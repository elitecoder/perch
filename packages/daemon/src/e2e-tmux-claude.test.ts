/**
 * E2E test — starts a real interactive Claude session in tmux, sends a prompt,
 * and verifies the transcript monitor posts a response to the mock Slack poster.
 *
 * Requires: tmux installed, `claude` CLI available and authenticated.
 * Run: npx vitest run --config vitest.e2e.config.ts src/e2e-tmux-claude.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execa } from 'execa'
import { readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { TmuxAdapter } from './adapters/tmux.js'
import { ClaudeCodePlugin } from './plugins/builtin/claude-code.js'
import { WatcherManager } from './watcher/manager.js'
import type { LiveView, ConversationalView } from './slack/poster.js'

class MockPoster {
  messages: { text: string; threadTs?: string }[] = []
  _ts = 0

  async post(text: string) {
    const ts = String(++this._ts)
    this.messages.push({ text })
    return { ts }
  }

  async postToThread(threadTs: string, text: string) {
    this.messages.push({ text, threadTs })
    return { ts: String(++this._ts) }
  }

  async postCode(text: string) { return this.post('```\n' + text + '\n```') }
  async postError(msg: string) { void this.post(`:x: ${msg}`) }
  async update(_ts: string, _text: string) { /* no-op */ }

  makeLiveView(_threadTs: string): LiveView {
    const self = this
    return {
      async update(text: string) { await self.post(text) },
      async transition(text: string) { await self.post(text) },
    } as LiveView
  }

  makeConversationalView(threadTs: string): ConversationalView {
    const self = this
    return {
      async updateStatus(text: string) { await self.postToThread(threadTs, text) },
      async postResponse(text: string) { await self.postToThread(threadTs, text) },
      async updateResponse(text: string) { await self.postToThread(threadTs, text) },
      async postUser(text: string) { await self.postToThread(threadTs, text) },
    } as unknown as ConversationalView
  }

  makeThreadPostFn(threadTs: string) {
    return (msg: string) => this.postToThread(threadTs, msg).then(() => undefined)
  }
}

const CLAUDE_SESSION = 'perch-e2e-claude'

function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

async function pollUntil(
  fn: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs = 500,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await fn()) return true
    await wait(intervalMs)
  }
  return false
}

/**
 * Scan ~/.claude/projects/ for the most recently modified .jsonl file
 * created at or after `sinceMs`. This finds a freshly-started interactive
 * Claude session without relying on --session-id appearing in `ps` args.
 */
async function waitForNewClaudeJsonl(
  sinceMs: number,
  timeoutMs = 20_000,
): Promise<string | null> {
  const projectsDir = join(homedir(), '.claude', 'projects')
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      let newest: { path: string; mtime: number } | null = null
      const dirs = await readdir(projectsDir).catch(() => [] as string[])

      for (const dir of dirs) {
        const files = await readdir(join(projectsDir, dir)).catch(() => [] as string[])
        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue
          const filePath = join(projectsDir, dir, file)
          const { mtimeMs } = await stat(filePath).catch(() => ({ mtimeMs: 0 }))
          if (mtimeMs >= sinceMs && (!newest || mtimeMs > newest.mtime)) {
            newest = { path: filePath, mtime: mtimeMs }
          }
        }
      }

      if (newest) return newest.path
    } catch {
      // ignore and retry
    }
    await wait(500)
  }
  return null
}

describe('E2E — tmux Claude session', () => {
  let adapter: TmuxAdapter
  let watcher: WatcherManager
  let poster: MockPoster
  let testPaneId: string

  beforeAll(async () => {
    // Kill any leftover test sessions
    const { stdout } = await execa('tmux', ['list-sessions', '-F', '#{session_name}']).catch(() => ({ stdout: '' }))
    for (const name of stdout.split('\n').map(s => s.trim()).filter(Boolean)) {
      if (name === CLAUDE_SESSION) {
        await execa('tmux', ['kill-session', '-t', name]).catch(() => {})
      }
    }

    // Create a wide session so Claude's TUI renders cleanly
    await execa('tmux', ['new-session', '-d', '-s', CLAUDE_SESSION, '-x', '220', '-y', '50'])
    await wait(400)

    adapter = new TmuxAdapter()
    const sessions = await adapter.listSessions()
    const session = sessions.find(s => s.name === CLAUDE_SESSION)
    if (!session) throw new Error(`Session "${CLAUDE_SESSION}" not found after creation`)

    const pane = session.windows[0]?.panes[0]
    if (!pane) throw new Error('No pane found in test session')
    testPaneId = pane.id

    watcher = new WatcherManager()
    poster = new MockPoster()
  }, 15_000)

  afterAll(async () => {
    watcher.dispose()
    await execa('tmux', ['kill-session', '-t', CLAUDE_SESSION]).catch(() => {})
  })

  it('starts claude, sends a prompt, transcript monitor posts response', async () => {
    // Record time just before launching so we can find the fresh JSONL
    const launchedAt = Date.now()

    // Launch claude in the pane (shell's cwd must already be trusted by Claude)
    await adapter.sendText(testPaneId, 'claude')

    // Wait for Claude's TUI to be ready — the ❯ input prompt appears once Claude
    // has fully started up and is waiting for user input
    const claudeReady = await pollUntil(async () => {
      const screen = await adapter.readPane(testPaneId, 50)
      return screen.includes('❯')
    }, 30_000, 500)

    if (!claudeReady) {
      const screen = await adapter.readPane(testPaneId, 50)
      throw new Error(`Claude did not reach waiting state within 30s.\n\nPane content:\n${screen}`)
    }

    // Send the prompt immediately — this triggers creation of the JSONL session file.
    // Asking the time is a real question: Claude will run `date` via bash tool and report it.
    await adapter.sendText(testPaneId, 'What time is it right now?')

    // Now poll for the JSONL that Claude creates once the first message is sent
    const jsonlPath = await waitForNewClaudeJsonl(launchedAt, 15_000)
    if (!jsonlPath) {
      throw new Error('Could not locate Claude Code session JSONL in ~/.claude/projects/')
    }
    console.log('[claude-e2e] JSONL:', jsonlPath)

    // Simulate a Slack thread and monitor from the start of the file to catch the response
    const { ts: threadTs } = await poster.post(':eyes: Watching claude')
    const plugin = new ClaudeCodePlugin()

    // startFromEnd = false: read from position 0 so we capture the full response
    await watcher.watchTranscript(testPaneId, jsonlPath, poster as any, threadTs, plugin, /* startFromEnd */ false)

    // Wait for Claude's actual response (not just the user-echo).
    // The response should contain a time (digits with colon, or AM/PM).
    const gotResponse = await pollUntil(
      () => poster.messages.filter(m => m.threadTs === threadTs).some(m => /\d+:\d+|AM|PM/i.test(m.text)),
      30_000,
      500,
    )

    const threadMessages = poster.messages.filter(m => m.threadTs === threadTs)
    console.log('[claude-e2e] thread messages:', threadMessages.map(m => m.text))

    expect(gotResponse, 'transcript monitor should post Claude\'s response (containing the time) to the thread').toBe(true)
  }, 90_000)
})
