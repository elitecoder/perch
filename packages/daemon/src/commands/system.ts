import type { ITerminalAdapter } from '../adapters/interface.js'
import type { IToolPlugin } from '../plugins/interface.js'
import type { WatcherManager } from '../watcher/manager.js'
import type { CommandHandler } from './router.js'

const HELP_TEXT = `
*Perch Commands*

*Terminal*
\`list\` / \`ls\`               — List all sessions
\`tree [session]\`             — Show session → windows → panes tree
\`read <pane> [lines]\`        — Read pane output (default 50 lines)
\`send <pane> <text>\`         — Send text + Enter to pane
\`key <pane> <key>\`           — Send a single keystroke

*Watch*
\`watch <pane> [--preset id]\` — Start watching a pane (use \`list\` to get pane IDs)
\`unwatch <pane>\`             — Stop watching
\`watching\`                   — List currently watched panes

*Workspace*
\`new session <name> [--cwd <p>] [--cmd <c>]\` — Create session
\`new split <dir> <pane>\`     — Split pane (left/right/up/down)
\`rename <target> <name>\`     — Rename session
\`close <target>\`             — Close session
\`select <pane>\`              — Switch active pane

*System*
\`help\`                       — Show this message
\`status\`                     — Daemon status
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
