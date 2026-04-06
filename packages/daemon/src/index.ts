const nodeVersion = parseInt(process.versions.node.split('.')[0]!, 10)
if (nodeVersion === 23 || nodeVersion === 24) {
  console.error(`Error: Node.js v${process.versions.node} has a known ESM/CJS interop bug that breaks Perch.`)
  console.error('Please upgrade to Node.js 25+:  nvm install 25')
  process.exit(1)
}

import keytar from 'keytar'
import { detectAdapter } from './adapters/registry.js'
import { ClaudeCodePlugin } from './plugins/builtin/claude-code.js'
import { WatcherManager } from './watcher/manager.js'
import { createSocketApp } from './slack/socket.js'
import { readConfig, readState, ensureConfigDir } from './config.js'
import { resumeWatches } from './resume.js'

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
  await resumeWatches(state, config, adapter, plugins, watcher, poster)
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
export { resumeWatches } from './resume.js'
