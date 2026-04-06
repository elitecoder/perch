import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WatcherManager } from './manager.js'
import type { IToolPlugin } from '../plugins/interface.js'

function makePlugin(): IToolPlugin {
  return {
    id: 'mock',
    displayName: 'Mock',
    detect: vi.fn().mockReturnValue(true),
    parseState: vi.fn().mockReturnValue('idle'),
    extractResponse: vi.fn().mockImplementation((s: string) => s),
    computeDelta: vi.fn().mockReturnValue(null),
    keyAliases: { accept: 'Enter' },
    watch: {
      pollIntervalMs: 100,
      notifyOnTransitions: [['thinking', 'waiting']],
      suppressPatterns: [],
    },
  } as unknown as IToolPlugin
}

describe('WatcherManager', () => {
  let manager: WatcherManager

  beforeEach(() => {
    manager = new WatcherManager()
  })

  afterEach(() => {
    manager.dispose()
  })

  describe('registerWatch / unwatch / listWatches', () => {
    it('adds a pane to the watch list', () => {
      manager.registerWatch('pane:1', 'thread-ts-1', makePlugin())
      expect(manager.listWatches()).toContain('pane:1')
    })

    it('removes a pane on unwatch', () => {
      manager.registerWatch('pane:1', 'thread-ts-1', makePlugin())
      manager.unwatch('pane:1')
      expect(manager.listWatches()).not.toContain('pane:1')
    })

    it('ignores unwatch on unknown pane', () => {
      expect(() => manager.unwatch('nonexistent')).not.toThrow()
    })

    it('tracks multiple watches independently', () => {
      manager.registerWatch('pane:1', 'thread-ts-1', makePlugin())
      manager.registerWatch('pane:2', 'thread-ts-2', makePlugin())
      expect(manager.listWatches()).toHaveLength(2)
    })
  })

  describe('dispose', () => {
    it('clears all watches', () => {
      manager.registerWatch('pane:1', 'thread-ts-1', makePlugin())
      manager.registerWatch('pane:2', 'thread-ts-2', makePlugin())
      manager.dispose()
      expect(manager.listWatches()).toHaveLength(0)
    })
  })

  describe('getByThread', () => {
    it('returns entry by thread timestamp', () => {
      manager.registerWatch('pane:1', 'thread-ts-1', makePlugin())
      const entry = manager.getByThread('thread-ts-1')
      expect(entry).toBeDefined()
      expect(entry!.paneId).toBe('pane:1')
    })

    it('returns plugin info from the entry', () => {
      const plugin = makePlugin()
      manager.registerWatch('pane:1', 'thread-ts-1', plugin)
      const entry = manager.getByThread('thread-ts-1')
      expect(entry!.plugin).toBe(plugin)
    })

    it('returns undefined for unknown thread', () => {
      expect(manager.getByThread('unknown')).toBeUndefined()
    })

    it('cleans up thread mapping on unwatch', () => {
      manager.registerWatch('pane:1', 'thread-ts-1', makePlugin())
      manager.unwatch('pane:1')
      expect(manager.getByThread('thread-ts-1')).toBeUndefined()
    })
  })

  describe('recordForwardedText', () => {
    it('does not throw for registered panes', () => {
      manager.registerWatch('pane:1', 'thread-ts-1', makePlugin())
      expect(() => manager.recordForwardedText('pane:1', 'hello')).not.toThrow()
    })

    it('does not throw for unknown panes', () => {
      expect(() => manager.recordForwardedText('unknown', 'hello')).not.toThrow()
    })
  })
})
