import type { ContentDelta, IToolPlugin, ToolState } from '../interface.js'

export class GenericPlugin implements IToolPlugin {
  readonly id = 'generic'
  readonly displayName = 'Generic Terminal'

  detect(_screenContent: string): boolean {
    return true // lowest-priority fallback, always matches
  }

  parseState(_content: string): ToolState {
    return 'idle'
  }

  extractResponse(content: string): string {
    return content.trim()
  }

  computeDelta(prev: string, curr: string): ContentDelta | null {
    if (prev === curr) return null
    const prevLines = prev.split('\n')
    const currLines = curr.split('\n')
    const newLines = currLines.filter(l => !prevLines.includes(l))
    if (newLines.length === 0) return null
    return { type: 'replace', content: newLines.join('\n') }
  }

  keyAliases: Record<string, string> = {}

  watch = {
    pollIntervalMs: 2000,
    notifyOnTransitions: [] as Array<[ToolState, ToolState]>,
    suppressPatterns: [] as RegExp[],
  }
}
