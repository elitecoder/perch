/**
 * Shared E2E test harness for Perch — adapter-agnostic.
 *
 * Exercises every Perch feature by wiring up the real adapter, plugins,
 * WatcherManager, and CommandRouter, replacing only the Slack Poster with a mock.
 *
 * Each adapter test file (e2e-cmux.test.ts, e2e-tmux.test.ts) provides a
 * setup/teardown implementation and calls registerE2ETests().
 */
import { describe, it, expect, beforeAll, afterAll, vi, type SpyInstance } from 'vitest'
import { ClaudeCodePlugin } from './plugins/builtin/claude-code.js'
import { GenericPlugin } from './plugins/builtin/generic.js'
import { WatcherManager } from './watcher/manager.js'
import { CommandRouter } from './commands/router.js'
import { makeTerminalHandlers } from './commands/terminal.js'
import { makeWorkspaceHandlers } from './commands/workspace.js'
import { makeWatchHandlers } from './commands/watch.js'
import { makeSystemHandlers } from './commands/system.js'
import type { ITerminalAdapter } from './adapters/interface.js'
import type { LiveView } from './slack/poster.js'
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

  makeLiveView(_threadTs: string): LiveView {
    const self = this
    return {
      async update(text: string) { await self.post(text) },
      async transition(text: string) { await self.post(text) },
    } as LiveView
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
   * - testPaneId: full pane ID (e.g. "cmux:workspace:3:surface:7")
   * - testShortId: bare numeric short ID shown in `tree` output (e.g. "7")
   * - testCommandId: (optional) ID to use in commands like `send`, `read`, `watch`.
   *   Defaults to testShortId. Use full pane ID when short IDs are ambiguous (e.g. zellij).
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

const TEST_SESSION_NAME = 'perch-e2e-test'
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
          const keyNames = Object.keys(entry.plugin.keyAliases)
          const msg = keyNames.length
            ? `*Keys for ${entry.plugin.displayName}:*\n${keyNames.map(k => `• \`${k}\` → ${entry.plugin.keyAliases[k]}`).join('\n')}\n\nType \`unwatch\` to stop.`
            : 'No key aliases for this preset.'
          await poster.postToThread(threadTs, msg)
          return
        }

        if (lower === 'unwatch') {
          watcher.unwatch(entry.paneId)
          await poster.postToThread(threadTs, `:white_check_mark: Stopped watching \`${entry.paneId}\``)
          return
        }

        const keyAlias = entry.plugin.keyAliases[lower]
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

    plugins = [new ClaudeCodePlugin(), new GenericPlugin()]
    watcher = new WatcherManager()
    poster = new MockPoster()
    startedAt = new Date()

    router = new CommandRouter()
    const terminalHandlers = makeTerminalHandlers(adapter)
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
    router.register('new', async (args, respond) => {
      const sub = args[0]?.toLowerCase()
      if (sub === 'session') return workspaceHandlers.newSession(args.slice(1), respond)
      if (sub === 'split') return workspaceHandlers.newSplit(args.slice(1), respond)
      await respond('Usage: `new session <name>` or `new split <dir> <pane>`')
    })
    router.register('rename', workspaceHandlers.rename)
    router.register('close', workspaceHandlers.close)
    router.register('select', workspaceHandlers.select)
  }, 15_000)

  afterAll(async () => {
    watcher.dispose()
    await provider.teardown()
  }, 10_000)

  // -------------------------------------------------------------------------
  // Terminal commands
  // -------------------------------------------------------------------------

  describe('Terminal commands', () => {
    it('list — shows test session', async () => {
      poster.clear()
      await handleText('list')
      expect(poster.last()).toContain(TEST_SESSION_NAME)
    })

    it('ls — alias for list', async () => {
      poster.clear()
      await handleText('ls')
      expect(poster.last()).toContain(TEST_SESSION_NAME)
    })

    it('tree — shows session tree', async () => {
      poster.clear()
      await handleText('tree')
      expect(poster.last()).toContain(TEST_SESSION_NAME)
      expect(poster.last()).toContain(testShortId)
    })

    it('read <pane> — reads pane content', async () => {
      poster.clear()
      await handleText(`read ${testCommandId}`)
      expect(poster.last()).toContain('```')
    })

    it('send <pane> <text> — sends text to pane', async () => {
      poster.clear()
      await handleText(`send ${testCommandId} echo hello-perch-e2e`)
      expect(poster.last()).toContain('Sent to')
      await wait(800)
      const screen = await adapter.readPane(testPaneId, 20)
      expect(screen).toContain('hello-perch-e2e')
    })

    it('key <pane> <key> — sends keystroke', async () => {
      poster.clear()
      await handleText(`key ${testCommandId} ctrl-c`)
      expect(poster.last()).toContain('Sent key')
    })
  })

  // -------------------------------------------------------------------------
  // Watch commands
  // -------------------------------------------------------------------------

  describe('Watch commands', () => {
    it('watch <pane> — starts watching', async () => {
      poster.clear()
      await handleText(`watch ${testCommandId} --preset generic`)
      const allText = poster.messages.map(m => m.text).join('\n')
      expect(allText).toContain('Watching')
      expect(watcher.listWatches()).toContain(testPaneId)
    })

    it('watching — lists watched panes', async () => {
      poster.clear()
      await handleText('watching')
      expect(poster.last()).toContain(testPaneId)
    })

    it('unwatch <pane> — stops watching', async () => {
      poster.clear()
      await handleText(`unwatch ${testCommandId}`)
      expect(poster.last()).toContain('Stopped watching')
      expect(watcher.listWatches()).not.toContain(testPaneId)
    })

    it('preset — sets global default', async () => {
      poster.clear()
      await handleText('preset generic')
      expect(poster.last()).toContain('Default preset set to')
    })

    it('preset <pane> <id> — sets per-pane override', async () => {
      poster.clear()
      await handleText(`preset ${testCommandId} claude`)
      expect(poster.last()).toContain('Preset for')
    })
  })

  // -------------------------------------------------------------------------
  // Workspace commands
  // -------------------------------------------------------------------------

  describe('Workspace commands', () => {
    let childSessionId: string

    it('new session — creates session', async () => {
      poster.clear()
      await handleText(`new session ${CHILD_SESSION_NAME}`)
      await wait(600)
      expect(poster.last()).toContain('Created session')
      expect(poster.last()).toContain(CHILD_SESSION_NAME)
      // Verify via adapter
      const sessions = await adapter.listSessions()
      const child = sessions.find(s => s.name === CHILD_SESSION_NAME)
      expect(child).toBeDefined()
      childSessionId = child!.id
    })

    it('rename — renames session', async () => {
      poster.clear()
      const renamedName = 'perch-e2e-renamed'
      await handleText(`rename ${childSessionId} ${renamedName}`)
      await wait(400)
      expect(poster.last()).toContain('Renamed')
      const sessions = await adapter.listSessions()
      const renamed = sessions.find(s => s.name === renamedName)
      expect(renamed).toBeDefined()
      // Rename back for close test — use the current ID (which may have changed for name-based adapters like zellij)
      await adapter.renameSession(renamed!.id, CHILD_SESSION_NAME)
      await wait(400)
      // Re-fetch the ID after rename-back (it may have changed)
      const sessionsAfter = await adapter.listSessions()
      const restored = sessionsAfter.find(s => s.name === CHILD_SESSION_NAME)
      if (restored) childSessionId = restored.id
    })

    it('new split — splits pane', async () => {
      poster.clear()
      await handleText(`new split right ${testPaneId}`)
      await wait(400)
      expect(poster.last()).toContain('Split')
    })

    it('select — selects pane', async () => {
      poster.clear()
      await handleText(`select ${testPaneId}`)
      expect(poster.last()).toContain('Selected pane')
    })

    it('close — closes session', async () => {
      poster.clear()
      await handleText(`close ${childSessionId}`)
      await wait(400)
      expect(poster.last()).toContain('Closed')
      const sessions = await adapter.listSessions()
      expect(sessions.find(s => s.name === CHILD_SESSION_NAME)).toBeUndefined()
    })
  })

  // -------------------------------------------------------------------------
  // System commands
  // -------------------------------------------------------------------------

  describe('System commands', () => {
    it('help — shows command reference', async () => {
      poster.clear()
      await handleText('help')
      expect(poster.last()).toContain('Perch Commands')
      expect(poster.last()).toContain('Terminal')
      expect(poster.last()).toContain('Watch')
      expect(poster.last()).toContain('Workspace')
    })

    it('status — shows daemon status', async () => {
      poster.clear()
      await handleText('status')
      expect(poster.last()).toContain(`Adapter: \`${provider.adapterName}\``)
      expect(poster.last()).toContain('Uptime:')
      expect(poster.last()).toContain('Plugins:')
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
      await handleText(`watch ${testCommandId} --preset claude`)
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
      ['accept', 'y'],
      ['reject', 'n'],
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
      it(`key alias "${alias}" �� sendKey("${expectedKey}")`, async () => {
        sendKeySpy.mockClear()
        await handleText(alias, watchThreadTs)
        expect(sendKeySpy).toHaveBeenCalledWith(testPaneId, expectedKey)
      })
    }

    // -- Thread meta-commands --

    it('keys/help in thread ��� lists all key aliases', async () => {
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

    // -- Raw text forwarding --

    it('forwards "whoami" to pane and shows output', async () => {
      sendTextSpy.mockClear()
      await handleText('whoami', watchThreadTs)
      expect(sendTextSpy).toHaveBeenCalledWith(testPaneId, 'whoami')
      await wait(1000)
      const screen = await adapter.readPane(testPaneId, 20)
      expect(screen).toContain('whoami')
    })

    it('forwards "which npm" to pane', async () => {
      sendTextSpy.mockClear()
      await handleText('which npm', watchThreadTs)
      expect(sendTextSpy).toHaveBeenCalledWith(testPaneId, 'which npm')
      await wait(1000)
      const screen = await adapter.readPane(testPaneId, 20)
      expect(screen).toMatch(/npm|which/)
    })

    it('forwards "echo perch-e2e-marker" and verifies in pane', async () => {
      sendTextSpy.mockClear()
      await handleText('echo perch-e2e-marker', watchThreadTs)
      expect(sendTextSpy).toHaveBeenCalledWith(testPaneId, 'echo perch-e2e-marker')
      await wait(1000)
      const screen = await adapter.readPane(testPaneId, 20)
      expect(screen).toContain('perch-e2e-marker')
    })

    it('forwards "pwd" to pane', async () => {
      sendTextSpy.mockClear()
      await handleText('pwd', watchThreadTs)
      expect(sendTextSpy).toHaveBeenCalledWith(testPaneId, 'pwd')
      await wait(1000)
      const screen = await adapter.readPane(testPaneId, 20)
      expect(screen).toContain('/')
    })

    it('forwards "date" to pane', async () => {
      sendTextSpy.mockClear()
      await handleText('date', watchThreadTs)
      expect(sendTextSpy).toHaveBeenCalledWith(testPaneId, 'date')
      await wait(1000)
      const screen = await adapter.readPane(testPaneId, 20)
      expect(screen).toMatch(/202\d/)
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
  // Sad paths — invalid commands, bad args, unknown panes
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

    it('read — missing pane arg', async () => {
      poster.clear()
      await handleText('read')
      expect(poster.last()).toContain('Usage')
      expect(poster.last()).toContain('read')
    })

    it('send — missing text arg', async () => {
      poster.clear()
      await handleText(`send ${testCommandId}`)
      expect(poster.last()).toContain('Usage')
      expect(poster.last()).toContain('send')
    })

    it('send — missing both args', async () => {
      poster.clear()
      await handleText('send')
      expect(poster.last()).toContain('Usage')
    })

    it('key — missing key arg', async () => {
      poster.clear()
      await handleText(`key ${testCommandId}`)
      expect(poster.last()).toContain('Usage')
      expect(poster.last()).toContain('key')
    })

    it('key — missing both args', async () => {
      poster.clear()
      await handleText('key')
      expect(poster.last()).toContain('Usage')
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

    it('new — missing subcommand', async () => {
      poster.clear()
      await handleText('new')
      expect(poster.last()).toContain('Usage')
    })

    it('new session — missing name', async () => {
      poster.clear()
      await handleText('new session')
      expect(poster.last()).toContain('Usage')
    })

    it('new split — missing args', async () => {
      poster.clear()
      await handleText('new split')
      expect(poster.last()).toContain('Usage')
    })

    it('new split — missing pane', async () => {
      poster.clear()
      await handleText('new split right')
      expect(poster.last()).toContain('Usage')
    })

    it('rename — missing args', async () => {
      poster.clear()
      await handleText('rename')
      expect(poster.last()).toContain('Usage')
    })

    it('rename — missing new name', async () => {
      poster.clear()
      await handleText('rename $0')
      expect(poster.last()).toContain('Usage')
    })

    it('close — missing target', async () => {
      poster.clear()
      await handleText('close')
      expect(poster.last()).toContain('Usage')
    })

    it('select — missing pane', async () => {
      poster.clear()
      await handleText('select')
      expect(poster.last()).toContain('Usage')
    })

    it('tree — non-existent session name', async () => {
      poster.clear()
      await handleText('tree nonexistent-session-xyz')
      expect(poster.last()).toContain('not found')
    })

    it('watch — unknown preset', async () => {
      poster.clear()
      await handleText(`watch ${testCommandId} --preset nonexistent`)
      // Should fall back to default plugin, not crash
      const allText = poster.messages.map(m => m.text).join('\n')
      expect(allText).toContain('Watching')
      // Clean up
      watcher.unwatch(testPaneId)
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
      expect(poster.last()).toContain(TEST_SESSION_NAME)
    })
  })
}
