import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWorkspaceHandlers } from './workspace.js'
import type { ITerminalAdapter, Session } from '../adapters/interface.js'

function makeAdapter(): ITerminalAdapter {
  return {
    name: 'mock',
    isAvailable: vi.fn(),
    listSessions: vi.fn().mockResolvedValue([]),
    readPane: vi.fn(),
    sendText: vi.fn(),
    sendKey: vi.fn(),
    createSession: vi.fn().mockResolvedValue({
      id: '$1',
      name: 'new-session',
      windows: [{ id: '@0', name: 'win', panes: [] }],
    } satisfies Session),
    renameSession: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
    splitPane: vi.fn().mockResolvedValue({
      id: 'tmux:test:@0:%2',
      index: 1,
      active: true,
      command: 'bash',
      dimensions: { rows: 24, cols: 80 },
    }),
    selectPane: vi.fn().mockResolvedValue(undefined),
  } as unknown as ITerminalAdapter
}

describe('workspace command handlers', () => {
  let adapter: ITerminalAdapter
  let handlers: ReturnType<typeof makeWorkspaceHandlers>
  let respond: ReturnType<typeof vi.fn>

  beforeEach(() => {
    adapter = makeAdapter()
    handlers = makeWorkspaceHandlers(adapter)
    respond = vi.fn().mockResolvedValue(undefined)
  })

  describe('newSession', () => {
    it('responds with usage when no name given', async () => {
      await handlers.newSession([], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('Usage'))
      expect(adapter.createSession).not.toHaveBeenCalled()
    })

    it('creates session with name only', async () => {
      await handlers.newSession(['my-project'], respond)
      expect(adapter.createSession).toHaveBeenCalledWith('my-project', undefined, undefined)
      expect(respond).toHaveBeenCalledWith(':white_check_mark: Created session *new-session* (`$1`)')
    })

    it('passes --cwd flag to createSession', async () => {
      await handlers.newSession(['proj', '--cwd', '/home/user/dev'], respond)
      expect(adapter.createSession).toHaveBeenCalledWith('proj', '/home/user/dev', undefined)
    })

    it('passes --cmd flag to createSession', async () => {
      await handlers.newSession(['proj', '--cmd', 'vim'], respond)
      expect(adapter.createSession).toHaveBeenCalledWith('proj', undefined, 'vim')
    })

    it('passes both --cwd and --cmd flags', async () => {
      await handlers.newSession(['proj', '--cwd', '/tmp', '--cmd', 'htop'], respond)
      expect(adapter.createSession).toHaveBeenCalledWith('proj', '/tmp', 'htop')
    })

    it('propagates adapter errors', async () => {
      vi.mocked(adapter.createSession).mockRejectedValue(new Error('workspace limit'))
      await expect(handlers.newSession(['proj'], respond)).rejects.toThrow('workspace limit')
    })
  })

  describe('newSplit', () => {
    it('responds with usage when direction missing', async () => {
      await handlers.newSplit([], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    })

    it('responds with usage when pane missing', async () => {
      await handlers.newSplit(['right'], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    })

    it('splits pane and confirms with IDs', async () => {
      await handlers.newSplit(['right', '%0'], respond)
      expect(adapter.splitPane).toHaveBeenCalledWith('%0', 'right')
      expect(respond).toHaveBeenCalledWith(':white_check_mark: Split `%0` → new pane `tmux:test:@0:%2`')
    })
  })

  describe('rename', () => {
    it('responds with usage when target missing', async () => {
      await handlers.rename([], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    })

    it('responds with usage when new name missing', async () => {
      await handlers.rename(['$0'], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    })

    it('renames session and confirms', async () => {
      await handlers.rename(['$0', 'better-name'], respond)
      expect(adapter.renameSession).toHaveBeenCalledWith('$0', 'better-name')
      expect(respond).toHaveBeenCalledWith(':white_check_mark: Renamed `$0` to *better-name*')
    })
  })

  describe('close', () => {
    it('responds with usage when target missing', async () => {
      await handlers.close([], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    })

    it('closes session and confirms', async () => {
      await handlers.close(['$0'], respond)
      expect(adapter.closeSession).toHaveBeenCalledWith('$0')
      expect(respond).toHaveBeenCalledWith(':white_check_mark: Closed `$0`')
    })
  })

  describe('select', () => {
    it('responds with usage when pane missing', async () => {
      await handlers.select([], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    })

    it('selects pane and confirms', async () => {
      await handlers.select(['%2'], respond)
      expect(adapter.selectPane).toHaveBeenCalledWith('%2')
      expect(respond).toHaveBeenCalledWith(':white_check_mark: Selected pane `%2`')
    })
  })
})
