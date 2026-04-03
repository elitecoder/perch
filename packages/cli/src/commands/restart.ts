import { restart } from '../launchagent.js'
import { ui } from '../ui.js'

export async function runRestart(): Promise<void> {
  const spinner = ui.spinner('Restarting Perch...').start()
  await restart()
  spinner.succeed('Perch restarted')
}
