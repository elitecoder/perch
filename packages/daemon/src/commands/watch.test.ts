import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWatchHandlers } from './watch.js'
import type { ITerminalAdapter } from '../adapters/interface.js'
import type { IToolPlugin } from '../plugins/interface.js'
import type { WatcherManager } from '../watcher/manager.js'
import type { Poster, LiveView } from '../slack/poster.js'

function makeDeps() {
  const adapter: ITerminalAdapter = {
    name: 'mock',
    isAvailable: vi.fn(),
    listSessions: vi.fn(),
    readPane: vi.fn().mockResolvedValue('screen content'),
    sendText: vi.fn(),
    sendKey: vi.fn(),
    createSession: vi.fn(),
    renameSession: vi.fn(),
    closeSession: vi.fn(),
    splitPane: vi.fn(),
    selectPane: vi.fn(),
  } as unknown as ITerminalAdapter

  const plugin: IToolPlugin = {
    id: 'generic',
    displayName: 'Generic',
    detect: vi.fn().mockReturnValue(true),
    parseState: vi.fn().mockReturnValue('idle'),
    extractResponse: vi.fn().mockImplementation((s: string) => s),
    computeDelta: vi.fn().mockReturnValue(null),
    keyAliases: {},
    watch: { pollIntervalMs: 2000, notifyOnTransitions: [], suppressPatterns: [] },
  } as unknown as IToolPlugin

  const mockLiveView = {
    update: vi.fn().mockResolvedValue(undefined),
    transition: vi.fn().mockResolvedValue(undefined),
  } as unknown as LiveView

  const watcher: WatcherManager = {
    watch: vi.fn(),
    unwatch: vi.fn(),
    listWatches: vi.fn().mockReturnValue([]),
    dispose: vi.fn(),
    getByThread: vi.fn(),
  } as unknown as WatcherManager

  const poster: Poster = {
    post: vi.fn().mockResolvedValue({ ts: '12345.678' }),
    postToThread: vi.fn(),
    makeThreadPostFn: vi.fn().mockReturnValue(vi.fn()),
    makeLiveView: vi.fn().mockReturnValue(mockLiveView),
  } as unknown as Poster

  return { adapter, plugin, watcher, poster, mockLiveView }
}

describe('watch command handlers', () => {
  let deps: ReturnType<typeof makeDeps>
  let handlers: ReturnType<typeof makeWatchHandlers>
  let respond: ReturnType<typeof vi.fn>

  beforeEach(() => {
    deps = makeDeps()
    handlers = makeWatchHandlers(deps.adapter, [deps.plugin], deps.watcher, deps.poster)
    respond = vi.fn().mockResolvedValue(undefined)
  })

  describe('watch', () => {
    it('responds with usage when no pane given', async () => {
      await handlers.watch([], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    })

    it('re-watches a pane that is already watched (unwatches first)', async () => {
      vi.mocked(deps.watcher.listWatches).mockReturnValue(['%0'])
      await handlers.watch(['%0'], respond)
      expect(deps.watcher.unwatch).toHaveBeenCalledWith('%0')
      expect(deps.poster.post).toHaveBeenCalledWith(expect.stringContaining('Watching'))
    })

    it('starts watching and posts thread header', async () => {
      await handlers.watch(['%0'], respond)
      expect(deps.poster.post).toHaveBeenCalledWith(expect.stringContaining('Watching'))
      expect(deps.watcher.watch).toHaveBeenCalledWith('%0', deps.adapter, deps.plugin, deps.mockLiveView, '12345.678')
    })

    it('respects --preset flag', async () => {
      const claudePlugin: IToolPlugin = {
        id: 'claude',
        displayName: 'Claude Code',
        detect: vi.fn().mockReturnValue(false),
        parseState: vi.fn().mockReturnValue('idle'),
        extractResponse: vi.fn().mockImplementation((s: string) => s),
        computeDelta: vi.fn().mockReturnValue(null),
        keyAliases: {},
        watch: { pollIntervalMs: 1500, notifyOnTransitions: [], suppressPatterns: [] },
      } as unknown as IToolPlugin
      const h = makeWatchHandlers(deps.adapter, [claudePlugin, deps.plugin], deps.watcher, deps.poster)
      await h.watch(['%0', '--preset', 'claude'], respond)
      expect(deps.watcher.watch).toHaveBeenCalledWith('%0', deps.adapter, claudePlugin, deps.mockLiveView, '12345.678')
    })
  })

  describe('unwatch', () => {
    it('responds with usage when no pane given', async () => {
      await handlers.unwatch([], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('Usage'))
    })

    it('calls watcher.unwatch', async () => {
      await handlers.unwatch(['%0'], respond)
      expect(deps.watcher.unwatch).toHaveBeenCalledWith('%0')
    })
  })

  describe('watching', () => {
    it('reports no watches when empty', async () => {
      await handlers.watching([], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('No panes'))
    })

    it('lists all watched panes', async () => {
      vi.mocked(deps.watcher.listWatches).mockReturnValue(['%0', '%1'])
      await handlers.watching([], respond)
      expect(respond).toHaveBeenCalledWith(expect.stringContaining('%0'))
    })
  })
})
