import { access } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { execa } from 'execa'
import type { ITerminalAdapter } from '../adapters/interface.js'

export interface ClaudePane {
  paneId: string
  sessionName: string
  sessionId: string       // UUID from --session-id arg
  cwd: string | null      // working directory of the claude process
  jsonlPath: string | null // ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
}

interface PaneEntry {
  paneId: string
  sessionName: string
  shellPid: number | null
}

/**
 * Find all terminal panes that have an active Claude process running in them.
 *
 * Strategy 1 (primary): scan `ps` for `--session-id` args, then walk each
 * Claude process's ancestor chain up to a known pane shell PID.
 *
 * Strategy 2 (fallback): scan recently-modified JSONL files and match their
 * encoded CWD against pane shell CWDs.
 */
export async function findClaudePanes(adapter: ITerminalAdapter): Promise<ClaudePane[]> {
  // Collect all pane shell PIDs from the adapter
  const sessions = await adapter.listSessions()

  const paneEntries: PaneEntry[] = []
  for (const session of sessions) {
    for (const window of session.windows) {
      for (const pane of window.panes) {
        const shellPid = adapter.getPanePid ? await adapter.getPanePid(pane.id) : null
        paneEntries.push({ paneId: pane.id, sessionName: session.name, shellPid })
      }
    }
  }

  if (paneEntries.length === 0) return []

  // Single ps call — get pid, ppid, and full args for all processes
  const psLines = await getPsOutput()
  if (psLines.length === 0) return []

  const parentOf = buildParentMap(psLines)

  // Find Claude processes by scanning for --session-id in args
  interface ClaudeProc {
    pid: number
    sessionId: string
  }
  const claudeProcs: ClaudeProc[] = []
  for (const line of psLines) {
    const sessionMatch = line.match(/--session-id\s+([0-9a-f-]{36})/)
    const resumeMatch = line.match(/--resume\s+([0-9a-f-]{36})/)
    const sessionId = (sessionMatch ?? resumeMatch)?.[1]
    if (!sessionId) continue
    const pidStr = line.trim().split(/\s+/)[0]
    const pid = parseInt(pidStr!, 10)
    if (!isNaN(pid)) claudeProcs.push({ pid, sessionId })
  }

  if (claudeProcs.length === 0) return []

  // Build lookup: shell PID → pane entry
  const shellPidToEntry = new Map<number, PaneEntry>()
  for (const entry of paneEntries) {
    if (entry.shellPid !== null) shellPidToEntry.set(entry.shellPid, entry)
  }

  const results: ClaudePane[] = []
  const matchedPaneIds = new Set<string>()

  // Strategy 1: ancestor walk for each Claude process
  for (const proc of claudeProcs) {
    const match = findAncestorPane(proc.pid, parentOf, shellPidToEntry)
    if (!match || matchedPaneIds.has(match.paneId)) continue

    matchedPaneIds.add(match.paneId)
    const cwd = await getProcessCwd(proc.pid)
    const jsonlPath = cwd ? buildJsonlPath(cwd, proc.sessionId) : null
    let jsonlExists = false
    if (jsonlPath) {
      try { await access(jsonlPath); jsonlExists = true } catch { /* not yet created */ }
    }

    results.push({
      paneId: match.paneId,
      sessionName: match.sessionName,
      sessionId: proc.sessionId,
      cwd,
      jsonlPath: jsonlExists ? jsonlPath : null,
    })
  }

  return results
}

// ---- Helpers -----------------------------------------------------------

async function getPsOutput(): Promise<string[]> {
  try {
    const { stdout } = await execa('ps', ['-ax', '-o', 'pid=,ppid=,args='])
    return stdout.split('\n')
  } catch {
    return []
  }
}

/** Build child → parent PID map from ps output lines. */
function buildParentMap(lines: string[]): Map<number, number> {
  const parentOf = new Map<number, number>()
  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 2) continue
    const pid = parseInt(parts[0]!, 10)
    const ppid = parseInt(parts[1]!, 10)
    if (!isNaN(pid) && !isNaN(ppid)) parentOf.set(pid, ppid)
  }
  return parentOf
}

/** Walk up the process tree from `pid` until a known pane shell PID is found. */
function findAncestorPane(
  pid: number,
  parentOf: Map<number, number>,
  shellPidToEntry: Map<number, PaneEntry>,
): { paneId: string; sessionName: string } | null {
  let current = pid
  const visited = new Set<number>()
  while (current > 1 && !visited.has(current)) {
    visited.add(current)
    const entry = shellPidToEntry.get(current)
    if (entry) return entry
    const parent = parentOf.get(current)
    if (!parent) break
    current = parent
  }
  return null
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

