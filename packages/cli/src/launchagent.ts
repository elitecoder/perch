import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { execa } from 'execa'

const LABEL = 'dev.perch'
const PLIST_PATH = join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
const TEMPLATE_PATH = join(
  new URL('.', import.meta.url).pathname,
  '../../../launchd/dev.perch.plist.template'
)
const CONFIG_DIR = join(homedir(), '.config', 'perch')

export interface PlistVars {
  nodePath: string
  daemonPath: string
}

export function generatePlist(vars: PlistVars): string {
  const template = readFileSync(TEMPLATE_PATH, 'utf-8')
  return template
    .replace(/\{\{NODE_PATH\}\}/g, vars.nodePath)
    .replace(/\{\{DAEMON_PATH\}\}/g, vars.daemonPath)
    .replace(/\{\{CONFIG_DIR\}\}/g, CONFIG_DIR)
    .replace(/\{\{HOME\}\}/g, homedir())
}

export async function install(vars: PlistVars): Promise<void> {
  mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true })
  const plist = generatePlist(vars)
  writeFileSync(PLIST_PATH, plist, 'utf-8')
  await execa('launchctl', ['load', PLIST_PATH])
}

export async function uninstall(): Promise<void> {
  if (existsSync(PLIST_PATH)) {
    await execa('launchctl', ['unload', PLIST_PATH]).catch(() => undefined)
    // Don't delete the file — let user confirm
  }
}

export async function isRunning(): Promise<boolean> {
  try {
    const { stdout } = await execa('launchctl', ['list', LABEL])
    return stdout.includes(LABEL)
  } catch {
    return false
  }
}

export async function restart(): Promise<void> {
  await uninstall()
  await execa('launchctl', ['load', PLIST_PATH])
}

export async function resolveNodePath(): Promise<string> {
  const { stdout } = await execa('which', ['node'])
  return stdout.trim()
}
