import keytar from 'keytar'
import { detectAdapter } from './adapters/registry.js'
import { ClaudeCodePlugin } from './plugins/builtin/claude-code.js'
import { WatcherManager } from './watcher/manager.js'
import { createSocketApp } from './slack/socket.js'
import { readConfig, readState, writeState, ensureConfigDir } from './config.js'
import { resolveClaudeSession } from './transcript/resolver.js'

const KEYCHAIN_SERVICE = 'dev.perch'

async function main() {
  ensureConfigDir()
  const config = readConfig()

  const botToken = await keytar.getPassword(KEYCHAIN_SERVICE, 'botToken')
  const appToken = await keytar.getPassword(KEYCHAIN_SERVICE, 'appToken')

  if (!botToken || !appToken) {
    console.error('Perch: credentials not found in Keychain. Run `perch setup` first.')
    process.exit(1)
  }

  if (!config.slackChannelId) {
    console.error('Perch: no Slack channel configured. Run `perch setup` first.')
    process.exit(1)
  }

  const adapter = await detectAdapter(config.adapterPriority)
  const plugins = [new ClaudeCodePlugin()]
  const watcher = new WatcherManager()

  const { app, poster } = createSocketApp({
    botToken,
    appToken,
    channelId: config.slackChannelId,
    adapter,
    plugins,
    watcher,
  })

  process.on('SIGTERM', () => {
    watcher.dispose()
    void app.stop().then(() => process.exit(0))
  })

  await app.start()
  console.log(`Perch running — adapter: ${adapter.name}`)

  // Resume watches saved before restart
  const state = readState()
  const resumed: string[] = []
  for (const paneId of state.watches) {
    try {
      const savedPresetId = config.panePresets[paneId] ?? config.defaultPreset
      const initialContent = await adapter.readPane(paneId)
      const plugin =
        (savedPresetId ? plugins.find(p => p.id === savedPresetId) : undefined) ??
        plugins.find(p => p.detect(initialContent)) ??
        plugins[plugins.length - 1]!
      const { ts } = await poster.post(`:eyes: Resumed watching \`${paneId}\` with *${plugin.displayName}*`)

      const resolved = await resolveClaudeSession(paneId, adapter)
      if (resolved) {
        watcher.watchTranscript(paneId, resolved.jsonlPath, poster, ts, plugin, true, resolved.pid)
      } else {
        await poster.postToThread(ts, ':warning: Could not locate Claude Code session file — is `claude` still running in this pane?')
      }
      resumed.push(paneId)
    } catch (err) {
      console.error(`Perch: failed to resume watch for ${paneId}:`, err)
    }
  }
  // Clear any panes that failed to resume
  if (resumed.length !== state.watches.length) {
    writeState({ ...state, watches: resumed })
  }
}

main().catch(err => {
  console.error('Perch fatal error:', err)
  process.exit(1)
})

// @slack/socket-mode can throw "Unhandled event 'server explicit disconnect'"
// from its internal state machine — catch it so the daemon stays up
process.on('uncaughtException', (err) => {
  console.error('Perch uncaught exception (recovering):', err.message)
})
process.on('unhandledRejection', (reason) => {
  console.error('Perch unhandled rejection (recovering):', reason)
})

// Re-exports for programmatic use
export { TmuxAdapter } from './adapters/tmux.js'
export { detectAdapter, getAdapters } from './adapters/registry.js'
export type { ITerminalAdapter, Session, Window, Pane } from './adapters/interface.js'
export type { IToolPlugin, ToolState, ContentDelta } from './plugins/interface.js'
export { ClaudeCodePlugin } from './plugins/builtin/claude-code.js'
export { WatcherManager } from './watcher/manager.js'
export { CommandRouter } from './commands/router.js'
export { Poster } from './slack/poster.js'
