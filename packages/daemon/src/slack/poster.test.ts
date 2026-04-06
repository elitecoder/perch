import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { Poster, ConversationalView, MAX_POST_LENGTH, MAX_UPDATE_LENGTH } from './poster.js'
import type { WebClient } from '@slack/web-api'

function makeClient() {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ts: '111.222', ok: true }),
    },
  } as unknown as WebClient
}

function makeReadClient() {
  return {
    chat: {
      getPermalink: vi.fn().mockResolvedValue({ permalink: 'https://slack.com/p/123', ok: true }),
    },
    conversations: {
      replies: vi.fn().mockResolvedValue({ messages: [], ok: true }),
    },
  } as unknown as WebClient
}

describe('Poster', () => {
  let client: WebClient
  let readClient: WebClient
  let poster: Poster

  beforeEach(() => {
    client = makeClient()
    readClient = makeReadClient()
    poster = new Poster(client, readClient, 'C0TEST')
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

    it('truncates text longer than MAX_POST_LENGTH', async () => {
      const long = 'x'.repeat(MAX_POST_LENGTH + 1000)
      await poster.post(long)
      const call = vi.mocked(client.chat.postMessage).mock.calls[0]![0]
      expect((call.text as string).length).toBeLessThanOrEqual(MAX_POST_LENGTH)
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
    it('calls chat.update with higher limit than postMessage', async () => {
      ;(client.chat as any).update = vi.fn().mockResolvedValue({ ok: true })
      // 3500 chars: exceeds MAX_POST_LENGTH (3000) but within MAX_UPDATE_LENGTH (4000)
      const long = 'x'.repeat(3500)
      await poster.update('111.222', long)
      const call = (client.chat as any).update.mock.calls[0]![0]
      expect(call.text).toBe(long)
    })
  })

  describe('truncation boundary', () => {
    it('does not truncate at exactly MAX_POST_LENGTH', async () => {
      const exact = 'x'.repeat(MAX_POST_LENGTH)
      await poster.post(exact)
      const call = vi.mocked(client.chat.postMessage).mock.calls[0]![0]
      expect(call.text).toBe(exact)
    })

    it('truncates at MAX_POST_LENGTH + 1', async () => {
      const over = 'x'.repeat(MAX_POST_LENGTH + 1)
      await poster.post(over)
      const call = vi.mocked(client.chat.postMessage).mock.calls[0]![0]
      expect((call.text as string).endsWith('...')).toBe(true)
      expect((call.text as string).length).toBe(MAX_POST_LENGTH)
    })
  })

})

describe('ConversationalView', () => {
  let client: WebClient
  let readClient: WebClient
  let poster: Poster
  let view: ConversationalView
  let tsCtr: number

  beforeEach(() => {
    vi.useFakeTimers()
    tsCtr = 0
    client = {
      chat: {
        postMessage: vi.fn().mockImplementation(() =>
          Promise.resolve({ ts: String(++tsCtr) + '.000', ok: true })),
        update: vi.fn().mockResolvedValue({ ok: true }),
      },
    } as unknown as WebClient
    readClient = {
      conversations: {
        replies: vi.fn().mockResolvedValue({ messages: [], ok: true }),
      },
    } as unknown as WebClient
    poster = new Poster(client, readClient, 'C0TEST')
    view = poster.makeConversationalView('thread.ts')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('updateStatus — two-tier throttling', () => {
    it('edits status in place with 1500ms throttle', async () => {
      await view.updateStatus('tool 1')
      expect(client.chat.postMessage).toHaveBeenCalledTimes(1)

      // Advance past the 1500ms status throttle
      for (let i = 2; i <= 5; i++) {
        vi.advanceTimersByTime(ConversationalView.STATUS_EDIT_INTERVAL_MS + 1)
        await view.updateStatus(`tool ${i}`)
      }
      expect(client.chat.postMessage).toHaveBeenCalledTimes(1)
      expect((client.chat as any).update).toHaveBeenCalledTimes(4)
    })

    it('buffers status edits within 1500ms throttle window', async () => {
      await view.updateStatus('tool 1')
      // Within throttle window — should buffer
      vi.advanceTimersByTime(500)
      await view.updateStatus('tool 2')
      expect((client.chat as any).update).toHaveBeenCalledTimes(0)
    })

    it('flush sends buffered status text', async () => {
      await view.updateStatus('tool 1')
      await view.updateStatus('buffered tool')
      expect((client.chat as any).update).toHaveBeenCalledTimes(0)

      await view.flush()
      expect((client.chat as any).update).toHaveBeenCalledTimes(1)
      expect((client.chat as any).update).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'buffered tool' }),
      )
    })

    it('uses MAX_UPDATE_LENGTH for status edits', async () => {
      await view.updateStatus('tool 1')
      vi.advanceTimersByTime(ConversationalView.STATUS_EDIT_INTERVAL_MS + 1)
      // 3500 chars: exceeds MAX_POST_LENGTH (3000) but within MAX_UPDATE_LENGTH (4000)
      const long = 'x'.repeat(3500)
      await view.updateStatus(long)
      const call = (client.chat as any).update.mock.calls[0]![0]
      expect(call.text).toBe(long)
    })
  })

  describe('updateResponse — throttling + buffer threshold', () => {
    it('creates response message on first call', async () => {
      await view.postResponse('initial')
      expect(client.chat.postMessage).toHaveBeenCalledTimes(1)

      // updateResponse with enough chars should edit
      vi.advanceTimersByTime(ConversationalView.RESPONSE_EDIT_INTERVAL_MS + 1)
      await view.updateResponse('initial plus enough new text to pass threshold!!')
      expect((client.chat as any).update).toHaveBeenCalledTimes(1)
    })

    it('buffers response edits within 300ms throttle', async () => {
      await view.postResponse('start')
      // Immediately call — within throttle
      await view.updateResponse('start plus a lot of new content here')
      expect((client.chat as any).update).toHaveBeenCalledTimes(0)
    })

    it('skips edit when delta < BUFFER_THRESHOLD chars', async () => {
      await view.postResponse('start')
      vi.advanceTimersByTime(ConversationalView.RESPONSE_EDIT_INTERVAL_MS + 1)
      // Delta is only 3 chars — below threshold
      await view.updateResponse('start...')
      expect((client.chat as any).update).toHaveBeenCalledTimes(0)
    })

    it('flush sends buffered response regardless of threshold', async () => {
      await view.postResponse('start')
      await view.updateResponse('start...')
      await view.flush()
      expect((client.chat as any).update).toHaveBeenCalledTimes(1)
      expect((client.chat as any).update).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'start...' }),
      )
    })
  })

  describe('flood control', () => {
    it('disables edits after first failure', async () => {
      await view.updateStatus('tool 1')
      // Make edit fail
      ;(client.chat as any).update.mockRejectedValueOnce(new Error('message_not_found'))
      vi.advanceTimersByTime(ConversationalView.STATUS_EDIT_INTERVAL_MS + 1)
      await view.updateStatus('tool 2')
      // Should have fallen through to postMessage
      expect(client.chat.postMessage).toHaveBeenCalledTimes(2)

      // Subsequent updates should go straight to postMessage (no edit attempt)
      vi.advanceTimersByTime(ConversationalView.STATUS_EDIT_INTERVAL_MS + 1)
      await view.updateStatus('tool 3')
      expect(client.chat.postMessage).toHaveBeenCalledTimes(3)
      // Only 1 edit was ever attempted
      expect((client.chat as any).update).toHaveBeenCalledTimes(1)
    })
  })

  describe('readback verification (disabled)', () => {
    it('does not post corrections — readback disabled due to Slack text normalization', async () => {
      await view.postResponse('hello')
      await view.postResponse('world')
      // Only 2 postToThread calls — no readback, no corrections
      expect(client.chat.postMessage).toHaveBeenCalledTimes(2)
    })
  })
})
