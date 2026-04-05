import { App } from '@slack/bolt'
import { WebClient } from '@slack/web-api'
import { writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
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
  const terminalHandlers = makeTerminalHandlers(adapter, watcher)
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

  // `new <name> [--cwd <path>]` — create session and launch Claude
  router.register('new', workspaceHandlers.newClaude)
  // `sessions` as alias for `list`
  router.register('sessions', terminalHandlers.list)

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
          const keyAliases = entry.plugin?.keyAliases ?? {}
          const keyNames = Object.keys(keyAliases)
          const name = entry.plugin?.displayName ?? 'Claude Code'
          const msg = keyNames.length
            ? `*Keys for ${name}:*\n${keyNames.map(k => `• \`${k}\` → ${keyAliases[k]}`).join('\n')}\n\nType \`unwatch\` to stop.`
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
          const sid = entry.paneId.match(/:(\d+)$/)?.[1] ?? entry.paneId.match(/%(\d+)$/)?.[1] ?? entry.paneId
          await say({ text: `:white_check_mark: Stopped watching \`${sid}\`` })
          return
        }

        // Check if it's a key alias (esc, ctrl-c, etc.)
        const keyAliases = entry.plugin?.keyAliases ?? {}
        const keyAlias = keyAliases[lower]
        if (keyAlias) {
          await adapter.sendKey(entry.paneId, keyAlias)
        } else {
          watcher.recordForwardedText(entry.paneId, cleaned)
          await adapter.sendText(entry.paneId, cleaned)
        }
        return
      }
    }

    const respond = async (replyText: string) => {
      await say({ text: replyText, thread_ts: threadTs })
    }
    await router.dispatch(cleaned, respond)
  }

  const UPLOAD_DIR = join(tmpdir(), 'perch-uploads')

  /**
   * Download a Slack file and save it locally. Returns the local path.
   */
  async function downloadSlackFile(file: { url_private_download?: string; url_private?: string; name?: string; id?: string }): Promise<string | null> {
    const url = file.url_private_download ?? file.url_private
    if (!url) return null
    try {
      await mkdir(UPLOAD_DIR, { recursive: true })
      const filename = file.name ?? `file-${file.id ?? Date.now()}`
      const localPath = join(UPLOAD_DIR, `${Date.now()}-${filename}`)
      const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } })
      if (!res.ok) {
        console.error(`[socket] file download HTTP ${res.status} for ${file.name ?? file.id}`)
        return null
      }
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.startsWith('text/html')) {
        console.error(`[socket] file download returned HTML instead of file data — check bot has files:read scope`)
        return null
      }
      const buffer = Buffer.from(await res.arrayBuffer())
      await writeFile(localPath, buffer)
      return localPath
    } catch (err) {
      console.error('[socket] file download failed:', err)
      return null
    }
  }

  const _processedTs = new Set<string>()

  // Plain messages in the channel
  app.message(async ({ message, say }) => {
    const msg = message as { text?: string; thread_ts?: string; ts?: string; bot_id?: string; files?: Array<{ url_private_download?: string; url_private?: string; name?: string; id?: string; mimetype?: string }>; subtype?: string }
    if (msg.bot_id) return // ignore other bots
    if (msg.subtype === 'message_changed') return
    // Dedup: Slack can fire multiple events for the same message
    if (msg.ts && _processedTs.has(msg.ts)) return
    if (msg.ts) {
      _processedTs.add(msg.ts)
      // Keep set small — prune old entries
      if (_processedTs.size > 100) {
        const arr = [..._processedTs]
        for (let i = 0; i < 50; i++) _processedTs.delete(arr[i]!)
      }
    }

    // Handle file attachments in watch threads
    if (msg.thread_ts && msg.files?.length) {
      const entry = watcher.getByThread(msg.thread_ts)
      if (entry) {
        const paths: string[] = []
        for (const file of msg.files) {
          const localPath = await downloadSlackFile(file)
          if (localPath) paths.push(localPath)
        }
        if (paths.length > 0) {
          const userText = msg.text?.replace(/^<@[A-Z0-9]+>\s*/i, '').trim() ?? ''
          // Combine user text with file paths on separate lines
          const parts = userText ? [userText, '', ...paths] : paths
          const prompt = parts.join('\n')
          watcher.recordForwardedText(entry.paneId, prompt)
          await adapter.sendText(entry.paneId, prompt)
        }
        return // Don't also forward msg.text via handleText
      }
    }

    await handleText(msg.text ?? '', msg.ts, msg.thread_ts, say)
  })

  // @mentions
  app.event('app_mention', async ({ event, say }) => {
    await handleText(event.text, event.ts, event.thread_ts, say)
  })

  return { app, poster }
}
