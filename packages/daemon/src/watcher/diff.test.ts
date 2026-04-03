import { describe, expect, it } from 'vitest'
import { diffScreens, isSuppressed, meaningfulAdded } from './diff.js'

describe('diffScreens', () => {
  it('returns empty diff for identical content', () => {
    const d = diffScreens('line1\nline2', 'line1\nline2')
    expect(d.added).toEqual([])
    expect(d.removed).toEqual([])
    expect(d.isAppend).toBe(true)
  })

  it('detects added lines', () => {
    const d = diffScreens('line1', 'line1\nline2\nline3')
    expect(d.added).toContain('line2')
    expect(d.added).toContain('line3')
  })

  it('detects removed lines', () => {
    const d = diffScreens('line1\nline2', 'line1')
    expect(d.removed).toContain('line2')
  })

  it('marks pure appends correctly', () => {
    const d = diffScreens('a\nb', 'a\nb\nc')
    expect(d.isAppend).toBe(true)
  })

  it('does not mark rewrite as append', () => {
    const d = diffScreens('a\nb\nc', 'x\ny')
    expect(d.isAppend).toBe(false)
  })

  it('strips ANSI codes before comparing', () => {
    const prev = 'hello'
    const curr = '\x1b[32mhello\x1b[0m\nnew line'
    const d = diffScreens(prev, curr)
    expect(d.isAppend).toBe(true)
    expect(d.added).toContain('new line')
  })

  it('ignores trailing blank lines', () => {
    const d = diffScreens('line1\n\n\n', 'line1\n\n')
    expect(d.added).toEqual([])
    expect(d.removed).toEqual([])
  })
})

describe('isSuppressed', () => {
  it('returns true when any pattern matches', () => {
    expect(isSuppressed('⣾', [/^[⣾⣽]/])).toBe(true)
  })

  it('returns false when no pattern matches', () => {
    expect(isSuppressed('important content', [/^\s*$/])).toBe(false)
  })

  it('returns false with empty pattern list', () => {
    expect(isSuppressed('anything', [])).toBe(false)
  })
})

describe('meaningfulAdded', () => {
  const patterns = [/^\s*$/, /^[⣾⣽⣻⢿]/]

  it('filters blank lines', () => {
    const result = meaningfulAdded(['good line', '', '  '], patterns)
    expect(result).toEqual(['good line'])
  })

  it('filters lines matching suppress patterns', () => {
    const result = meaningfulAdded(['⣾ spinning', 'real output'], patterns)
    expect(result).toEqual(['real output'])
  })

  it('returns all lines when nothing is suppressed', () => {
    const result = meaningfulAdded(['a', 'b', 'c'], [])
    expect(result).toEqual(['a', 'b', 'c'])
  })
})
