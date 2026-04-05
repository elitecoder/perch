import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTerminalHandlers } from './terminal.js'
import type { ITerminalAdapter } from '../adapters/interface.js'
import type { WatcherManager } from '../watcher/manager.js'

vi.mock('../transcript/claude-finder.js', () => ({
  findClaudePanes: vi.fn().mockResolvedValue([]),
}))

import { findClaudePanes } from '../transcript/claude-finder.js'

function makeAdapter(): ITerminalAdapter {
  return {
    name: 'mock',
    isAvailable: vi.fn(),
    listSessions: vi.fn().mockResolvedValue([]),
    readPane: vi.fn().mockResolvedValue('pane output'),
    sendText: vi.fn().mockResolvedValue(undefined),
    sendKey: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn(),
    renameSession: vi.fn(),
    closeSession: vi.fn(),
    splitPane: vi.fn(),
    selectPane: vi.fn(),
  } as unknown as ITerminalAdapter
}

function makeWatcher(): WatcherManager {
  return {
    listWatches: vi.fn().mockReturnValue([]),
    watch: vi.fn(),
    unwatch: vi.fn(),
    getByThread: vi.fn(),
    dispose: vi.fn(),
  } as unknown as WatcherManager
}

const mockClaudePane = {
  paneId: 'tmux:main:@0:%0',
  sessionName: 'my-feature',
  sessionId: 'abc-123',
  cwd: '/home/user/dev',
  jsonlPath: '/home/user/.claude/projects/-home-user-dev/abc-123.jsonl',
}

describe('terminal command handlers', () => {
  let adapter: ITerminalAdapter
  let watcher: WatcherManager
  let handlers: ReturnType<typeof makeTerminalHandlers>
  let respond: ReturnType<typeof vi.fn>

  beforeEach(() => {
    adapter = makeAdapter()
    watcher = makeWatcher()
    handlers = makeTerminalHandlers(adapter, watcher)
    respond = vi.fn().mockResolvedValue(undefined)
    vi.mocked(findClaudePanes).mockResolvedValue([])
  })

  describe('list', () => {
    it('responds with no-sessions message when no Claude panes found', async () => {
      vi.mocked(findClaudePanes).mockResolvedValue([])
      await handlers.list([], respond)
      expect(respond).toHaveBeenCalledWith('No active Claude sessions.')
    })

    it('shows session name and pane ID', async () => {
      vi.mocked(findClaudePanes).mockResolvedValue([mockClaudePane])
      await handlers.list([], respond)
      const text = respond.mock.calls[0]![0] as string
      expect(text).toContain('my-feature')
      expect(text).toContain('`0`')
    })

    it('marks watched panes with watching indicator', async () => {
      vi.mocked(findClaudePanes).mockResolvedValue([mockClaudePane])
      vi.mocked(watcher.listWatches).mockReturnValue(['tmux:main:@0:%0'])
      await handlers.list([], respond)
      const text = respond.mock.calls[0]![0] as string
      expect(text).toContain('watching')
    })

    it('does not mark unwatched panes', async () => {
      vi.mocked(findClaudePanes).mockResolvedValue([mockClaudePane])
      vi.mocked(watcher.listWatches).mockReturnValue([])
      await handlers.list([], respond)
      const text = respond.mock.calls[0]![0] as string
      expect(text).not.toContain('watching')
    })

    it('lists multiple sessions', async () => {
      vi.mocked(findClaudePanes).mockResolvedValue([
        mockClaudePane,
        { ...mockClaudePane, paneId: 'tmux:main:@0:%1', sessionName: 'other-project' },
      ])
      await handlers.list([], respond)
      const text = respond.mock.calls[0]![0] as string
      expect(text).toContain('my-feature')
      expect(text).toContain('other-project')
    })
  })

  describe('resolvePane', () => {
    const mockSession = {
      id: '$0',
      name: 'main',
      windows: [{
        id: '@0',
        name: 'editor',
        panes: [{
          id: 'tmux:main:@0:%0',
          index: 0,
          active: true,
          command: 'zsh',
          dimensions: { rows: 40, cols: 120 },
        }],
      }],
    }

    it('resolves short numeric ID to full pane ID', async () => {
      vi.mocked(adapter.listSessions).mockResolvedValue([mockSession])
      const resolved = await handlers.resolvePane('0')
      expect(resolved).toBe('tmux:main:@0:%0')
    })

    it('passes through full IDs without scanning', async () => {
      const resolved = await handlers.resolvePane('tmux:main:@0:%0')
      expect(resolved).toBe('tmux:main:@0:%0')
      expect(adapter.listSessions).not.toHaveBeenCalled()
    })

    it('returns input as fallback when short ID not found', async () => {
      vi.mocked(adapter.listSessions).mockResolvedValue([mockSession])
      const resolved = await handlers.resolvePane('999')
      expect(resolved).toBe('999')
    })
  })
})
