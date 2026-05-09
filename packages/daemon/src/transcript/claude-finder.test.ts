import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findClaudePanes } from './claude-finder.js'
import type { ITerminalAdapter, Session } from '../adapters/interface.js'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  access: vi.fn(),
}))

import { execa } from 'execa'
import { access } from 'fs/promises'
const mockExeca = vi.mocked(execa)
const mockAccess = vi.mocked(access)

function makeAdapter(
  sessions: Session[] = [],
  getPaneTty?: (id: string) => Promise<string | null>,
): ITerminalAdapter {
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
    ...(getPaneTty ? { getPaneTty } : {}),
  } as unknown as ITerminalAdapter
}

function sessionWithPane(
  sessionName: string,
  paneId: string,
  title?: string,
): Session {
  return {
    id: sessionName,
    name: sessionName,
    windows: [{
      id: '@0',
      name: 'main',
      panes: [{
        id: paneId,
        index: 0,
        active: true,
        command: 'zsh',
        title,
        dimensions: { rows: 40, cols: 120 },
      }],
    }],
  }
}

describe('findClaudePanes (TTY-based)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAccess.mockRejectedValue(new Error('ENOENT') as never)
  })

  it('returns empty array when the adapter reports no panes', async () => {
    const adapter = makeAdapter([])
    const result = await findClaudePanes(adapter)
    expect(result).toEqual([])
    expect(mockExeca).not.toHaveBeenCalled()
  })

  it('returns empty array when ps fails', async () => {
    const adapter = makeAdapter([sessionWithPane('dev', 'tmux:dev:@0:%0')], vi.fn().mockResolvedValue('ttys001'))
    mockExeca.mockRejectedValueOnce(new Error('ps failed') as never)
    const result = await findClaudePanes(adapter)
    expect(result).toEqual([])
  })

  it('returns empty array when no Claude procs appear in ps output', async () => {
    const adapter = makeAdapter([sessionWithPane('dev', 'tmux:dev:@0:%0')], vi.fn().mockResolvedValue('ttys001'))
    mockExeca.mockResolvedValueOnce({
      stdout: '  200 ttys001 /bin/zsh\n  201 ttys001 vim main.ts',
    } as never)
    const result = await findClaudePanes(adapter)
    expect(result).toEqual([])
  })

  it('matches Claude proc to pane by TTY via --session-id', async () => {
    const adapter = makeAdapter(
      [sessionWithPane('dev', 'tmux:dev:@0:%0')],
      vi.fn().mockResolvedValue('ttys001'),
    )
    mockExeca.mockResolvedValueOnce({
      stdout: '  200 ttys001 node /usr/local/bin/claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    } as never)
    // lsof for CWD
    mockExeca.mockResolvedValueOnce({ stdout: 'p200\nn/home/user/project' } as never)

    const result = await findClaudePanes(adapter)
    expect(result).toHaveLength(1)
    expect(result[0]!.paneId).toBe('tmux:dev:@0:%0')
    expect(result[0]!.sessionName).toBe('dev')
    expect(result[0]!.sessionId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(result[0]!.cwd).toBe('/home/user/project')
    expect(result[0]!.jsonlPath).toBeNull() // access mocked to reject
  })

  it('matches via --resume flag', async () => {
    const adapter = makeAdapter(
      [sessionWithPane('dev', 'tmux:dev:@0:%0')],
      vi.fn().mockResolvedValue('ttys001'),
    )
    mockExeca.mockResolvedValueOnce({
      stdout: '  200 ttys001 node claude --resume aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    } as never)
    mockExeca.mockResolvedValueOnce({ stdout: 'p200\nn/tmp' } as never)

    const result = await findClaudePanes(adapter)
    expect(result).toHaveLength(1)
    expect(result[0]!.sessionId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })

  it('sets jsonlPath when the file exists on disk', async () => {
    const adapter = makeAdapter(
      [sessionWithPane('dev', 'tmux:dev:@0:%0')],
      vi.fn().mockResolvedValue('ttys001'),
    )
    mockExeca.mockResolvedValueOnce({
      stdout: '  200 ttys001 node claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    } as never)
    mockExeca.mockResolvedValueOnce({ stdout: 'p200\nn/home/user/project' } as never)
    mockAccess.mockResolvedValueOnce(undefined as never)

    const result = await findClaudePanes(adapter)
    expect(result).toHaveLength(1)
    expect(result[0]!.jsonlPath).toMatch(/\.claude\/projects\/-home-user-project\/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\.jsonl$/)
  })

  it('drops Claude proc whose TTY does not map to any known pane', async () => {
    const adapter = makeAdapter(
      [sessionWithPane('dev', 'tmux:dev:@0:%0')],
      vi.fn().mockResolvedValue('ttys001'),
    )
    // proc TTY ttys999 does not match ttys001
    mockExeca.mockResolvedValueOnce({
      stdout: '  999 ttys999 node claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    } as never)

    const result = await findClaudePanes(adapter)
    expect(result).toEqual([])
  })

  it('skips Claude procs without a TTY (daemonised "??")', async () => {
    const adapter = makeAdapter(
      [sessionWithPane('dev', 'tmux:dev:@0:%0')],
      vi.fn().mockResolvedValue('ttys001'),
    )
    mockExeca.mockResolvedValueOnce({
      stdout: [
        '  501 ?? node claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        '  200 ttys001 node claude --resume bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
      ].join('\n'),
    } as never)
    mockExeca.mockResolvedValueOnce({ stdout: 'p200\nn/tmp' } as never)

    const result = await findClaudePanes(adapter)
    expect(result).toHaveLength(1)
    expect(result[0]!.sessionId).toBe('bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee')
  })

  it('returns null cwd when lsof fails', async () => {
    const adapter = makeAdapter(
      [sessionWithPane('dev', 'tmux:dev:@0:%0')],
      vi.fn().mockResolvedValue('ttys001'),
    )
    mockExeca.mockResolvedValueOnce({
      stdout: '  200 ttys001 node claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    } as never)
    mockExeca.mockRejectedValueOnce(new Error('lsof failed') as never)

    const result = await findClaudePanes(adapter)
    expect(result).toHaveLength(1)
    expect(result[0]!.cwd).toBeNull()
    expect(result[0]!.jsonlPath).toBeNull()
  })

  it('returns null cwd when lsof output has no n-line', async () => {
    const adapter = makeAdapter(
      [sessionWithPane('dev', 'tmux:dev:@0:%0')],
      vi.fn().mockResolvedValue('ttys001'),
    )
    mockExeca.mockResolvedValueOnce({
      stdout: '  200 ttys001 node claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    } as never)
    mockExeca.mockResolvedValueOnce({ stdout: 'p200' } as never)

    const result = await findClaudePanes(adapter)
    expect(result).toHaveLength(1)
    expect(result[0]!.cwd).toBeNull()
  })

  it('propagates pane title from adapter', async () => {
    const adapter = makeAdapter(
      [sessionWithPane('Squirrel', 'cmux:workspace:7:surface:12', '✳ Address PR comments')],
      vi.fn().mockResolvedValue('ttys007'),
    )
    mockExeca.mockResolvedValueOnce({
      stdout: '  200 ttys007 node claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    } as never)
    mockExeca.mockResolvedValueOnce({ stdout: 'p200\nn/home/user/project' } as never)

    const result = await findClaudePanes(adapter)
    expect(result[0]!.paneTitle).toBe('✳ Address PR comments')
  })

  it('returns empty array when adapter has no getPaneTty support', async () => {
    const adapter = makeAdapter([sessionWithPane('dev', 'tmux:dev:@0:%0')]) // no getPaneTty
    mockExeca.mockResolvedValueOnce({
      stdout: '  200 ttys001 node claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    } as never)
    const result = await findClaudePanes(adapter)
    expect(result).toEqual([])
  })

  it('deduplicates Claude procs that share a TTY (first wins)', async () => {
    const adapter = makeAdapter(
      [sessionWithPane('dev', 'tmux:dev:@0:%0')],
      vi.fn().mockResolvedValue('ttys001'),
    )
    mockExeca.mockResolvedValueOnce({
      stdout: [
        '  200 ttys001 node claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        '  201 ttys001 node claude --session-id bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
      ].join('\n'),
    } as never)
    mockExeca.mockResolvedValueOnce({ stdout: 'p200\nn/home/user/project' } as never)

    const result = await findClaudePanes(adapter)
    expect(result).toHaveLength(1)
    expect(result[0]!.sessionId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
  })

  it('handles multiple panes with independent TTYs', async () => {
    const twoSessions: Session[] = [
      sessionWithPane('dev', 'tmux:dev:@0:%0'),
      sessionWithPane('work', 'tmux:work:@0:%0'),
    ]
    const getPaneTty = vi.fn(async (id: string) =>
      id === 'tmux:dev:@0:%0' ? 'ttys001' : 'ttys002',
    )
    const adapter = makeAdapter(twoSessions, getPaneTty)
    mockExeca.mockResolvedValueOnce({
      stdout: [
        '  200 ttys001 node claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        '  300 ttys002 node claude --resume bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
      ].join('\n'),
    } as never)
    mockExeca.mockResolvedValueOnce({ stdout: 'p200\nn/a' } as never)
    mockExeca.mockResolvedValueOnce({ stdout: 'p300\nn/b' } as never)

    const result = await findClaudePanes(adapter)
    expect(result).toHaveLength(2)
    expect(result.map(r => r.sessionName).sort()).toEqual(['dev', 'work'])
  })

  it('skips panes where getPaneTty returns null', async () => {
    const adapter = makeAdapter(
      [sessionWithPane('dev', 'tmux:dev:@0:%0')],
      vi.fn().mockResolvedValue(null),
    )
    mockExeca.mockResolvedValueOnce({
      stdout: '  200 ttys001 node claude --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    } as never)

    const result = await findClaudePanes(adapter)
    expect(result).toEqual([])
  })

  it('ignores lines with invalid PIDs', async () => {
    const adapter = makeAdapter(
      [sessionWithPane('dev', 'tmux:dev:@0:%0')],
      vi.fn().mockResolvedValue('ttys001'),
    )
    mockExeca.mockResolvedValueOnce({
      stdout: [
        'HEADER ttys001 --session-id aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        '  200 ttys001 node claude --session-id bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee',
      ].join('\n'),
    } as never)
    mockExeca.mockResolvedValueOnce({ stdout: 'p200\nn/tmp' } as never)

    const result = await findClaudePanes(adapter)
    expect(result).toHaveLength(1)
    expect(result[0]!.sessionId).toBe('bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee')
  })
})
