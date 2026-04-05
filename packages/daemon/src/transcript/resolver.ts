import { access, readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { execa } from 'execa'
import type { ITerminalAdapter } from '../adapters/interface.js'

export interface ResolvedSession {
  sessionId: string
  cwd: string
  jsonlPath: string
  pid: number
}

/**
 * Given a pane ID, find the Claude Code JSONL transcript file.
 *
 * Strategy: find running `claude` processes, determine their CWD, narrow to
 * descendants of the pane's shell PID, then pick the most recently modified
 * JSONL in the project directory (Claude Code may internally rotate session
 * IDs while keeping the original --session-id in argv).
 */
export async function resolveClaudeSession(
  paneId: string,
  adapter: ITerminalAdapter,
): Promise<ResolvedSession | null> {
  // Scan all running claude processes for --session-id in their args
  const claudeProcs = await findClaudeProcesses()
  if (claudeProcs.length === 0) {
    console.log(`[resolver] no claude processes found`)
    return null
  }

  // If the adapter can give us the shell PID, narrow to descendants of that shell
  let candidates = claudeProcs
  if (adapter.getPanePid) {
    const shellPid = await adapter.getPanePid(paneId)
    if (shellPid) {
      const tree = await buildPidTree()
      const descendants = collectDescendants(shellPid, tree)
      descendants.add(shellPid)
      const narrowed = claudeProcs.filter(p => descendants.has(p.pid))
      if (narrowed.length > 0) {
        candidates = narrowed
      } else {
        console.log(`[resolver] PID narrowing found 0 descendants of shell ${shellPid} among ${claudeProcs.length} claude procs — falling back to all`)
      }
    } else {
      console.log(`[resolver] getPanePid returned null for ${paneId}`)
    }
  }

  // For each candidate, find the most recently modified JSONL in its project dir.
  // Claude Code may rotate session IDs internally, so we can't trust --session-id
  // from argv. Instead, pick the freshest .jsonl in the project directory.
  for (const proc of candidates) {
    const projectDir = buildProjectDir(proc.cwd)
    const latest = await findLatestJsonl(projectDir)
    if (latest) {
      console.log(`[resolver] resolved ${paneId} → ${latest.path} (pid ${proc.pid})`)
      return { sessionId: latest.sessionId, cwd: proc.cwd, jsonlPath: latest.path, pid: proc.pid }
    } else {
      console.log(`[resolver] no JSONL files in ${projectDir}`)
    }
  }

  console.log(`[resolver] no JSONL found for any of ${candidates.length} candidates (pane ${paneId})`)
  return null
}

/**
 * Poll until a JSONL file appears for a newly-started Claude session.
 */
export async function waitForClaudeSession(
  paneId: string,
  adapter: ITerminalAdapter,
  timeoutMs = 20_000,
): Promise<ResolvedSession | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const resolved = await resolveClaudeSession(paneId, adapter)
    if (resolved) return resolved
    await sleep(500)
  }
  return null
}

// ---- Helpers ---------------------------------------------------------------

export function encodeCwdPath(cwd: string): string {
  return cwd.replace(/\//g, '-')
}

function buildProjectDir(cwd: string): string {
  const encoded = encodeCwdPath(cwd)
  return join(homedir(), '.claude', 'projects', encoded)
}

interface LatestJsonl {
  sessionId: string
  path: string
  mtimeMs: number
}

/**
 * Find the most recently modified .jsonl file (top-level only) in a project
 * directory. Returns null if the directory doesn't exist or has no JSONL files.
 */
async function findLatestJsonl(dir: string): Promise<LatestJsonl | null> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return null
  }

  let best: LatestJsonl | null = null
  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue
    const fullPath = join(dir, entry)
    try {
      const s = await stat(fullPath)
      if (!best || s.mtimeMs > best.mtimeMs) {
        best = {
          sessionId: entry.replace(/\.jsonl$/, ''),
          path: fullPath,
          mtimeMs: s.mtimeMs,
        }
      }
    } catch {
      // skip unreadable files
    }
  }
  return best
}

interface ClaudeProcess {
  pid: number
  sessionId: string
  cwd: string
}

/**
 * Scan `ps` output for running claude processes that have --session-id in args.
 * Returns them sorted newest PID first (proxy for most recently started).
 */
async function findClaudeProcesses(): Promise<ClaudeProcess[]> {
  try {
    const { stdout } = await execa('ps', ['-ax', '-o', 'pid=,args='])
    const results: ClaudeProcess[] = []

    for (const line of stdout.split('\n')) {
      // Match: --session-id <uuid> or --resume <uuid>
      const sessionMatch = line.match(/--session-id\s+([0-9a-f-]{36})/)
      const resumeMatch = line.match(/--resume\s+([0-9a-f-]{36})/)
      const sessionId = (sessionMatch ?? resumeMatch)?.[1]
      if (!sessionId) continue

      const pidStr = line.trim().split(/\s+/)[0]
      const pid = parseInt(pidStr!, 10)
      if (isNaN(pid)) continue

      // Get the cwd of this process
      const cwd = await getProcessCwd(pid)
      if (!cwd) continue

      results.push({ pid, sessionId, cwd })
    }

    // Sort newest (highest PID) first as a heuristic for most recently started
    return results.sort((a, b) => b.pid - a.pid)
  } catch {
    return []
  }
}

async function getProcessCwd(pid: number): Promise<string | null> {
  try {
    // macOS: lsof -a -p <pid> -d cwd -Fn
    const { stdout } = await execa('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'])
    // Output lines: 'p<pid>', 'n<path>'
    const line = stdout.split('\n').find(l => l.startsWith('n'))
    return line ? line.slice(1).trim() : null
  } catch {
    return null
  }
}

async function buildPidTree(): Promise<Map<number, number[]>> {
  try {
    const { stdout } = await execa('ps', ['-ax', '-o', 'pid=,ppid='])
    const tree = new Map<number, number[]>()
    for (const line of stdout.trim().split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 2) continue
      const pid = parseInt(parts[0]!, 10)
      const ppid = parseInt(parts[1]!, 10)
      if (!isNaN(pid) && !isNaN(ppid)) {
        if (!tree.has(ppid)) tree.set(ppid, [])
        tree.get(ppid)!.push(pid)
      }
    }
    return tree
  } catch {
    return new Map()
  }
}

function collectDescendants(root: number, tree: Map<number, number[]>): Set<number> {
  const visited = new Set<number>()
  const queue = [root]
  while (queue.length > 0) {
    const pid = queue.shift()!
    for (const child of tree.get(pid) ?? []) {
      if (!visited.has(child)) {
        visited.add(child)
        queue.push(child)
      }
    }
  }
  return visited
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
