import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir, homedir } from 'os'
import { join } from 'path'
import { encodeCwdPath, resolveClaudeSession } from './resolver.js'
import type { ITerminalAdapter } from '../adapters/interface.js'

vi.mock('execa', () => ({ execa: vi.fn() }))
import { execa } from 'execa'
const mockExeca = vi.mocked(execa)

describe('encodeCwdPath', () => {
  it('encodes a simple path (leading slash becomes leading dash)', () => {
    expect(encodeCwdPath('/Users/mukul/dev/perch')).toBe('-Users-mukul-dev-perch')
  })

  it('handles root path', () => {
    expect(encodeCwdPath('/tmp')).toBe('-tmp')
  })

  it('encodes deeply nested path', () => {
    expect(encodeCwdPath('/home/user/projects/my-app')).toBe('-home-user-projects-my-app')
  })
})

describe('resolveClaudeSession — disambiguates same-CWD siblings via hook-state', () => {
  // Two Claude processes in the same CWD, each with a distinct current session id
  // recorded by the hook. Before this change the resolver returned the same
  // (freshest) JSONL for both PIDs, which caused cross-contaminated Slack threads.

  const CWD = '/tmp/perch-resolver-test-cwd'
  const projectDir = join(homedir(), '.claude', 'projects', encodeCwdPath(CWD))
  const hookStateDir = join(homedir(), '.config', 'perch', 'hook-state')
  const pidA = 90001
  const pidB = 90002
  const sidA = '11111111-1111-1111-1111-111111111111'
  const sidB = '22222222-2222-2222-2222-222222222222'
  const argvA = '33333333-3333-3333-3333-333333333333' // stale argv (pre-rotation) for A

  function makeAdapter(shellPidToPane: Record<string, number>): ITerminalAdapter {
    return {
      name: 'mock',
      isAvailable: vi.fn(),
      listSessions: vi.fn(),
      readPane: vi.fn(),
      sendText: vi.fn(),
      sendKey: vi.fn(),
      createSession: vi.fn(),
      renameSession: vi.fn(),
      closeSession: vi.fn(),
      splitPane: vi.fn(),
      selectPane: vi.fn(),
      getPanePid: vi.fn(async (paneId: string) => shellPidToPane[paneId] ?? null),
    } as unknown as ITerminalAdapter
  }

  function mockPsAndLsof(): void {
    // Order of execa calls in resolver:
    // 1) findClaudeProcesses: ps -ax -o pid=,args=
    // 2) per process: lsof for cwd
    // 3) buildPidTree: ps -ax -o pid=,ppid=
    // 4) (no further execa; we use access on the JSONL paths)

    mockExeca.mockImplementation(async (...args: unknown[]) => {
      const argv = args[1] as string[] | undefined
      if (!argv) return { stdout: '' } as never

      // ps -ax -o pid=,args=  (findClaudeProcesses)
      if (argv.includes('-o') && argv.includes('pid=,args=')) {
        return { stdout: [
          `  ${pidA}    1 node /usr/local/bin/claude --session-id ${argvA}`,
          `  ${pidB}    1 node /usr/local/bin/claude --session-id ${sidB}`,
        ].join('\n') } as never
      }

      // lsof for cwd
      if ((argv[0] ?? '').includes('lsof') || argv.some((a) => typeof a === 'string' && a.endsWith('lsof'))) {
        return { stdout: `p${argv.find((a) => !Number.isNaN(Number(a)))}\nn${CWD}` } as never
      }
      if (argv.includes('-a') && argv.includes('-p') && argv.includes('cwd')) {
        return { stdout: `pXX\nn${CWD}` } as never
      }

      // ps -ax -o pid=,ppid=  (buildPidTree)
      if (argv.includes('-o') && argv.includes('pid=,ppid=')) {
        // Shell PID 800 → child PID_A, shell 900 → child PID_B
        return { stdout: [
          `${pidA} 800`,
          `${pidB} 900`,
          `800 1`,
          `900 1`,
        ].join('\n') } as never
      }

      return { stdout: '' } as never
    })
  }

  beforeEach(async () => {
    await mkdir(projectDir, { recursive: true })
    await mkdir(hookStateDir, { recursive: true })
    // Write a stale JSONL for argvA (stale after rotation), plus the two live ones.
    // sidA is NEWER than sidB so the "freshest JSONL" heuristic would otherwise
    // point both PIDs at sidA.jsonl.
    await writeFile(join(projectDir, `${argvA}.jsonl`), '')
    await writeFile(join(projectDir, `${sidB}.jsonl`), '{"type":"user","message":{"role":"user","content":"B"}}\n')
    await new Promise(r => setTimeout(r, 10))
    await writeFile(join(projectDir, `${sidA}.jsonl`), '{"type":"user","message":{"role":"user","content":"A"}}\n')

    await writeFile(join(hookStateDir, `${pidA}.sid`), sidA)
    await writeFile(join(hookStateDir, `${pidB}.sid`), sidB)

    mockPsAndLsof()
  })

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
    await rm(join(hookStateDir, `${pidA}.sid`), { force: true })
    await rm(join(hookStateDir, `${pidB}.sid`), { force: true })
    vi.clearAllMocks()
  })

  it('routes pane A to session A (not the freshest sibling)', async () => {
    const adapter = makeAdapter({ 'pane:A': 800 })
    const result = await resolveClaudeSession('pane:A', adapter)
    expect(result).not.toBeNull()
    expect(result!.sessionId).toBe(sidA)
    expect(result!.pid).toBe(pidA)
  })

  it('routes pane B to session B even though session A has the freshest JSONL', async () => {
    const adapter = makeAdapter({ 'pane:B': 900 })
    const result = await resolveClaudeSession('pane:B', adapter)
    expect(result).not.toBeNull()
    expect(result!.sessionId).toBe(sidB)
    expect(result!.pid).toBe(pidB)
  })

  it('falls back to argv session ID when no hook record exists yet', async () => {
    // Remove the hook record for A — simulate a freshly-started claude that hasn't
    // fired any hook events yet.
    await rm(join(hookStateDir, `${pidA}.sid`), { force: true })
    const adapter = makeAdapter({ 'pane:A': 800 })
    const result = await resolveClaudeSession('pane:A', adapter)
    // argv for A points at the stale argvA JSONL (exists but empty) — that's the
    // correct fallback order: hook > argv > freshest-in-dir
    expect(result!.sessionId).toBe(argvA)
  })
})
