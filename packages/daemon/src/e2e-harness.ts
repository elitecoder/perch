/**
 * Shared E2E test harness for Perch — adapter-agnostic.
 *
 * Exercises Perch commands by wiring up the real adapter, plugins,
 * WatcherManager, and CommandRouter, replacing only the Slack Poster with a mock.
 *
 * Each adapter test file (e2e-cmux.test.ts, e2e-tmux.test.ts) provides a
 * setup/teardown implementation and calls registerE2ETests().
 *
 * Note: `list` returns "No active Claude sessions" in these tests because no
 * real Claude process is running. For full Claude session tests see e2e-tmux-claude.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi, type SpyInstance } from 'vitest'
import { ClaudeCodePlugin } from './plugins/builtin/claude-code.js'
import { WatcherManager } from './watcher/manager.js'
import { CommandRouter } from './commands/router.js'
import { makeTerminalHandlers } from './commands/terminal.js'
import { makeWorkspaceHandlers } from './commands/workspace.js'
import { makeWatchHandlers } from './commands/watch.js'
import { makeSystemHandlers } from './commands/system.js'
import type { ITerminalAdapter } from './adapters/interface.js'
import type { ConversationalView } from './slack/poster.js'
import type { IToolPlugin } from './plugins/interface.js'

// ---------------------------------------------------------------------------
// Mock Poster — captures messages instead of posting to Slack
// ---------------------------------------------------------------------------

export class MockPoster {
  messages: { text: string; threadTs?: string }[] = []
  _ts = 0

  clear() { this.messages = [] }
  last() { return this.messages[this.messages.length - 1]?.text ?? '' }

  async post(text: string) {
    const ts = String(++this._ts)
    this.messages.push({ text })
    return { ts }
  }

  async postToThread(threadTs: string, text: string) {
    const ts = String(++this._ts)
    this.messages.push({ text, threadTs })
    return { ts }
  }

  async postCode(text: string) { return this.post('```\n' + text + '\n```') }
  async postError(msg: string) { void this.post(`:x: ${msg}`) }
  async update(_ts: string, _text: string) { /* no-op */ }

  makeConversationalView(threadTs: string): ConversationalView {
    const self = this
    return {
      async updateStatus(text: string) { await self.postToThread(threadTs, text) },
      async postResponse(text: string) { await self.postToThread(threadTs, text) },
      async updateResponse(text: string) { await self.postToThread(threadTs, text) },
      async postUser(text: string) { await self.postToThread(threadTs, text) },
    } as unknown as ConversationalView
  }

  makeThreadPostFn(threadTs: string) {
    return (msg: string) => this.postToThread(threadTs, msg).then(() => undefined)
  }
}

// ---------------------------------------------------------------------------
// Provider interface — each adapter implements this
// ---------------------------------------------------------------------------

export interface E2EProvider {
  /** Adapter display name (e.g. "cmux", "tmux") — used in status assertion */
  adapterName: string

  /**
   * Create a test workspace/session and return:
   * - adapter: a real ITerminalAdapter instance
   * - testPaneId: full pane ID (e.g. "tmux:perch-e2e-test:@0:%1")
   * - testShortId: bare numeric short ID (e.g. "1")
   * - testCommandId: (optional) ID to use in commands. Defaults to testShortId.
   */
  setup(): Promise<{
    adapter: ITerminalAdapter
    testPaneId: string
    testShortId: string
    testCommandId?: string
  }>

  /** Clean up all test workspaces/sessions */
  teardown(): Promise<void>
}

// ---------------------------------------------------------------------------
// Shared test suite
// ---------------------------------------------------------------------------

/** Small delay for terminal state to propagate */
function wait(ms = 400) {
  return new Promise(r => setTimeout(r, ms))
}

const CHILD_SESSION_NAME = 'perch-e2e-child'

export function registerE2ETests(provider: E2EProvider) {
  let adapter: ITerminalAdapter
  let plugins: IToolPlugin[]
  let watcher: WatcherManager
  let router: CommandRouter
  let poster: MockPoster
  let startedAt: Date

  let testPaneId: string
  let testShortId: string
  let testCommandId: string

  // Replicates handleText from socket.ts without Slack
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
          await poster.postToThread(threadTs, `:white_check_mark: Stopped watching \`${entry.paneId}\``)
          return
        }

        const keyAliases = entry.plugin?.keyAliases ?? {}
        const keyAlias = keyAliases[lower]
        if (keyAlias) {
          await adapter.sendKey(entry.paneId, keyAlias)
        } else {
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
  // Setup / Teardown
  // -------------------------------------------------------------------------

  beforeAll(async () => {
    const result = await provider.setup()
    adapter = result.adapter
    testPaneId = result.testPaneId
    testShortId = result.testShortId
    testCommandId = result.testCommandId ?? result.testShortId

    plugins = [new ClaudeCodePlugin()]
    watcher = new WatcherManager()
    poster = new MockPoster()
    startedAt = new Date()

    router = new CommandRouter()
    const terminalHandlers = makeTerminalHandlers(adapter, watcher)
    const workspaceHandlers = makeWorkspaceHandlers(adapter)
    const watchHandlers = makeWatchHandlers(adapter, plugins, watcher, poster as any, terminalHandlers.resolvePane)
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
  }, 15_000)

  afterAll(async () => {
    watcher.dispose()
    await provider.teardown()
  }, 10_000)

  // -------------------------------------------------------------------------
  // Terminal commands
  // -------------------------------------------------------------------------

  describe('Terminal commands', () => {
    it('list — returns Claude sessions list or empty message', async () => {
      poster.clear()
      await handleText('list')
      const text = poster.last()
      // Either no sessions running or a formatted list — both valid
      const valid = text.includes('No active Claude sessions') || text.includes('*Claude sessions:*')
      expect(valid, `Unexpected list response: ${text}`).toBe(true)
    })

    it('sessions — alias for list, same format', async () => {
      poster.clear()
      await handleText('sessions')
      const text = poster.last()
      const valid = text.includes('No active Claude sessions') || text.includes('*Claude sessions:*')
      expect(valid, `Unexpected sessions response: ${text}`).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  // Watch commands
  // -------------------------------------------------------------------------

  describe('Watch commands', () => {
    it('watch <pane> — starts watching (warns: no Claude session)', async () => {
      poster.clear()
      await handleText(`watch ${testCommandId}`)
      const allText = poster.messages.map(m => m.text).join('\n')
      expect(allText).toContain('Watching')
      expect(watcher.listWatches()).toContain(testPaneId)
    })

    it('watching — lists watched panes', async () => {
      poster.clear()
      await handleText('watching')
      expect(poster.last()).toContain('Watching')
    })

    it('unwatch <pane> — stops watching', async () => {
      poster.clear()
      await handleText(`unwatch ${testCommandId}`)
      expect(poster.last()).toContain('Stopped watching')
      expect(watcher.listWatches()).not.toContain(testPaneId)
    })
  })

  // -------------------------------------------------------------------------
  // New command — creates session and launches Claude
  // -------------------------------------------------------------------------

  describe('New command', () => {
    let childSessionId: string

    it('new <name> — creates session, sends claude command, posts pane ID', async () => {
      poster.clear()
      await handleText(`new ${CHILD_SESSION_NAME}`)
      await wait(600)
      const text = poster.last()
      expect(text).toContain('Created session')
      expect(text).toContain(CHILD_SESSION_NAME)
      expect(text).toContain('watch')
      // Verify session was actually created
      const sessions = await adapter.listSessions()
      const child = sessions.find(s => s.name === CHILD_SESSION_NAME)
      expect(child).toBeDefined()
      childSessionId = child!.id
    })

    it('new — missing name responds with usage', async () => {
      poster.clear()
      await handleText('new')
      expect(poster.last()).toContain('Usage')
    })

    afterAll(async () => {
      if (childSessionId) {
        await adapter.closeSession(childSessionId).catch(() => {})
      }
    })
  })

  // -------------------------------------------------------------------------
  // System commands
  // -------------------------------------------------------------------------

  describe('System commands', () => {
    it('help — shows command reference with new command set', async () => {
      poster.clear()
      await handleText('help')
      const text = poster.last()
      expect(text).toContain('Perch Commands')
      expect(text).toContain('list')
      expect(text).toContain('new')
      expect(text).toContain('watch')
    })

    it('status — shows daemon status', async () => {
      poster.clear()
      await handleText('status')
      const text = poster.last()
      expect(text).toContain(`Adapter: \`${provider.adapterName}\``)
      expect(text).toContain('Uptime:')
      expect(text).toContain('Plugins:')
    })
  })

  // -------------------------------------------------------------------------
  // Thread interactions — key aliases + text forwarding
  // -------------------------------------------------------------------------

  describe('Thread interactions', () => {
    let watchThreadTs: string
    let sendKeySpy: SpyInstance
    let sendTextSpy: SpyInstance

    beforeAll(async () => {
      const tsBefore = poster._ts
      poster.clear()
      await handleText(`watch ${testCommandId}`)
      expect(watcher.listWatches()).toContain(testPaneId)

      const tsAfter = poster._ts
      let foundTs = ''
      for (let i = tsBefore + 1; i <= tsAfter; i++) {
        if (watcher.getByThread(String(i))) {
          foundTs = String(i)
          break
        }
      }
      expect(foundTs).not.toBe('')
      watchThreadTs = foundTs

      sendKeySpy = vi.spyOn(adapter, 'sendKey')
      sendTextSpy = vi.spyOn(adapter, 'sendText')
    })

    afterAll(() => {
      sendKeySpy?.mockRestore()
      sendTextSpy?.mockRestore()
      watcher.unwatch(testPaneId)
    })

    // -- Key aliases (14 total) --

    const keyAliasTests: Array<[string, string]> = [
      ['accept', 'Enter'],
      ['reject', 'Escape'],
      ['interrupt', 'C-c'],
      ['expand', 'C-o'],
      ['esc', 'Escape'],
      ['escape', 'Escape'],
      ['confirm', 'Enter'],
      ['enter', 'Enter'],
      ['tab', 'Tab'],
      ['up', 'Up'],
      ['down', 'Down'],
      ['left', 'Left'],
      ['right', 'Right'],
      ['space', 'Space'],
    ]

    for (const [alias, expectedKey] of keyAliasTests) {
      it(`key alias "${alias}" → sendKey("${expectedKey}")`, async () => {
        sendKeySpy.mockClear()
        await handleText(alias, watchThreadTs)
        expect(sendKeySpy).toHaveBeenCalledWith(testPaneId, expectedKey)
      })
    }

    // -- Thread meta-commands --

    it('keys/help in thread — lists all key aliases', async () => {
      poster.clear()
      await handleText('keys', watchThreadTs)
      const response = poster.last()
      expect(response).toContain('Keys for')
      expect(response).toContain('accept')
      expect(response).toContain('reject')
      expect(response).toContain('interrupt')
      expect(response).toContain('expand')
      expect(response).toContain('esc')
      expect(response).toContain('confirm')
      expect(response).toContain('tab')
      expect(response).toContain('up')
      expect(response).toContain('down')
      expect(response).toContain('space')
      expect(response).toContain('unwatch')
    })

    // -- Text forwarding (prompts sent to Claude via thread) --

    it('forwards a prompt to the pane via sendText', async () => {
      sendTextSpy.mockClear()
      await handleText('What time is it?', watchThreadTs)
      expect(sendTextSpy).toHaveBeenCalledWith(testPaneId, 'What time is it?')
    })

    it('forwards a multi-word prompt to the pane', async () => {
      sendTextSpy.mockClear()
      await handleText('Summarize the last 3 git commits', watchThreadTs)
      expect(sendTextSpy).toHaveBeenCalledWith(testPaneId, 'Summarize the last 3 git commits')
    })

    it('does not treat unknown text as a key alias', async () => {
      sendKeySpy.mockClear()
      sendTextSpy.mockClear()
      await handleText('refactor the auth module', watchThreadTs)
      expect(sendKeySpy).not.toHaveBeenCalled()
      expect(sendTextSpy).toHaveBeenCalledWith(testPaneId, 'refactor the auth module')
    })

    // -- Unwatch from thread (must be last thread test) --

    it('unwatch in thread — stops watching', async () => {
      poster.clear()
      await handleText('unwatch', watchThreadTs)
      expect(poster.last()).toContain('Stopped watching')
      expect(watcher.listWatches()).not.toContain(testPaneId)
    })
  })

  // -------------------------------------------------------------------------
  // Sad paths
  // -------------------------------------------------------------------------

  describe('Sad paths', () => {
    it('unknown command — responds with helpful error', async () => {
      poster.clear()
      await handleText('foobar')
      expect(poster.last()).toContain('Unknown command')
      expect(poster.last()).toContain('foobar')
      expect(poster.last()).toContain('help')
    })

    it('another unknown command — "deploy"', async () => {
      poster.clear()
      await handleText('deploy production')
      expect(poster.last()).toContain('Unknown command')
      expect(poster.last()).toContain('deploy')
    })

    it('watch — missing pane arg', async () => {
      poster.clear()
      await handleText('watch')
      expect(poster.last()).toContain('Usage')
    })

    it('unwatch — missing pane arg', async () => {
      poster.clear()
      await handleText('unwatch')
      expect(poster.last()).toContain('Usage')
    })

    it('new — missing name arg', async () => {
      poster.clear()
      await handleText('new')
      expect(poster.last()).toContain('Usage')
    })

    it('empty message — no response', async () => {
      poster.clear()
      await handleText('')
      expect(poster.messages).toHaveLength(0)
    })

    it('whitespace-only message — no response', async () => {
      poster.clear()
      await handleText('   ')
      expect(poster.messages).toHaveLength(0)
    })

    it('case insensitivity — "HELP" works like "help"', async () => {
      poster.clear()
      await handleText('HELP')
      expect(poster.last()).toContain('Perch Commands')
    })

    it('case insensitivity — "LIST" works like "list"', async () => {
      poster.clear()
      await handleText('LIST')
      const text = poster.last()
      const valid = text.includes('No active Claude sessions') || text.includes('*Claude sessions:*')
      expect(valid, `Unexpected LIST response: ${text}`).toBe(true)
    })
  })
}
