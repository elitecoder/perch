import {
  isAssistantRecord,
  isUserRecord,
  type AssistantRecord,
  type TranscriptRecord,
  type ToolResultBlock,
  type ToolUseBlock,
} from './types.js'

export type SlackActionType = 'update_status' | 'post_response' | 'update_response' | 'post_user' | 'post_snippet'

export interface SlackAction {
  type: SlackActionType
  text: string
}

const CURSOR = ' ▌'

/**
 * Maps JSONL records from Claude Code transcripts into Slack actions.
 *
 * Streaming model (mirrors Hermes/OpenClaw):
 * - Tool calls: one status message, edited in place as tools accumulate
 * - First text chunk: post_response (creates new message with cursor)
 * - Subsequent chunks: update_response (edit in place with cursor)
 * - end_turn: update_response (final edit, no cursor)
 * - User text: post_user (speech bubble, for watching existing sessions)
 * - Thinking blocks + sidechain records: skipped
 */
export class ConversationalFormatter {
  private _pendingTools: string[] = []
  private _responseStarted = false
  /** True when the last assistant record had stop_reason 'tool_use' (may be waiting for approval). */
  waitingForToolResult = false
  /** Description of the last tool call, shown in "waiting for approval" messages. */
  lastToolDescription = ''

  processRecords(records: TranscriptRecord[]): SlackAction[] {
    const actions: SlackAction[] = []

    for (const record of records) {
      if (record.isSidechain) continue

      if (isAssistantRecord(record)) {
        actions.push(...this._processAssistant(record))
      } else if (isUserRecord(record)) {
        actions.push(...this._processUser(record))
      }
    }

    return actions
  }

  private _processAssistant(record: AssistantRecord): SlackAction[] {
    const actions: SlackAction[] = []
    const { content, stop_reason } = record.message

    const textParts: string[] = []
    const toolCalls: ToolUseBlock[] = []

    for (const block of content) {
      if (block.type === 'thinking') continue
      if (block.type === 'text') textParts.push(block.text)
      if (block.type === 'tool_use') toolCalls.push(block)
    }

    if (toolCalls.length > 0) {
      this._pendingTools.push(...toolCalls.map(formatToolCall))

      // Post content from Write tool calls targeting .md files as snippets
      for (const tool of toolCalls) {
        if (tool.name === 'Write') {
          const path = stringField(tool.input, 'file_path') ?? ''
          const writeContent = stringField(tool.input, 'content')
          if (path.endsWith('.md') && writeContent && writeContent.length > 100) {
            const filename = path.split('/').pop() ?? 'file.md'
            actions.push({ type: 'post_snippet', text: writeContent, title: filename } as SlackAction & { title: string })
          }
        }
      }

      actions.push({ type: 'update_status', text: this._pendingTools.join('\n') })
    }

    // Track whether Claude is waiting for a tool result (permission prompt)
    this.waitingForToolResult = stop_reason === 'tool_use'
    if (this.waitingForToolResult && toolCalls.length > 0) {
      this.lastToolDescription = formatToolCall(toolCalls[toolCalls.length - 1]!)
    }

    const text = textParts.join('').trim()
    if (text) {
      const formatted = toSlackMrkdwn(text)
      if (stop_reason === 'end_turn') {
        // Final chunk — no cursor, reset state for next turn
        const type = this._responseStarted ? 'update_response' : 'post_response'
        this._pendingTools = []
        this._responseStarted = false
        actions.push({ type, text: formatted })
      } else {
        // Streaming chunk — append cursor
        const type = this._responseStarted ? 'update_response' : 'post_response'
        this._responseStarted = true
        actions.push({ type, text: formatted + CURSOR })
      }
    } else if (stop_reason === 'end_turn') {
      // end_turn with no text (tool-only turn) — reset state
      this._pendingTools = []
      this._responseStarted = false
    }

    return actions
  }

  private _processUser(record: import('./types.js').UserRecord): SlackAction[] {
    const { content } = record.message

    if (typeof content === 'string') {
      const text = content.trim()
      if (!text) return []
      // New user turn — reset response state
      this._responseStarted = false
      this.waitingForToolResult = false
      return [{ type: 'post_user', text: `:speech_balloon: *User:* ${text}` }]
    }

    // Tool results arrived — no longer waiting for approval
    this.waitingForToolResult = false

    const actions: SlackAction[] = []
    for (const block of content) {
      if (block.type === 'tool_result') {
        const tb = block as ToolResultBlock
        if (tb.is_error) {
          const toolLabel = this._pendingTools.at(-1)?.split(' ')[1] ?? 'Tool'
          actions.push({ type: 'update_status', text: `:warning: ${toolLabel} failed` })
        }
      }
    }
    return actions
  }
}

// ---- Helpers ---------------------------------------------------------------

function formatToolCall(block: ToolUseBlock): string {
  const { name, input } = block
  const path = stringField(input, 'file_path') ?? stringField(input, 'path')
  const pattern = stringField(input, 'pattern')
  const command = stringField(input, 'command')
  const description = stringField(input, 'description')

  switch (name) {
    case 'Read':
      return `:page_facing_up: Reading \`${shorten(path ?? '...')}\``
    case 'Edit':
    case 'MultiEdit':
      return `:pencil2: Editing \`${shorten(path ?? '...')}\``
    case 'Write':
      return `:pencil2: Writing \`${shorten(path ?? '...')}\``
    case 'Bash': {
      const label = description ?? command ?? ''
      return `:terminal: Running: \`${shorten(label, 60)}\``
    }
    case 'Grep':
      return `:mag: Searching for \`${shorten(pattern ?? '...', 40)}\``
    case 'Glob':
      return `:open_file_folder: Finding files \`${shorten(stringField(input, 'pattern') ?? '...', 40)}\``
    case 'Agent':
      return `:robot_face: Delegating to subagent`
    case 'WebSearch':
      return `:globe_with_meridians: Searching: \`${shorten(stringField(input, 'query') ?? '...', 50)}\``
    case 'WebFetch':
      return `:link: Fetching URL`
    default:
      return `:gear: Using ${name}`
  }
}

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key]
  return typeof v === 'string' ? v : undefined
}

function shorten(s: string, max = 50): string {
  const basename = s.includes('/') ? s.split('/').pop()! : s
  if (basename.length <= max) return basename
  return basename.slice(0, max - 1) + '…'
}

export function toSlackMrkdwn(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '*$1*')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<$2|$1>')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/~~(.+?)~~/g, '~$1~')
}
