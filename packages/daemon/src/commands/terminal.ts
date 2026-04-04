import type { ITerminalAdapter, Pane, Session } from '../adapters/interface.js'
import type { CommandHandler } from './router.js'

function formatSession(s: Session): string {
  const windowLines = s.windows.map(w => {
    const paneLines = w.panes.map(
      p => `      • \`${shortId(p)}\`${p.active ? ' (active)' : ''}: ${p.command}`
    )
    return [`    *${s.name}*`, ...paneLines].join('\n')
  })
  return windowLines.join('\n')
}

function shortId(p: Pane): string {
  // Extract the last numeric part — surface number for cmux, pane index for tmux
  const match = p.id.match(/:(\d+)$/)
  return match ? match[1] : String(p.index)
}

/** Resolve a short ID (bare number) to the full pane ID by scanning sessions */
async function resolvePane(adapter: ITerminalAdapter, input: string): Promise<string> {
  // If it already looks like a full ID, pass through
  if (input.includes(':') && !/^\d+$/.test(input)) return input

  const sessions = await adapter.listSessions()
  for (const s of sessions) {
    for (const w of s.windows) {
      for (const p of w.panes) {
        if (shortId(p) === input) return p.id
      }
    }
  }
  // Fallback — let the adapter try to handle it
  return input
}

export function makeTerminalHandlers(adapter: ITerminalAdapter): Record<string, CommandHandler> {
  const list: CommandHandler = async (_args, respond) => {
    const sessions = await adapter.listSessions()
    if (sessions.length === 0) {
      await respond('No active sessions.')
      return
    }
    await respond(sessions.map(formatSession).join('\n\n'))
  }

  const tree: CommandHandler = async (args, respond) => {
    const sessions = await adapter.listSessions()
    const target = args[0]
    const filtered = target ? sessions.filter(s => s.name === target || s.id === target) : sessions
    if (filtered.length === 0) {
      await respond(target ? `Session \`${target}\` not found.` : 'No active sessions.')
      return
    }
    await respond(filtered.map(formatSession).join('\n\n'))
  }

  const read: CommandHandler = async (args, respond) => {
    if (!args[0]) { await respond('Usage: `read <pane> [lines]`'); return }
    const paneId = await resolvePane(adapter, args[0])
    const lines = args[1] ? parseInt(args[1], 10) : 50
    const content = await adapter.readPane(paneId, lines)
    await respond('```\n' + (content.trim() || '(empty)') + '\n```')
  }

  const send: CommandHandler = async (args, respond) => {
    const text = args.slice(1).join(' ')
    if (!args[0] || !text) { await respond('Usage: `send <pane> <text>`'); return }
    const paneId = await resolvePane(adapter, args[0])
    await adapter.sendText(paneId, text)
    await respond(`:white_check_mark: Sent to \`${args[0]}\``)
  }

  const key: CommandHandler = async (args, respond) => {
    if (!args[0] || !args[1]) { await respond('Usage: `key <pane> <key>`'); return }
    const paneId = await resolvePane(adapter, args[0])
    await adapter.sendKey(paneId, args[1])
    await respond(`:white_check_mark: Sent key \`${args[1]}\` to \`${args[0]}\``)
  }

  return { list, tree, read, send, key, resolvePane: (input: string) => resolvePane(adapter, input) }
}
