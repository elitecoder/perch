export type ToolState = 'thinking' | 'waiting' | 'idle' | 'error'

export interface ContentDelta {
  type: 'append' | 'replace' | 'transition'
  content: string
  fromState?: ToolState
  toState?: ToolState
}

export interface IToolPlugin {
  readonly id: string
  readonly displayName: string

  /** Return true if this tool appears to be running in the given screen content */
  detect(screenContent: string): boolean

  /** Parse current state of the tool from screen content */
  parseState(content: string): ToolState

  /** Extract the meaningful portion of screen content to relay */
  extractResponse(content: string): string

  /** Compute what changed meaningfully between two snapshots; null = nothing worth sending */
  computeDelta(prev: string, curr: string): ContentDelta | null

  /** Human-readable key aliases specific to this tool */
  keyAliases: Record<string, string>

  /** Watch behavior tuning */
  watch: {
    pollIntervalMs: number
    /** Only post to Slack when transitioning between these state pairs */
    notifyOnTransitions: Array<[ToolState, ToolState]>
    /** Regex patterns to suppress from delta output (noise) */
    suppressPatterns: RegExp[]
  }
}
