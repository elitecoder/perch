import { execa } from 'execa'
import type { ITerminalAdapter, Pane, Session, Window } from './interface.js'

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
        const name = line.trim().replace(/\s+\[.*\]$/, '') // strip "[current]" annotation
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

  private _makePlaceholderPane(sessionName: string, index: number): Pane[] {
    return [
      {
        id: `zellij:${sessionName}:0:${index}`,
        index,
        active: true,
        command: '',
        dimensions: { rows: 24, cols: 80 },
      },
    ]
  }

  async readPane(paneId: string, _lines?: number): Promise<string> {
    const session = this._sessionFromPaneId(paneId)
    const { stdout } = await execa('zellij', [
      '--session', session,
      'action', 'dump-screen', '/dev/stdout',
    ])
    return stdout
  }

  async sendText(paneId: string, text: string): Promise<void> {
    const session = this._sessionFromPaneId(paneId)
    await execa('zellij', ['--session', session, 'action', 'write-chars', text])
    await execa('zellij', ['--session', session, 'action', 'write', '10']) // Enter = \n (decimal 10)
  }

  async sendKey(paneId: string, key: string): Promise<void> {
    const session = this._sessionFromPaneId(paneId)
    await execa('zellij', ['--session', session, 'action', 'write-chars', key])
  }

  async createSession(name: string, _cwd?: string, _command?: string): Promise<Session> {
    await execa('zellij', ['--session', name, 'options', '--detach'])
    const sessions = await this.listSessions()
    const session = sessions.find(s => s.name === name)
    if (!session) throw new Error(`Failed to find Zellij session "${name}" after creation`)
    return session
  }

  async renameSession(sessionId: string, name: string): Promise<void> {
    await execa('zellij', ['--session', sessionId, 'action', 'rename-session', name])
  }

  async closeSession(sessionId: string): Promise<void> {
    await execa('zellij', ['--session', sessionId, 'action', 'quit'])
  }

  async splitPane(paneId: string, direction: 'left' | 'right' | 'up' | 'down'): Promise<Pane> {
    const session = this._sessionFromPaneId(paneId)
    const dirFlag = direction === 'left' || direction === 'right' ? '--direction right' : '--direction down'
    await execa('zellij', ['--session', session, 'action', 'new-pane', dirFlag])
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

  private _sessionFromPaneId(paneId: string): string {
    const parts = paneId.split(':')
    // format: zellij:<session>:<window>:<index>
    return parts.length >= 2 ? parts[1]! : paneId
  }
}
