import { randomBytes } from 'crypto'

export interface AskSession {
  id: string
  paneId: string
  sessionId: string
  threadTs: string
  cwd: string
  createdAt: Date
  lastActivityAt: Date
  status: 'starting' | 'active' | 'done'
}

function shortId(): string {
  return randomBytes(3).toString('hex') // e.g. "a1b2c3"
}

export class AskSessionManager {
  private _sessions = new Map<string, AskSession>()
  private _threadToSession = new Map<string, string>()

  create(opts: {
    paneId: string
    sessionId: string
    threadTs: string
    cwd: string
  }): AskSession {
    const id = shortId()
    const now = new Date()
    const session: AskSession = {
      id,
      paneId: opts.paneId,
      sessionId: opts.sessionId,
      threadTs: opts.threadTs,
      cwd: opts.cwd,
      createdAt: now,
      lastActivityAt: now,
      status: 'starting',
    }
    this._sessions.set(id, session)
    this._threadToSession.set(opts.threadTs, id)
    return session
  }

  getByThread(threadTs: string): AskSession | undefined {
    const id = this._threadToSession.get(threadTs)
    if (!id) return undefined
    return this._sessions.get(id)
  }

  markActivity(threadTs: string): void {
    const id = this._threadToSession.get(threadTs)
    if (!id) return
    const session = this._sessions.get(id)
    if (session) session.lastActivityAt = new Date()
  }

  remove(id: string): void {
    const session = this._sessions.get(id)
    if (!session) return
    this._threadToSession.delete(session.threadTs)
    this._sessions.delete(id)
  }

  listSessions(): AskSession[] {
    return [...this._sessions.values()]
  }

  dispose(): void {
    this._sessions.clear()
    this._threadToSession.clear()
  }
}
