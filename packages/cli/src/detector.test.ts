import { describe, expect, it, vi } from 'vitest'
import { detectMultiplexers, installInstructions } from './detector.js'

vi.mock('execa', () => ({
  execa: vi.fn(),
}))

import { execa } from 'execa'
const mockExeca = vi.mocked(execa)

describe('detectMultiplexers', () => {
  it('returns only installed multiplexers', async () => {
    mockExeca.mockImplementation((_cmd, args) => {
      const target = (args as string[])[0]
      if (target === 'tmux') return Promise.resolve({ stdout: '/usr/bin/tmux' }) as never
      return Promise.reject(new Error('not found')) as never
    })

    const found = await detectMultiplexers()
    expect(found.map(m => m.id)).toEqual(['tmux'])
  })

  it('returns empty array when none are installed', async () => {
    mockExeca.mockRejectedValue(new Error('not found') as never)
    const found = await detectMultiplexers()
    expect(found).toHaveLength(0)
  })

  it('respects priority order (tmux before zellij)', async () => {
    mockExeca.mockImplementation((_cmd, args) => {
      const target = (args as string[])[0]
      if (target === 'tmux' || target === 'zellij') {
        return Promise.resolve({ stdout: `/usr/bin/${target}` }) as never
      }
      return Promise.reject(new Error('not found')) as never
    })

    const found = await detectMultiplexers()
    expect(found[0]?.id).toBe('tmux')
    expect(found[1]?.id).toBe('zellij')
  })
})

describe('installInstructions', () => {
  it('returns brew install tmux for tmux', () => {
    expect(installInstructions('tmux')).toContain('brew install tmux')
  })

  it('returns a fallback for unknown multiplexers', () => {
    expect(installInstructions('unknown')).toContain('unknown')
  })
})
