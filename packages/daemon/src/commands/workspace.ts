import type { ITerminalAdapter } from '../adapters/interface.js'
import type { CommandHandler } from './router.js'
import { shortId } from './watch.js'

export function makeWorkspaceHandlers(adapter: ITerminalAdapter): Record<string, CommandHandler> {
  const newClaude: CommandHandler = async (args, respond) => {
    const name = args[0]
    if (!name) {
      await respond('Usage: `new <name> [--cwd <path>]`')
      return
    }
    const cwdIdx = args.indexOf('--cwd')
    const cwd = cwdIdx !== -1 ? args[cwdIdx + 1] : undefined

    const session = await adapter.createSession(name, cwd)
    const pane = session.windows[0]?.panes[0]
    if (!pane) {
      await respond(':x: Session created but no pane found.')
      return
    }
    await adapter.sendText(pane.id, 'claude')
    const sid = shortId(pane.id)
    await respond(
      `:white_check_mark: Created session *${name}* — \`${sid}\`\nUse \`watch ${sid}\` to monitor.`,
    )
  }

  return { newClaude }
}
