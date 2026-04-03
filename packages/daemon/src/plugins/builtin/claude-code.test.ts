import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it, beforeEach } from 'vitest'
import { ClaudeCodePlugin } from './claude-code.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, '../../__fixtures__')

function fixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf-8')
}

describe('ClaudeCodePlugin', () => {
  let plugin: ClaudeCodePlugin

  beforeEach(() => {
    plugin = new ClaudeCodePlugin()
  })

  describe('detect', () => {
    it('detects Claude Code from waiting marker ◆', () => {
      expect(plugin.detect(fixture('tmux-capture-claude-code-waiting.txt'))).toBe(true)
    })

    it('detects Claude Code from the word Claude', () => {
      expect(plugin.detect('Claude is analyzing...')).toBe(true)
    })

    it('does not detect in plain bash output', () => {
      expect(plugin.detect(fixture('tmux-capture-generic.txt'))).toBe(false)
    })
  })

  describe('parseState', () => {
    it('returns "waiting" when ◆ prompt is present', () => {
      expect(plugin.parseState(fixture('tmux-capture-claude-code-waiting.txt'))).toBe('waiting')
    })

    it('returns "idle" when shell prompt is visible after ✓', () => {
      expect(plugin.parseState(fixture('tmux-capture-claude-idle.txt'))).toBe('idle')
    })

    it('returns "thinking" when spinner char is present', () => {
      expect(plugin.parseState(fixture('tmux-capture-claude-code-thinking.txt'))).toBe('thinking')
    })

    it('returns "error" when ✗ is present', () => {
      expect(plugin.parseState('✗ Error: something went wrong\n$ ')).toBe('error')
    })
  })

  describe('extractResponse', () => {
    it('strips ANSI codes', () => {
      const withAnsi = '\x1b[32mHello world\x1b[0m'
      expect(plugin.extractResponse(withAnsi)).toBe('Hello world')
    })

    it('trims trailing shell prompt line', () => {
      const content = 'Claude output here\n$ '
      expect(plugin.extractResponse(content)).toBe('Claude output here')
    })
  })

  describe('computeDelta', () => {
    it('returns null when content is unchanged', () => {
      const content = 'same content'
      expect(plugin.computeDelta(content, content)).toBeNull()
    })

    it('returns transition delta when state changes', () => {
      const prev = fixture('tmux-capture-claude-code-thinking.txt')
      const curr = fixture('tmux-capture-claude-code-waiting.txt')
      const delta = plugin.computeDelta(prev, curr)
      expect(delta).not.toBeNull()
      expect(delta?.type).toBe('transition')
      expect(delta?.fromState).toBe('thinking')
      expect(delta?.toState).toBe('waiting')
    })

    it('returns append delta when content grows without state change', () => {
      const prev = 'Reading file...'
      const curr = 'Reading file...\nProcessing output...'
      const delta = plugin.computeDelta(prev, curr)
      expect(delta?.type).toBe('append')
      expect(delta?.content).toContain('Processing output')
    })

    it('suppresses blank-only deltas', () => {
      const prev = 'some content'
      const curr = 'some content\n\n   \n'
      const delta = plugin.computeDelta(prev, curr)
      // blank appended content should be suppressed
      expect(delta).toBeNull()
    })
  })

  describe('keyAliases', () => {
    it('has accept mapped to y', () => {
      expect(plugin.keyAliases.accept).toBe('y')
    })

    it('has interrupt mapped to C-c', () => {
      expect(plugin.keyAliases.interrupt).toBe('C-c')
    })
  })

  describe('watch config', () => {
    it('has a reasonable poll interval', () => {
      expect(plugin.watch.pollIntervalMs).toBeLessThanOrEqual(2000)
    })

    it('notifies on thinking→waiting transitions', () => {
      const transitions = plugin.watch.notifyOnTransitions
      const hasThinkingToWaiting = transitions.some(
        ([from, to]) => from === 'thinking' && to === 'waiting'
      )
      expect(hasThinkingToWaiting).toBe(true)
    })
  })
})
