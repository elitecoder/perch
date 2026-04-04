import { execa } from 'execa'
import { homedir } from 'os'
import { join } from 'path'
import type { ITerminalAdapter, Pane, Session, Window } from './interface.js'

const CMUX_BIN =
  process.env.CMUX_BIN ??
  '/Applications/cmux.app/Contents/Resources/bin/cmux'

const CMUX_SOCKET =
  process.env.CMUX_SOCKET_PATH ??
  join(homedir(), 'Library', 'Application Support', 'cmux', 'cmux.sock')

function cmux(args: string[]) {
  return execa(CMUX_BIN, args, {
    env: { ...process.env, CMUX_SOCKET_PATH: CMUX_SOCKET },
  })
}

// Key aliases that cmux send understands
const KEY_MAP: Record<string, string> = {
  'Enter': '\\n',
  'Tab':   '\\t',
  'C-c':   '\\x03',
  'Escape': '\\x1b',
}

function toSendArg(key: string): string {
  return KEY_MAP[key] ?? key
}

export class CmuxAdapter implements ITerminalAdapter {
  readonly name = 'cmux'

  async isAvailable(): Promise<boolean> {
    try {
      await cmux(['ping'])
      return true
    } catch (err) {
      console.error('[cmux] isAvailable failed:', err instanceof Error ? err.message : err)
      return false
    }
  }

  async listSessions(): Promise<Session[]> {
    const { stdout } = await cmux(['list-workspaces'])
    if (!stdout.trim()) return []

    const sessions: Session[] = []
    for (const line of stdout.trim().split('\n')) {
      // e.g. "* workspace:1  ~  [selected]"
      const match = line.match(/(workspace:\d+)\s+(.+?)(?:\s+\[|$)/)
      if (!match) continue
      const [, wsRef, name] = match
      const panes = await this._listSurfaces(wsRef!)
      sessions.push({
        id: wsRef!,
        name: name!.trim(),
        windows: [{ id: wsRef!, name: name!.trim(), panes }],
      })
    }
    return sessions
  }

  private async _listSurfaces(workspaceRef: string): Promise<Pane[]> {
    const { stdout } = await cmux(['list-panels', '--workspace', workspaceRef])
    if (!stdout.trim()) return []

    const panes: Pane[] = []
    let index = 0
    for (const line of stdout.trim().split('\n')) {
      // e.g. "* surface:5  terminal  [focused]  "perch logs""
      const match = line.match(/(surface:\d+)\s+(\w+)/)
      if (!match) continue
      const [, surfaceRef, type] = match
      if (type !== 'terminal') continue // skip browser surfaces
      const active = line.includes('[focused]')
      const titleMatch = line.match(/"([^"]*)"/)
      panes.push({
        id: `cmux:${workspaceRef}:${surfaceRef}`,
        index: index++,
        active,
        command: titleMatch?.[1] ?? '',
        dimensions: { rows: 24, cols: 80 }, // cmux doesn't expose dims over CLI
      })
    }
    return panes
  }

  async readPane(paneId: string, lines = 50): Promise<string> {
    const { surface } = this._parsePaneId(paneId)
    const { stdout } = await cmux([
      'capture-pane',
      '--surface', surface,
      '--lines', String(lines),
    ])
    return stdout
  }

  async sendText(paneId: string, text: string): Promise<void> {
    const { surface } = this._parsePaneId(paneId)
    // cmux send treats \n as Enter
    await cmux(['send', '--surface', surface, `${text}\\n`])
  }

  async sendKey(paneId: string, key: string): Promise<void> {
    const { surface } = this._parsePaneId(paneId)
    await cmux(['send', '--surface', surface, toSendArg(key)])
  }

  async createSession(name: string, cwd?: string, command?: string): Promise<Session> {
    const args = ['new-workspace', '--name', name]
    if (cwd) args.push('--cwd', cwd)
    if (command) args.push('--command', command)
    await cmux(args)
    const sessions = await this.listSessions()
    const session = sessions.find(s => s.name === name)
    if (!session) throw new Error(`Failed to find cmux workspace "${name}" after creation`)
    return session
  }

  async renameSession(sessionId: string, name: string): Promise<void> {
    await cmux(['workspace-action', '--action', 'rename', '--workspace', sessionId, '--title', name])
  }

  async closeSession(sessionId: string): Promise<void> {
    await cmux(['workspace-action', '--action', 'close', '--workspace', sessionId])
  }

  async splitPane(paneId: string, direction: 'left' | 'right' | 'up' | 'down'): Promise<Pane> {
    const { workspace, surface } = this._parsePaneId(paneId)
    const { stdout } = await cmux([
      'new-split', direction,
      '--workspace', workspace,
      '--surface', surface,
    ])
    // stdout contains the new surface ref
    const newSurface = stdout.trim() || 'surface:new'
    return {
      id: `cmux:${workspace}:${newSurface}`,
      index: 0,
      active: true,
      command: '',
      dimensions: { rows: 24, cols: 80 },
    }
  }

  async selectPane(paneId: string): Promise<void> {
    const { surface } = this._parsePaneId(paneId)
    await cmux(['focus-surface', '--surface', surface]).catch(() => {
      // focus-surface may not exist in all versions; best-effort
    })
  }

  private _parsePaneId(paneId: string): { workspace: string; surface: string } {
    const parts = paneId.split(':')
    // format: cmux:<workspace>:<workspace-n>:<surface>:<surface-n>
    // e.g.  cmux:workspace:1:surface:5
    if (parts[0] === 'cmux' && parts.length >= 5) {
      return {
        workspace: `${parts[1]}:${parts[2]}`,
        surface: `${parts[3]}:${parts[4]}`,
      }
    }
    // fallback: bare number like "3" → "surface:3"
    if (/^\d+$/.test(paneId)) {
      return { workspace: '', surface: `surface:${paneId}` }
    }
    // already a surface ref like "surface:3"
    return { workspace: '', surface: paneId }
  }
}
