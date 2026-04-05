import type { ITerminalAdapter } from '../adapters/interface.js'
import type { IToolPlugin } from '../plugins/interface.js'
import type { WatcherManager } from '../watcher/manager.js'
import type { Poster } from '../slack/poster.js'
import type { CommandHandler } from './router.js'
import { readConfig, writeConfig, readState, writeState } from '../config.js'
import { resolveClaudeSession } from '../transcript/resolver.js'

export function shortId(paneId: string): string {
  return paneId.match(/:(\d+)$/)?.[1] ?? paneId.match(/%(\d+)$/)?.[1] ?? paneId
}

export function makeWatchHandlers(
  adapter: ITerminalAdapter,
  plugins: IToolPlugin[],
  watcher: WatcherManager,
  poster: Poster,
  resolvePane: (input: string) => Promise<string>,
): Record<string, CommandHandler> {
  function findPlugin(id: string): IToolPlugin | undefined {
    return plugins.find(p => p.id === id)
  }

  function detectPlugin(screenContent: string, presetId?: string): IToolPlugin {
    if (presetId) {
      const match = findPlugin(presetId)
      if (match) return match
    }
    return plugins.find(p => p.detect(screenContent)) ?? plugins[plugins.length - 1]!
  }

  const watch: CommandHandler = async (args, respond) => {
    if (!args[0]) {
      await respond('Usage: `watch <pane> [--preset <plugin-id>]`')
      return
    }
    const paneId = await resolvePane(args[0])
    if (watcher.listWatches().includes(paneId)) {
      watcher.unwatch(paneId)
    }

    const presetIdx = args.indexOf('--preset')
    const explicitPresetId = presetIdx !== -1 ? args[presetIdx + 1] : undefined

    const config = readConfig()
    const resolvedPresetId = explicitPresetId ?? config.panePresets[paneId] ?? config.defaultPreset

    const initialContent = await adapter.readPane(paneId)
    const plugin = detectPlugin(initialContent, resolvedPresetId)

    // Save as global default on first ever use
    if (!config.defaultPreset) {
      writeConfig({ ...config, defaultPreset: plugin.id })
    }

    const keyNames = Object.keys(plugin.keyAliases)
    const keysHint = keyNames.length
      ? `\nKeys: ${keyNames.map(k => `\`${k}\``).join(', ')}\nType \`unwatch\` to stop.`
      : ''
    const { ts } = await poster.post(
      `:eyes: Watching \`${shortId(paneId)}\` with *${plugin.displayName}* — replies here will be forwarded to the pane.${keysHint}`
    )

    // Always use JSONL transcript monitoring
    const resolved = await resolveClaudeSession(paneId, adapter)
    if (!resolved) {
      await poster.postToThread(ts, ':warning: Could not locate Claude Code session file — is `claude` running in this pane?')
      // Still register for thread-based key aliases and text forwarding
      watcher.registerWatch(paneId, ts, plugin)
    } else {
      await watcher.watchTranscript(paneId, resolved.jsonlPath, poster, ts, plugin, true, resolved.pid)
    }
    const state = readState()
    if (!state.watches.includes(paneId)) {
      writeState({ ...state, watches: [...state.watches, paneId], watchThreads: { ...state.watchThreads, [paneId]: ts } })
    } else {
      writeState({ ...state, watchThreads: { ...state.watchThreads, [paneId]: ts } })
    }
    await poster.postToThread(ts, `:white_check_mark: Started watching \`${shortId(paneId)}\``)
  }

  const unwatch: CommandHandler = async (args, respond) => {
    if (!args[0]) {
      await respond('Usage: `unwatch <pane>`')
      return
    }
    const paneId = await resolvePane(args[0])
    watcher.unwatch(paneId)
    const state = readState()
    const { [paneId]: _, ...remainingThreads } = state.watchThreads ?? {}
    writeState({ ...state, watches: state.watches.filter(id => id !== paneId), watchThreads: remainingThreads })
    await respond(`:white_check_mark: Stopped watching \`${shortId(paneId)}\``)
  }

  const watching: CommandHandler = async (_args, respond) => {
    const list = watcher.listWatches()
    if (list.length === 0) {
      await respond('No panes currently being watched.')
      return
    }
    await respond('*Watching:*\n' + list.map(id => `• \`${shortId(id)}\``).join('\n'))
  }

  const preset: CommandHandler = async (args, respond) => {
    // `preset <plugin-id>` — set global default
    // `preset <pane> <plugin-id>` — set per-pane override
    const availableIds = plugins.map(p => p.id)
    const isPluginId = (s: string) => availableIds.includes(s)

    let pluginId: string
    let paneId: string | undefined

    if (args.length === 1 && isPluginId(args[0]!)) {
      pluginId = args[0]!
    } else if (args.length >= 2 && isPluginId(args[1]!)) {
      paneId = args[0]!
      pluginId = args[1]!
    } else {
      await respond(`Usage: \`preset <plugin-id>\` or \`preset <pane> <plugin-id>\`\nAvailable: ${plugins.map(p => `\`${p.id}\``).join(', ')}`)
      return
    }

    const plugin = findPlugin(pluginId)!
    const config = readConfig()

    if (paneId) {
      writeConfig({ ...config, panePresets: { ...config.panePresets, [paneId]: pluginId } })
      await respond(`:white_check_mark: Preset for \`${shortId(paneId)}\` set to *${plugin.displayName}*`)
    } else {
      writeConfig({ ...config, defaultPreset: pluginId })
      await respond(`:white_check_mark: Default preset set to *${plugin.displayName}*`)
    }
  }

  return { watch, unwatch, watching, preset }
}
