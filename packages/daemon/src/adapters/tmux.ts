import { execa } from 'execa'
import type { ITerminalAdapter, Pane, Session, Window } from './interface.js'

export class TmuxAdapter implements ITerminalAdapter {
  readonly name = 'tmux'

  async isAvailable(): Promise<boolean> {
    try {
      await execa('tmux', ['-V'])
      return true
    } catch {
      return false
    }
  }

  async listSessions(): Promise<Session[]> {
    const { stdout } = await execa('tmux', [
      'list-sessions',
      '-F',
      '#{session_id}:#{session_name}',
    ])
    if (!stdout.trim()) return []

    const sessions: Session[] = []
    for (const line of stdout.trim().split('\n')) {
      const [id, name] = line.split(':')
      if (!id || !name) continue
      const windows = await this._listWindows(name)
      sessions.push({ id, name, windows })
    }
    return sessions
  }

  private async _listWindows(sessionName: string): Promise<Window[]> {
    const { stdout } = await execa('tmux', [
      'list-windows',
      '-t', sessionName,
      '-F', '#{window_id}:#{window_name}',
    ])
    if (!stdout.trim()) return []

    const windows: Window[] = []
    for (const line of stdout.trim().split('\n')) {
      const colonIdx = line.indexOf(':')
      if (colonIdx === -1) continue
      const id = line.slice(0, colonIdx)
      const name = line.slice(colonIdx + 1)
      const panes = await this._listPanes(sessionName, id)
      windows.push({ id, name, panes })
    }
    return windows
  }

  private async _listPanes(sessionName: string, windowId: string): Promise<Pane[]> {
    const fmt = '#{pane_id}:#{pane_index}:#{pane_active}:#{pane_current_command}:#{pane_height}:#{pane_width}'
    const { stdout } = await execa('tmux', [
      'list-panes',
      '-t', `${sessionName}:${windowId}`,
      '-F', fmt,
    ])
    if (!stdout.trim()) return []

    return stdout.trim().split('\n').map((line: string) => {
      const parts = line.split(':')
      const [paneId, indexStr, activeStr, command, rowsStr, colsStr] = parts
      return {
        id: `tmux:${sessionName}:${windowId}:${paneId}`,
        index: parseInt(indexStr, 10),
        active: activeStr === '1',
        command: command ?? '',
        dimensions: {
          rows: parseInt(rowsStr, 10),
          cols: parseInt(colsStr, 10),
        },
      }
    })
  }

  async readPane(paneId: string, lines = 50): Promise<string> {
    const tmuxTarget = this._toTmuxTarget(paneId)
    const { stdout } = await execa('tmux', [
      'capture-pane',
      '-p',
      '-t', tmuxTarget,
      '-S', `-${lines}`,
    ])
    return stdout
  }

  async sendText(paneId: string, text: string): Promise<void> {
    const tmuxTarget = this._toTmuxTarget(paneId)
    await execa('tmux', ['send-keys', '-t', tmuxTarget, text, 'Enter'])
  }

  async sendKey(paneId: string, key: string): Promise<void> {
    const tmuxTarget = this._toTmuxTarget(paneId)
    await execa('tmux', ['send-keys', '-t', tmuxTarget, key])
  }

  async createSession(name: string, cwd?: string, command?: string): Promise<Session> {
    const args = ['new-session', '-d', '-s', name]
    if (cwd) args.push('-c', cwd)
    if (command) args.push(command)
    await execa('tmux', args)
    const sessions = await this.listSessions()
    const session = sessions.find(s => s.name === name)
    if (!session) throw new Error(`Failed to find session "${name}" after creation`)
    return session
  }

  async renameSession(sessionId: string, name: string): Promise<void> {
    await execa('tmux', ['rename-session', '-t', sessionId, name])
  }

  async closeSession(sessionId: string): Promise<void> {
    await execa('tmux', ['kill-session', '-t', sessionId])
  }

  async splitPane(paneId: string, direction: 'left' | 'right' | 'up' | 'down'): Promise<Pane> {
    const tmuxTarget = this._toTmuxTarget(paneId)
    const flag = direction === 'left' || direction === 'right' ? '-h' : '-v'
    const { stdout } = await execa('tmux', [
      'split-window',
      flag,
      '-t', tmuxTarget,
      '-P',
      '-F', '#{pane_id}:#{pane_index}:#{pane_active}:#{pane_current_command}:#{pane_height}:#{pane_width}',
    ])
    const parts = stdout.trim().split(':')
    const [newPaneId, indexStr, activeStr, command, rowsStr, colsStr] = parts
    // Reconstruct a full pane id using parent's session/window prefix
    const [, sessionName, windowId] = paneId.split(':')
    return {
      id: `tmux:${sessionName}:${windowId}:${newPaneId}`,
      index: parseInt(indexStr, 10),
      active: activeStr === '1',
      command: command ?? '',
      dimensions: {
        rows: parseInt(rowsStr, 10),
        cols: parseInt(colsStr, 10),
      },
    }
  }

  async selectPane(paneId: string): Promise<void> {
    const tmuxTarget = this._toTmuxTarget(paneId)
    await execa('tmux', ['select-pane', '-t', tmuxTarget])
  }

  async getPanePid(paneId: string): Promise<number | null> {
    try {
      const tmuxTarget = this._toTmuxTarget(paneId)
      const { stdout } = await execa('tmux', [
        'display-message',
        '-t', tmuxTarget,
        '-p', '#{pane_pid}',
      ])
      const pid = parseInt(stdout.trim(), 10)
      return isNaN(pid) ? null : pid
    } catch {
      return null
    }
  }

  /** Convert a perch pane id "tmux:session:window:pane" → tmux target "pane" */
  private _toTmuxTarget(paneId: string): string {
    const parts = paneId.split(':')
    // format: tmux:<session>:<window>:<paneId>
    if (parts.length === 4 && parts[0] === 'tmux') {
      return parts[3]
    }
    // Pass through if already a raw tmux target
    return paneId
  }
}
