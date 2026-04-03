import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('execa', () => ({
  execa: vi.fn().mockResolvedValue({ stdout: '/opt/homebrew/bin/node' }),
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue(
      '{{NODE_PATH}} {{DAEMON_PATH}} {{CONFIG_DIR}} {{HOME}}'
    ),
    writeFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(true),
  }
})

import { execa } from 'execa'
import { writeFileSync } from 'fs'
import { generatePlist, install, isRunning, restart, resolveNodePath } from './launchagent.js'

const mockExeca = vi.mocked(execa)
const mockWriteFileSync = vi.mocked(writeFileSync)

describe('generatePlist', () => {
  it('substitutes all template variables', () => {
    const result = generatePlist({ nodePath: '/usr/bin/node', daemonPath: '/usr/local/lib/daemon.cjs' })
    expect(result).toContain('/usr/bin/node')
    expect(result).toContain('/usr/local/lib/daemon.cjs')
    expect(result).not.toContain('{{NODE_PATH}}')
    expect(result).not.toContain('{{DAEMON_PATH}}')
    expect(result).not.toContain('{{CONFIG_DIR}}')
    expect(result).not.toContain('{{HOME}}')
  })
})

describe('install', () => {
  it('writes plist file and calls launchctl load', async () => {
    await install({ nodePath: '/usr/bin/node', daemonPath: '/daemon.cjs' })
    expect(mockWriteFileSync).toHaveBeenCalled()
    expect(mockExeca).toHaveBeenCalledWith('launchctl', ['load', expect.stringContaining('dev.perch.plist')])
  })
})

describe('isRunning', () => {
  it('returns true when launchctl list contains the label', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: 'PID\tStatus\tLabel\n123\t0\tdev.perch' } as never)
    expect(await isRunning()).toBe(true)
  })

  it('returns false when launchctl list does not contain the label', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: 'PID\tStatus\tLabel\n' } as never)
    expect(await isRunning()).toBe(false)
  })

  it('returns false when launchctl throws', async () => {
    mockExeca.mockRejectedValueOnce(new Error('not found') as never)
    expect(await isRunning()).toBe(false)
  })
})

describe('resolveNodePath', () => {
  it('returns the path from which node', async () => {
    mockExeca.mockResolvedValueOnce({ stdout: '/opt/homebrew/bin/node\n' } as never)
    const path = await resolveNodePath()
    expect(path).toBe('/opt/homebrew/bin/node')
  })
})
