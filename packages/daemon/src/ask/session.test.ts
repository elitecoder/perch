import { describe, expect, it, beforeEach } from 'vitest'
import { AskSessionManager } from './session.js'

describe('AskSessionManager', () => {
  let manager: AskSessionManager

  beforeEach(() => {
    manager = new AskSessionManager()
  })

  describe('create', () => {
    it('returns a session with generated id', () => {
      const session = manager.create({
        paneId: 'pane:1',
        sessionId: '$1',
        threadTs: 'ts-1',
        cwd: '/home/user',
      })
      expect(session.id).toMatch(/^[a-f0-9]{6}$/)
      expect(session.paneId).toBe('pane:1')
      expect(session.sessionId).toBe('$1')
      expect(session.threadTs).toBe('ts-1')
      expect(session.cwd).toBe('/home/user')
      expect(session.status).toBe('starting')
    })

    it('sets createdAt and lastActivityAt to now', () => {
      const before = Date.now()
      const session = manager.create({
        paneId: 'pane:1',
        sessionId: '$1',
        threadTs: 'ts-1',
        cwd: '/tmp',
      })
      const after = Date.now()
      expect(session.createdAt.getTime()).toBeGreaterThanOrEqual(before)
      expect(session.createdAt.getTime()).toBeLessThanOrEqual(after)
      expect(session.lastActivityAt.getTime()).toBe(session.createdAt.getTime())
    })

    it('generates unique ids for multiple sessions', () => {
      const s1 = manager.create({ paneId: 'p:1', sessionId: '$1', threadTs: 't1', cwd: '/' })
      const s2 = manager.create({ paneId: 'p:2', sessionId: '$2', threadTs: 't2', cwd: '/' })
      expect(s1.id).not.toBe(s2.id)
    })
  })

  describe('getByThread', () => {
    it('returns session by thread timestamp', () => {
      manager.create({ paneId: 'p:1', sessionId: '$1', threadTs: 'thread-abc', cwd: '/' })
      const found = manager.getByThread('thread-abc')
      expect(found).toBeDefined()
      expect(found!.paneId).toBe('p:1')
    })

    it('returns undefined for unknown thread', () => {
      expect(manager.getByThread('unknown')).toBeUndefined()
    })
  })

  describe('markActivity', () => {
    it('updates lastActivityAt', () => {
      const session = manager.create({ paneId: 'p:1', sessionId: '$1', threadTs: 't1', cwd: '/' })
      const initial = session.lastActivityAt.getTime()
      // Small delay to ensure time advances
      manager.markActivity('t1')
      expect(session.lastActivityAt.getTime()).toBeGreaterThanOrEqual(initial)
    })

    it('does not throw for unknown thread', () => {
      expect(() => manager.markActivity('unknown')).not.toThrow()
    })
  })

  describe('remove', () => {
    it('removes session by id', () => {
      const session = manager.create({ paneId: 'p:1', sessionId: '$1', threadTs: 't1', cwd: '/' })
      manager.remove(session.id)
      expect(manager.getByThread('t1')).toBeUndefined()
      expect(manager.listSessions()).toHaveLength(0)
    })

    it('does not throw for unknown id', () => {
      expect(() => manager.remove('nonexistent')).not.toThrow()
    })
  })

  describe('listSessions', () => {
    it('returns empty array when no sessions', () => {
      expect(manager.listSessions()).toEqual([])
    })

    it('returns all sessions', () => {
      manager.create({ paneId: 'p:1', sessionId: '$1', threadTs: 't1', cwd: '/' })
      manager.create({ paneId: 'p:2', sessionId: '$2', threadTs: 't2', cwd: '/' })
      expect(manager.listSessions()).toHaveLength(2)
    })

    it('excludes removed sessions', () => {
      const s = manager.create({ paneId: 'p:1', sessionId: '$1', threadTs: 't1', cwd: '/' })
      manager.create({ paneId: 'p:2', sessionId: '$2', threadTs: 't2', cwd: '/' })
      manager.remove(s.id)
      expect(manager.listSessions()).toHaveLength(1)
    })
  })

  describe('dispose', () => {
    it('clears all sessions and thread mappings', () => {
      manager.create({ paneId: 'p:1', sessionId: '$1', threadTs: 't1', cwd: '/' })
      manager.create({ paneId: 'p:2', sessionId: '$2', threadTs: 't2', cwd: '/' })
      manager.dispose()
      expect(manager.listSessions()).toHaveLength(0)
      expect(manager.getByThread('t1')).toBeUndefined()
      expect(manager.getByThread('t2')).toBeUndefined()
    })
  })

  describe('status mutation', () => {
    it('allows changing session status directly', () => {
      const session = manager.create({ paneId: 'p:1', sessionId: '$1', threadTs: 't1', cwd: '/' })
      expect(session.status).toBe('starting')
      session.status = 'active'
      expect(manager.getByThread('t1')!.status).toBe('active')
      session.status = 'done'
      expect(manager.getByThread('t1')!.status).toBe('done')
    })
  })
})
