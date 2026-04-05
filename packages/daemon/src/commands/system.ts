import type { ITerminalAdapter } from '../adapters/interface.js'
import type { IToolPlugin } from '../plugins/interface.js'
import type { WatcherManager } from '../watcher/manager.js'
import type { CommandHandler } from './router.js'

const HELP_TEXT = `
*Perch Commands*

*Sessions*
\`list\` / \`sessions\`             — List active Claude sessions
\`new <name> [--cwd <path>]\`    — Create session and launch \`claude\`

*Watch*
\`watch <pane>\`                  — Start monitoring a Claude session
\`unwatch <pane>\`                — Stop monitoring
\`watching\`                      — List currently watched sessions
_(In a thread: reply, \`accept\`, \`reject\`, \`interrupt\`, \`unwatch\`)_

*System*
\`help\`                          — Show this message
\`status\`                        — Daemon status
`.trim()

export function makeSystemHandlers(
  adapter: ITerminalAdapter,
  plugins: IToolPlugin[],
  watcher: WatcherManager,
  startedAt: Date,
): Record<string, CommandHandler> {
  const help: CommandHandler = async (_args, respond) => {
    await respond(HELP_TEXT)
  }

  const status: CommandHandler = async (_args, respond) => {
    const uptime = Math.floor((Date.now() - startedAt.getTime()) / 1000)
    const watches = watcher.listWatches()
    const lines = [
      `*Perch Status*`,
      `• Adapter: \`${adapter.name}\``,
      `• Uptime: ${uptime}s`,
      `• Watching: ${watches.length} pane(s)${watches.length ? ': ' + watches.map(w => `\`${w}\``).join(', ') : ''}`,
      `• Plugins: ${plugins.map(p => p.id).join(', ')}`,
    ]
    await respond(lines.join('\n'))
  }

  return { help, status }
}
