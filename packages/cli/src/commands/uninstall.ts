import { confirm } from '@inquirer/prompts'
import { execa } from 'execa'
import { uninstall } from '../launchagent.js'
import { clearAllSecrets } from '../keychain.js'
import { removeClaudeHooks, removeClaudeSkills } from './setup.js'
import { ui } from '../ui.js'
import { rmSync, existsSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { CONFIG_DIR } from '@perch-dev/shared/config'

const INSTALL_DIR = join(homedir(), '.perch')

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

  removeClaudeHooks()
  ui.success('Claude Code hooks removed')

  removeClaudeSkills()
  ui.success('Claude Code skills removed')

  if (existsSync(CONFIG_DIR)) {
    rmSync(CONFIG_DIR, { recursive: true, force: true })
    ui.success('Config directory removed')
  }

  if (existsSync(INSTALL_DIR)) {
    rmSync(INSTALL_DIR, { recursive: true, force: true })
    ui.success('Install directory removed')
  }

  // Remove the global `perch` binary
  try {
    const { stdout } = await execa('which', ['perch'])
    const binPath = stdout.trim()
    if (binPath) {
      unlinkSync(binPath)
      ui.success(`Removed ${binPath}`)
    }
  } catch {
    // already gone
  }

  ui.success('Perch uninstalled.')
}
