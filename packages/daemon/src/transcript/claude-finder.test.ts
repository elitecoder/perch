import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findClaudePanes } from './claude-finder.js'
import type { ITerminalAdapter, Session } from '../adapters/interface.js'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'
const mockExeca = vi.mocked(execa)

function makeAdapter(sessions: Session[] = [], getPanePid?: (id: string) => Promise<number | null>): ITerminalAdapter {
  return {
    name: 'mock',
    isAvailable: vi.fn(),
    listSessions: vi.fn().mockResolvedValue(sessions),
    readPane: vi.fn(),
    sendText: vi.fn(),
    sendKey: vi.fn(),
    createSession: vi.fn(),
    renameSession: vi.fn(),
    closeSession: vi.fn(),
    splitPane: vi.fn(),
    selectPane: vi.fn(),
    ...(getPanePid ? { getPanePid } : {}),
  } as unknown as ITerminalAdapter
}

const mockSession: Session = {
  id: '$0',
  name: 'dev',
  windows: [{
    id: '@0',
    name: 'main',
    panes: [{
      id: 'tmux:dev:@0:%0',
      index: 0,
      active: true,
      command: 'zsh',
      dimensions: { rows: 40, cols: 120 },
    }],
  }],
}

describe('findClaudePanes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when no sessions exist', async () => {
    const adapter = makeAdapter([])
    const result = await findClaudePanes(adapter)
    expect(result).toEqual([])
  })

  it('returns empty array when ps fails', async () => {
    const adapter = makeAdapter([mockSession], vi.fn().mockResolvedValue(100))
    // ps call fails
    mockExeca.mockRejectedValueOnce(new Error('ps failed') as never)
    const result = await findClaudePanes(adapter)
    expect(result).toEqual([])
  })

  it('returns empty array when no Claude processes found in ps output', async () => {
    const adapter = makeAdapter([mockSession], vi.fn().mockResolvedValue(100))
    mockExeca.mockResolvedValueOnce({ stdout: '  200  100 /bin/zsh\n  201  200 vim main.ts' } as never)
    const result = await findClaudePanes(adapter)
    expect(result).toEqual([])
  })

  it('finds Claude pane via --session-id in ps output and ancestor walk', async () => {
    const adapter = makeAdapter([mockSession], vi.fn().mockResolvedValue(100))
    // ps output: shell PID 100, node PID 200 (child of 100), with --session-id
    mockExeca.mockResolvedValueOnce({
      stdout: [
        '  100    1 /bin/zsh',
        '  200  100 node /usr/local/bin/claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      ].join('\n'),
    } as never)
    // lsof for CWD
    mockExeca.mockResolvedValueOnce({ stdout: 'p200\nn/home/user/project' } as never)
    // access check for JSONL file will fail (file doesn't exist)

    const result = await findClaudePanes(adapter)
    expect(result).toHaveLength(1)
    expect(result[0]!.paneId).toBe('tmux:dev:@0:%0')
    expect(result[0]!.sessionName).toBe('dev')
    expect(result[0]!.sessionId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(result[0]!.cwd).toBe('/home/user/project')
  })

  it('finds Claude pane via --resume flag', async () => {
    const adapter = makeAdapter([mockSession], vi.fn().mockResolvedValue(100))
    mockExeca.mockResolvedValueOnce({
      stdout: [
        '  100    1 /bin/zsh',
        '  200  100 node /usr/local/bin/claude --resume aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      ].join('\n'),
    } as never)
    mockExeca.mockResolvedValueOnce({ stdout: 'p200\nn/tmp' } as never)

    const result = await findClaudePanes(adapter)
    expect(result).toHaveLength(1)
    expect(result[0]!.sessionId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })

  it('skips Claude process when ancestor walk does not reach a known pane shell', async () => {
    const adapter = makeAdapter([mockSession], vi.fn().mockResolvedValue(100))
    // Claude process PID 999 with parent 998 — neither is the pane shell (100)
    mockExeca.mockResolvedValueOnce({
      stdout: [
        '  100    1 /bin/zsh',
        '  998    1 /bin/bash',
        '  999  998 node /usr/local/bin/claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      ].join('\n'),
    } as never)

    const result = await findClaudePanes(adapter)
    expect(result).toEqual([])
  })

  it('returns null cwd when lsof fails', async () => {
    const adapter = makeAdapter([mockSession], vi.fn().mockResolvedValue(100))
    mockExeca.mockResolvedValueOnce({
      stdout: '  100    1 /bin/zsh\n  200  100 node claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    } as never)
    // lsof fails
    mockExeca.mockRejectedValueOnce(new Error('lsof failed') as never)

    const result = await findClaudePanes(adapter)
    expect(result).toHaveLength(1)
    expect(result[0]!.cwd).toBeNull()
    expect(result[0]!.jsonlPath).toBeNull()
  })

  it('returns null when getPanePid is not available', async () => {
    const adapter = makeAdapter([mockSession]) // no getPanePid
    mockExeca.mockResolvedValueOnce({
      stdout: '  200  100 node claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    } as never)

    const result = await findClaudePanes(adapter)
    // No shell PIDs known, so ancestor walk fails
    expect(result).toEqual([])
  })
})
