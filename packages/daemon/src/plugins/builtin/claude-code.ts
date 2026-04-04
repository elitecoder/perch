import type { ContentDelta, IToolPlugin, ToolState } from '../interface.js'

// ANSI escape sequence pattern
const ANSI_RE = /\x1b\[[0-9;]*[mGKHF]/g

// Claude Code prompt markers
const WAITING_MARKERS = ['◆', '◇']
const ERROR_MARKERS = ['✗']
const DONE_MARKERS = ['✓']
const THINKING_RE = /[⣾⣽⣻⢿⡿⣟⣯⣷]/ // braille spinner chars

// Shell prompt detection (bash/zsh)
const SHELL_PROMPT_RE = /[$#>]\s*$/m

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

function containsAny(text: string, markers: string[]): boolean {
  return markers.some(m => text.includes(m))
}

export class ClaudeCodePlugin implements IToolPlugin {
  readonly id = 'claude'
  readonly displayName = 'Claude Code'

  detect(screenContent: string): boolean {
    const stripped = stripAnsi(screenContent)
    return (
      containsAny(stripped, [...WAITING_MARKERS, ...ERROR_MARKERS, ...DONE_MARKERS]) ||
      /\bClaude\b/.test(stripped)
    )
  }

  parseState(content: string): ToolState {
    const stripped = stripAnsi(content)
    if (containsAny(stripped, ERROR_MARKERS)) return 'error'
    if (containsAny(stripped, WAITING_MARKERS)) return 'waiting'
    if (THINKING_RE.test(stripped)) return 'thinking'
    if (SHELL_PROMPT_RE.test(stripped)) return 'idle'
    return 'thinking'
  }

  extractResponse(content: string): string {
    const stripped = stripAnsi(content)
    // Drop the last line if it's a bare shell prompt (UI chrome)
    const lines = stripped.split('\n')
    const last = lines[lines.length - 1]
    if (last !== undefined && /^[$#>]\s*$/.test(last.trim())) {
      return lines.slice(0, -1).join('\n').trim()
    }
    return stripped.trim()
  }

  computeDelta(prev: string, curr: string): ContentDelta | null {
    const prevClean = stripAnsi(prev)
    const currClean = stripAnsi(curr)
    if (prevClean === currClean) return null

    const prevState = this.parseState(prev)
    const currState = this.parseState(curr)

    if (prevState !== currState) {
      return {
        type: 'transition',
        content: this.extractResponse(curr),
        fromState: prevState,
        toState: currState,
      }
    }

    // Check for appended content
    if (currClean.startsWith(prevClean)) {
      const appended = currClean.slice(prevClean.length).trim()
      if (!appended) return null
      if (this._isSuppressed(appended)) return null
      return { type: 'append', content: appended }
    }

    // Full replace
    const extracted = this.extractResponse(curr)
    if (this._isSuppressed(extracted)) return null
    return { type: 'replace', content: extracted }
  }

  private _isSuppressed(text: string): boolean {
    return this.watch.suppressPatterns.some(re => re.test(text))
  }

  keyAliases: Record<string, string> = {
    accept: 'y',
    reject: 'n',
    interrupt: 'C-c',
    esc: 'Escape',
    escape: 'Escape',
    confirm: 'Enter',
    enter: 'Enter',
    tab: 'Tab',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    space: 'Space',
  }

  watch = {
    pollIntervalMs: 1500,
    notifyOnTransitions: [
      ['thinking', 'waiting'],
      ['thinking', 'idle'],
      ['waiting', 'thinking'],
      ['idle', 'thinking'],
      ['thinking', 'error'],
    ] as Array<[ToolState, ToolState]>,
    suppressPatterns: [
      /^\s*$/, // blank lines
      /^\s*[⣾⣽⣻⢿⡿⣟⣯⣷]\s*$/, // spinner-only lines
      /\d+:\d+:\d+/, // timestamps
    ],
  }
}
