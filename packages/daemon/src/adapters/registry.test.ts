import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the tmux adapter module
vi.mock('./tmux.js', () => ({
  TmuxAdapter: vi.fn().mockImplementation(() => ({
    name: 'tmux',
    isAvailable: vi.fn().mockResolvedValue(false),
  })),
}))

import { TmuxAdapter } from './tmux.js'
import { detectAdapter, getAdapters } from './registry.js'

const MockTmuxAdapter = vi.mocked(TmuxAdapter)

describe('AdapterRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getAdapters', () => {
    it('returns all registered adapters', () => {
      const adapters = getAdapters()
      expect(adapters.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('detectAdapter', () => {
    it('returns the first available adapter (tmux)', async () => {
      MockTmuxAdapter.mockImplementationOnce(() => ({
        name: 'tmux',
        isAvailable: vi.fn().mockResolvedValue(true),
      }) as never)

      // Re-import to get fresh registry with mocked adapter
      vi.resetModules()
      const { detectAdapter: freshDetect } = await import('./registry.js')
      const adapter = await freshDetect()
      expect(adapter.name).toBe('tmux')
    })

    it('throws when no adapter is available', async () => {
      // All adapters unavailable
      MockTmuxAdapter.mockImplementation(() => ({
        name: 'tmux',
        isAvailable: vi.fn().mockResolvedValue(false),
      }) as never)

      vi.resetModules()
      const { detectAdapter: freshDetect } = await import('./registry.js')
      await expect(freshDetect()).rejects.toThrow('No supported terminal multiplexer')
    })
  })
})
