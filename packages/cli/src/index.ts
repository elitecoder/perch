const nodeVersion = parseInt(process.versions.node.split('.')[0]!, 10)
if (nodeVersion === 23 || nodeVersion === 24) {
  console.error(`Error: Node.js v${process.versions.node} has a known ESM/CJS interop bug that breaks Perch.`)
  console.error('Please upgrade to Node.js 25+:  nvm install 25')
  process.exit(1)
}

import { runSetup } from './commands/setup.js'
import { runStatus } from './commands/status.js'
import { runRestart } from './commands/restart.js'
import { runLogs } from './commands/logs.js'
import { runUninstall } from './commands/uninstall.js'
import { ui } from './ui.js'

const COMMANDS: Record<string, () => Promise<void> | void> = {
  setup: runSetup,
  status: runStatus,
  restart: runRestart,
  logs: runLogs,
  uninstall: runUninstall,
}

async function main() {
  const cmd = process.argv[2]

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log([
      'Usage: perch <command>',
      '',
      'Commands:',
      '  setup      Run the interactive setup wizard',
      '  status     Check daemon status',
      '  restart    Restart the daemon',
      '  logs       Tail daemon logs',
      '  uninstall  Remove Perch',
    ].join('\n'))
    return
  }

  const handler = COMMANDS[cmd]
  if (!handler) {
    ui.error(`Unknown command: ${cmd}. Run \`perch help\` for usage.`)
    process.exit(1)
  }

  await handler()
}

main().catch(err => {
  ui.error(String(err instanceof Error ? err.message : err))
  process.exit(1)
})
