import { execa } from 'execa'
import type { ITerminalAdapter, Pane, Session } from './interface.js'

const ANSI_RE = /\x1b\[[0-9;]*[mGKHFABCDJKST]|\x1b[()][AB012]|\x1b=/g

/**
 * ZellijAdapter — wraps the `zellij` CLI.
 *
 * Zellij exposes sessions via `zellij list-sessions` and pane content via
 * `zellij action dump-screen`. Key differences from tmux:
 * - Sessions identified by name only (no numeric $ID)
 * - No native split/create over CLI in older versions; uses `zellij action`
 */
export class ZellijAdapter implements ITerminalAdapter {
  readonly name = 'zellij'

  async isAvailable(): Promise<boolean> {
    try {
      await execa('zellij', ['--version'])
      return true
    } catch {
      return false
    }
  }

  async listSessions(): Promise<Session[]> {
    const { stdout } = await execa('zellij', ['list-sessions'])
    if (!stdout.trim()) return []

    return stdout
      .trim()
      .split('\n')
      .map((line, i) => {
        const clean = line.replace(ANSI_RE, '').trim()
        const name = clean.replace(/\s+\[.*$/, '') // strip "[Created ...ago]" and "[current]" annotations
        return {
          id: name,
          name,
          windows: [
            {
              id: '0',
              name: 'main',
              panes: this._makePlaceholderPane(name, i),
            },
          ],
        }
      })
  }

  private _makePlaceholderPane(sessionName: string, _index: number): Pane[] {
    // Pane index 0 is always the default pane in a zellij session
    return [
      {
        id: `zellij:${sessionName}:0:0`,
        index: 0,
        active: true,
        command: '',
        dimensions: { rows: 24, cols: 80 },
      },
    ]
  }

  async readPane(paneId: string, _lines?: number): Promise<string> {
    const { session, paneIndex } = this._parsePaneId(paneId)
    const args = ['--session', session, 'action', 'dump-screen', '--full']
    if (paneIndex !== undefined) args.push('--pane-id', String(paneIndex))
    const { stdout } = await execa('zellij', args)
    return stdout
  }

  async sendText(paneId: string, text: string): Promise<void> {
    const { session, paneIndex } = this._parsePaneId(paneId)
    const paneArgs = paneIndex !== undefined ? ['--pane-id', String(paneIndex)] : []
    await execa('zellij', ['--session', session, 'action', 'write-chars', ...paneArgs, text])
    await execa('zellij', ['--session', session, 'action', 'write', ...paneArgs, '10']) // Enter = \n (decimal 10)
  }

  async sendKey(paneId: string, key: string): Promise<void> {
    const { session, paneIndex } = this._parsePaneId(paneId)
    const paneArgs = paneIndex !== undefined ? ['--pane-id', String(paneIndex)] : []
    await execa('zellij', ['--session', session, 'action', 'write-chars', ...paneArgs, key])
  }

  async createSession(name: string, _cwd?: string, _command?: string): Promise<Session> {
    await execa('zellij', ['attach', name, '--create-background'])
    const sessions = await this.listSessions()
    const session = sessions.find(s => s.name === name)
    if (!session) throw new Error(`Failed to find Zellij session "${name}" after creation`)
    return session
  }

  async renameSession(sessionId: string, name: string): Promise<void> {
    const { session } = this._parsePaneId(sessionId)
    await execa('zellij', ['--session', session, 'action', 'rename-session', name])
  }

  async closeSession(sessionId: string): Promise<void> {
    const { session } = this._parsePaneId(sessionId)
    await execa('zellij', ['kill-session', session])
  }

  async splitPane(paneId: string, direction: 'left' | 'right' | 'up' | 'down'): Promise<Pane> {
    const { session } = this._parsePaneId(paneId)
    const dir = direction === 'left' || direction === 'right' ? 'right' : 'down'
    await execa('zellij', ['--session', session, 'action', 'new-pane', '--direction', dir])
    // Return a placeholder — Zellij doesn't expose new pane ID over CLI
    return {
      id: `zellij:${session}:0:new`,
      index: 0,
      active: true,
      command: '',
      dimensions: { rows: 24, cols: 80 },
    }
  }

  async selectPane(_paneId: string): Promise<void> {
    // Zellij doesn't support selecting a specific pane by ID over the CLI in v0.x
  }

  private _parsePaneId(paneId: string): { session: string; paneIndex?: number } {
    const parts = paneId.split(':')
    // format: zellij:<session>:<window>:<paneIndex>
    if (parts.length >= 4 && parts[0] === 'zellij') {
      const idx = parseInt(parts[3]!, 10)
      return { session: parts[1]!, paneIndex: Number.isNaN(idx) ? undefined : idx }
    }
    if (parts.length >= 2 && parts[0] === 'zellij') {
      return { session: parts[1]! }
    }
    return { session: paneId }
  }
}
