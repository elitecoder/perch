import { access } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { execa } from 'execa'
import type { ITerminalAdapter } from '../adapters/interface.js'

export interface ClaudePane {
  paneId: string
  sessionName: string
  /** Per-pane title (cmux surface title). Often reflects the current Claude
   *  task and differs from the workspace name — more useful as a list label. */
  paneTitle?: string
  sessionId: string       // UUID from --session-id arg
  cwd: string | null      // working directory of the claude process
  jsonlPath: string | null // ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
}

interface PaneEntry {
  paneId: string
  sessionName: string
  paneTitle?: string
  tty: string | null
}

interface ClaudeProc {
  pid: number
  sessionId: string
  tty: string
}

/**
 * Find all terminal panes that have an active Claude process running in them.
 *
 * Strategy: match `ps` Claude processes to panes by TTY. A TTY device is
 * owned by exactly one pane, so this is 1:1 and immune to nested shell
 * wrappings (cmux spawns two `-/bin/zsh` per surface, which used to break
 * ancestor-PID matching).
 */
export async function findClaudePanes(adapter: ITerminalAdapter): Promise<ClaudePane[]> {
  const sessions = await adapter.listSessions()

  const paneEntries: PaneEntry[] = []
  for (const session of sessions) {
    for (const window of session.windows) {
      for (const pane of window.panes) {
        const tty = adapter.getPaneTty ? await adapter.getPaneTty(pane.id) : null
        paneEntries.push({ paneId: pane.id, sessionName: session.name, paneTitle: pane.title, tty })
      }
    }
  }

  if (paneEntries.length === 0) return []

  const claudeProcs = await findClaudeProcesses()
  if (claudeProcs.length === 0) return []

  // Index panes by TTY for O(1) lookup per Claude proc.
  const ttyToPane = new Map<string, PaneEntry>()
  for (const entry of paneEntries) {
    if (entry.tty) ttyToPane.set(entry.tty, entry)
  }

  const results: ClaudePane[] = []
  const matchedPaneIds = new Set<string>()

  for (const proc of claudeProcs) {
    const pane = ttyToPane.get(proc.tty)
    if (!pane || matchedPaneIds.has(pane.paneId)) continue
    matchedPaneIds.add(pane.paneId)

    const cwd = await getProcessCwd(proc.pid)
    const jsonlPath = cwd ? buildJsonlPath(cwd, proc.sessionId) : null
    let jsonlExists = false
    if (jsonlPath) {
      try { await access(jsonlPath); jsonlExists = true } catch { /* not yet created */ }
    }

    results.push({
      paneId: pane.paneId,
      sessionName: pane.sessionName,
      paneTitle: pane.paneTitle,
      sessionId: proc.sessionId,
      cwd,
      jsonlPath: jsonlExists ? jsonlPath : null,
    })
  }

  return results
}

// ---- Helpers -----------------------------------------------------------

/**
 * Scan `ps` for processes with --session-id/--resume in argv, returning each
 * with its TTY. Uses `ps -o tty=` (TTY short name like "ttys009") so the value
 * matches what adapters return from getPaneTty.
 */
async function findClaudeProcesses(): Promise<ClaudeProc[]> {
  let stdout: string
  try {
    ({ stdout } = await execa('ps', ['-ax', '-o', 'pid=,tty=,args=']))
  } catch {
    return []
  }

  const procs: ClaudeProc[] = []
  for (const line of stdout.split('\n')) {
    const sessionMatch = line.match(/--session-id\s+([0-9a-f-]{36})/)
    const resumeMatch = line.match(/--resume\s+([0-9a-f-]{36})/)
    const sessionId = (sessionMatch ?? resumeMatch)?.[1]
    if (!sessionId) continue

    const parts = line.trim().split(/\s+/)
    const pid = parseInt(parts[0]!, 10)
    const tty = parts[1]!
    if (isNaN(pid) || !tty || tty === '??') continue

    procs.push({ pid, sessionId, tty })
  }
  return procs
}

async function getProcessCwd(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execa('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
    const line = stdout.split('\n').find(l => l.startsWith('n'))
    return line ? line.slice(1).trim() : null
  } catch {
    return null
  }
}

function buildJsonlPath(cwd: string, sessionId: string): string {
  const encoded = cwd.replace(/\//g, '-')
  return join(homedir(), '.claude', 'projects', encoded, `${sessionId}.jsonl`)
}
