import { spawn } from 'child_process'
import { CONFIG_DIR } from '@perch-dev/shared/config'
import { join } from 'path'
import { ui } from '../ui.js'

export function runLogs(): void {
  const stderr = join(CONFIG_DIR, 'stderr.log')
  const stdout = join(CONFIG_DIR, 'stdout.log')
  ui.info(`Tailing daemon logs (Ctrl-C to exit)\n`)
  const tail = spawn('tail', ['-f', stdout, stderr], { stdio: 'inherit' })
  tail.on('error', err => {
    ui.error(`Could not tail logs: ${err.message}`)
    process.exit(1)
  })
}
