import { confirm } from '@inquirer/prompts'
import { uninstall } from '../launchagent.js'
import { clearAllSecrets } from '../keychain.js'
import { ui } from '../ui.js'
import { rmSync, existsSync } from 'fs'
import { CONFIG_DIR } from '../../../daemon/src/config.js'

export async function runUninstall(): Promise<void> {
  const proceed = await confirm({ message: 'This will remove the Perch LaunchAgent. Continue?' })
  if (!proceed) {
    ui.info('Aborted.')
    return
  }

  const spinner = ui.spinner('Unloading LaunchAgent...').start()
  await uninstall()
  spinner.succeed('LaunchAgent unloaded')

  const clearKeys = await confirm({ message: 'Also remove Slack tokens from Keychain?' })
  if (clearKeys) {
    await clearAllSecrets()
    ui.success('Keychain entries removed')
  }

  const clearConfig = await confirm({ message: 'Also remove config files (~/.config/perch)?' })
  if (clearConfig && existsSync(CONFIG_DIR)) {
    rmSync(CONFIG_DIR, { recursive: true, force: true })
    ui.success('Config directory removed')
  }

  ui.success('Perch uninstalled.')
}
