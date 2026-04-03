import { describe, expect, it } from 'vitest'
import { StateMachine } from './state-machine.js'
import type { ToolState } from '../plugins/interface.js'

describe('StateMachine', () => {
  it('starts in idle by default', () => {
    const sm = new StateMachine()
    expect(sm.current).toBe('idle')
  })

  it('accepts a custom initial state', () => {
    const sm = new StateMachine('thinking')
    expect(sm.current).toBe('thinking')
  })

  it('returns null when state does not change', () => {
    const sm = new StateMachine('idle')
    expect(sm.update('idle')).toBeNull()
  })

  it('returns a transition when state changes', () => {
    const sm = new StateMachine('idle')
    const t = sm.update('thinking')
    expect(t).toEqual({ from: 'idle', to: 'thinking' })
    expect(sm.current).toBe('thinking')
  })

  it('tracks rapid state flips correctly', () => {
    const sm = new StateMachine('idle')
    sm.update('thinking')
    sm.update('waiting')
    const t = sm.update('idle')
    expect(t).toEqual({ from: 'waiting', to: 'idle' })
    expect(sm.current).toBe('idle')
  })

  it('handles repeated same state transitions gracefully', () => {
    const sm = new StateMachine('thinking')
    expect(sm.update('thinking')).toBeNull()
    expect(sm.update('thinking')).toBeNull()
    expect(sm.current).toBe('thinking')
  })

  describe('shouldNotify', () => {
    const transitions: Array<[ToolState, ToolState]> = [
      ['thinking', 'waiting'],
      ['thinking', 'idle'],
    ]

    it('returns true for a listed transition', () => {
      expect(StateMachine.shouldNotify({ from: 'thinking', to: 'waiting' }, transitions)).toBe(true)
    })

    it('returns false for an unlisted transition', () => {
      expect(StateMachine.shouldNotify({ from: 'idle', to: 'error' }, transitions)).toBe(false)
    })

    it('returns false when notifyOnTransitions is empty', () => {
      expect(StateMachine.shouldNotify({ from: 'thinking', to: 'waiting' }, [])).toBe(false)
    })

    it('is direction-sensitive (from/to order matters)', () => {
      // transitions only has thinking→waiting, not waiting→thinking
      expect(StateMachine.shouldNotify({ from: 'waiting', to: 'thinking' }, transitions)).toBe(false)
    })
  })
})
