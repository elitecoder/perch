import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock @slack/bolt before importing socket
const mockMessageHandler = vi.fn()
const mockEventHandler = vi.fn()
const mockActionHandler = vi.fn()

vi.mock('@slack/bolt', () => {
  const App = vi.fn().mockImplementation(() => ({
    message: mockMessageHandler,
    event: mockEventHandler,
    action: mockActionHandler,
  }))
  return { default: { App }, App }
})

vi.mock('@slack/web-api', () => ({
  WebClient: vi.fn().mockImplementation(() => ({
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ts: '111.222', ok: true }),
      update: vi.fn().mockResolvedValue({ ok: true }),
      getPermalink: vi.fn().mockResolvedValue({ permalink: 'https://slack.com/p/123', ok: true }),
    },
    conversations: {
      replies: vi.fn().mockResolvedValue({ messages: [], ok: true }),
    },
  })),
}))

import { createSocketApp } from './socket.js'
import type { ITerminalAdapter } from '../adapters/interface.js'
import type { IToolPlugin } from '../plugins/interface.js'
import type { WatcherManager } from '../watcher/manager.js'

function makeAdapter(): ITerminalAdapter {
  return {
    name: 'mock',
    isAvailable: vi.fn(),
    listSessions: vi.fn().mockResolvedValue([]),
    readPane: vi.fn().mockResolvedValue(''),
    sendText: vi.fn().mockResolvedValue(undefined),
    sendKey: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn(),
    renameSession: vi.fn(),
    closeSession: vi.fn(),
    splitPane: vi.fn(),
    selectPane: vi.fn(),
  } as unknown as ITerminalAdapter
}

function makePlugin(): IToolPlugin {
  return {
    id: 'claude',
    displayName: 'Claude Code',
    detect: vi.fn().mockReturnValue(false),
    parseState: vi.fn().mockReturnValue('idle'),
    extractResponse: vi.fn().mockImplementation((s: string) => s),
    computeDelta: vi.fn().mockReturnValue(null),
    keyAliases: { accept: 'Enter', interrupt: 'C-c' },
    watch: { pollIntervalMs: 1500, notifyOnTransitions: [], suppressPatterns: [] },
  } as unknown as IToolPlugin
}

function makeWatcher(): WatcherManager {
  return {
    watchTranscript: vi.fn().mockResolvedValue(undefined),
    registerWatch: vi.fn(),
    unwatch: vi.fn(),
    listWatches: vi.fn().mockReturnValue([]),
    getByThread: vi.fn(),
    dispose: vi.fn(),
    recordForwardedText: vi.fn(),
  } as unknown as WatcherManager
}

describe('createSocketApp', () => {
  let adapter: ITerminalAdapter
  let watcher: WatcherManager
  let plugin: IToolPlugin

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = makeAdapter()
    watcher = makeWatcher()
    plugin = makePlugin()
  })

  it('returns app and poster', () => {
    const { app, poster } = createSocketApp({
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
      channelId: 'C0TEST',
      adapter,
      plugins: [plugin],
      watcher,
    })
    expect(app).toBeDefined()
    expect(poster).toBeDefined()
  })

  it('registers message, event, and action handlers', () => {
    createSocketApp({
      botToken: 'xoxb-test',
      appToken: 'xapp-test',
      channelId: 'C0TEST',
      adapter,
      plugins: [plugin],
      watcher,
    })
    expect(mockMessageHandler).toHaveBeenCalledTimes(1)
    expect(mockEventHandler).toHaveBeenCalledWith('app_mention', expect.any(Function))
    expect(mockActionHandler).toHaveBeenCalledWith(/^perch_key:/, expect.any(Function))
  })

  describe('message handler', () => {
    let messageCallback: (ctx: Record<string, unknown>) => Promise<void>

    beforeEach(() => {
      createSocketApp({
        botToken: 'xoxb-test',
        appToken: 'xapp-test',
        channelId: 'C0TEST',
        adapter,
        plugins: [plugin],
        watcher,
      })
      messageCallback = mockMessageHandler.mock.calls[0]![0]
    })

    it('ignores messages from bots', async () => {
      const say = vi.fn()
      await messageCallback({
        message: { text: 'list', bot_id: 'B123', channel: 'C0TEST', ts: '1.1' },
        say,
      })
      expect(say).not.toHaveBeenCalled()
    })

    it('ignores messages from other channels', async () => {
      const say = vi.fn()
      await messageCallback({
        message: { text: 'list', channel: 'C0OTHER', ts: '1.2' },
        say,
      })
      expect(say).not.toHaveBeenCalled()
    })

    it('ignores message_changed subtypes', async () => {
      const say = vi.fn()
      await messageCallback({
        message: { text: 'list', subtype: 'message_changed', channel: 'C0TEST', ts: '1.3' },
        say,
      })
      expect(say).not.toHaveBeenCalled()
    })

    it('deduplicates messages with same ts', async () => {
      const say = vi.fn().mockResolvedValue(undefined)
      await messageCallback({
        message: { text: 'help', channel: 'C0TEST', ts: '99.99' },
        say,
      })
      await messageCallback({
        message: { text: 'help', channel: 'C0TEST', ts: '99.99' },
        say,
      })
      // help command should only fire once
      expect(say).toHaveBeenCalledTimes(1)
    })

    it('strips @mention prefix before dispatching', async () => {
      const say = vi.fn().mockResolvedValue(undefined)
      await messageCallback({
        message: { text: '<@U123BOT> help', channel: 'C0TEST', ts: '2.1' },
        say,
      })
      const text = say.mock.calls[0]?.[0]?.text as string
      expect(text).toContain('*Perch Commands*')
    })

    it('dispatches help command', async () => {
      const say = vi.fn().mockResolvedValue(undefined)
      await messageCallback({
        message: { text: 'help', channel: 'C0TEST', ts: '3.1' },
        say,
      })
      const text = say.mock.calls[0]?.[0]?.text as string
      expect(text).toContain('*Perch Commands*')
    })

    it('routes unknown commands to the router (which replies with error)', async () => {
      const say = vi.fn().mockResolvedValue(undefined)
      await messageCallback({
        message: { text: 'nonexistent', channel: 'C0TEST', ts: '4.1' },
        say,
      })
      const text = say.mock.calls[0]?.[0]?.text as string
      expect(text).toContain('Unknown command')
    })

    describe('thread replies to watched panes', () => {
      beforeEach(() => {
        vi.mocked(watcher.getByThread).mockReturnValue({
          paneId: 'tmux:dev:@0:%0',
          plugin: plugin,
        })
      })

      it('forwards text to the watched pane', async () => {
        const say = vi.fn().mockResolvedValue(undefined)
        await messageCallback({
          message: { text: 'fix the bug', thread_ts: 'thread-1', channel: 'C0TEST', ts: '5.1' },
          say,
        })
        expect(watcher.recordForwardedText).toHaveBeenCalledWith('tmux:dev:@0:%0', 'fix the bug', '5.1')
        expect(adapter.sendText).toHaveBeenCalledWith('tmux:dev:@0:%0', 'fix the bug')
      })

      it('sends key alias instead of text for known keys', async () => {
        const say = vi.fn().mockResolvedValue(undefined)
        await messageCallback({
          message: { text: 'accept', thread_ts: 'thread-1', channel: 'C0TEST', ts: '5.2' },
          say,
        })
        expect(adapter.sendKey).toHaveBeenCalledWith('tmux:dev:@0:%0', 'Enter')
        expect(adapter.sendText).not.toHaveBeenCalled()
      })

      it('sends interrupt key alias', async () => {
        const say = vi.fn().mockResolvedValue(undefined)
        await messageCallback({
          message: { text: 'interrupt', thread_ts: 'thread-1', channel: 'C0TEST', ts: '5.3' },
          say,
        })
        expect(adapter.sendKey).toHaveBeenCalledWith('tmux:dev:@0:%0', 'C-c')
      })

      it('shows help/keys message', async () => {
        const say = vi.fn().mockResolvedValue(undefined)
        await messageCallback({
          message: { text: 'keys', thread_ts: 'thread-1', channel: 'C0TEST', ts: '5.4' },
          say,
        })
        const text = say.mock.calls[0]?.[0]?.text as string
        expect(text).toContain('Keys for')
        expect(text).toContain('`accept`')
        expect(text).toContain('`interrupt`')
      })

      it('handles unwatch in thread', async () => {
        vi.mock('../config.js', async (importOriginal) => {
          const actual = await importOriginal() as Record<string, unknown>
          return {
            ...actual,
            readState: vi.fn().mockReturnValue({ watches: ['tmux:dev:@0:%0'], watchThreads: {} }),
            writeState: vi.fn(),
          }
        })
        const say = vi.fn().mockResolvedValue(undefined)
        await messageCallback({
          message: { text: 'unwatch', thread_ts: 'thread-1', channel: 'C0TEST', ts: '5.5' },
          say,
        })
        expect(watcher.unwatch).toHaveBeenCalledWith('tmux:dev:@0:%0')
      })

      it('forwards slash commands with ! prefix', async () => {
        const say = vi.fn().mockResolvedValue(undefined)
        await messageCallback({
          message: { text: '!clear', thread_ts: 'thread-1', channel: 'C0TEST', ts: '5.6' },
          say,
        })
        expect(adapter.sendText).toHaveBeenCalledWith('tmux:dev:@0:%0', '/clear')
        // recordForwardedText should NOT be called for slash commands
        expect(watcher.recordForwardedText).not.toHaveBeenCalled()
      })

      it('forwards slash commands with . prefix', async () => {
        const say = vi.fn().mockResolvedValue(undefined)
        await messageCallback({
          message: { text: '.compact', thread_ts: 'thread-1', channel: 'C0TEST', ts: '5.7' },
          say,
        })
        expect(adapter.sendText).toHaveBeenCalledWith('tmux:dev:@0:%0', '/compact')
      })
    })
  })

  describe('app_mention handler', () => {
    it('ignores events from other channels', async () => {
      createSocketApp({
        botToken: 'xoxb-test',
        appToken: 'xapp-test',
        channelId: 'C0TEST',
        adapter,
        plugins: [plugin],
        watcher,
      })
      const eventCallback = mockEventHandler.mock.calls.find(
        (c: unknown[]) => c[0] === 'app_mention',
      )![1] as (ctx: Record<string, unknown>) => Promise<void>

      const say = vi.fn().mockResolvedValue(undefined)
      await eventCallback({
        event: { text: '<@U123> help', channel: 'C0OTHER', ts: '6.1' },
        say,
      })
      expect(say).not.toHaveBeenCalled()
    })
  })

  describe('button action handler', () => {
    let actionCallback: (ctx: Record<string, unknown>) => Promise<void>

    beforeEach(() => {
      createSocketApp({
        botToken: 'xoxb-test',
        appToken: 'xapp-test',
        channelId: 'C0TEST',
        adapter,
        plugins: [plugin],
        watcher,
      })
      actionCallback = mockActionHandler.mock.calls[0]![1]
    })

    it('sends key to pane for simple key action', async () => {
      const ack = vi.fn().mockResolvedValue(undefined)
      await actionCallback({
        action: { action_id: 'perch_key:tmux:dev:@0:%0:Enter' },
        ack,
        body: { message: { ts: '7.1' }, channel: { id: 'C0TEST' } },
      })
      expect(ack).toHaveBeenCalled()
      expect(adapter.sendKey).toHaveBeenCalledWith('tmux:dev:@0:%0', 'Enter')
    })

    it('sends Down+Enter for choice actions', async () => {
      const ack = vi.fn().mockResolvedValue(undefined)
      await actionCallback({
        action: {
          action_id: 'perch_key:tmux:dev:@0:%0:choice:2',
          text: { text: 'Option 3' },
        },
        ack,
        body: { message: { ts: '7.2' }, channel: { id: 'C0TEST' } },
      })
      expect(ack).toHaveBeenCalled()
      // 2 Down keys for index 2
      expect(adapter.sendKey).toHaveBeenCalledWith('tmux:dev:@0:%0', 'Down')
      const downCalls = vi.mocked(adapter.sendKey).mock.calls.filter(c => c[1] === 'Down')
      expect(downCalls).toHaveLength(2)
      // Then Enter
      expect(adapter.sendKey).toHaveBeenCalledWith('tmux:dev:@0:%0', 'Enter')
    })
  })
})
