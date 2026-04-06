import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CmuxAdapter } from './cmux.js'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'
const mockExeca = vi.mocked(execa)

function mockOutput(stdout: string) {
  return mockExeca.mockResolvedValueOnce({ stdout } as never)
}

describe('CmuxAdapter', () => {
  let adapter: CmuxAdapter

  beforeEach(() => {
    adapter = new CmuxAdapter()
    vi.clearAllMocks()
  })

  it('has name "cmux"', () => {
    expect(adapter.name).toBe('cmux')
  })

  describe('isAvailable', () => {
    it('returns true when cmux ping succeeds', async () => {
      mockOutput('')
      expect(await adapter.isAvailable()).toBe(true)
      expect(mockExeca).toHaveBeenCalledWith(
        expect.stringContaining('cmux'),
        ['ping'],
        expect.objectContaining({ env: expect.any(Object) }),
      )
    })

    it('returns false when cmux ping throws', async () => {
      mockExeca.mockRejectedValueOnce(new Error('not found') as never)
      expect(await adapter.isAvailable()).toBe(false)
    })
  })

  describe('listSessions', () => {
    it('throws when list-workspaces fails', async () => {
      mockExeca.mockRejectedValueOnce(new Error('cmux not running') as never)
      await expect(adapter.listSessions()).rejects.toThrow('cmux not running')
    })

    it('returns empty array when no workspaces', async () => {
      mockOutput('')
      expect(await adapter.listSessions()).toEqual([])
    })

    it('returns empty array for whitespace-only output', async () => {
      mockOutput('   \n  ')
      expect(await adapter.listSessions()).toEqual([])
    })

    it('parses workspaces and their surfaces', async () => {
      // list-workspaces
      mockOutput('* workspace:1  my-project  [selected]')
      // list-panels for workspace:1
      mockOutput('* surface:5  terminal  [focused]  "vim"\n  surface:6  terminal  "bash"')

      const sessions = await adapter.listSessions()
      expect(sessions).toHaveLength(1)
      expect(sessions[0].id).toBe('workspace:1')
      expect(sessions[0].name).toBe('my-project')
      expect(sessions[0].windows[0].panes).toHaveLength(2)

      const pane0 = sessions[0].windows[0].panes[0]
      expect(pane0.id).toBe('cmux:workspace:1:surface:5')
      expect(pane0.active).toBe(true)
      expect(pane0.command).toBe('vim')

      const pane1 = sessions[0].windows[0].panes[1]
      expect(pane1.id).toBe('cmux:workspace:1:surface:6')
      expect(pane1.active).toBe(false)
      expect(pane1.command).toBe('bash')
    })

    it('skips non-terminal surfaces (e.g. browser)', async () => {
      mockOutput('* workspace:2  dev  [selected]')
      mockOutput('  surface:10  browser  [focused]  "docs"\n  surface:11  terminal  "zsh"')

      const sessions = await adapter.listSessions()
      expect(sessions[0].windows[0].panes).toHaveLength(1)
      expect(sessions[0].windows[0].panes[0].id).toBe('cmux:workspace:2:surface:11')
    })

    it('parses multiple workspaces', async () => {
      mockOutput('* workspace:1  proj-a  [selected]\n  workspace:2  proj-b')
      // surfaces for workspace:1
      mockOutput('  surface:5  terminal  "bash"')
      // surfaces for workspace:2
      mockOutput('  surface:8  terminal  "zsh"')

      const sessions = await adapter.listSessions()
      expect(sessions).toHaveLength(2)
      expect(sessions[0].name).toBe('proj-a')
      expect(sessions[1].name).toBe('proj-b')
    })

    it('skips lines that do not match workspace format', async () => {
      mockOutput('some header\n* workspace:1  test')
      mockOutput('  surface:1  terminal  "bash"')

      const sessions = await adapter.listSessions()
      expect(sessions).toHaveLength(1)
    })
  })

  describe('readPane', () => {
    it('throws when capture-pane fails', async () => {
      mockExeca.mockRejectedValueOnce(new Error('surface not found') as never)
      await expect(adapter.readPane('cmux:workspace:1:surface:999')).rejects.toThrow('surface not found')
    })

    it('calls capture-pane with surface ref and line count', async () => {
      mockOutput('some output')
      const result = await adapter.readPane('cmux:workspace:1:surface:5', 30)
      expect(result).toBe('some output')
      expect(mockExeca).toHaveBeenCalledWith(
        expect.stringContaining('cmux'),
        ['capture-pane', '--surface', 'surface:5', '--lines', '30'],
        expect.any(Object),
      )
    })

    it('defaults to 50 lines', async () => {
      mockOutput('')
      await adapter.readPane('cmux:workspace:1:surface:5')
      expect(mockExeca).toHaveBeenCalledWith(
        expect.stringContaining('cmux'),
        ['capture-pane', '--surface', 'surface:5', '--lines', '50'],
        expect.any(Object),
      )
    })

    it('handles bare numeric pane ID', async () => {
      mockOutput('output')
      await adapter.readPane('3')
      expect(mockExeca).toHaveBeenCalledWith(
        expect.stringContaining('cmux'),
        ['capture-pane', '--surface', 'surface:3', '--lines', '50'],
        expect.any(Object),
      )
    })

    it('handles surface:N format directly', async () => {
      mockOutput('output')
      await adapter.readPane('surface:7')
      expect(mockExeca).toHaveBeenCalledWith(
        expect.stringContaining('cmux'),
        ['capture-pane', '--surface', 'surface:7', '--lines', '50'],
        expect.any(Object),
      )
    })
  })

  describe('sendText', () => {
    it('throws when send fails', async () => {
      mockExeca.mockRejectedValueOnce(new Error('connection lost') as never)
      await expect(adapter.sendText('cmux:workspace:1:surface:5', 'echo hi')).rejects.toThrow('connection lost')
    })

    it('sends text then enter separately', async () => {
      mockOutput('')
      await adapter.sendText('cmux:workspace:1:surface:5', 'echo hello')
      expect(mockExeca).toHaveBeenCalledWith(
        expect.stringContaining('cmux'),
        ['send', '--surface', 'surface:5', 'echo hello'],
        expect.any(Object),
      )
      expect(mockExeca).toHaveBeenCalledWith(
        expect.stringContaining('cmux'),
        ['send-key', '--surface', 'surface:5', 'enter'],
        expect.any(Object),
      )
    })
  })

  describe('sendKey', () => {
    it('maps standard keys to cmux format', async () => {
      const mappings: Array<[string, string]> = [
        ['Enter', 'enter'],
        ['Tab', 'tab'],
        ['C-c', 'ctrl+c'],
        ['C-d', 'ctrl+d'],
        ['C-o', 'ctrl+o'],
        ['Escape', 'escape'],
        ['Up', 'up'],
        ['Down', 'down'],
        ['Left', 'left'],
        ['Right', 'right'],
        ['Space', 'space'],
      ]

      for (const [input, expected] of mappings) {
        vi.clearAllMocks()
        mockOutput('')
        await adapter.sendKey('cmux:workspace:1:surface:5', input)
        expect(mockExeca).toHaveBeenCalledWith(
          expect.stringContaining('cmux'),
          ['send-key', '--surface', 'surface:5', expected],
          expect.any(Object),
        )
      }
    })

    it('lowercases unknown keys as fallback', async () => {
      mockOutput('')
      await adapter.sendKey('cmux:workspace:1:surface:5', 'F5')
      expect(mockExeca).toHaveBeenCalledWith(
        expect.stringContaining('cmux'),
        ['send-key', '--surface', 'surface:5', 'f5'],
        expect.any(Object),
      )
    })
  })

  describe('createSession', () => {
    it('creates workspace and returns session', async () => {
      mockOutput('') // new-workspace
      // listSessions call chain
      mockOutput('* workspace:3  my-new')
      mockOutput('  surface:10  terminal  "bash"')

      const session = await adapter.createSession('my-new')
      expect(mockExeca).toHaveBeenCalledWith(
        expect.stringContaining('cmux'),
        ['new-workspace', '--name', 'my-new'],
        expect.any(Object),
      )
      expect(session.name).toBe('my-new')
    })

    it('passes --cwd and --command flags', async () => {
      mockOutput('')
      mockOutput('* workspace:3  dev')
      mockOutput('  surface:10  terminal  "vim"')

      await adapter.createSession('dev', '/home/user', 'vim')
      expect(mockExeca).toHaveBeenCalledWith(
        expect.stringContaining('cmux'),
        ['new-workspace', '--name', 'dev', '--cwd', '/home/user', '--command', 'vim'],
        expect.any(Object),
      )
    })

    it('throws if created workspace not found after creation', async () => {
      mockOutput('') // new-workspace
      mockOutput('* workspace:1  other') // listSessions — different name
      mockOutput('  surface:1  terminal  "bash"')

      await expect(adapter.createSession('missing')).rejects.toThrow('Failed to find cmux workspace "missing"')
    })
  })

  describe('renameSession', () => {
    it('calls workspace-action rename', async () => {
      mockOutput('')
      await adapter.renameSession('workspace:1', 'new-name')
      expect(mockExeca).toHaveBeenCalledWith(
        expect.stringContaining('cmux'),
        ['workspace-action', '--action', 'rename', '--workspace', 'workspace:1', '--title', 'new-name'],
        expect.any(Object),
      )
    })
  })

  describe('closeSession', () => {
    it('calls close-workspace', async () => {
      mockOutput('')
      await adapter.closeSession('workspace:1')
      expect(mockExeca).toHaveBeenCalledWith(
        expect.stringContaining('cmux'),
        ['close-workspace', '--workspace', 'workspace:1'],
        expect.any(Object),
      )
    })
  })

  describe('splitPane', () => {
    it('calls new-split with direction and returns new pane', async () => {
      mockOutput('surface:20')
      const pane = await adapter.splitPane('cmux:workspace:1:surface:5', 'right')
      expect(mockExeca).toHaveBeenCalledWith(
        expect.stringContaining('cmux'),
        ['new-split', 'right', '--workspace', 'workspace:1', '--surface', 'surface:5'],
        expect.any(Object),
      )
      expect(pane.id).toBe('cmux:workspace:1:surface:20')
      expect(pane.active).toBe(true)
    })

    it('handles empty stdout from new-split gracefully', async () => {
      mockOutput('')
      const pane = await adapter.splitPane('cmux:workspace:1:surface:5', 'down')
      expect(pane.id).toBe('cmux:workspace:1:surface:new')
    })
  })

  describe('selectPane', () => {
    it('calls focus-surface', async () => {
      mockOutput('')
      await adapter.selectPane('cmux:workspace:1:surface:5')
      expect(mockExeca).toHaveBeenCalledWith(
        expect.stringContaining('cmux'),
        ['focus-surface', '--surface', 'surface:5'],
        expect.any(Object),
      )
    })

    it('does not throw if focus-surface fails (best-effort)', async () => {
      mockExeca.mockRejectedValueOnce(new Error('not supported') as never)
      await expect(adapter.selectPane('cmux:workspace:1:surface:5')).resolves.toBeUndefined()
    })
  })
})
