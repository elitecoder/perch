import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TmuxAdapter } from './tmux.js'

// Mock execa module
vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'
const mockExeca = vi.mocked(execa)

function mockOutput(stdout: string) {
  return mockExeca.mockResolvedValueOnce({ stdout } as never)
}

describe('TmuxAdapter', () => {
  let adapter: TmuxAdapter

  beforeEach(() => {
    adapter = new TmuxAdapter()
    vi.clearAllMocks()
  })

  describe('isAvailable', () => {
    it('returns true when tmux -V succeeds', async () => {
      mockOutput('tmux 3.4')
      expect(await adapter.isAvailable()).toBe(true)
      expect(mockExeca).toHaveBeenCalledWith('tmux', ['-V'])
    })

    it('returns false when tmux -V throws', async () => {
      mockExeca.mockRejectedValueOnce(new Error('not found') as never)
      expect(await adapter.isAvailable()).toBe(false)
    })
  })

  describe('listSessions', () => {
    it('returns empty array when no sessions', async () => {
      mockOutput('')
      expect(await adapter.listSessions()).toEqual([])
    })

    it('parses sessions and recursively fetches windows/panes', async () => {
      // list-sessions
      mockOutput('$0:main')
      // list-windows for "main"
      mockOutput('@0:editor')
      // list-panes for "main":@0
      mockOutput('%0:0:1:vim:40:120')

      const sessions = await adapter.listSessions()
      expect(sessions).toHaveLength(1)
      expect(sessions[0].name).toBe('main')
      expect(sessions[0].windows).toHaveLength(1)
      expect(sessions[0].windows[0].panes).toHaveLength(1)
      expect(sessions[0].windows[0].panes[0].active).toBe(true)
      expect(sessions[0].windows[0].panes[0].command).toBe('vim')
      expect(sessions[0].windows[0].panes[0].dimensions).toEqual({ rows: 40, cols: 120 })
    })

    it('invokes correct tmux commands for session listing', async () => {
      mockOutput('$0:session1')
      mockOutput('@0:win1')
      mockOutput('%0:0:0:bash:24:80')

      await adapter.listSessions()

      expect(mockExeca).toHaveBeenNthCalledWith(1, 'tmux', [
        'list-sessions', '-F', '#{session_id}:#{session_name}',
      ])
      expect(mockExeca).toHaveBeenNthCalledWith(2, 'tmux', [
        'list-windows', '-t', 'session1', '-F', '#{window_id}:#{window_name}',
      ])
      expect(mockExeca).toHaveBeenNthCalledWith(3, 'tmux', [
        'list-panes', '-t', 'session1:@0', '-F',
        '#{pane_id}:#{pane_index}:#{pane_active}:#{pane_current_command}:#{pane_height}:#{pane_width}',
      ])
    })
  })

  describe('readPane', () => {
    it('calls capture-pane with correct target and line count', async () => {
      mockOutput('line1\nline2\n')
      const result = await adapter.readPane('tmux:main:@0:%1', 30)
      expect(result).toBe('line1\nline2\n')
      expect(mockExeca).toHaveBeenCalledWith('tmux', [
        'capture-pane', '-p', '-t', '%1', '-S', '-30',
      ])
    })

    it('defaults to 50 lines', async () => {
      mockOutput('')
      await adapter.readPane('tmux:main:@0:%0')
      expect(mockExeca).toHaveBeenCalledWith('tmux', [
        'capture-pane', '-p', '-t', '%0', '-S', '-50',
      ])
    })
  })

  describe('sendText', () => {
    it('calls send-keys with text and Enter', async () => {
      mockOutput('')
      await adapter.sendText('tmux:main:@0:%0', 'ls -la')
      expect(mockExeca).toHaveBeenCalledWith('tmux', [
        'send-keys', '-t', '%0', 'ls -la', 'Enter',
      ])
    })
  })

  describe('sendKey', () => {
    it('calls send-keys with the key only', async () => {
      mockOutput('')
      await adapter.sendKey('tmux:main:@0:%0', 'C-c')
      expect(mockExeca).toHaveBeenCalledWith('tmux', [
        'send-keys', '-t', '%0', 'C-c',
      ])
    })
  })

  describe('createSession', () => {
    it('calls new-session and returns the created session', async () => {
      mockOutput('') // new-session
      mockOutput('$1:newsession') // list-sessions
      mockOutput('@0:win') // list-windows
      mockOutput('%0:0:1:bash:24:80') // list-panes

      const session = await adapter.createSession('newsession')
      expect(mockExeca).toHaveBeenCalledWith('tmux', [
        'new-session', '-d', '-s', 'newsession',
      ])
      expect(session.name).toBe('newsession')
    })

    it('passes cwd and command when provided', async () => {
      mockOutput('')
      mockOutput('$1:dev')
      mockOutput('@0:win')
      mockOutput('%0:0:1:bash:24:80')

      await adapter.createSession('dev', '/home/user', 'vim')
      expect(mockExeca).toHaveBeenCalledWith('tmux', [
        'new-session', '-d', '-s', 'dev', '-c', '/home/user', 'vim',
      ])
    })
  })

  describe('renameSession', () => {
    it('calls rename-session', async () => {
      mockOutput('')
      await adapter.renameSession('$0', 'new-name')
      expect(mockExeca).toHaveBeenCalledWith('tmux', [
        'rename-session', '-t', '$0', 'new-name',
      ])
    })
  })

  describe('closeSession', () => {
    it('calls kill-session', async () => {
      mockOutput('')
      await adapter.closeSession('$0')
      expect(mockExeca).toHaveBeenCalledWith('tmux', ['kill-session', '-t', '$0'])
    })
  })

  describe('selectPane', () => {
    it('calls select-pane with tmux target', async () => {
      mockOutput('')
      await adapter.selectPane('tmux:main:@0:%2')
      expect(mockExeca).toHaveBeenCalledWith('tmux', ['select-pane', '-t', '%2'])
    })
  })

  describe('splitPane', () => {
    it('uses -h flag for horizontal split (left/right)', async () => {
      mockOutput('%1:1:0:bash:24:60')
      await adapter.splitPane('tmux:main:@0:%0', 'right')
      expect(mockExeca).toHaveBeenCalledWith('tmux', expect.arrayContaining(['-h']))
    })

    it('uses -v flag for vertical split (up/down)', async () => {
      mockOutput('%1:1:0:bash:12:80')
      await adapter.splitPane('tmux:main:@0:%0', 'down')
      expect(mockExeca).toHaveBeenCalledWith('tmux', expect.arrayContaining(['-v']))
    })

    it('returns a pane with correct id namespace', async () => {
      mockOutput('%3:1:0:bash:24:80')
      const pane = await adapter.splitPane('tmux:main:@0:%0', 'right')
      expect(pane.id).toBe('tmux:main:@0:%3')
    })
  })
})
