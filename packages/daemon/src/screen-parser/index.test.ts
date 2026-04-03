import { describe, expect, it } from 'vitest'
import { parseScreen } from './index.js'
import { GenericPlugin } from '../plugins/builtin/generic.js'
import { ClaudeCodePlugin } from '../plugins/builtin/claude-code.js'

describe('parseScreen', () => {
  describe('with GenericPlugin', () => {
    const plugin = new GenericPlugin()

    it('strips ANSI codes', () => {
      const raw = '\x1b[32mHello\x1b[0m\nWorld'
      const { clean } = parseScreen(raw, plugin)
      expect(clean).not.toContain('\x1b')
      expect(clean).toContain('Hello')
    })

    it('trims trailing blank lines', () => {
      const raw = 'line1\nline2\n\n\n'
      const { lines } = parseScreen(raw, plugin)
      expect(lines[lines.length - 1]).not.toBe('')
    })

    it('preserves raw content on the result', () => {
      const raw = 'raw content'
      const { raw: returned } = parseScreen(raw, plugin)
      expect(returned).toBe(raw)
    })
  })

  describe('with ClaudeCodePlugin', () => {
    const plugin = new ClaudeCodePlugin()

    it('strips shell prompt from the end', () => {
      const raw = 'Claude output\n$ '
      const { clean } = parseScreen(raw, plugin)
      expect(clean).not.toMatch(/\$\s*$/)
      expect(clean).toContain('Claude output')
    })

    it('strips ANSI and extracts meaningful content', () => {
      const raw = '\x1b[33m◆ Do you want to apply?\x1b[0m\n$ '
      const { clean } = parseScreen(raw, plugin)
      expect(clean).toContain('◆ Do you want to apply?')
      expect(clean).not.toContain('\x1b')
    })
  })
})
