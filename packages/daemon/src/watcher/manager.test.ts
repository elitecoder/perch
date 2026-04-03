import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WatcherManager } from './manager.js'
import type { ITerminalAdapter } from '../adapters/interface.js'
import type { IToolPlugin } from '../plugins/interface.js'

function makeAdapter(content = 'screen content'): ITerminalAdapter {
  return {
    name: 'mock',
    isAvailable: vi.fn(),
    listSessions: vi.fn(),
    readPane: vi.fn().mockResolvedValue(content),
    sendText: vi.fn(),
    sendKey: vi.fn(),
    createSession: vi.fn(),
    renameSession: vi.fn(),
    closeSession: vi.fn(),
    splitPane: vi.fn(),
    selectPane: vi.fn(),
  } as unknown as ITerminalAdapter
}

function makePlugin(): IToolPlugin {
  return {
    id: 'mock',
    displayName: 'Mock',
    detect: vi.fn().mockReturnValue(true),
    parseState: vi.fn().mockReturnValue('idle'),
    extractResponse: vi.fn().mockImplementation((s: string) => s),
    computeDelta: vi.fn().mockReturnValue(null),
    keyAliases: {},
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
    vi.useFakeTimers()
    manager = new WatcherManager()
  })

  afterEach(() => {
    manager.dispose()
    vi.useRealTimers()
  })

  describe('watch / unwatch / listWatches', () => {
    it('adds a pane to the watch list', () => {
      manager.watch('pane:1', makeAdapter(), makePlugin(), vi.fn())
      expect(manager.listWatches()).toContain('pane:1')
    })

    it('is idempotent — duplicate watch does not double-register', () => {
      const adapter = makeAdapter()
      const plugin = makePlugin()
      manager.watch('pane:1', adapter, plugin, vi.fn())
      manager.watch('pane:1', adapter, plugin, vi.fn())
      expect(manager.listWatches()).toHaveLength(1)
    })

    it('removes a pane on unwatch', () => {
      manager.watch('pane:1', makeAdapter(), makePlugin(), vi.fn())
      manager.unwatch('pane:1')
      expect(manager.listWatches()).not.toContain('pane:1')
    })

    it('ignores unwatch on unknown pane', () => {
      expect(() => manager.unwatch('nonexistent')).not.toThrow()
    })

    it('tracks multiple watches independently', () => {
      manager.watch('pane:1', makeAdapter(), makePlugin(), vi.fn())
      manager.watch('pane:2', makeAdapter(), makePlugin(), vi.fn())
      expect(manager.listWatches()).toHaveLength(2)
    })
  })

  describe('dispose', () => {
    it('clears all watches', () => {
      manager.watch('pane:1', makeAdapter(), makePlugin(), vi.fn())
      manager.watch('pane:2', makeAdapter(), makePlugin(), vi.fn())
      manager.dispose()
      expect(manager.listWatches()).toHaveLength(0)
    })
  })

  describe('tick — delta posting', () => {
    const POLL = 100 // matches makePlugin's pollIntervalMs

    it('posts when plugin computeDelta returns a non-null delta', async () => {
      const adapter = makeAdapter('new content')
      const plugin = makePlugin()
      vi.mocked(plugin.computeDelta).mockReturnValue({
        type: 'append',
        content: 'new content',
      })

      const postFn = vi.fn().mockResolvedValue(undefined)
      manager.watch('pane:1', adapter, plugin, postFn)

      await vi.advanceTimersByTimeAsync(POLL)
      expect(postFn).toHaveBeenCalledWith('new content')
    })

    it('does not post when computeDelta returns null and no transition', async () => {
      const adapter = makeAdapter('same')
      const plugin = makePlugin()
      vi.mocked(plugin.computeDelta).mockReturnValue(null)

      const postFn = vi.fn().mockResolvedValue(undefined)
      manager.watch('pane:1', adapter, plugin, postFn)

      await vi.advanceTimersByTimeAsync(POLL)
      expect(postFn).not.toHaveBeenCalled()
    })

    it('posts state transition message when transition is in notifyOnTransitions', async () => {
      const adapter = makeAdapter('◆ waiting prompt')
      const plugin = makePlugin()
      // First tick: thinking (idle→thinking, not in list); second tick: waiting (thinking→waiting, IS in list)
      vi.mocked(plugin.parseState)
        .mockReturnValueOnce('thinking')
        .mockReturnValueOnce('waiting')
      vi.mocked(plugin.computeDelta).mockReturnValue(null)
      vi.mocked(plugin.extractResponse).mockReturnValue('◆ waiting prompt')

      const postFn = vi.fn().mockResolvedValue(undefined)
      manager.watch('pane:1', adapter, plugin, postFn)

      await vi.advanceTimersByTimeAsync(POLL)     // first tick: idle→thinking
      await vi.advanceTimersByTimeAsync(POLL)     // second tick: thinking→waiting

      const calls = postFn.mock.calls.map(c => c[0] as string)
      const transitionMsg = calls.find(m => m.includes('thinking') && m.includes('waiting'))
      expect(transitionMsg).toBeTruthy()
    })

    it('handles readPane errors gracefully without crashing', async () => {
      const adapter = makeAdapter()
      vi.mocked(adapter.readPane).mockRejectedValue(new Error('tmux gone'))
      const postFn = vi.fn()

      manager.watch('pane:1', adapter, makePlugin(), postFn)
      await vi.advanceTimersByTimeAsync(POLL)
      expect(postFn).not.toHaveBeenCalled()
    })
  })
})
