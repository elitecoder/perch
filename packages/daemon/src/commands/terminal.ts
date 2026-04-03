import type { ITerminalAdapter, Session } from '../adapters/interface.js'
import type { CommandHandler } from './router.js'

function formatSession(s: Session): string {
  const windowLines = s.windows.map(w => {
    const paneLines = w.panes.map(
      p => `      • \`${p.id}\`${p.active ? ' (active)' : ''}: ${p.command}`
    )
    return [`    window ${w.id} "${w.name}"`, ...paneLines].join('\n')
  })
  return [`*${s.name}* (${s.id})`, ...windowLines].join('\n')
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
    const paneId = args[0]
    const lines = args[1] ? parseInt(args[1], 10) : 50
    if (!paneId) {
      await respond('Usage: `read <pane> [lines]`')
      return
    }
    const content = await adapter.readPane(paneId, lines)
    await respond('```\n' + (content.trim() || '(empty)') + '\n```')
  }

  const send: CommandHandler = async (args, respond) => {
    const paneId = args[0]
    const text = args.slice(1).join(' ')
    if (!paneId || !text) {
      await respond('Usage: `send <pane> <text>`')
      return
    }
    await adapter.sendText(paneId, text)
    await respond(`:white_check_mark: Sent to \`${paneId}\``)
  }

  const key: CommandHandler = async (args, respond) => {
    const paneId = args[0]
    const keyName = args[1]
    if (!paneId || !keyName) {
      await respond('Usage: `key <pane> <key>`')
      return
    }
    await adapter.sendKey(paneId, keyName)
    await respond(`:white_check_mark: Sent key \`${keyName}\` to \`${paneId}\``)
  }

  return { list, tree, read, send, key }
}
