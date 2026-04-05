import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./tmux.js', () => ({
  TmuxAdapter: vi.fn().mockImplementation(() => ({
    name: 'tmux',
    isAvailable: vi.fn().mockResolvedValue(false),
  })),
}))

vi.mock('./cmux.js', () => ({
  CmuxAdapter: vi.fn().mockImplementation(() => ({
    name: 'cmux',
    isAvailable: vi.fn().mockResolvedValue(false),
  })),
}))

import { detectAdapter, getAdapters } from './registry.js'

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
    it('returns the first available adapter', async () => {
      vi.resetModules()

      vi.doMock('./tmux.js', () => ({
        TmuxAdapter: vi.fn().mockImplementation(() => ({
          name: 'tmux',
          isAvailable: vi.fn().mockResolvedValue(true),
        })),
      }))
      vi.doMock('./cmux.js', () => ({
        CmuxAdapter: vi.fn().mockImplementation(() => ({
          name: 'cmux',
          isAvailable: vi.fn().mockResolvedValue(false),
        })),
      }))

      const { detectAdapter: freshDetect } = await import('./registry.js')
      const adapter = await freshDetect()
      expect(adapter.name).toBe('tmux')
    })

    it('throws when no adapter is available', async () => {
      vi.resetModules()

      vi.doMock('./tmux.js', () => ({
        TmuxAdapter: vi.fn().mockImplementation(() => ({
          name: 'tmux',
          isAvailable: vi.fn().mockResolvedValue(false),
        })),
      }))
      vi.doMock('./cmux.js', () => ({
        CmuxAdapter: vi.fn().mockImplementation(() => ({
          name: 'cmux',
          isAvailable: vi.fn().mockResolvedValue(false),
        })),
      }))

      const { detectAdapter: freshDetect } = await import('./registry.js')
      await expect(freshDetect()).rejects.toThrow('No supported terminal multiplexer')
    })
  })
})
