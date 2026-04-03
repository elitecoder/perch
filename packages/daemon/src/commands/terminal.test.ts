import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTerminalHandlers } from './terminal.js'
import type { ITerminalAdapter, Session } from '../adapters/interface.js'

function makeAdapter(): ITerminalAdapter {
  return {
    name: 'mock',
    isAvailable: vi.fn(),
    listSessions: vi.fn(),
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
    it('responds with session info', async () => {
      vi.mocked(adapter.listSessions).mockResolvedValue([mockSession])
      await handlers.list([], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('main'))
    })

    it('responds with no sessions message when empty', async () => {
      vi.mocked(adapter.listSessions).mockResolvedValue([])
      await handlers.list([], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('No active'))
    })
  })

  describe('tree', () => {
    it('filters by session name when arg given', async () => {
      vi.mocked(adapter.listSessions).mockResolvedValue([mockSession])
      await handlers.tree(['main'], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('main'))
    })

    it('responds with not found when session missing', async () => {
      vi.mocked(adapter.listSessions).mockResolvedValue([mockSession])
      await handlers.tree(['nonexistent'], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('not found'))
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

    it('responds with usage when no pane given', async () => {
      await handlers.read([], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    })

    it('wraps output in code block', async () => {
      await handlers.read(['%0'], respond)
      const text = vi.mocked(respond).mock.calls[0]![0] as string
      expect(text).toMatch(/^```/)
    })
  })

  describe('send', () => {
    it('calls sendText with pane and text', async () => {
      await handlers.send(['%0', 'hello', 'world'], respond)
      expect(adapter.sendText).toHaveBeenCalledWith('%0', 'hello world')
    })

    it('responds with usage when args missing', async () => {
      await handlers.send(['%0'], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    })
  })

  describe('key', () => {
    it('calls sendKey with pane and key', async () => {
      await handlers.key(['%0', 'C-c'], respond)
      expect(adapter.sendKey).toHaveBeenCalledWith('%0', 'C-c')
    })

    it('responds with usage when args missing', async () => {
      await handlers.key(['%0'], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    })
  })
})
