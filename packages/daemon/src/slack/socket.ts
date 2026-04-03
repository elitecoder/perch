import { App } from '@slack/bolt'
import { WebClient } from '@slack/web-api'
import { CommandRouter } from '../commands/router.js'
import { makeTerminalHandlers } from '../commands/terminal.js'
import { makeWorkspaceHandlers } from '../commands/workspace.js'
import { makeWatchHandlers } from '../commands/watch.js'
import { makeSystemHandlers } from '../commands/system.js'
import type { ITerminalAdapter } from '../adapters/interface.js'
import type { IToolPlugin } from '../plugins/interface.js'
import type { WatcherManager } from '../watcher/manager.js'
import { Poster } from './poster.js'

export interface SocketAppOptions {
  botToken: string
  appToken: string
  channelId: string
  adapter: ITerminalAdapter
  plugins: IToolPlugin[]
  watcher: WatcherManager
}

export function createSocketApp(opts: SocketAppOptions): { app: App; poster: Poster } {
  const { botToken, appToken, channelId, adapter, plugins, watcher } = opts

  const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
  })

  const client = new WebClient(botToken)
  const poster = new Poster(client, channelId)
  const router = new CommandRouter()
  const startedAt = new Date()

  // Register all command handlers
  const terminalHandlers = makeTerminalHandlers(adapter)
  const workspaceHandlers = makeWorkspaceHandlers(adapter)
  const watchHandlers = makeWatchHandlers(adapter, plugins, watcher, poster)
  const systemHandlers = makeSystemHandlers(adapter, plugins, watcher, startedAt)

  for (const [name, handler] of Object.entries({
    ...terminalHandlers,
    ...systemHandlers,
    ...watchHandlers,
  })) {
    router.register(name, handler)
  }

  // Workspace sub-commands: "new session", "new split", "rename", "close", "select"
  router.register('new', async (args, respond) => {
    const sub = args[0]?.toLowerCase()
    if (sub === 'session') return workspaceHandlers.newSession(args.slice(1), respond)
    if (sub === 'split') return workspaceHandlers.newSplit(args.slice(1), respond)
    await respond('Usage: `new session <name>` or `new split <dir> <pane>`')
  })
  router.register('rename', workspaceHandlers.rename)
  router.register('close', workspaceHandlers.close)
  router.register('select', workspaceHandlers.select)

  async function handleText(
    text: string,
    ts: string | undefined,
    threadTs: string | undefined,
    say: (opts: { text: string; thread_ts?: string }) => Promise<unknown>,
  ) {
    // Strip @mention prefix so "@perch list" and "list" both work
    const cleaned = text.replace(/^<@[A-Z0-9]+>\s*/i, '').trim()
    if (!cleaned) return

    // Thread replies → forward to the watched pane for that thread
    if (threadTs) {
      const watches = watcher.listWatches()
      if (watches.length > 0) {
        const paneId = watches[0]!
        const plugin = plugins.find(p => p.detect(cleaned))
        const resolvedKey = plugin?.keyAliases[cleaned.toLowerCase()] ?? cleaned
        await adapter.sendText(paneId, resolvedKey)
        return
      }
    }

    const respond = async (replyText: string) => {
      await say({ text: replyText })
    }
    await router.dispatch(cleaned, respond)
  }

  // Plain messages in the channel
  app.message(async ({ message, say }) => {
    const msg = message as { text?: string; thread_ts?: string; ts?: string; bot_id?: string }
    if (msg.bot_id) return // ignore other bots
    await handleText(msg.text ?? '', msg.ts, msg.thread_ts, say)
  })

  // @mentions
  app.event('app_mention', async ({ event, say }) => {
    await handleText(event.text, event.ts, event.thread_ts, say)
  })

  return { app, poster }
}
