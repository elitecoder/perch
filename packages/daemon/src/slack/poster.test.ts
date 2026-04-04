import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Poster } from './poster.js'
import type { WebClient } from '@slack/web-api'

function makeClient() {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ts: '111.222', ok: true }),
    },
  } as unknown as WebClient
}

describe('Poster', () => {
  let client: WebClient
  let poster: Poster

  beforeEach(() => {
    client = makeClient()
    poster = new Poster(client, 'C0TEST')
  })

  describe('post', () => {
    it('calls chat.postMessage with channel and text', async () => {
      await poster.post('hello')
      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'C0TEST', text: 'hello' })
      )
    })

    it('returns the ts from the response', async () => {
      const { ts } = await poster.post('hello')
      expect(ts).toBe('111.222')
    })

    it('truncates text longer than 3000 chars', async () => {
      const long = 'x'.repeat(4000)
      await poster.post(long)
      const call = vi.mocked(client.chat.postMessage).mock.calls[0]![0]
      expect((call.text as string).length).toBeLessThanOrEqual(3003) // 3000 + "..."
    })
  })

  describe('postToThread', () => {
    it('includes thread_ts', async () => {
      await poster.postToThread('999.000', 'reply')
      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ thread_ts: '999.000', text: 'reply' })
      )
    })
  })

  describe('postError', () => {
    it('prefixes with :x: emoji', async () => {
      await poster.postError('something failed')
      const call = vi.mocked(client.chat.postMessage).mock.calls[0]![0]
      expect(call.text as string).toContain(':x:')
      expect(call.text as string).toContain('something failed')
    })
  })

  describe('makeThreadPostFn', () => {
    it('returns a function that posts to the thread', async () => {
      const fn = poster.makeThreadPostFn('ts123')
      await fn('msg')
      expect(client.chat.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ thread_ts: 'ts123', text: 'msg' })
      )
    })
  })

  describe('postCode', () => {
    it('wraps text in a code block', async () => {
      await poster.postCode('console.log("hi")')
      const call = vi.mocked(client.chat.postMessage).mock.calls[0]![0]
      expect(call.text).toBe('```\nconsole.log("hi")\n```')
    })
  })

  describe('update', () => {
    it('calls chat.update with channel, ts, and truncated text', async () => {
      ;(client.chat as any).update = vi.fn().mockResolvedValue({ ok: true })
      await poster.update('111.222', 'updated text')
      expect((client.chat as any).update).toHaveBeenCalledWith({
        channel: 'C0TEST',
        ts: '111.222',
        text: 'updated text',
      })
    })
  })

  describe('truncation boundary', () => {
    it('does not truncate at exactly 3000 chars', async () => {
      const exact = 'x'.repeat(3000)
      await poster.post(exact)
      const call = vi.mocked(client.chat.postMessage).mock.calls[0]![0]
      expect(call.text).toBe(exact)
    })

    it('truncates at 3001 chars', async () => {
      const over = 'x'.repeat(3001)
      await poster.post(over)
      const call = vi.mocked(client.chat.postMessage).mock.calls[0]![0]
      expect((call.text as string).endsWith('...')).toBe(true)
      expect((call.text as string).length).toBe(3000)
    })
  })

  describe('makeLiveView', () => {
    it('returns a LiveView instance', () => {
      const liveView = poster.makeLiveView('thread-ts-1')
      expect(liveView).toBeDefined()
      expect(typeof liveView.update).toBe('function')
      expect(typeof liveView.transition).toBe('function')
    })
  })
})

describe('LiveView', () => {
  let client: WebClient
  let poster: Poster

  beforeEach(() => {
    client = makeClient()
    ;(client.chat as any).update = vi.fn().mockResolvedValue({ ok: true })
    poster = new Poster(client, 'C0TEST')
  })

  it('posts a new thread message on first update (no existing _liveTs)', async () => {
    const liveView = poster.makeLiveView('thread-ts-1')
    await liveView.update('first update')
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: 'thread-ts-1', text: 'first update' })
    )
  })

  it('edits the existing message on subsequent updates', async () => {
    const liveView = poster.makeLiveView('thread-ts-1')
    await liveView.update('first')
    const postedTs = '111.222' // from mock

    await liveView.update('second')
    expect((client.chat as any).update).toHaveBeenCalledWith({
      channel: 'C0TEST',
      ts: postedTs,
      text: 'second',
    })
  })

  it('falls back to new post if chat.update fails (message deleted)', async () => {
    const liveView = poster.makeLiveView('thread-ts-1')
    await liveView.update('first')

    ;(client.chat as any).update.mockRejectedValueOnce(new Error('message_not_found'))
    await liveView.update('recovery')

    // Should have posted a new message after failed update
    const postCalls = vi.mocked(client.chat.postMessage).mock.calls
    expect(postCalls).toHaveLength(2) // first + recovery
    expect(postCalls[1]![0]).toEqual(
      expect.objectContaining({ thread_ts: 'thread-ts-1', text: 'recovery' })
    )
  })

  it('transition always posts a new message (generates notification)', async () => {
    const liveView = poster.makeLiveView('thread-ts-1')
    await liveView.update('initial')
    vi.mocked(client.chat.postMessage).mockClear()

    await liveView.transition('thinking → waiting')
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ thread_ts: 'thread-ts-1', text: 'thinking → waiting' })
    )
  })

  it('subsequent updates after transition edit the transition message', async () => {
    const liveView = poster.makeLiveView('thread-ts-1')
    await liveView.transition('state change')
    const transitionTs = '111.222'

    await liveView.update('delta after transition')
    expect((client.chat as any).update).toHaveBeenCalledWith({
      channel: 'C0TEST',
      ts: transitionTs,
      text: 'delta after transition',
    })
  })

  it('truncates long text in updates', async () => {
    const liveView = poster.makeLiveView('thread-ts-1')
    await liveView.update('first')

    const long = 'x'.repeat(4000)
    await liveView.update(long)
    const call = (client.chat as any).update.mock.calls[0]
    expect(call[0].text.length).toBeLessThanOrEqual(3000)
  })
})
