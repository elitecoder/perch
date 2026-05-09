import { execa } from 'execa'
import type { ITerminalAdapter, Pane, Session, Window } from './interface.js'

const CMUX_BIN =
  process.env.CMUX_BIN ??
  '/Applications/cmux.app/Contents/Resources/bin/cmux'

function cmux(args: string[]) {
  return execa(CMUX_BIN, args)
}

// Map from plugin key names to cmux send-key names
const KEY_MAP: Record<string, string> = {
  'Enter': 'enter',
  'Tab':   'tab',
  'C-c':   'ctrl+c',
  'C-d':   'ctrl+d',
  'C-o':   'ctrl+o',
  'Escape': 'escape',
  'Up':    'up',
  'Down':  'down',
  'Left':  'left',
  'Right': 'right',
  'Space': 'space',
}

function toSendKeyArg(key: string): string {
  return KEY_MAP[key] ?? key.toLowerCase()
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
        title: titleMatch?.[1],
        dimensions: { rows: 24, cols: 80 }, // cmux doesn't expose dims over CLI
      })
    }
    return panes
  }

  async readPane(paneId: string, lines = 50): Promise<string> {
    const { workspace, surface } = this._parsePaneId(paneId)
    const { stdout } = await cmux([
      'capture-pane',
      ...this._wsArgs(workspace),
      '--surface', surface,
      '--lines', String(lines),
    ])
    return stdout
  }

  async sendText(paneId: string, text: string): Promise<void> {
    const { workspace, surface } = this._parsePaneId(paneId)
    // Send text first, then Enter separately — some TUIs (Claude Code)
    // don't process Enter correctly when it's inlined via \n in a paste.
    await cmux(['send', ...this._wsArgs(workspace), '--surface', surface, text])
    await cmux(['send-key', ...this._wsArgs(workspace), '--surface', surface, 'enter'])
  }

  async sendKey(paneId: string, key: string): Promise<void> {
    const { workspace, surface } = this._parsePaneId(paneId)
    await cmux(['send-key', ...this._wsArgs(workspace), '--surface', surface, toSendKeyArg(key)])
  }

  // cmux resolves bare surface refs against the currently-focused workspace.
  // The daemon operates across many workspaces, so we must pin the workspace
  // explicitly whenever we know it — otherwise commands fail with
  // "Workspace not found" for any surface outside the user's current view.
  private _wsArgs(workspace: string): string[] {
    return workspace ? ['--workspace', workspace] : []
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
    await cmux(['close-workspace', '--workspace', sessionId])
  }

  async splitPane(paneId: string, direction: 'left' | 'right' | 'up' | 'down'): Promise<Pane> {
    const { workspace, surface } = this._parsePaneId(paneId)
    const { stdout } = await cmux([
      'new-split', direction,
      '--workspace', workspace,
      '--surface', surface,
    ])
    // cmux ≥0.63 emits "OK surface:17 workspace:16"; older builds emitted
    // the bare surface ref. Pull out the surface ref either way.
    const newSurface = stdout.match(/surface:\d+/)?.[0] ?? 'surface:new'
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
    // cmux ≥0.63 removed the `focus-surface` subcommand; the RPC method remains.
    await cmux(['rpc', 'surface.focus', JSON.stringify({ surface_id: surface })]).catch(() => {
      // Best-effort — never block a command if focus fails.
    })
  }

  async getPaneTty(paneId: string): Promise<string | null> {
    const { workspace, surface } = this._parsePaneId(paneId)
    return this._getSurfaceTty(workspace || undefined, surface)
  }

  async getPanePid(paneId: string): Promise<number | null> {
    try {
      const { workspace, surface } = this._parsePaneId(paneId)
      const tty = await this._getSurfaceTty(workspace || undefined, surface)
      if (!tty) return null
      // Find the login shell on this TTY — login shells have a leading '-' in argv[0]
      const { stdout } = await execa('ps', ['-t', tty, '-o', 'pid=,args='])
      for (const line of stdout.split('\n')) {
        const parts = line.trim().split(/\s+/)
        const pid = parseInt(parts[0]!, 10)
        const args = parts[1] ?? ''
        if (!isNaN(pid) && args.startsWith('-/')) return pid
      }
      return null
    } catch {
      return null
    }
  }

  private async _getSurfaceTty(workspace: string | undefined, surface: string): Promise<string | null> {
    try {
      const args = ['tree']
      if (workspace) args.push('--workspace', workspace)
      else args.push('--all')
      const { stdout } = await cmux(args)
      // Line format: surface surface:5 [terminal] "title" tty=ttys001
      const escaped = surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const match = stdout.match(new RegExp(`${escaped}.*?tty=(\\S+)`))
      return match?.[1] ?? null
    } catch {
      return null
    }
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
