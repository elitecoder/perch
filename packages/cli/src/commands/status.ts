import { isRunning } from '../launchagent.js'
import { ui } from '../ui.js'

export async function runStatus(): Promise<void> {
  const running = await isRunning()
  if (running) {
    ui.success('Perch daemon is running')
  } else {
    ui.error('Perch daemon is not running')
    ui.info('Start it with: perch restart')
  }
}
