import { confirm } from '@inquirer/prompts'
import { execa } from 'execa'
import { uninstall } from '../launchagent.js'
import { clearAllSecrets } from '../keychain.js'
import { ui } from '../ui.js'
import { rmSync, existsSync } from 'fs'
import { CONFIG_DIR } from '@perch-dev/shared/config'

export async function runUninstall(): Promise<void> {
  const proceed = await confirm({ message: 'This will completely remove Perch. Continue?' })
  if (!proceed) {
    ui.info('Aborted.')
    return
  }

  const spinner = ui.spinner('Unloading LaunchAgent...').start()
  await uninstall()
  spinner.succeed('LaunchAgent unloaded')

  await clearAllSecrets()
  ui.success('Keychain entries removed')

  if (existsSync(CONFIG_DIR)) {
    rmSync(CONFIG_DIR, { recursive: true, force: true })
    ui.success('Config directory removed')
  }

  ui.success('Removing perch CLI...')
  ui.info('Run: npm uninstall --global perch')
  await execa('npm', ['uninstall', '--global', 'perch']).catch(() => {
    // may fail if installed via pnpm or yarn
    ui.warn('Could not auto-remove. Run manually: npm uninstall --global perch')
  })

  ui.success('Perch uninstalled.')
}
