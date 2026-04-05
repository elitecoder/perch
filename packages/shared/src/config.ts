import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export const CONFIG_DIR = join(homedir(), '.config', 'perch')
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json')
export const STATE_PATH = join(CONFIG_DIR, 'state.json')
export const LOG_PATH = join(CONFIG_DIR, 'perch.log')
export const LOCK_PATH = join(CONFIG_DIR, 'perch.lock')

export interface PerchConfig {
  slackChannelId: string
  pollIntervalMs: number
  maxScreenLines: number
  adapterPriority: string[]
  userPluginsDir: string
  defaultPreset?: string
  panePresets: Record<string, string>
  claudeCodeAvailable?: boolean
}

const DEFAULTS: PerchConfig = {
  slackChannelId: '',
  pollIntervalMs: 2000,
  maxScreenLines: 50,
  adapterPriority: ['tmux', 'zellij', 'cmux'],
  userPluginsDir: join(CONFIG_DIR, 'plugins'),
  panePresets: {},
}

export function ensureConfigDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
}

export function readConfig(): PerchConfig {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS }
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function writeConfig(config: PerchConfig): void {
  ensureConfigDir()
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

export interface PerchState {
  watches: string[]
}

export function readState(): PerchState {
  if (!existsSync(STATE_PATH)) return { watches: [] }
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8')) as PerchState
  } catch {
    return { watches: [] }
  }
}

export function writeState(state: PerchState): void {
  ensureConfigDir()
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8')
}
