import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ZellijAdapter } from './zellij.js'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'
const mockExeca = vi.mocked(execa)

function mockOutput(stdout: string) {
  return mockExeca.mockResolvedValueOnce({ stdout } as never)
}

describe('ZellijAdapter', () => {
  let adapter: ZellijAdapter

  beforeEach(() => {
    adapter = new ZellijAdapter()
    vi.clearAllMocks()
  })

  it('has name "zellij"', () => {
    expect(adapter.name).toBe('zellij')
  })

  describe('isAvailable', () => {
    it('returns true when zellij --version succeeds', async () => {
      mockOutput('zellij 0.44.0')
      expect(await adapter.isAvailable()).toBe(true)
      expect(mockExeca).toHaveBeenCalledWith('zellij', ['--version'])
    })

    it('returns false when zellij --version throws', async () => {
      mockExeca.mockRejectedValueOnce(new Error('not found') as never)
      expect(await adapter.isAvailable()).toBe(false)
    })
  })

  describe('listSessions', () => {
    it('throws when list-sessions fails', async () => {
      mockExeca.mockRejectedValueOnce(new Error('zellij not running') as never)
      await expect(adapter.listSessions()).rejects.toThrow('zellij not running')
    })

    it('returns empty array when no sessions', async () => {
      mockOutput('')
      expect(await adapter.listSessions()).toEqual([])
    })

    it('parses session names and strips [current] annotation', async () => {
      mockOutput('my-project [current]\nbackground-job')

      const sessions = await adapter.listSessions()
      expect(sessions).toHaveLength(2)

      expect(sessions[0].id).toBe('my-project')
      expect(sessions[0].name).toBe('my-project')
      expect(sessions[0].windows).toHaveLength(1)
      expect(sessions[0].windows[0].panes).toHaveLength(1)
      expect(sessions[0].windows[0].panes[0].id).toBe('zellij:my-project:0:0')
      expect(sessions[0].windows[0].panes[0].active).toBe(true)

      expect(sessions[1].id).toBe('background-job')
      expect(sessions[1].name).toBe('background-job')
      expect(sessions[1].windows[0].panes[0].id).toBe('zellij:background-job:0:0')
    })

    it('handles single session without annotation', async () => {
      mockOutput('dev-session')
      const sessions = await adapter.listSessions()
      expect(sessions).toHaveLength(1)
      expect(sessions[0].name).toBe('dev-session')
    })

    it('trims whitespace from session names', async () => {
      mockOutput('  spaced-session  ')
      const sessions = await adapter.listSessions()
      expect(sessions[0].name).toBe('spaced-session')
    })
  })

  describe('readPane', () => {
    it('throws when dump-screen fails', async () => {
      mockExeca.mockRejectedValueOnce(new Error('session not found') as never)
      await expect(adapter.readPane('zellij:unknown:0:0')).rejects.toThrow('session not found')
    })

    it('calls dump-screen with session and pane ID', async () => {
      mockOutput('screen content here')
      const result = await adapter.readPane('zellij:my-project:0:0')
      expect(result).toBe('screen content here')
      expect(mockExeca).toHaveBeenCalledWith('zellij', [
        '--session', 'my-project',
        'action', 'dump-screen', '--full', '--pane-id', '0',
      ])
    })

    it('passes pane index from full pane ID', async () => {
      mockOutput('output')
      await adapter.readPane('zellij:work:0:2')
      expect(mockExeca).toHaveBeenCalledWith('zellij', [
        '--session', 'work',
        'action', 'dump-screen', '--full', '--pane-id', '2',
      ])
    })

    it('uses paneId directly if no colon-separated format (no --pane-id)', async () => {
      mockOutput('output')
      await adapter.readPane('bare-session')
      expect(mockExeca).toHaveBeenCalledWith('zellij', [
        '--session', 'bare-session',
        'action', 'dump-screen', '--full',
      ])
    })

    it('ignores lines parameter (zellij dumps full screen)', async () => {
      mockOutput('output')
      await adapter.readPane('zellij:sess:0:0', 30)
      expect(mockExeca).toHaveBeenCalledWith('zellij', [
        '--session', 'sess',
        'action', 'dump-screen', '--full', '--pane-id', '0',
      ])
    })
  })

  describe('sendText', () => {
    it('throws when write-chars fails', async () => {
      mockExeca.mockRejectedValueOnce(new Error('connection refused') as never)
      await expect(adapter.sendText('zellij:proj:0:1', 'hi')).rejects.toThrow('connection refused')
    })

    it('sends text via write-chars with --pane-id then Enter via write 10', async () => {
      mockOutput('') // write-chars
      mockOutput('') // write 10 (Enter)
      await adapter.sendText('zellij:proj:0:3', 'echo hello')
      expect(mockExeca).toHaveBeenNthCalledWith(1, 'zellij', [
        '--session', 'proj', 'action', 'write-chars', '--pane-id', '3', 'echo hello',
      ])
      expect(mockExeca).toHaveBeenNthCalledWith(2, 'zellij', [
        '--session', 'proj', 'action', 'write', '--pane-id', '3', '10',
      ])
    })

    it('omits --pane-id for bare session name', async () => {
      mockOutput('')
      mockOutput('')
      await adapter.sendText('bare-sess', 'hello')
      expect(mockExeca).toHaveBeenNthCalledWith(1, 'zellij', [
        '--session', 'bare-sess', 'action', 'write-chars', 'hello',
      ])
    })
  })

  describe('sendKey', () => {
    it('sends key via write-chars with --pane-id', async () => {
      mockOutput('')
      await adapter.sendKey('zellij:proj:0:5', 'C-c')
      expect(mockExeca).toHaveBeenCalledWith('zellij', [
        '--session', 'proj', 'action', 'write-chars', '--pane-id', '5', 'C-c',
      ])
    })
  })

  describe('createSession', () => {
    it('creates detached background session and returns it', async () => {
      mockOutput('') // create
      mockOutput('new-sess') // listSessions
      const session = await adapter.createSession('new-sess')
      expect(mockExeca).toHaveBeenCalledWith('zellij', [
        'attach', 'new-sess', '--create-background',
      ])
      expect(session.name).toBe('new-sess')
    })

    it('throws if session not found after creation', async () => {
      mockOutput('') // create
      mockOutput('other-sess') // listSessions returns different name
      await expect(adapter.createSession('missing')).rejects.toThrow(
        'Failed to find Zellij session "missing"'
      )
    })
  })

  describe('renameSession', () => {
    it('calls action rename-session', async () => {
      mockOutput('')
      await adapter.renameSession('old-name', 'new-name')
      expect(mockExeca).toHaveBeenCalledWith('zellij', [
        '--session', 'old-name', 'action', 'rename-session', 'new-name',
      ])
    })
  })

  describe('closeSession', () => {
    it('calls kill-session', async () => {
      mockOutput('')
      await adapter.closeSession('my-sess')
      expect(mockExeca).toHaveBeenCalledWith('zellij', [
        'kill-session', 'my-sess',
      ])
    })
  })

  describe('splitPane', () => {
    it('uses --direction right for left/right splits', async () => {
      mockOutput('')
      const pane = await adapter.splitPane('zellij:proj:0:0', 'right')
      expect(mockExeca).toHaveBeenCalledWith('zellij', [
        '--session', 'proj', 'action', 'new-pane', '--direction', 'right',
      ])
      expect(pane.id).toBe('zellij:proj:0:new')
      expect(pane.active).toBe(true)
    })

    it('uses --direction right for left direction too', async () => {
      mockOutput('')
      await adapter.splitPane('zellij:proj:0:0', 'left')
      expect(mockExeca).toHaveBeenCalledWith('zellij', [
        '--session', 'proj', 'action', 'new-pane', '--direction', 'right',
      ])
    })

    it('uses --direction down for up/down splits', async () => {
      mockOutput('')
      await adapter.splitPane('zellij:proj:0:0', 'down')
      expect(mockExeca).toHaveBeenCalledWith('zellij', [
        '--session', 'proj', 'action', 'new-pane', '--direction', 'down',
      ])
    })

    it('uses --direction down for up direction too', async () => {
      mockOutput('')
      await adapter.splitPane('zellij:proj:0:0', 'up')
      expect(mockExeca).toHaveBeenCalledWith('zellij', [
        '--session', 'proj', 'action', 'new-pane', '--direction', 'down',
      ])
    })
  })

  describe('selectPane', () => {
    it('is a no-op (zellij limitation)', async () => {
      await adapter.selectPane('zellij:proj:0:0')
      expect(mockExeca).not.toHaveBeenCalled()
    })
  })
})
