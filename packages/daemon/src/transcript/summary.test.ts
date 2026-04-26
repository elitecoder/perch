import { describe, expect, it } from 'vitest'
import { extractSummary, formatSummary } from './summary.js'
import type { TranscriptRecord } from './types.js'

function userStr(text: string): TranscriptRecord {
  return { type: 'user', message: { role: 'user', content: text } } as TranscriptRecord
}

function userBlocks(blocks: Array<{ type: 'text'; text: string } | { type: 'tool_result'; tool_use_id: string; content?: string }>): TranscriptRecord {
  return { type: 'user', message: { role: 'user', content: blocks } } as TranscriptRecord
}

function assistant(text: string): TranscriptRecord {
  return {
    type: 'assistant',
    message: {
      model: 'claude',
      id: 'msg',
      role: 'assistant',
      content: [{ type: 'text', text }],
      stop_reason: 'end_turn',
    },
  } as TranscriptRecord
}

describe('extractSummary', () => {
  it('returns an empty summary when there are no records', () => {
    expect(extractSummary([])).toEqual({})
  })

  it('picks the most recent user prompt and assistant response', () => {
    const records = [
      userStr('old prompt'),
      assistant('old response'),
      userStr('new prompt'),
      assistant('new response'),
    ]
    expect(extractSummary(records)).toEqual({
      lastPrompt: 'new prompt',
      lastAssistantText: 'new response',
    })
  })

  it('ignores user records that are only tool_result echoes', () => {
    const records = [
      userStr('real prompt'),
      assistant('reply'),
      userBlocks([{ type: 'tool_result', tool_use_id: 't1', content: 'some tool output' }]),
    ]
    expect(extractSummary(records).lastPrompt).toBe('real prompt')
  })

  it('concatenates multiple text blocks in a user array', () => {
    const records = [userBlocks([
      { type: 'text', text: 'part one' },
      { type: 'text', text: 'part two' },
    ])]
    expect(extractSummary(records).lastPrompt).toBe('part one\n\npart two')
  })

  it('strips injected system tags from user prompts', () => {
    const records = [userStr('<system-reminder>ignore me</system-reminder>actual prompt')]
    expect(extractSummary(records).lastPrompt).toBe('actual prompt')
  })

  it('skips user records that collapse to whitespace after tag stripping', () => {
    const records = [
      userStr('real prompt'),
      assistant('reply'),
      userStr('<system-reminder>noise</system-reminder>'),
    ]
    expect(extractSummary(records).lastPrompt).toBe('real prompt')
  })

  it('joins multiple assistant text blocks with blank lines', () => {
    const records: TranscriptRecord[] = [{
      type: 'assistant',
      message: {
        model: 'claude',
        id: 'msg',
        role: 'assistant',
        content: [
          { type: 'text', text: 'first paragraph' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: {} },
          { type: 'text', text: 'second paragraph' },
        ],
        stop_reason: 'end_turn',
      },
    } as TranscriptRecord]
    expect(extractSummary(records).lastAssistantText).toBe('first paragraph\n\nsecond paragraph')
  })

  it('ignores assistant records that have no text blocks (pure tool calls)', () => {
    const records: TranscriptRecord[] = [
      assistant('useful response'),
      {
        type: 'assistant',
        message: {
          model: 'claude',
          id: 'msg2',
          role: 'assistant',
          content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }],
          stop_reason: 'tool_use',
        },
      } as TranscriptRecord,
    ]
    expect(extractSummary(records).lastAssistantText).toBe('useful response')
  })

  it('truncates fields longer than 500 chars with an ellipsis', () => {
    const long = 'a'.repeat(600)
    const result = extractSummary([userStr(long)])
    expect(result.lastPrompt!.length).toBe(500)
    expect(result.lastPrompt!.endsWith('…')).toBe(true)
  })
})

describe('formatSummary', () => {
  it('returns null when the summary is empty', () => {
    expect(formatSummary({})).toBeNull()
  })

  it('renders both fields when both are present', () => {
    const text = formatSummary({ lastPrompt: 'fix the flaky test', lastAssistantText: 'found it' })
    expect(text).toContain('*Context so far:*')
    expect(text).toContain('*Last prompt:* fix the flaky test')
    expect(text).toContain('*Last response:* found it')
  })

  it('omits the prompt line when no prompt is known', () => {
    const text = formatSummary({ lastAssistantText: 'working on it' })!
    expect(text).not.toContain('*Last prompt:*')
    expect(text).toContain('*Last response:* working on it')
  })

  it('omits the response line when no response is known', () => {
    const text = formatSummary({ lastPrompt: 'hello' })!
    expect(text).toContain('*Last prompt:* hello')
    expect(text).not.toContain('*Last response:*')
  })
})
