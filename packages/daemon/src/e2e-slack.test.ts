/**
 * Perch E2E tests — real Slack API integration.
 *
 * Requires:
 *   - cmux running with Automation Mode enabled
 *   - Slack tokens in macOS Keychain (service: dev.perch)
 *   - Channel ID in ~/.config/perch/config.json
 *
 * Run: npx vitest run --config vitest.e2e.config.ts src/e2e-slack.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { writeFileSync } from 'fs'
import { join } from 'path'
import keytar from 'keytar'
import { WebClient } from '@slack/web-api'
import { execa } from 'execa'
import { CmuxAdapter } from './adapters/cmux.js'
import { ClaudeCodePlugin } from './plugins/builtin/claude-code.js'
import { WatcherManager } from './watcher/manager.js'
import { CommandRouter } from './commands/router.js'
import { makeTerminalHandlers } from './commands/terminal.js'
import { makeWatchHandlers } from './commands/watch.js'
import { makeSystemHandlers } from './commands/system.js'
import { makeWorkspaceHandlers } from './commands/workspace.js'
import { Poster } from './slack/poster.js'
import { readConfig, readState, writeState } from './config.js'
import { resumeWatches } from './resume.js'

const KEYCHAIN_SERVICE = 'dev.perch'
const CMUX = '/Applications/cmux.app/Contents/Resources/bin/cmux'
const TEST_WS_NAME = 'perch-e2e-slack'
const CHILD_WS_NAME = 'perch-e2e-child'

function cmux(args: string[]) {
  return execa(CMUX, args)
}

function wait(ms = 400) {
  return new Promise(r => setTimeout(r, ms))
}

// Collect all message timestamps for cleanup
const messagesToDelete: string[] = []

describe('E2E — Slack integration', () => {
  let client: WebClient
  let poster: Poster
  let channelId: string
  let adapter: CmuxAdapter
  let plugins: ClaudeCodePlugin[]
  let watcher: WatcherManager
  let router: CommandRouter
  let testPaneId: string
  let testShortId: string
  let workspaceRef: string
  let startedAt: Date

  // -------------------------------------------------------------------------
  // Helper: wire up router with current watcher
  // -------------------------------------------------------------------------

  function wireRouter() {
    router = new CommandRouter()
    const terminalHandlers = makeTerminalHandlers(adapter, watcher)
    const workspaceHandlers = makeWorkspaceHandlers(adapter)
    const watchHandlers = makeWatchHandlers(adapter, plugins, watcher, poster, terminalHandlers.resolvePane)
    const systemHandlers = makeSystemHandlers(adapter, plugins, watcher, startedAt)

    for (const [name, handler] of Object.entries({
      ...terminalHandlers,
      ...systemHandlers,
      ...watchHandlers,
    })) {
      if (typeof handler === 'function' && name !== 'resolvePane') {
        router.register(name, handler)
      }
    }
    router.register('new', workspaceHandlers.newClaude)
    router.register('sessions', terminalHandlers.list)
  }

  // -------------------------------------------------------------------------
  // Helper: replicate handleText from socket.ts
  // -------------------------------------------------------------------------

  async function handleText(text: string, threadTs?: string) {
    const cleaned = text.replace(/^<@[A-Z0-9]+>\s*/i, '').trim()
    if (!cleaned) return

    if (threadTs) {
      const entry = watcher.getByThread(threadTs)
      if (entry) {
        const lower = cleaned.toLowerCase()

        if (lower === 'keys' || lower === 'help') {
          const keyAliases = entry.plugin?.keyAliases ?? {}
          const keyNames = Object.keys(keyAliases)
          const name = entry.plugin?.displayName ?? 'Claude Code'
          const msg = keyNames.length
            ? `*Keys for ${name}:*\n${keyNames.map(k => `• \`${k}\` → ${keyAliases[k]}`).join('\n')}\n\nType \`unwatch\` to stop.`
            : 'No key aliases for this preset.'
          await poster.postToThread(threadTs, msg)
          return
        }

        if (lower === 'unwatch') {
          watcher.unwatch(entry.paneId)
          const state = readState()
          const { [entry.paneId]: _, ...remainingThreads } = state.watchThreads ?? {}
          writeState({ ...state, watches: state.watches.filter(id => id !== entry.paneId), watchThreads: remainingThreads })
          const sid = entry.paneId.match(/:(\d+)$/)?.[1] ?? entry.paneId.match(/%(\d+)$/)?.[1] ?? entry.paneId
          await poster.postToThread(threadTs, `:white_check_mark: Stopped watching \`${sid}\``)
          return
        }

        const keyAliases = entry.plugin?.keyAliases ?? {}
        const keyAlias = keyAliases[lower]
        if (keyAlias) {
          await adapter.sendKey(entry.paneId, keyAlias)
        } else {
          watcher.recordForwardedText(entry.paneId, cleaned)
          await adapter.sendText(entry.paneId, cleaned)
        }
        return
      }
    }

    const respond = async (replyText: string) => {
      if (threadTs) {
        await poster.postToThread(threadTs, replyText)
      } else {
        await poster.post(replyText)
      }
    }
    await router.dispatch(cleaned, respond)
  }

  // -------------------------------------------------------------------------
  // Helpers: read from Slack
  // -------------------------------------------------------------------------

  async function getThreadReplies(threadTs: string): Promise<Array<{ ts: string; text: string }>> {
    const res = await client.conversations.replies({ channel: channelId, ts: threadTs })
    return (res.messages ?? []).slice(1).map(m => ({ ts: m.ts!, text: m.text ?? '' }))
  }

  async function getMessage(ts: string): Promise<string> {
    const res = await client.conversations.history({
      channel: channelId, latest: ts, inclusive: true, limit: 1,
    })
    return res.messages?.[0]?.text ?? ''
  }

  async function getRecentMessages(limit = 10): Promise<Array<{ ts: string; text: string; thread_ts?: string }>> {
    const res = await client.conversations.history({ channel: channelId, limit })
    return (res.messages ?? []).map(m => ({ ts: m.ts!, text: m.text ?? '', thread_ts: m.thread_ts }))
  }

  // -------------------------------------------------------------------------
  // Setup / Teardown
  // -------------------------------------------------------------------------

  beforeAll(async () => {
    delete process.env.CMUX_SURFACE_ID
    delete process.env.CMUX_WORKSPACE_ID
    delete process.env.CMUX_TAB_ID

    const botToken = await keytar.getPassword(KEYCHAIN_SERVICE, 'botToken')
    if (!botToken) throw new Error('No botToken in Keychain — run `perch setup` first')

    const config = readConfig()
    channelId = config.slackChannelId
    if (!channelId) throw new Error('No slackChannelId in config — run `perch setup` first')

    client = new WebClient(botToken)
    poster = new Poster(client, client, channelId)

    // Wrap poster to track all posted messages for cleanup
    const origPost = poster.post.bind(poster)
    poster.post = async (text: string) => {
      const res = await origPost(text)
      messagesToDelete.push(res.ts)
      return res
    }
    const origPostToThread = poster.postToThread.bind(poster)
    poster.postToThread = async (threadTs: string, text: string) => {
      const res = await origPostToThread(threadTs, text)
      messagesToDelete.push(res.ts)
      return res
    }

    // Create cmux test workspace
    const { stdout: pingOut } = await cmux(['ping'])
    if (!pingOut.includes('PONG')) throw new Error('cmux is not running')

    const { stdout: wsBefore } = await cmux(['list-workspaces'])
    for (const line of wsBefore.split('\n')) {
      if (line.includes(TEST_WS_NAME) || line.includes(CHILD_WS_NAME)) {
        const match = line.match(/(workspace:\d+)/)
        if (match) await cmux(['close-workspace', '--workspace', match[1]]).catch(() => {})
      }
    }
    await wait()

    await cmux(['new-workspace', '--name', TEST_WS_NAME])
    await wait(600)
    const { stdout: wsTemp } = await cmux(['list-workspaces'])
    const wsTempLine = wsTemp.split('\n').find(l => l.includes(TEST_WS_NAME))
    if (wsTempLine) {
      workspaceRef = wsTempLine.match(/(workspace:\d+)/)![1]
      await cmux(['select-workspace', '--workspace', workspaceRef])
      await wait(1000)
    }

    const { stdout: wsAfter } = await cmux(['list-workspaces'])
    const wsLine = wsAfter.split('\n').find(l => l.includes(TEST_WS_NAME))
    if (!wsLine) throw new Error(`Could not find workspace "${TEST_WS_NAME}" after creation`)
    workspaceRef = wsLine.match(/(workspace:\d+)/)![1]

    const { stdout: panelsOut } = await cmux(['list-panels', '--workspace', workspaceRef])
    const surfMatch = panelsOut.match(/(surface:\d+)\s+terminal/)
    if (!surfMatch) throw new Error('Could not find terminal surface in test workspace')
    const surfaceRef = surfMatch[1]
    testPaneId = `cmux:${workspaceRef}:${surfaceRef}`
    testShortId = surfaceRef.split(':')[1]

    adapter = new CmuxAdapter()
    plugins = [new ClaudeCodePlugin()]
    watcher = new WatcherManager()
    startedAt = new Date()

    wireRouter()
  }, 20_000)

  afterAll(async () => {
    watcher.dispose()

    // Clean up test cmux workspaces
    const { stdout } = await cmux(['list-workspaces']).catch(() => ({ stdout: '' }))
    for (const line of stdout.split('\n')) {
      if (line.includes(TEST_WS_NAME) || line.includes(CHILD_WS_NAME)) {
        const match = line.match(/(workspace:\d+)/)
        if (match) await cmux(['close-workspace', '--workspace', match[1]]).catch(() => {})
      }
    }

    // Capture all test messages before deletion
    const report: string[] = ['# Perch Slack E2E — Message Capture', `Run: ${new Date().toISOString()}`, '']
    const seen = new Set<string>()
    for (const ts of [...new Set(messagesToDelete)]) {
      try {
        const res = await client.conversations.replies({ channel: channelId, ts, limit: 100 }).catch(() => null)
        if (!res?.messages?.length) continue
        const parentTs = res.messages[0]!.ts!
        if (seen.has(parentTs)) continue
        seen.add(parentTs)
        report.push(`---`)
        for (const msg of res.messages) {
          const indent = msg.ts === parentTs ? '' : '    '
          const time = new Date(parseFloat(msg.ts!) * 1000).toLocaleTimeString()
          report.push(`${indent}[${time}] ${msg.text}`)
        }
        report.push('')
      } catch { /* skip */ }
    }
    const reportPath = join(process.cwd(), 'e2e-slack-messages.txt')
    writeFileSync(reportPath, report.join('\n'), 'utf-8')
    console.log(`\n📋 Message capture saved to ${reportPath}\n`)

    // Delete all test messages from Slack
    for (const ts of messagesToDelete.reverse()) {
      await client.chat.delete({ channel: channelId, ts }).catch(() => {})
    }
  }, 30_000)

  // =========================================================================
  // 1. Poster basics
  // =========================================================================

  describe('Poster basics', () => {
    it('post() — creates a channel message with valid ts', async () => {
      const { ts } = await poster.post(':test_tube: Perch E2E test message')
      expect(ts).toMatch(/^\d+\.\d+$/)
      const text = await getMessage(ts)
      expect(text).toContain('Perch E2E test message')
    })

    it('postToThread() — creates a threaded reply', async () => {
      const { ts: parentTs } = await poster.post(':test_tube: Thread parent')
      const { ts: replyTs } = await poster.postToThread(parentTs, 'Thread reply')
      expect(replyTs).toMatch(/^\d+\.\d+$/)
      const replies = await getThreadReplies(parentTs)
      expect(replies.some(r => r.text === 'Thread reply')).toBe(true)
    })

    it('update() — edits a message in place', async () => {
      const { ts } = await poster.post(':test_tube: Before edit')
      await poster.update(ts, ':test_tube: After edit')
      const text = await getMessage(ts)
      expect(text).toContain('After edit')
      expect(text).not.toContain('Before edit')
    })

    it('postCode() — wraps text in a code block', async () => {
      const { ts } = await poster.postCode('echo hello')
      messagesToDelete.push(ts)
      const text = await getMessage(ts)
      expect(text).toContain('```')
      expect(text).toContain('echo hello')
    })

    it('postError() — posts an error message', async () => {
      await poster.postError('Something went wrong')
      await wait(200)
      const msgs = await getRecentMessages(3)
      expect(msgs.some(m => m.text.includes('Something went wrong'))).toBe(true)
    })
  })

  // =========================================================================
  // 2. System commands
  // =========================================================================

  describe('System commands', () => {
    it('help — shows command reference', async () => {
      await handleText('help')
      await wait(200)
      const msgs = await getRecentMessages(3)
      const helpMsg = msgs.find(m => m.text.includes('Perch Commands'))
      expect(helpMsg).toBeDefined()
      expect(helpMsg!.text).toContain('list')
      expect(helpMsg!.text).toContain('watch')
      expect(helpMsg!.text).toContain('new')
    })

    it('status — shows daemon status with adapter and uptime', async () => {
      await handleText('status')
      await wait(200)
      const msgs = await getRecentMessages(3)
      const statusMsg = msgs.find(m => m.text.includes('Adapter:'))
      expect(statusMsg).toBeDefined()
      expect(statusMsg!.text).toContain('`cmux`')
      expect(statusMsg!.text).toContain('Uptime:')
      expect(statusMsg!.text).toContain('Plugins:')
    })

    it('HELP — case insensitive', async () => {
      await handleText('HELP')
      await wait(200)
      const msgs = await getRecentMessages(3)
      expect(msgs.some(m => m.text.includes('Perch Commands'))).toBe(true)
    })
  })

  // =========================================================================
  // 3. Terminal commands
  // =========================================================================

  describe('Terminal commands', () => {
    it('list — returns Claude sessions or empty message', async () => {
      await handleText('list')
      await wait(200)
      const msgs = await getRecentMessages(3)
      const listMsg = msgs.find(m =>
        m.text.includes('No active Claude sessions') || m.text.includes('Claude sessions:')
      )
      expect(listMsg).toBeDefined()
    })

    it('sessions — alias for list', async () => {
      await handleText('sessions')
      await wait(200)
      const msgs = await getRecentMessages(3)
      const listMsg = msgs.find(m =>
        m.text.includes('No active Claude sessions') || m.text.includes('Claude sessions:')
      )
      expect(listMsg).toBeDefined()
    })
  })

  // =========================================================================
  // 4. Workspace commands
  // =========================================================================

  describe('Workspace commands', () => {
    let childSessionId: string

    it('new <name> — creates session and posts confirmation', async () => {
      await handleText(`new ${CHILD_WS_NAME}`)
      await wait(600)
      const msgs = await getRecentMessages(5)
      const newMsg = msgs.find(m => m.text.includes('Created session') && m.text.includes(CHILD_WS_NAME))
      expect(newMsg).toBeDefined()
      expect(newMsg!.text).toContain('watch')

      const sessions = await adapter.listSessions()
      const child = sessions.find(s => s.name === CHILD_WS_NAME)
      expect(child).toBeDefined()
      childSessionId = child!.id
    })

    it('new — missing name responds with usage', async () => {
      await handleText('new')
      await wait(200)
      const msgs = await getRecentMessages(3)
      expect(msgs.some(m => m.text.includes('Usage'))).toBe(true)
    })

    afterAll(async () => {
      if (childSessionId) {
        await adapter.closeSession(childSessionId).catch(() => {})
      }
    })
  })

  // =========================================================================
  // 5. Watch flow — full thread lifecycle
  // =========================================================================

  describe('Watch flow', () => {
    let watchParentTs: string

    it('watch — posts top-level message with "Watching" and short ID', async () => {
      await handleText(`watch ${testShortId}`)
      await wait(300)

      const msgs = await getRecentMessages(5)
      const watchMsg = msgs.find(m => m.text?.includes('Watching') && m.text?.includes(`\`${testShortId}\``))
      expect(watchMsg).toBeDefined()
      watchParentTs = watchMsg!.ts
      if (!messagesToDelete.includes(watchParentTs)) messagesToDelete.push(watchParentTs)
    })

    it('watch — header contains key aliases and unwatch hint', async () => {
      const text = await getMessage(watchParentTs)
      expect(text).toContain('accept')
      expect(text).toContain('reject')
      expect(text).toContain('interrupt')
      expect(text).toContain('unwatch')
    })

    it('watch — "Started watching" confirmation is in the thread, not channel', async () => {
      const replies = await getThreadReplies(watchParentTs)
      expect(replies.some(r => r.text.includes('Started watching'))).toBe(true)

      const msgs = await getRecentMessages(10)
      const channelMsgs = msgs.filter(m => m.text.includes('Started watching') && !m.thread_ts)
      expect(channelMsgs.length).toBe(0)
    })

    it('watching — lists the pane as watched', async () => {
      await handleText('watching')
      await wait(200)
      const msgs = await getRecentMessages(3)
      const watchingMsg = msgs.find(m => m.text.includes('Watching') && m.text.includes(`\`${testShortId}\``))
      expect(watchingMsg).toBeDefined()
    })

    it('unwatch — stops watching and posts confirmation', async () => {
      await handleText(`unwatch ${testShortId}`)
      await wait(200)
      expect(watcher.listWatches()).not.toContain(testPaneId)
      const msgs = await getRecentMessages(3)
      expect(msgs.some(m => m.text.includes('Stopped watching'))).toBe(true)
    })
  })

  // =========================================================================
  // 6. Thread interactions — key aliases, text forwarding, help
  // =========================================================================

  describe('Thread interactions', () => {
    let watchThreadTs: string
    let sendKeySpy: ReturnType<typeof vi.spyOn>
    let sendTextSpy: ReturnType<typeof vi.spyOn>

    beforeAll(async () => {
      await handleText(`watch ${testShortId}`)
      await wait(300)

      const state = readState()
      watchThreadTs = state.watchThreads?.[testPaneId] ?? ''
      expect(watchThreadTs).not.toBe('')
      if (!messagesToDelete.includes(watchThreadTs)) messagesToDelete.push(watchThreadTs)

      sendKeySpy = vi.spyOn(adapter, 'sendKey')
      sendTextSpy = vi.spyOn(adapter, 'sendText')
    })

    afterAll(() => {
      sendKeySpy?.mockRestore()
      sendTextSpy?.mockRestore()
      watcher.unwatch(testPaneId)
    })

    it('key alias "accept" → sendKey("Enter")', async () => {
      sendKeySpy.mockClear()
      await handleText('accept', watchThreadTs)
      expect(sendKeySpy).toHaveBeenCalledWith(testPaneId, 'Enter')
    })

    it('key alias "reject" → sendKey("Escape")', async () => {
      sendKeySpy.mockClear()
      await handleText('reject', watchThreadTs)
      expect(sendKeySpy).toHaveBeenCalledWith(testPaneId, 'Escape')
    })

    it('key alias "interrupt" → sendKey("C-c")', async () => {
      sendKeySpy.mockClear()
      await handleText('interrupt', watchThreadTs)
      expect(sendKeySpy).toHaveBeenCalledWith(testPaneId, 'C-c')
    })

    it('key alias "tab" → sendKey("Tab")', async () => {
      sendKeySpy.mockClear()
      await handleText('tab', watchThreadTs)
      expect(sendKeySpy).toHaveBeenCalledWith(testPaneId, 'Tab')
    })

    it('key alias "up" → sendKey("Up")', async () => {
      sendKeySpy.mockClear()
      await handleText('up', watchThreadTs)
      expect(sendKeySpy).toHaveBeenCalledWith(testPaneId, 'Up')
    })

    it('text forwarding — sends prompt to pane via sendText', async () => {
      sendTextSpy.mockClear()
      await handleText('What time is it?', watchThreadTs)
      expect(sendTextSpy).toHaveBeenCalledWith(testPaneId, 'What time is it?')
    })

    it('text forwarding — records forwarded text for echo suppression', async () => {
      const recordSpy = vi.spyOn(watcher, 'recordForwardedText')
      await handleText('Summarize the last 3 commits', watchThreadTs)
      expect(recordSpy).toHaveBeenCalledWith(testPaneId, 'Summarize the last 3 commits')
      recordSpy.mockRestore()
    })

    it('unknown text is forwarded, not treated as key alias', async () => {
      sendKeySpy.mockClear()
      sendTextSpy.mockClear()
      await handleText('refactor the auth module', watchThreadTs)
      expect(sendKeySpy).not.toHaveBeenCalled()
      expect(sendTextSpy).toHaveBeenCalledWith(testPaneId, 'refactor the auth module')
    })

    it('keys/help in thread — lists all key aliases in Slack', async () => {
      await handleText('keys', watchThreadTs)
      await wait(200)
      const replies = await getThreadReplies(watchThreadTs)
      const keysReply = replies.find(r => r.text.includes('Keys for'))
      expect(keysReply).toBeDefined()
      expect(keysReply!.text).toContain('accept')
      expect(keysReply!.text).toContain('reject')
      expect(keysReply!.text).toContain('interrupt')
      expect(keysReply!.text).toContain('unwatch')
    })

    it('unwatch from thread — stops watching and posts to thread', async () => {
      await handleText('unwatch', watchThreadTs)
      await wait(200)
      expect(watcher.listWatches()).not.toContain(testPaneId)
      const replies = await getThreadReplies(watchThreadTs)
      expect(replies.some(r => r.text.includes('Stopped watching'))).toBe(true)
    })
  })

  // =========================================================================
  // 7. Watch resume — thread reuse across restarts
  // =========================================================================

  describe('Watch resume', () => {
    let originalThreadTs: string

    it('resume reuses the existing Slack thread (no new top-level message)', async () => {
      // Start a watch
      await handleText(`watch ${testShortId}`)
      await wait(300)

      const state = readState()
      originalThreadTs = state.watchThreads?.[testPaneId] ?? ''
      expect(originalThreadTs).not.toBe('')
      if (!messagesToDelete.includes(originalThreadTs)) messagesToDelete.push(originalThreadTs)

      const beforeMsgs = await getRecentMessages(20)
      const beforeCount = beforeMsgs.length

      // Simulate restart
      watcher.dispose()
      watcher = new WatcherManager()
      wireRouter()

      const resumeState = readState()
      const config = readConfig()
      await resumeWatches(resumeState, config, adapter, plugins, watcher, poster)
      await wait(300)

      // No new top-level messages
      const afterMsgs = await getRecentMessages(20)
      expect(afterMsgs.length).toBe(beforeCount)

      // Same thread ts persisted
      const newState = readState()
      expect(newState.watchThreads?.[testPaneId]).toBe(originalThreadTs)
    })

    it('posting after resume goes to the same thread', async () => {
      await poster.postToThread(originalThreadTs, ':test_tube: Post after resume')
      await wait(200)
      const replies = await getThreadReplies(originalThreadTs)
      expect(replies.some(r => r.text.includes('Post after resume'))).toBe(true)
    })

    afterAll(() => {
      watcher.unwatch(testPaneId)
    })
  })

  // =========================================================================
  // 8. ConversationalView — edit-in-place behavior
  // =========================================================================

  describe('ConversationalView', () => {
    it('updateStatus — posts then edits in place on second call', async () => {
      const { ts: threadTs } = await poster.post(':test_tube: ConversationalView test')
      const view = poster.makeConversationalView(threadTs)

      await view.updateStatus(':hourglass: Working on step 1...')
      await wait(300)
      let replies = await getThreadReplies(threadTs)
      expect(replies.some(r => r.text.includes('step 1'))).toBe(true)

      // Wait past STATUS_EDIT_INTERVAL_MS (1500ms) so the edit is not throttled
      await wait(1600)
      await view.updateStatus(':hourglass: Working on step 2...')
      await wait(300)
      replies = await getThreadReplies(threadTs)
      expect(replies.filter(r => r.text.includes('step 2')).length).toBe(1)
      expect(replies.filter(r => r.text.includes('step 1')).length).toBe(0)
    })

    it('postResponse — posts a new message separate from status', async () => {
      const { ts: threadTs } = await poster.post(':test_tube: Response test')
      const view = poster.makeConversationalView(threadTs)

      await view.updateStatus(':hourglass: Thinking...')
      await wait(200)
      await view.postResponse('Here is my response.')
      await wait(300)

      const replies = await getThreadReplies(threadTs)
      expect(replies.some(r => r.text.includes('Here is my response'))).toBe(true)
      expect(replies.length).toBeGreaterThanOrEqual(2)
    })

    it('updateResponse — edits the response message in place', async () => {
      const { ts: threadTs } = await poster.post(':test_tube: Response edit test')
      const view = poster.makeConversationalView(threadTs)

      await view.postResponse('Response v1')
      await wait(300)
      // Delta must exceed BUFFER_THRESHOLD (40 chars) to trigger an edit
      await view.updateResponse('Response v1 — updated with enough additional text to pass the buffer threshold')
      await wait(300)

      const replies = await getThreadReplies(threadTs)
      expect(replies.some(r => r.text.includes('buffer threshold'))).toBe(true)
      expect(replies.filter(r => r.text === 'Response v1').length).toBe(0)
    })

    it('postUser — posts a brief user message', async () => {
      const { ts: threadTs } = await poster.post(':test_tube: User message test')
      const view = poster.makeConversationalView(threadTs)

      await view.postUser(':bust_in_silhouette: User said something')
      await wait(200)

      const replies = await getThreadReplies(threadTs)
      expect(replies.some(r => r.text.includes('User said something'))).toBe(true)
    })
  })

  // =========================================================================
  // 9. Progress indicators — typing, reactions, stall detection
  // =========================================================================

  describe('Progress indicators', () => {
    it('setTypingStatus — sets and clears typing without error', async () => {
      const { ts: threadTs } = await poster.post(':test_tube: Typing indicator test')
      await poster.setTypingStatus(threadTs, 'is thinking...')
      await wait(200)
      await poster.clearTypingStatus(threadTs)
      // No error thrown = success (typing indicator is ephemeral, can't read it back)
    })

    it('addReaction / removeReaction — does not throw', async () => {
      const { ts } = await poster.post(':test_tube: Reaction test')
      // addReaction/removeReaction silently ignore errors (including missing scope)
      await poster.addReaction(ts, 'eyes')
      await wait(200)
      await poster.removeReaction(ts, 'eyes')
      // No error = success. Verification requires reactions:read scope.
    })

    it('StatusReactor — transitions without error', async () => {
      const { StatusReactor } = await import('./transcript/monitor.js')

      const { ts } = await poster.post(':test_tube: StatusReactor test')
      const reactor = new StatusReactor(poster, ts)

      // Transitions should not throw (reactions:write may or may not be available)
      await reactor.transition('eyes')
      expect(reactor.current).toBe('eyes')
      await reactor.transition('wrench')
      expect(reactor.current).toBe('wrench')
      await reactor.transition('white_check_mark')
      expect(reactor.current).toBe('white_check_mark')
    })
  })

  // =========================================================================
  // 10. Hermes-style posting improvements
  // =========================================================================

  describe('Hermes-style posting', () => {
    it('update() uses higher text limit than postMessage (MAX_UPDATE_LENGTH = 4000)', async () => {
      const { ts } = await poster.post(':test_tube: Higher limit test')
      // 3500 chars: would be truncated by MAX_POST_LENGTH (3000) but fits in MAX_UPDATE_LENGTH (4000)
      const longText = 'x'.repeat(3500)
      await poster.update(ts, longText)
      await wait(300)
      const text = await getMessage(ts)
      expect(text.length).toBe(3500)
    })

    it('toSlackMrkdwn preserves code blocks', async () => {
      // Import and test directly
      const { toSlackMrkdwn } = await import('./transcript/formatter.js')
      const input = '**bold** and ```\n**not bold**\n```'
      const result = toSlackMrkdwn(input)
      expect(result).toContain('*bold*')
      expect(result).toContain('```\n**not bold**\n```')
    })

    it('tool dedup counter works', async () => {
      const { ConversationalFormatter } = await import('./transcript/formatter.js')
      const fmt = new ConversationalFormatter()
      const actions = fmt.processRecords([{
        type: 'assistant',
        uuid: 'test',
        isSidechain: false,
        message: {
          model: 'claude-sonnet-4-6',
          id: 'msg_test',
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/a.ts' } },
            { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/a.ts' } },
            { type: 'tool_use', id: 't3', name: 'Read', input: { file_path: '/a.ts' } },
          ],
          stop_reason: 'tool_use',
        },
      } as any])
      const status = actions.find(a => a.type === 'update_status')!
      expect(status.text).toContain('(×3)')
      expect(status.text.split('\n')).toHaveLength(1)
    })
  })

  // =========================================================================
  // 11. Sad paths
  // =========================================================================

  describe('Sad paths', () => {
    it('unknown command — responds with helpful error', async () => {
      await handleText('foobar')
      await wait(200)
      const msgs = await getRecentMessages(3)
      const errMsg = msgs.find(m => m.text.includes('Unknown command') && m.text.includes('foobar'))
      expect(errMsg).toBeDefined()
      expect(errMsg!.text).toContain('help')
    })

    it('watch — missing pane arg', async () => {
      await handleText('watch')
      await wait(200)
      const msgs = await getRecentMessages(3)
      expect(msgs.some(m => m.text.includes('Usage'))).toBe(true)
    })

    it('unwatch — missing pane arg', async () => {
      await handleText('unwatch')
      await wait(200)
      const msgs = await getRecentMessages(3)
      expect(msgs.some(m => m.text.includes('Usage'))).toBe(true)
    })

    it('empty message — no response', async () => {
      const before = await getRecentMessages(3)
      await handleText('')
      await wait(200)
      const after = await getRecentMessages(3)
      expect(after[0]?.ts).toBe(before[0]?.ts)
    })

    it('whitespace-only message — no response', async () => {
      const before = await getRecentMessages(3)
      await handleText('   ')
      await wait(200)
      const after = await getRecentMessages(3)
      expect(after[0]?.ts).toBe(before[0]?.ts)
    })
  })
})
