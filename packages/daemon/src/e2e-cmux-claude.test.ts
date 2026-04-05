/**
 * E2E test — starts a real interactive Claude session in cmux, sends a prompt,
 * and verifies the transcript monitor posts a response to the mock Slack poster.
 *
 * Requires: cmux running with Automation Mode enabled, `claude` CLI available and authenticated.
 * Run: npx vitest run --config vitest.e2e.config.ts src/e2e-cmux-claude.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execa } from 'execa'
import { readdir, stat } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { CmuxAdapter } from './adapters/cmux.js'
import { ClaudeCodePlugin } from './plugins/builtin/claude-code.js'
import { WatcherManager } from './watcher/manager.js'
import type { LiveView, ConversationalView } from './slack/poster.js'

const CMUX = '/Applications/cmux.app/Contents/Resources/bin/cmux'
const TEST_WS_NAME = 'perch-e2e-claude'

function cmux(args: string[]) {
  return execa(CMUX, args)
}

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
 * created at or after `sinceMs`.
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

describe('E2E — cmux Claude session', () => {
  let adapter: CmuxAdapter
  let watcher: WatcherManager
  let poster: MockPoster
  let testPaneId: string
  let workspaceRef: string

  beforeAll(async () => {
    // Clear cmux env vars to avoid conflicts when running inside cmux
    delete process.env.CMUX_SURFACE_ID
    delete process.env.CMUX_WORKSPACE_ID
    delete process.env.CMUX_TAB_ID

    const { stdout: pingOut } = await cmux(['ping'])
    if (!pingOut.includes('PONG')) throw new Error('cmux is not running')

    // Clean up leftover test workspaces
    const { stdout: wsBefore } = await cmux(['list-workspaces'])
    for (const line of wsBefore.split('\n')) {
      if (line.includes(TEST_WS_NAME)) {
        const match = line.match(/(workspace:\d+)/)
        if (match) await cmux(['close-workspace', '--workspace', match[1]]).catch(() => {})
      }
    }
    await wait(400)

    // Create test workspace and select it
    await cmux(['new-workspace', '--name', TEST_WS_NAME])
    await wait(600)
    const { stdout: wsAfter } = await cmux(['list-workspaces'])
    const wsLine = wsAfter.split('\n').find(l => l.includes(TEST_WS_NAME))
    if (!wsLine) throw new Error(`Could not find workspace "${TEST_WS_NAME}" after creation`)
    workspaceRef = wsLine.match(/(workspace:\d+)/)![1]

    await cmux(['select-workspace', '--workspace', workspaceRef])
    await wait(1000)

    // Find the terminal surface
    const { stdout: panelsOut } = await cmux(['list-panels', '--workspace', workspaceRef])
    const surfMatch = panelsOut.match(/(surface:\d+)\s+terminal/)
    if (!surfMatch) throw new Error('Could not find terminal surface in test workspace')
    const surfaceRef = surfMatch[1]

    testPaneId = `cmux:${workspaceRef}:${surfaceRef}`
    adapter = new CmuxAdapter()
    watcher = new WatcherManager()
    poster = new MockPoster()
  }, 15_000)

  afterAll(async () => {
    watcher.dispose()
    // Send ctrl-c and exit to Claude before closing workspace
    await adapter.sendKey(testPaneId, 'C-c').catch(() => {})
    await wait(500)
    await adapter.sendText(testPaneId, '/exit').catch(() => {})
    await wait(1000)
    if (workspaceRef) {
      await cmux(['close-workspace', '--workspace', workspaceRef]).catch(() => {})
    }
  }, 15_000)

  it('starts claude, sends a prompt, transcript monitor posts response', async () => {
    const launchedAt = Date.now()

    // Launch claude in the pane
    await adapter.sendText(testPaneId, 'claude')

    // Wait for Claude's TUI to be ready (the input prompt)
    const claudeReady = await pollUntil(async () => {
      const screen = await adapter.readPane(testPaneId, 50)
      return screen.includes('❯')
    }, 30_000, 500)

    if (!claudeReady) {
      const screen = await adapter.readPane(testPaneId, 50)
      throw new Error(`Claude did not reach waiting state within 30s.\n\nPane content:\n${screen}`)
    }

    // Send a simple prompt — Claude will run `date` and report the time
    await adapter.sendText(testPaneId, 'What time is it right now?')

    // Poll for the JSONL session file
    const jsonlPath = await waitForNewClaudeJsonl(launchedAt, 15_000)
    if (!jsonlPath) {
      throw new Error('Could not locate Claude Code session JSONL in ~/.claude/projects/')
    }
    console.log('[claude-e2e] JSONL:', jsonlPath)

    // Set up transcript monitoring
    const { ts: threadTs } = await poster.post(':eyes: Watching claude')
    const plugin = new ClaudeCodePlugin()

    await watcher.watchTranscript(testPaneId, jsonlPath, poster as any, threadTs, plugin, false)

    // Wait for Claude's response containing a time
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
