/**
 * Perch E2E tests — tmux adapter.
 *
 * Requires: tmux installed.
 * Run: npx vitest run src/e2e-tmux.test.ts
 */
import { describe } from 'vitest'
import { execa } from 'execa'
import { TmuxAdapter } from './adapters/tmux.js'
import { registerE2ETests, type E2EProvider } from './e2e-harness.js'

const TEST_SESSION = 'perch-e2e-test'

function tmux(args: string[]) {
  return execa('tmux', args)
}

function wait(ms = 400) {
  return new Promise(r => setTimeout(r, ms))
}

const tmuxProvider: E2EProvider = {
  adapterName: 'tmux',

  async setup() {
    // Verify tmux is available
    await execa('tmux', ['-V'])

    // Clean up leftover test sessions
    const { stdout: sessions } = await tmux(['list-sessions', '-F', '#{session_name}']).catch(() => ({ stdout: '' }))
    for (const name of sessions.split('\n')) {
      if (name.includes(TEST_SESSION) || name.includes('perch-e2e')) {
        await tmux(['kill-session', '-t', name]).catch(() => {})
      }
    }
    await wait()

    // Create test session (detached)
    await tmux(['new-session', '-d', '-s', TEST_SESSION])
    await wait(600)

    // Discover pane ID
    const adapter = new TmuxAdapter()
    const sessionsList = await adapter.listSessions()
    const session = sessionsList.find(s => s.name === TEST_SESSION)
    if (!session) throw new Error(`Could not find session "${TEST_SESSION}" after creation`)

    const pane = session.windows[0]?.panes[0]
    if (!pane) throw new Error('No panes found in test session')

    // Short ID: extract trailing pane index from id like "tmux:perch-e2e-test:@0:%1"
    // The shortId function in terminal.ts uses the last numeric part after ":"
    const shortMatch = pane.id.match(/:(\d+)$/)
    const testShortId = shortMatch ? shortMatch[1] : String(pane.index)

    return {
      adapter,
      testPaneId: pane.id,
      testShortId,
    }
  },

  async teardown() {
    const { stdout } = await tmux(['list-sessions', '-F', '#{session_name}']).catch(() => ({ stdout: '' }))
    for (const name of stdout.split('\n')) {
      if (name.includes(TEST_SESSION) || name.includes('perch-e2e')) {
        await tmux(['kill-session', '-t', name]).catch(() => {})
      }
    }
  },
}

describe('E2E — tmux', () => {
  registerE2ETests(tmuxProvider)
})
