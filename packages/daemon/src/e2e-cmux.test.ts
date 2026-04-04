/**
 * Perch E2E tests — cmux adapter.
 *
 * Requires: cmux running with Automation Mode enabled.
 * Run: npx vitest run src/e2e-cmux.test.ts
 */
import { describe } from 'vitest'
import { execa } from 'execa'
import { CmuxAdapter } from './adapters/cmux.js'
import { registerE2ETests, type E2EProvider } from './e2e-harness.js'

const CMUX = '/Applications/cmux.app/Contents/Resources/bin/cmux'
const TEST_WS_NAME = 'perch-e2e-test'

function cmux(args: string[]) {
  return execa(CMUX, args)
}

function wait(ms = 400) {
  return new Promise(r => setTimeout(r, ms))
}

const cmuxProvider: E2EProvider = {
  adapterName: 'cmux',

  async setup() {
    // Clear cmux env vars — when running inside a cmux terminal, these override
    // --surface/--workspace flags and cause "Surface is not a terminal" errors.
    delete process.env.CMUX_SURFACE_ID
    delete process.env.CMUX_WORKSPACE_ID
    delete process.env.CMUX_TAB_ID

    const { stdout: pingOut } = await cmux(['ping'])
    if (!pingOut.includes('PONG')) throw new Error('cmux is not running')

    // Clean up leftover test workspaces
    const { stdout: wsBefore } = await cmux(['list-workspaces'])
    for (const line of wsBefore.split('\n')) {
      if (line.includes(TEST_WS_NAME) || line.includes('perch-e2e')) {
        const match = line.match(/(workspace:\d+)/)
        if (match) await cmux(['close-workspace', '--workspace', match[1]]).catch(() => {})
      }
    }
    await wait()

    // Create test workspace and select it so cmux allocates a tty
    await cmux(['new-workspace', '--name', TEST_WS_NAME])
    await wait(600)
    const { stdout: wsTemp } = await cmux(['list-workspaces'])
    const wsTempLine = wsTemp.split('\n').find(l => l.includes(TEST_WS_NAME))
    if (wsTempLine) {
      const ref = wsTempLine.match(/(workspace:\d+)/)![1]
      await cmux(['select-workspace', '--workspace', ref])
      await wait(1000)
    }

    // Discover workspace ref and surface ID
    const { stdout: wsAfter } = await cmux(['list-workspaces'])
    const wsLine = wsAfter.split('\n').find(l => l.includes(TEST_WS_NAME))
    if (!wsLine) throw new Error(`Could not find workspace "${TEST_WS_NAME}" after creation`)
    const workspaceRef = wsLine.match(/(workspace:\d+)/)![1]

    const { stdout: panelsOut } = await cmux(['list-panels', '--workspace', workspaceRef])
    const surfMatch = panelsOut.match(/(surface:\d+)\s+terminal/)
    if (!surfMatch) throw new Error('Could not find terminal surface in test workspace')
    const surfaceRef = surfMatch[1]

    return {
      adapter: new CmuxAdapter(),
      testPaneId: `cmux:${workspaceRef}:${surfaceRef}`,
      testShortId: surfaceRef.split(':')[1],
    }
  },

  async teardown() {
    const { stdout } = await cmux(['list-workspaces']).catch(() => ({ stdout: '' }))
    for (const line of stdout.split('\n')) {
      if (line.includes(TEST_WS_NAME) || line.includes('perch-e2e')) {
        const match = line.match(/(workspace:\d+)/)
        if (match) await cmux(['close-workspace', '--workspace', match[1]]).catch(() => {})
      }
    }
  },
}

describe('E2E — cmux', () => {
  registerE2ETests(cmuxProvider)
})
