import { execa } from 'execa'
import { access } from 'fs/promises'

export interface MultiplexerInfo {
  id: string
  displayName: string
  command: string
}

const MULTIPLEXERS: MultiplexerInfo[] = [
  { id: 'tmux', displayName: 'tmux', command: 'tmux' },
  { id: 'cmux', displayName: 'cmux', command: 'cmux' },
]

const FALLBACK_PATHS: Record<string, string[]> = {
  cmux: ['/Applications/cmux.app/Contents/Resources/bin/cmux'],
}

async function isInstalled(command: string): Promise<boolean> {
  try {
    await execa('which', [command])
    return true
  } catch {
    for (const p of FALLBACK_PATHS[command] ?? []) {
      try {
        await access(p)
        return true
      } catch {}
    }
    return false
  }
}

export async function detectMultiplexers(): Promise<MultiplexerInfo[]> {
  const results = await Promise.all(
    MULTIPLEXERS.map(async m => ({ m, found: await isInstalled(m.command) }))
  )
  return results.filter(r => r.found).map(r => r.m)
}

export function installInstructions(id: string): string {
  const instructions: Record<string, string> = {
    tmux: 'brew install tmux',
    cmux: 'brew install --cask cmux',
  }
  return instructions[id] ?? `Install ${id} via your package manager`
}

export interface ClaudeCodeInfo {
  installed: boolean
  version?: string
  authenticated?: boolean
}

export async function detectClaudeCode(): Promise<ClaudeCodeInfo> {
  // Check if installed
  let version: string | undefined
  try {
    const { stdout } = await execa('claude', ['--version'])
    version = stdout.trim()
  } catch {
    return { installed: false }
  }

  // Verify auth by running a minimal prompt with a short timeout
  try {
    await execa('claude', ['-p', 'hi', '--output-format', 'text'], {
      timeout: 20_000,
    })
    return { installed: true, version, authenticated: true }
  } catch {
    return { installed: true, version, authenticated: false }
  }
}
