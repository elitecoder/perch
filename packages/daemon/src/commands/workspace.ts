import type { ITerminalAdapter } from '../adapters/interface.js'
import type { CommandHandler } from './router.js'

export function makeWorkspaceHandlers(adapter: ITerminalAdapter): Record<string, CommandHandler> {
  const newSession: CommandHandler = async (args, respond) => {
    const name = args[0]
    if (!name) {
      await respond('Usage: `new session <name> [--cwd <path>] [--cmd <command>]`')
      return
    }
    const cwdIdx = args.indexOf('--cwd')
    const cmdIdx = args.indexOf('--cmd')
    const cwd = cwdIdx !== -1 ? args[cwdIdx + 1] : undefined
    const cmd = cmdIdx !== -1 ? args[cmdIdx + 1] : undefined
    const session = await adapter.createSession(name, cwd, cmd)
    await respond(`:white_check_mark: Created session *${session.name}* (\`${session.id}\`)`)
  }

  const newSplit: CommandHandler = async (args, respond) => {
    const dir = args[0] as 'left' | 'right' | 'up' | 'down'
    const paneId = args[1]
    if (!dir || !paneId) {
      await respond('Usage: `new split <left|right|up|down> <pane>`')
      return
    }
    const pane = await adapter.splitPane(paneId, dir)
    await respond(`:white_check_mark: Split \`${paneId}\` → new pane \`${pane.id}\``)
  }

  const rename: CommandHandler = async (args, respond) => {
    const target = args[0]
    const name = args[1]
    if (!target || !name) {
      await respond('Usage: `rename <session-id> <new-name>`')
      return
    }
    await adapter.renameSession(target, name)
    await respond(`:white_check_mark: Renamed \`${target}\` to *${name}*`)
  }

  const close: CommandHandler = async (args, respond) => {
    const target = args[0]
    if (!target) {
      await respond('Usage: `close <session-id>`')
      return
    }
    await adapter.closeSession(target)
    await respond(`:white_check_mark: Closed \`${target}\``)
  }

  const select: CommandHandler = async (args, respond) => {
    const paneId = args[0]
    if (!paneId) {
      await respond('Usage: `select <pane>`')
      return
    }
    await adapter.selectPane(paneId)
    await respond(`:white_check_mark: Selected pane \`${paneId}\``)
  }

  return { newSession, newSplit, rename, close, select }
}
