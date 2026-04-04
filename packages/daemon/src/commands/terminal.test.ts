import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTerminalHandlers } from './terminal.js'
import type { ITerminalAdapter, Session } from '../adapters/interface.js'

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

const mockSession: Session = {
  id: '$0',
  name: 'main',
  windows: [{
    id: '@0',
    name: 'editor',
    panes: [{
      id: 'tmux:main:@0:%0',
      index: 0,
      active: true,
      command: 'vim',
      dimensions: { rows: 40, cols: 120 },
    }],
  }],
}

describe('terminal command handlers', () => {
  let adapter: ITerminalAdapter
  let handlers: ReturnType<typeof makeTerminalHandlers>
  let respond: ReturnType<typeof vi.fn>

  beforeEach(() => {
    adapter = makeAdapter()
    handlers = makeTerminalHandlers(adapter)
    respond = vi.fn().mockResolvedValue(undefined)
  })

  describe('list', () => {
    it('responds with session name and pane info', async () => {
      vi.mocked(adapter.listSessions).mockResolvedValue([mockSession])
      await handlers.list([], respond)
      const text = respond.mock.calls[0]![0] as string
      expect(text).toContain('*main*')
      expect(text).toContain('`0`') // short pane ID
      expect(text).toContain('vim')  // command
    })

    it('responds with exact no-sessions message', async () => {
      vi.mocked(adapter.listSessions).mockResolvedValue([])
      await handlers.list([], respond)
      expect(respond).toHaveBeenCalledWith('No active sessions.')
    })
  })

  describe('tree', () => {
    it('filters by session name and includes pane details', async () => {
      vi.mocked(adapter.listSessions).mockResolvedValue([mockSession])
      await handlers.tree(['main'], respond)
      const text = respond.mock.calls[0]![0] as string
      expect(text).toContain('*main*')
      expect(text).toContain('(active)')
      expect(text).toContain('vim')
    })

    it('responds with specific not-found message including session name', async () => {
      vi.mocked(adapter.listSessions).mockResolvedValue([mockSession])
      await handlers.tree(['nonexistent'], respond)
      expect(respond).toHaveBeenCalledWith('Session `nonexistent` not found.')
    })

    it('shows all sessions when no filter given', async () => {
      vi.mocked(adapter.listSessions).mockResolvedValue([mockSession])
      await handlers.tree([], respond)
      const text = respond.mock.calls[0]![0] as string
      expect(text).toContain('*main*')
    })

    it('shows no-sessions message when empty and no filter', async () => {
      vi.mocked(adapter.listSessions).mockResolvedValue([])
      await handlers.tree([], respond)
      expect(respond).toHaveBeenCalledWith('No active sessions.')
    })
  })

  describe('read', () => {
    it('calls readPane with paneId and line count', async () => {
      await handlers.read(['%0', '30'], respond)
      expect(adapter.readPane).toHaveBeenCalledWith('%0', 30)
    })

    it('defaults to 50 lines', async () => {
      await handlers.read(['%0'], respond)
      expect(adapter.readPane).toHaveBeenCalledWith('%0', 50)
    })

    it('responds with usage including command syntax', async () => {
      await handlers.read([], respond)
      expect(respond).toHaveBeenCalledWith('Usage: `read <pane> [lines]`')
    })

    it('wraps output in code block with actual content', async () => {
      vi.mocked(adapter.readPane).mockResolvedValue('hello world')
      await handlers.read(['%0'], respond)
      expect(respond).toHaveBeenCalledWith('```\nhello world\n```')
    })

    it('shows (empty) for blank pane content', async () => {
      vi.mocked(adapter.readPane).mockResolvedValue('  \n  ')
      await handlers.read(['%0'], respond)
      expect(respond).toHaveBeenCalledWith('```\n(empty)\n```')
    })
  })

  describe('send', () => {
    it('joins multi-word text and sends to pane', async () => {
      await handlers.send(['%0', 'hello', 'world'], respond)
      expect(adapter.sendText).toHaveBeenCalledWith('%0', 'hello world')
      expect(respond).toHaveBeenCalledWith(':white_check_mark: Sent to `%0`')
    })

    it('responds with usage when text missing', async () => {
      await handlers.send(['%0'], respond)
      expect(respond).toHaveBeenCalledWith('Usage: `send <pane> <text>`')
    })

    it('responds with usage when both args missing', async () => {
      await handlers.send([], respond)
      expect(respond).toHaveBeenCalledWith('Usage: `send <pane> <text>`')
    })
  })

  describe('key', () => {
    it('sends key and confirms with both key and pane in response', async () => {
      await handlers.key(['%0', 'C-c'], respond)
      expect(adapter.sendKey).toHaveBeenCalledWith('%0', 'C-c')
      expect(respond).toHaveBeenCalledWith(':white_check_mark: Sent key `C-c` to `%0`')
    })

    it('responds with usage when key missing', async () => {
      await handlers.key(['%0'], respond)
      expect(respond).toHaveBeenCalledWith('Usage: `key <pane> <key>`')
    })

    it('responds with usage when both args missing', async () => {
      await handlers.key([], respond)
      expect(respond).toHaveBeenCalledWith('Usage: `key <pane> <key>`')
    })
  })

  describe('resolvePane', () => {
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
