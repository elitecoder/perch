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
  const watchHandlers = makeWatchHandlers(adapter, plugins, watcher, poster, terminalHandlers.resolvePane)
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
      const entry = watcher.getByThread(threadTs)
      if (entry) {
        const lower = cleaned.toLowerCase()

        // List available keys
        if (lower === 'keys' || lower === 'help') {
          const keyNames = Object.keys(entry.plugin.keyAliases)
          const msg = keyNames.length
            ? `*Keys for ${entry.plugin.displayName}:*\n${keyNames.map(k => `• \`${k}\` → ${entry.plugin.keyAliases[k]}`).join('\n')}\n\nType \`unwatch\` to stop.`
            : 'No key aliases for this preset.'
          await say({ text: msg })
          return
        }

        // Unwatch from within the thread
        if (lower === 'unwatch') {
          watcher.unwatch(entry.paneId)
          const { readState, writeState } = await import('../config.js')
          const state = readState()
          writeState({ ...state, watches: state.watches.filter(id => id !== entry.paneId) })
          await say({ text: `:white_check_mark: Stopped watching \`${entry.paneId}\`` })
          return
        }

        // Check if it's a key alias (esc, ctrl-c, etc.)
        const keyAlias = entry.plugin.keyAliases[lower]
        if (keyAlias) {
          await adapter.sendKey(entry.paneId, keyAlias)
          await say({ text: `Sent \`${lower}\`` })
        } else {
          await adapter.sendText(entry.paneId, cleaned)
          await say({ text: `Sent: ${cleaned}` })
        }
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
