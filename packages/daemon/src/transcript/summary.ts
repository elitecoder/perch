import { readFile } from 'fs/promises'
import { parseRecord, isUserRecord, isAssistantRecord, type TranscriptRecord, type UserRecord, type AssistantRecord } from './types.js'

/**
 * Summary of the tail of a Claude Code JSONL transcript — the user's last
 * prompt and Claude's last textual response. Used to seed a freshly-attached
 * watch thread with enough context that the viewer understands what Claude
 * is doing, rather than staring at an empty thread until the next event.
 */
export interface TranscriptSummary {
  lastPrompt?: string
  lastAssistantText?: string
}

const MAX_FIELD_CHARS = 500

/** Read the full JSONL file and extract a summary of its tail. */
export async function summarizeTranscript(jsonlPath: string): Promise<TranscriptSummary> {
  let content: string
  try {
    content = await readFile(jsonlPath, 'utf8')
  } catch {
    return {}
  }

  const records: TranscriptRecord[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const record = parseRecord(trimmed)
    if (record !== null) records.push(record)
  }

  return extractSummary(records)
}

/** Pure extraction — exposed separately so it's easy to unit-test. */
export function extractSummary(records: TranscriptRecord[]): TranscriptSummary {
  let lastPrompt: string | undefined
  let lastAssistantText: string | undefined

  // Walk backwards: first matching record wins for each slot.
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]!
    if (lastAssistantText === undefined && isAssistantRecord(r)) {
      const text = assistantText(r)
      if (text) lastAssistantText = truncate(text, MAX_FIELD_CHARS)
    }
    if (lastPrompt === undefined && isUserRecord(r)) {
      const text = userPromptText(r)
      if (text) lastPrompt = truncate(text, MAX_FIELD_CHARS)
    }
    if (lastPrompt !== undefined && lastAssistantText !== undefined) break
  }

  return { lastPrompt, lastAssistantText }
}

/** Render a summary as a Slack message. Returns null when there's nothing useful. */
export function formatSummary(s: TranscriptSummary): string | null {
  if (!s.lastPrompt && !s.lastAssistantText) return null
  const parts: string[] = ['*Context so far:*']
  if (s.lastPrompt) parts.push(`*Last prompt:* ${s.lastPrompt}`)
  if (s.lastAssistantText) parts.push(`*Last response:* ${s.lastAssistantText}`)
  return parts.join('\n')
}

// ---- Internals -------------------------------------------------------------

function assistantText(r: AssistantRecord): string | null {
  const texts: string[] = []
  for (const block of r.message.content) {
    if (block.type === 'text' && block.text.trim()) texts.push(block.text.trim())
  }
  return texts.length ? texts.join('\n\n') : null
}

/**
 * Extract a human-typed prompt from a user record. Claude Code stores three
 * kinds of content under `user` records: plain-string prompts, arrays that
 * mix text blocks with tool_result blocks, and pure tool_result arrays
 * (echoes of tool output, not user intent). Only the first two are prompts.
 */
function userPromptText(r: UserRecord): string | null {
  const content = r.message.content
  if (typeof content === 'string') {
    const stripped = stripSystemTags(content).trim()
    return stripped || null
  }
  const texts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && block.text.trim()) {
      const stripped = stripSystemTags(block.text).trim()
      if (stripped) texts.push(stripped)
    }
  }
  return texts.length ? texts.join('\n\n') : null
}

/** Mirror of formatter.ts `stripSystemTags` — injected tags aren't user intent. */
function stripSystemTags(text: string): string {
  return text.replace(/<[a-z-]+(?:\s[^>]*)?>[^<]*<\/[a-z-]+>/gi, '').replace(/<[a-z-]+\s*\/>/gi, '')
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1).trimEnd() + '…'
}
