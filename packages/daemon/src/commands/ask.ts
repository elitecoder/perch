import { homedir } from 'os'
import type { ITerminalAdapter } from '../adapters/interface.js'
import type { IToolPlugin } from '../plugins/interface.js'
import type { WatcherManager } from '../watcher/manager.js'
import type { Poster } from '../slack/poster.js'
import type { AskSessionManager } from '../ask/session.js'
import type { CommandHandler } from './router.js'
import { waitForClaudeSession } from '../transcript/resolver.js'

// Claude Code waiting-state markers — diamond characters
const CLAUDE_READY_MARKERS = ['◆', '◇']

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[mGKHF]/g, '')
}

function isClaudeReady(content: string): boolean {
  const stripped = stripAnsi(content)
  return CLAUDE_READY_MARKERS.some(m => stripped.includes(m))
}

async function waitForClaudeReady(
  adapter: ITerminalAdapter,
  paneId: string,
  timeoutMs = 15_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const content = await adapter.readPane(paneId)
    if (isClaudeReady(content)) return true
    if (stripAnsi(content).includes('command not found')) return false
    await new Promise(r => setTimeout(r, 500))
  }
  return false // timed out — proceed anyway, watcher will catch up
}

export function makeAskHandlers(
  adapter: ITerminalAdapter,
  plugins: IToolPlugin[],
  watcher: WatcherManager,
  poster: Poster,
  askManager: AskSessionManager,
): Record<string, CommandHandler> {
  function claudePlugin(): IToolPlugin {
    return plugins.find(p => p.id === 'claude') ?? plugins[plugins.length - 1]!
  }

  const ask: CommandHandler = async (args, respond) => {
    const prompt = args.join(' ').trim()
    if (!prompt) {
      await respond('Usage: `ask <prompt>`\nExample: `ask fix the login bug in src/auth.ts`')
      return
    }

    const cwd = homedir()

    // Create a named tmux/cmux session running Claude Code interactively
    const sessionName = `perch-ask-${Date.now().toString(36)}`
    let session
    try {
      session = await adapter.createSession(sessionName, cwd, 'claude')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await respond(`:x: Could not start Claude Code: ${msg}\n\nMake sure \`claude\` is installed and authenticated. Run \`claude --version\` to check.`)
      return
    }

    // First pane of first window
    const pane = session.windows[0]?.panes[0]
    if (!pane) {
      await respond(':x: Session created but no pane found.')
      return
    }
    const paneId = pane.id

    // Post the thread opener — this creates the thread for the session
    const { ts: threadTs } = await poster.post(
      `:robot_face: *Claude Code* — \`${prompt.slice(0, 80)}${prompt.length > 80 ? '…' : ''}\`\n_Starting session..._`
    )

    // Register the ask session immediately so 'done' can find it
    const askSession = askManager.create({
      paneId,
      sessionId: session.id,
      threadTs,
      cwd,
    })

    // Wait for Claude Code to initialize
    const ready = await waitForClaudeReady(adapter, paneId)
    if (!ready) {
      // Check if claude wasn't found at all
      const content = await adapter.readPane(paneId)
      if (stripAnsi(content).includes('command not found')) {
        await poster.postToThread(threadTs, ':x: `claude` not found. Install Claude Code: https://claude.ai/code')
        await adapter.closeSession(session.id)
        askManager.remove(askSession.id)
        return
      }
      // Otherwise, timed out — may still work, proceed
      await poster.postToThread(threadTs, '_Claude Code is taking a moment to start — watching for activity..._')
    }

    // Send the prompt
    await adapter.sendText(paneId, prompt)
    askSession.status = 'active'

    // Monitor via JSONL transcript — polls until the session file appears (up to 20s).
    const plugin = claudePlugin()
    const resolved = await waitForClaudeSession(paneId, adapter)
    if (resolved) {
      await watcher.watchTranscript(paneId, resolved.jsonlPath, poster, threadTs, plugin, false, resolved.pid)
    } else {
      await poster.postToThread(threadTs, ':warning: Could not locate Claude Code session file — live updates unavailable. Check that `claude` is running and `getPanePid` is supported for this adapter.')
    }
    const keyNames = Object.keys(plugin.keyAliases)
    const keysHint = keyNames.length
      ? `\nReply here to continue. Keys: ${keyNames.slice(0, 5).map(k => `\`${k}\``).join(', ')}. Type \`done\` to close.`
      : '\nReply here to continue. Type `done` to close.'

    await poster.postToThread(threadTs, `:eyes: Watching — session \`${sessionName}\`${keysHint}`)

    await respond(`:white_check_mark: Started — follow the thread above.`)
  }

  const done: CommandHandler = async (_args, respond) => {
    // This handler is only called from channel-level "done" (not thread).
    // Thread-level "done" is intercepted in socket.ts before routing.
    await respond('To close an ask session, type `done` in the session\'s thread.')
  }

  const sessions: CommandHandler = async (_args, respond) => {
    const list = askManager.listSessions()
    if (list.length === 0) {
      await respond('No active ask sessions.')
      return
    }
    const lines = list.map(s => {
      const age = Math.floor((Date.now() - s.createdAt.getTime()) / 1000)
      return `• \`${s.paneId}\` — _${s.status}_ — ${age}s ago`
    })
    await respond('*Active ask sessions:*\n' + lines.join('\n'))
  }

  return { ask, done, sessions }
}
