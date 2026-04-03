import { describe, expect, it, beforeEach } from 'vitest'
import { GenericPlugin } from './generic.js'

describe('GenericPlugin', () => {
  let plugin: GenericPlugin

  beforeEach(() => {
    plugin = new GenericPlugin()
  })

  it('always detects (fallback)', () => {
    expect(plugin.detect('')).toBe(true)
    expect(plugin.detect('anything at all')).toBe(true)
  })

  it('always returns idle state', () => {
    expect(plugin.parseState('◆ prompt')).toBe('idle')
    expect(plugin.parseState('⣾ spinner')).toBe('idle')
  })

  describe('computeDelta', () => {
    it('returns null when content is identical', () => {
      expect(plugin.computeDelta('abc', 'abc')).toBeNull()
    })

    it('returns replace delta with new lines', () => {
      const prev = 'line1\nline2'
      const curr = 'line1\nline2\nline3'
      const delta = plugin.computeDelta(prev, curr)
      expect(delta?.type).toBe('replace')
      expect(delta?.content).toContain('line3')
    })

    it('returns null when only existing lines reordered (no truly new lines)', () => {
      const prev = 'line1\nline2'
      const curr = 'line2\nline1' // same lines, different order — no new lines
      const delta = plugin.computeDelta(prev, curr)
      expect(delta).toBeNull()
    })
  })

  it('has no key aliases', () => {
    expect(Object.keys(plugin.keyAliases)).toHaveLength(0)
  })
})
