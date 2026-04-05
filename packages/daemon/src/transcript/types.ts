// Typed representation of Claude Code's native JSONL transcript records.
// Claude Code writes these to ~/.claude/projects/<encoded-path>/<session-id>.jsonl

export type ToolState = 'thinking' | 'waiting' | 'idle' | 'error'

// ---- Content blocks --------------------------------------------------------

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}

export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content?: string | Array<{ type: 'text'; text: string }>
  is_error?: boolean
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock

// ---- Base record fields shared by all types --------------------------------

interface BaseRecord {
  uuid?: string
  parentUuid?: string | null
  isSidechain?: boolean
  timestamp?: string
  sessionId?: string
  cwd?: string
}

// ---- Record types ----------------------------------------------------------

export interface PermissionModeRecord extends BaseRecord {
  type: 'permission-mode'
  permissionMode: string
}

export interface UserRecord extends BaseRecord {
  type: 'user'
  message: {
    role: 'user'
    content: string | Array<ToolResultBlock | { type: 'text'; text: string }>
  }
}

export interface AssistantRecord extends BaseRecord {
  type: 'assistant'
  message: {
    model: string
    id: string
    role: 'assistant'
    content: ContentBlock[]
    stop_reason: 'end_turn' | 'tool_use' | null
    usage?: {
      input_tokens: number
      output_tokens: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }
}

export interface SystemRecord extends BaseRecord {
  type: 'system'
  subtype: 'turn_duration' | 'stop_hook_summary' | string
  durationMs?: number
}

export interface FileHistoryRecord extends BaseRecord {
  type: 'file-history-snapshot'
}

export interface AttachmentRecord extends BaseRecord {
  type: 'attachment'
}

export type TranscriptRecord =
  | PermissionModeRecord
  | UserRecord
  | AssistantRecord
  | SystemRecord
  | FileHistoryRecord
  | AttachmentRecord

// ---- Parsing ---------------------------------------------------------------

export function parseRecord(line: string): TranscriptRecord | null {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>
    if (typeof obj !== 'object' || obj === null || typeof obj['type'] !== 'string') return null
    return obj as TranscriptRecord
  } catch {
    return null
  }
}

export function isUserRecord(r: TranscriptRecord): r is UserRecord {
  return r.type === 'user'
}

export function isAssistantRecord(r: TranscriptRecord): r is AssistantRecord {
  return r.type === 'assistant'
}

export function isSystemRecord(r: TranscriptRecord): r is SystemRecord {
  return r.type === 'system'
}
