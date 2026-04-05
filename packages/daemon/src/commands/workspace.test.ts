import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWorkspaceHandlers } from './workspace.js'
import type { ITerminalAdapter, Session } from '../adapters/interface.js'

const mockSession: Session = {
  id: '$1',
  name: 'new-session',
  windows: [{
    id: '@0',
    name: 'win',
    panes: [{
      id: 'tmux:new-session:@0:%0',
      index: 0,
      active: true,
      command: 'zsh',
      dimensions: { rows: 24, cols: 80 },
    }],
  }],
}

function makeAdapter(): ITerminalAdapter {
  return {
    name: 'mock',
    isAvailable: vi.fn(),
    listSessions: vi.fn().mockResolvedValue([]),
    readPane: vi.fn(),
    sendText: vi.fn().mockResolvedValue(undefined),
    sendKey: vi.fn(),
    createSession: vi.fn().mockResolvedValue(mockSession),
    renameSession: vi.fn(),
    closeSession: vi.fn(),
    splitPane: vi.fn(),
    selectPane: vi.fn(),
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

  describe('newClaude', () => {
    it('responds with usage when no name given', async () => {
      await handlers.newClaude([], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('Usage'))
      expect(adapter.createSession).not.toHaveBeenCalled()
    })

    it('creates session with name only and launches claude', async () => {
      await handlers.newClaude(['my-project'], respond)
      expect(adapter.createSession).toHaveBeenCalledWith('my-project', undefined)
      expect(adapter.sendText).toHaveBeenCalledWith('tmux:new-session:@0:%0', 'claude')
      const text = respond.mock.calls[0]![0] as string
      expect(text).toContain('my-project')
      expect(text).toContain('tmux:new-session:@0:%0')
      expect(text).toContain('watch')
    })

    it('passes --cwd flag to createSession', async () => {
      await handlers.newClaude(['proj', '--cwd', '/home/user/dev'], respond)
      expect(adapter.createSession).toHaveBeenCalledWith('proj', '/home/user/dev')
    })

    it('responds with error when session has no pane', async () => {
      vi.mocked(adapter.createSession).mockResolvedValue({
        id: '$1',
        name: 'empty',
        windows: [{ id: '@0', name: 'win', panes: [] }],
      })
      await handlers.newClaude(['my-project'], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining(':x:'))
      expect(adapter.sendText).not.toHaveBeenCalled()
    })

    it('propagates adapter errors', async () => {
      vi.mocked(adapter.createSession).mockRejectedValue(new Error('workspace limit'))
      await expect(handlers.newClaude(['proj'], respond)).rejects.toThrow('workspace limit')
    })
  })
})
