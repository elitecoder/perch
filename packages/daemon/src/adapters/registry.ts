import type { ITerminalAdapter } from './interface.js'
import { TmuxAdapter } from './tmux.js'
import { ZellijAdapter } from './zellij.js'
import { CmuxAdapter } from './cmux.js'

const ALL_ADAPTERS: ITerminalAdapter[] = [
  new CmuxAdapter(),
  new TmuxAdapter(),
  new ZellijAdapter(),
]

export async function detectAdapter(priority?: string[]): Promise<ITerminalAdapter> {
  const ordered = priority
    ? [
        ...priority.map(id => ALL_ADAPTERS.find(a => a.name === id)).filter(Boolean) as ITerminalAdapter[],
        ...ALL_ADAPTERS.filter(a => !priority.includes(a.name)),
      ]
    : ALL_ADAPTERS

  for (const adapter of ordered) {
    if (await adapter.isAvailable()) {
      return adapter
    }
  }
  throw new Error(
    'No supported terminal multiplexer found. Install tmux or cmux.'
  )
}

export function getAdapters(): ITerminalAdapter[] {
  return [...ALL_ADAPTERS]
}
