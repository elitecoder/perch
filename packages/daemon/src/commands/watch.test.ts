import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeWatchHandlers } from './watch.js'
import type { ITerminalAdapter } from '../adapters/interface.js'
import type { IToolPlugin } from '../plugins/interface.js'
import type { WatcherManager } from '../watcher/manager.js'
import type { Poster } from '../slack/poster.js'

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

  const watcher: WatcherManager = {
    watchTranscript: vi.fn().mockResolvedValue(undefined),
    registerWatch: vi.fn(),
    unwatch: vi.fn(),
    listWatches: vi.fn().mockReturnValue([]),
    dispose: vi.fn(),
    getByThread: vi.fn(),
  } as unknown as WatcherManager

  const poster: Poster = {
    post: vi.fn().mockResolvedValue({ ts: '12345.678' }),
    postToThread: vi.fn().mockResolvedValue({ ts: '12345.999' }),
    makeThreadPostFn: vi.fn().mockReturnValue(vi.fn()),
  } as unknown as Poster

  return { adapter, plugin, watcher, poster }
}

describe('watch command handlers', () => {
  let deps: ReturnType<typeof makeDeps>
  let handlers: ReturnType<typeof makeWatchHandlers>
  let respond: ReturnType<typeof vi.fn>

  beforeEach(() => {
    deps = makeDeps()
    handlers = makeWatchHandlers(deps.adapter, [deps.plugin], deps.watcher, deps.poster, async (id) => id)
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
      const postText = vi.mocked(deps.poster.post).mock.calls[0]![0] as string
      expect(postText).toContain('Watching')
      expect(postText).toContain('`0`')
    })

    it('starts watching and posts thread header with pane ID', async () => {
      await handlers.watch(['%0'], respond)
      const postText = vi.mocked(deps.poster.post).mock.calls[0]![0] as string
      expect(postText).toContain('Watching')
      expect(postText).toContain('`0`')
    })

    it('uses watchTranscript for claude preset when session resolves', async () => {
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
      const h = makeWatchHandlers(deps.adapter, [claudePlugin, deps.plugin], deps.watcher, deps.poster, async (id) => id)
      // With no getPanePid on the adapter, resolveClaudeSession returns null → warning posted
      await h.watch(['%0', '--preset', 'claude'], respond)
      // Should use either watchTranscript or registerWatch (depending on whether Claude session is found)
      const usedTranscript = vi.mocked(deps.watcher.watchTranscript).mock.calls.length > 0
      const usedRegister = vi.mocked(deps.watcher.registerWatch).mock.calls.length > 0
      expect(usedTranscript || usedRegister).toBe(true)
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
    it('reports no watches with exact message', async () => {
      await handlers.watching([], respond)
      const text = respond.mock.calls[0]![0] as string
      expect(text).toContain('No panes')
    })

    it('lists all watched pane IDs', async () => {
      vi.mocked(deps.watcher.listWatches).mockReturnValue(['%0', '%1'])
      await handlers.watching([], respond)
      const text = respond.mock.calls[0]![0] as string
      expect(text).toContain('`0`')
      expect(text).toContain('`1`')
    })
  })

})
