import { describe, expect, it } from 'vitest'
import { stripAnsi, normalizeLines, trimTrailingBlanks } from './utils.js'

describe('stripAnsi', () => {
  it('removes color codes', () => {
    expect(stripAnsi('\x1b[32mGreen\x1b[0m')).toBe('Green')
  })

  it('removes cursor movement codes', () => {
    expect(stripAnsi('\x1b[2Ghello\x1b[K')).toBe('hello')
  })

  it('removes control characters', () => {
    expect(stripAnsi('hello\x07world\x0e')).toBe('helloworld')
  })

  it('preserves plain text', () => {
    expect(stripAnsi('no codes here')).toBe('no codes here')
  })

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('')
  })

  it('removes multiple ANSI sequences in sequence', () => {
    expect(stripAnsi('\x1b[1m\x1b[31mBold Red\x1b[0m')).toBe('Bold Red')
  })

  it('removes charset selection codes', () => {
    expect(stripAnsi('\x1b(Bhello\x1b)0')).toBe('hello')
  })

  it('removes cursor direction codes (A, B, C, D)', () => {
    expect(stripAnsi('\x1b[3Ahello\x1b[2B')).toBe('hello')
  })
})

describe('normalizeLines', () => {
  it('splits on newlines and trims trailing whitespace', () => {
    expect(normalizeLines('line1  \nline2\t')).toEqual(['line1', 'line2'])
  })

  it('strips ANSI before splitting', () => {
    expect(normalizeLines('\x1b[31mred\x1b[0m\nplain')).toEqual(['red', 'plain'])
  })

  it('handles empty string', () => {
    expect(normalizeLines('')).toEqual([''])
  })

  it('preserves leading whitespace', () => {
    expect(normalizeLines('  indented\n    more')).toEqual(['  indented', '    more'])
  })
})

describe('trimTrailingBlanks', () => {
  it('removes trailing empty lines', () => {
    expect(trimTrailingBlanks(['a', 'b', '', ''])).toEqual(['a', 'b'])
  })

  it('returns empty array for all-blank input', () => {
    expect(trimTrailingBlanks(['', '', ''])).toEqual([])
  })

  it('returns same array when no trailing blanks', () => {
    expect(trimTrailingBlanks(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('handles empty input', () => {
    expect(trimTrailingBlanks([])).toEqual([])
  })

  it('preserves internal blank lines', () => {
    expect(trimTrailingBlanks(['a', '', 'b'])).toEqual(['a', '', 'b'])
  })
})
