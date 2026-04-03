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
})
