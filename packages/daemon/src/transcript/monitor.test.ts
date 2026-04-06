import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { writeFile, rm, mkdir, appendFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { TranscriptMonitor } from './monitor.js'
import type { Poster, ConversationalView } from '../slack/poster.js'

const tmp = join(tmpdir(), 'perch-monitor-test')

beforeEach(async () => {
  await mkdir(tmp, { recursive: true })
})

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true })
})

function jsonlPath(name = 'session.jsonl'): string {
  return join(tmp, name)
}

function makeMockPoster(view: Partial<ConversationalView>): Poster {
  if (!view.flush) view.flush = vi.fn().mockResolvedValue(undefined)
  return {
    makeConversationalView: () => view as ConversationalView,
    addReaction: vi.fn().mockResolvedValue(undefined),
    removeReaction: vi.fn().mockResolvedValue(undefined),
    setTypingStatus: vi.fn().mockResolvedValue(undefined),
    clearTypingStatus: vi.fn().mockResolvedValue(undefined),
  } as unknown as Poster
}

describe('TranscriptMonitor', () => {
  it('calls updateStatus for tool calls', async () => {
    const path = jsonlPath()
    await writeFile(path, '')

    const updateStatus = vi.fn().mockResolvedValue(undefined)
    const poster = makeMockPoster({ updateStatus, postResponse: vi.fn(), postUser: vi.fn() })

    const monitor = new TranscriptMonitor()
    monitor.watch('pane:1', path, poster, 'ts-1')

    // Write an assistant record with a tool call
    await appendFile(
      path,
      JSON.stringify({
        type: 'assistant',
        isSidechain: false,
        message: {
          model: 'claude-sonnet-4-6',
          id: 'msg_1',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/src/auth.ts' } }],
          stop_reason: 'tool_use',
        },
      }) + '\n',
    )

    await monitor.tick('pane:1')
    expect(updateStatus).toHaveBeenCalledWith(expect.stringContaining('auth.ts'))

    monitor.dispose()
  })

  it('calls postResponse for end_turn assistant message', async () => {
    const path = jsonlPath()
    await writeFile(path, '')

    const postResponse = vi.fn().mockResolvedValue(undefined)
    const poster = makeMockPoster({ updateStatus: vi.fn(), postResponse, postUser: vi.fn() })

    const monitor = new TranscriptMonitor()
    monitor.watch('pane:2', path, poster, 'ts-2')

    await appendFile(
      path,
      JSON.stringify({
        type: 'assistant',
        isSidechain: false,
        message: {
          model: 'claude-sonnet-4-6',
          id: 'msg_2',
          role: 'assistant',
          content: [{ type: 'text', text: 'I fixed the bug.' }],
          stop_reason: 'end_turn',
        },
      }) + '\n',
    )

    await monitor.tick('pane:2')
    expect(postResponse).toHaveBeenCalledWith('I fixed the bug.')

    monitor.dispose()
  })

  it('getByThread returns the watch for a registered thread', async () => {
    const monitor = new TranscriptMonitor()
    const poster = makeMockPoster({ updateStatus: vi.fn(), postResponse: vi.fn(), postUser: vi.fn() })
    await monitor.watch('pane:3', jsonlPath('s3.jsonl'), poster, 'thread-abc')
    expect(monitor.getByThread('thread-abc')).toBeDefined()
    monitor.dispose()
  })

  it('unwatch removes the watch', async () => {
    const monitor = new TranscriptMonitor()
    const poster = makeMockPoster({ updateStatus: vi.fn(), postResponse: vi.fn(), postUser: vi.fn() })
    await monitor.watch('pane:4', jsonlPath('s4.jsonl'), poster, 'thread-xyz')
    monitor.unwatch('pane:4')
    expect(monitor.listWatches()).toHaveLength(0)
    expect(monitor.getByThread('thread-xyz')).toBeUndefined()
  })

  it('detects session rotation and switches to the newer JSONL', async () => {
    // Start with the original session file
    const oldPath = jsonlPath('old-session.jsonl')
    await writeFile(oldPath, '')

    const postResponse = vi.fn().mockResolvedValue(undefined)
    const poster = makeMockPoster({ updateStatus: vi.fn(), postResponse, postUser: vi.fn() })

    const monitor = new TranscriptMonitor()
    await monitor.watch('pane:5', oldPath, poster, 'ts-5')

    // Tick with no new records to exhaust emptyTicks threshold (10 ticks)
    for (let i = 0; i < 11; i++) {
      await monitor.tick('pane:5')
    }
    // No rotation yet because no newer file exists
    expect(postResponse).not.toHaveBeenCalled()

    // Create a "rotated" session file with newer mtime
    const newPath = jsonlPath('new-session.jsonl')
    // Ensure the new file has a strictly newer mtime
    await new Promise(r => setTimeout(r, 50))
    await writeFile(
      newPath,
      JSON.stringify({
        type: 'assistant',
        isSidechain: false,
        message: {
          model: 'claude-sonnet-4-6',
          id: 'msg_rot',
          role: 'assistant',
          content: [{ type: 'text', text: 'Rotated response.' }],
          stop_reason: 'end_turn',
        },
      }) + '\n',
    )

    // Tick enough to trigger rotation check again
    for (let i = 0; i < 11; i++) {
      await monitor.tick('pane:5')
    }

    // After rotation, the reader switched to new-session.jsonl which already
    // had content. But seekToEnd was called, so existing content is skipped.
    // Write NEW content to the rotated file:
    await appendFile(
      newPath,
      JSON.stringify({
        type: 'assistant',
        isSidechain: false,
        message: {
          model: 'claude-sonnet-4-6',
          id: 'msg_new',
          role: 'assistant',
          content: [{ type: 'text', text: 'New content after rotation.' }],
          stop_reason: 'end_turn',
        },
      }) + '\n',
    )

    await monitor.tick('pane:5')
    expect(postResponse).toHaveBeenCalledWith('New content after rotation.')

    monitor.dispose()
  })

  it('calls flush after processing actions', async () => {
    const path = jsonlPath('flush-test.jsonl')
    await writeFile(path, '')

    const flush = vi.fn().mockResolvedValue(undefined)
    const poster = makeMockPoster({
      updateStatus: vi.fn().mockResolvedValue(undefined),
      postResponse: vi.fn().mockResolvedValue(undefined),
      postUser: vi.fn().mockResolvedValue(undefined),
      flush,
    })

    const monitor = new TranscriptMonitor()
    await monitor.watch('pane:6', path, poster, 'ts-6')

    await appendFile(
      path,
      JSON.stringify({
        type: 'assistant',
        isSidechain: false,
        message: {
          model: 'claude-sonnet-4-6',
          id: 'msg_flush',
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
          stop_reason: 'end_turn',
        },
      }) + '\n',
    )

    await monitor.tick('pane:6')
    expect(flush).toHaveBeenCalled()

    monitor.dispose()
  })

  it('cleans up marker files when new records arrive', async () => {
    const path = jsonlPath('cleanup-test.jsonl')
    await writeFile(path, '')

    const postResponse = vi.fn().mockResolvedValue(undefined)
    const poster = makeMockPoster({
      updateStatus: vi.fn().mockResolvedValue(undefined),
      postResponse,
      postUser: vi.fn().mockResolvedValue(undefined),
    })

    const monitor = new TranscriptMonitor()
    await monitor.watch('pane:8', path, poster, 'ts-8')

    // Simulate stale marker files that a hook left behind
    const { mkdir: mkdirFs, writeFile: writeFs, access: accessFs } = await import('fs/promises')
    const os = await import('os')
    const pathMod = await import('path')
    const waitingDir = pathMod.join(os.homedir(), '.config', 'perch', 'waiting')
    const interactiveDir = pathMod.join(os.homedir(), '.config', 'perch', 'interactive')
    await mkdirFs(waitingDir, { recursive: true })
    await mkdirFs(interactiveDir, { recursive: true })

    const sessionId = 'cleanup-test'
    await writeFs(pathMod.join(waitingDir, `${sessionId}.json`), '{"tool_name":"Bash"}')
    await writeFs(pathMod.join(interactiveDir, `${sessionId}.json`), '{"notification_type":"permission_prompt"}')

    // Write a JSONL record so the tick processes new records
    await appendFile(
      path,
      JSON.stringify({
        type: 'assistant',
        isSidechain: false,
        message: {
          model: 'claude-sonnet-4-6',
          id: 'msg_cleanup',
          role: 'assistant',
          content: [{ type: 'text', text: 'Working on it.' }],
          stop_reason: 'end_turn',
        },
      }) + '\n',
    )

    await monitor.tick('pane:8')

    // Marker files should be cleaned up
    let waitingExists = true
    let interactiveExists = true
    try { await accessFs(pathMod.join(waitingDir, `${sessionId}.json`)); } catch { waitingExists = false }
    try { await accessFs(pathMod.join(interactiveDir, `${sessionId}.json`)); } catch { interactiveExists = false }
    expect(waitingExists).toBe(false)
    expect(interactiveExists).toBe(false)

    monitor.dispose()
  })

  it('suppresses user echo for forwarded text after system tags are stripped', async () => {
    const path = jsonlPath('echo-test.jsonl')
    await writeFile(path, '')

    const postUser = vi.fn().mockResolvedValue(undefined)
    const poster = makeMockPoster({
      updateStatus: vi.fn().mockResolvedValue(undefined),
      postResponse: vi.fn().mockResolvedValue(undefined),
      postUser,
    })

    const monitor = new TranscriptMonitor()
    await monitor.watch('pane:7', path, poster, 'ts-7')

    // Record forwarded text from Slack
    monitor.recordForwardedText('pane:7', 'fix the bug')

    // JSONL echoes back the user text wrapped in system tags
    await appendFile(
      path,
      JSON.stringify({
        type: 'user',
        isSidechain: false,
        message: {
          role: 'user',
          content: '<system-reminder>context</system-reminder>\nfix the bug\n<system-reminder>more context</system-reminder>',
        },
      }) + '\n',
    )

    await monitor.tick('pane:7')
    // The user text should be suppressed because it matches the forwarded text
    expect(postUser).not.toHaveBeenCalled()

    monitor.dispose()
  })
})
