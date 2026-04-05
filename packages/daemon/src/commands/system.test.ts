import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSystemHandlers } from './system.js'
import type { ITerminalAdapter } from '../adapters/interface.js'
import type { IToolPlugin } from '../plugins/interface.js'
import type { WatcherManager } from '../watcher/manager.js'

function makeDeps() {
  const adapter: ITerminalAdapter = {
    name: 'tmux',
    isAvailable: vi.fn(),
    listSessions: vi.fn(),
    readPane: vi.fn(),
    sendText: vi.fn(),
    sendKey: vi.fn(),
    createSession: vi.fn(),
    renameSession: vi.fn(),
    closeSession: vi.fn(),
    splitPane: vi.fn(),
    selectPane: vi.fn(),
  } as unknown as ITerminalAdapter

  const plugins: IToolPlugin[] = [
    { id: 'claude', displayName: 'Claude Code' } as IToolPlugin,
    { id: 'generic', displayName: 'Generic Terminal' } as IToolPlugin,
  ]

  const watcher: WatcherManager = {
    watch: vi.fn(),
    unwatch: vi.fn(),
    listWatches: vi.fn().mockReturnValue([]),
    dispose: vi.fn(),
    getByThread: vi.fn(),
  } as unknown as WatcherManager

  return { adapter, plugins, watcher }
}

describe('system command handlers', () => {
  let deps: ReturnType<typeof makeDeps>
  let handlers: ReturnType<typeof makeSystemHandlers>
  let respond: ReturnType<typeof vi.fn>

  beforeEach(() => {
    deps = makeDeps()
    handlers = makeSystemHandlers(deps.adapter, deps.plugins, deps.watcher, new Date())
    respond = vi.fn().mockResolvedValue(undefined)
  })

  describe('help', () => {
    it('includes Perch Commands header', async () => {
      await handlers.help([], respond)
      const text = respond.mock.calls[0]![0] as string
      expect(text).toContain('*Perch Commands*')
    })

    it('documents list and new commands', async () => {
      await handlers.help([], respond)
      const text = respond.mock.calls[0]![0] as string
      expect(text).toContain('`list`')
      expect(text).toContain('`new')
    })

    it('documents watch, unwatch, watching commands', async () => {
      await handlers.help([], respond)
      const text = respond.mock.calls[0]![0] as string
      expect(text).toContain('`watch')
      expect(text).toContain('`unwatch')
      expect(text).toContain('`watching`')
    })

    it('documents system commands', async () => {
      await handlers.help([], respond)
      const text = respond.mock.calls[0]![0] as string
      expect(text).toContain('`help`')
      expect(text).toContain('`status`')
    })

    it('ignores extra args gracefully', async () => {
      await handlers.help(['extra', 'args'], respond)
      expect(respond).toHaveBeenCalled()
    })
  })

  describe('status', () => {
    it('includes adapter name', async () => {
      await handlers.status([], respond)
      const text = respond.mock.calls[0]![0] as string
      expect(text).toContain('Adapter: `tmux`')
    })

    it('includes uptime in seconds', async () => {
      const startedAt = new Date(Date.now() - 60_000) // 60s ago
      handlers = makeSystemHandlers(deps.adapter, deps.plugins, deps.watcher, startedAt)
      await handlers.status([], respond)
      const text = respond.mock.calls[0]![0] as string
      expect(text).toMatch(/Uptime: \d+s/)
      const uptimeMatch = text.match(/Uptime: (\d+)s/)
      expect(Number(uptimeMatch![1])).toBeGreaterThanOrEqual(58)
    })

    it('shows watch count and pane IDs when watching', async () => {
      vi.mocked(deps.watcher.listWatches).mockReturnValue(['%0', '%1'])
      await handlers.status([], respond)
      const text = respond.mock.calls[0]![0] as string
      expect(text).toContain('Watching: 2 pane(s)')
      expect(text).toContain('`%0`')
      expect(text).toContain('`%1`')
    })

    it('shows 0 panes when not watching', async () => {
      await handlers.status([], respond)
      const text = respond.mock.calls[0]![0] as string
      expect(text).toContain('Watching: 0 pane(s)')
    })

    it('lists all plugin IDs', async () => {
      await handlers.status([], respond)
      const text = respond.mock.calls[0]![0] as string
      expect(text).toContain('Plugins: claude, generic')
    })
  })
})
