import type { ITerminalAdapter, Pane } from '../adapters/interface.js'
import type { WatcherManager } from '../watcher/manager.js'
import type { CommandHandler } from './router.js'
import { findClaudePanes } from '../transcript/claude-finder.js'

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

function shortIdFromPaneId(paneId: string): string {
  // cmux: cmux:workspace:1:surface:5 → "5"
  const numericTail = paneId.match(/:(\d+)$/)
  if (numericTail) return numericTail[1]!
  // tmux: tmux:work:@0:%3 → "3"
  const tmuxPane = paneId.match(/%(\d+)$/)
  if (tmuxPane) return tmuxPane[1]!
  return paneId
}

export function makeTerminalHandlers(
  adapter: ITerminalAdapter,
  watcher: WatcherManager,
): Record<string, CommandHandler> {
  const list: CommandHandler = async (_args, respond) => {
    const claudePanes = await findClaudePanes(adapter)
    if (claudePanes.length === 0) {
      await respond('No active Claude sessions.')
      return
    }
    const watching = watcher.listWatches()
    const lines = claudePanes.map(p => {
      const id = shortIdFromPaneId(p.paneId)
      const watchedMark = watching.includes(p.paneId) ? ' 👀 watching' : ''
      return `  • *${p.sessionName}*    \`${id}\`${watchedMark}`
    })
    await respond('*Claude sessions:*\n' + lines.join('\n'))
  }

  return { list, resolvePane: (input: string) => resolvePane(adapter, input) }
}
