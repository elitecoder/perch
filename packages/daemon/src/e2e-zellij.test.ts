/**
 * Perch E2E tests — zellij adapter.
 *
 * Requires: zellij installed.
 * Run: npx vitest run src/e2e-zellij.test.ts
 *
 * Unlike tmux, zellij background sessions require --pane-id for read/write.
 * The adapter handles this via _parsePaneId().
 */
import { describe } from 'vitest'
import { execa } from 'execa'
import { ZellijAdapter } from './adapters/zellij.js'
import { registerE2ETests, type E2EProvider } from './e2e-harness.js'

const TEST_SESSION = 'perch-e2e-test'

function wait(ms = 400) {
  return new Promise(r => setTimeout(r, ms))
}

async function zellijKillSession(name: string) {
  await execa('zellij', ['kill-session', name]).catch(() => {})
}

const zellijProvider: E2EProvider = {
  adapterName: 'zellij',

  async setup() {
    // Verify zellij is available
    await execa('zellij', ['--version'])

    // Clean up leftover test sessions
    const { stdout: sessions } = await execa('zellij', ['list-sessions']).catch(() => ({ stdout: '' }))
    for (const line of sessions.split('\n')) {
      const name = line.trim().replace(/\s+\[.*\]$/, '')
      if (name.includes(TEST_SESSION) || name.includes('perch-e2e')) {
        await zellijKillSession(name)
      }
    }
    await wait()

    // Create test session (detached background) — kill first if leftover from previous run
    await execa('zellij', ['kill-session', TEST_SESSION]).catch(() => {})
    await wait(200)
    await execa('zellij', ['attach', TEST_SESSION, '--create-background'])
    await wait(1000)

    const adapter = new ZellijAdapter()
    const sessionsList = await adapter.listSessions()
    const session = sessionsList.find(s => s.name === TEST_SESSION)
    if (!session) throw new Error(`Could not find session "${TEST_SESSION}" after creation`)

    const pane = session.windows[0]?.panes[0]
    if (!pane) throw new Error('No panes found in test session')

    // Zellij pane short IDs (all "0") are ambiguous across sessions.
    // testShortId is what `tree` displays (bare "0").
    // testCommandId is the full pane ID so resolvePane passes it through
    // without scanning sessions (it contains ":" so it's treated as full).
    const shortMatch = pane.id.match(/:(\d+)$/)

    return {
      adapter,
      testPaneId: pane.id,
      testShortId: shortMatch ? shortMatch[1] : '0',
      testCommandId: pane.id,
    }
  },

  async teardown() {
    const { stdout } = await execa('zellij', ['list-sessions']).catch(() => ({ stdout: '' }))
    for (const line of stdout.split('\n')) {
      const name = line.trim().replace(/\s+\[.*\]$/, '')
      if (name.includes(TEST_SESSION) || name.includes('perch-e2e')) {
        await zellijKillSession(name)
      }
    }
  },
}

describe('E2E — zellij', () => {
  registerE2ETests(zellijProvider)
})
