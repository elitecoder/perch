import type { ITerminalAdapter } from './adapters/interface.js'
import type { IToolPlugin } from './plugins/interface.js'
import type { WatcherManager } from './watcher/manager.js'
import type { Poster } from './slack/poster.js'
import type { PerchConfig, PerchState } from './config.js'
import { writeState } from './config.js'
import { resolveClaudeSession } from './transcript/resolver.js'
import { shortId } from './commands/watch.js'

/**
 * Resume watches from persisted state. Reuses existing Slack threads when
 * available, otherwise creates new ones. Updates state.json with the result.
 */
export async function resumeWatches(
  state: PerchState,
  config: PerchConfig,
  adapter: ITerminalAdapter,
  plugins: IToolPlugin[],
  watcher: WatcherManager,
  poster: Poster,
): Promise<string[]> {
  const savedThreads = state.watchThreads ?? {}
  const resumed: string[] = []
  const newThreads: Record<string, string> = {}

  for (const paneId of state.watches) {
    try {
      const savedPresetId = config.panePresets[paneId] ?? config.defaultPreset
      const initialContent = await adapter.readPane(paneId)
      const plugin =
        (savedPresetId ? plugins.find(p => p.id === savedPresetId) : undefined) ??
        plugins.find(p => p.detect(initialContent)) ??
        plugins[plugins.length - 1]!

      // Reuse the existing thread if we have one, otherwise start a new one
      const oldTs = savedThreads[paneId]
      let ts: string
      if (oldTs) {
        ts = oldTs
      } else {
        const res = await poster.post(`:eyes: Resumed watching \`${shortId(paneId)}\` with *${plugin.displayName}*`)
        ts = res.ts
      }

      const resolved = await resolveClaudeSession(paneId, adapter)
      if (resolved) {
        watcher.watchTranscript(paneId, resolved.jsonlPath, poster, ts, plugin, true, resolved.pid)
      } else {
        await poster.postToThread(ts, ':warning: Could not locate Claude Code session file — is `claude` still running in this pane?')
      }
      resumed.push(paneId)
      newThreads[paneId] = ts
    } catch (err) {
      console.error(`Perch: failed to resume watch for ${paneId}:`, err)
    }
  }

  writeState({ watches: resumed, watchThreads: newThreads })
  return resumed
}
