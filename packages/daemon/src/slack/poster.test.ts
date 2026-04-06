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

  describe('error handling', () => {
    it('propagates error when chat.postMessage rejects', async () => {
      vi.mocked(client.chat.postMessage).mockRejectedValueOnce(new Error('channel_not_found'))
      await expect(poster.post('hello')).rejects.toThrow('channel_not_found')
    })

    it('propagates error when postToThread rejects', async () => {
      vi.mocked(client.chat.postMessage).mockRejectedValueOnce(new Error('invalid_auth'))
      await expect(poster.postToThread('999.000', 'reply')).rejects.toThrow('invalid_auth')
    })

    it('propagates error when postError rejects', async () => {
      vi.mocked(client.chat.postMessage).mockRejectedValueOnce(new Error('rate_limited'))
      await expect(poster.postError('oops')).rejects.toThrow('rate_limited')
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

  describe('postApprovalButtons', () => {
    it('posts message with action blocks containing buttons', async () => {
      await poster.postApprovalButtons('thread.1', 'Waiting', 'pane:1', [
        { label: 'Accept', key: 'Enter', style: 'primary' },
        { label: 'Reject', key: 'Escape', style: 'danger' },
      ])
      const call = vi.mocked(client.chat.postMessage).mock.calls[0]![0]
      expect(call.thread_ts).toBe('thread.1')
      expect(call.blocks).toBeDefined()
      const actions = (call.blocks as any[]).find((b: any) => b.type === 'actions')
      expect(actions.elements).toHaveLength(2)
      expect(actions.elements[0].action_id).toBe('perch_key:pane:1:Enter')
      expect(actions.elements[1].style).toBe('danger')
    })
  })

  describe('postChoiceButtons', () => {
    it('posts choice buttons with correct action_id format', async () => {
      await poster.postChoiceButtons('thread.2', 'Pick one', 'pane:2', [
        { label: 'Option A', index: 0 },
        { label: 'Option B', index: 1 },
      ])
      const call = vi.mocked(client.chat.postMessage).mock.calls[0]![0]
      const actions = (call.blocks as any[]).find((b: any) => b.type === 'actions')
      expect(actions.elements[0].action_id).toBe('perch_key:pane:2:choice:0')
      expect(actions.elements[1].action_id).toBe('perch_key:pane:2:choice:1')
    })
  })

  describe('clearButtons', () => {
    it('replaces buttons with text-only section', async () => {
      ;(client.chat as any).update = vi.fn().mockResolvedValue({ ok: true })
      await poster.clearButtons('msg.1', ':white_check_mark: Done')
      const call = (client.chat as any).update.mock.calls[0]![0]
      expect(call.ts).toBe('msg.1')
      expect(call.blocks).toHaveLength(1)
      expect(call.blocks[0].type).toBe('section')
    })
  })

  describe('threadPermalink', () => {
    it('returns permalink from readClient', async () => {
      const url = await poster.threadPermalink('msg.2')
      expect(url).toBe('https://slack.com/p/123')
      expect(readClient.chat.getPermalink).toHaveBeenCalledWith({
        channel: 'C0TEST',
        message_ts: 'msg.2',
      })
    })
  })

  describe('addReaction', () => {
    it('calls reactions.add', async () => {
      ;(client as any).reactions = { add: vi.fn().mockResolvedValue({ ok: true }) }
      await poster.addReaction('msg.3', 'eyes')
      expect((client as any).reactions.add).toHaveBeenCalledWith({
        channel: 'C0TEST', timestamp: 'msg.3', name: 'eyes',
      })
    })

    it('silently ignores already_reacted error', async () => {
      ;(client as any).reactions = { add: vi.fn().mockRejectedValue({ data: { error: 'already_reacted' } }) }
      await expect(poster.addReaction('msg.3', 'eyes')).resolves.toBeUndefined()
    })
  })

  describe('removeReaction', () => {
    it('calls reactions.remove', async () => {
      ;(client as any).reactions = { remove: vi.fn().mockResolvedValue({ ok: true }) }
      await poster.removeReaction('msg.4', 'thinking_face')
      expect((client as any).reactions.remove).toHaveBeenCalledWith({
        channel: 'C0TEST', timestamp: 'msg.4', name: 'thinking_face',
      })
    })

    it('silently ignores no_reaction error', async () => {
      ;(client as any).reactions = { remove: vi.fn().mockRejectedValue({ data: { error: 'no_reaction' } }) }
      await expect(poster.removeReaction('msg.4', 'eyes')).resolves.toBeUndefined()
    })
  })

  describe('setTypingStatus / clearTypingStatus', () => {
    it('calls assistant.threads.setStatus (silent on error)', async () => {
      // No assistant scope — should not throw
      await expect(poster.setTypingStatus('thread.3', 'is thinking...')).resolves.toBeUndefined()
      await expect(poster.clearTypingStatus('thread.3')).resolves.toBeUndefined()
    })
  })

  describe('postSnippetToThread', () => {
    it('falls back to chunked text when files:write missing', async () => {
      ;(client as any).filesUploadV2 = vi.fn().mockRejectedValue({ data: { error: 'missing_scope' } })
      await poster.postSnippetToThread('thread.4', 'Short content', 'title.md')
      // Should fall back to postToThread
      expect(client.chat.postMessage).toHaveBeenCalled()
      const text = vi.mocked(client.chat.postMessage).mock.calls[0]![0].text as string
      expect(text).toContain('Short content')
    })

    it('uses filesUploadV2 when available', async () => {
      ;(client as any).filesUploadV2 = vi.fn().mockResolvedValue({ ok: true })
      await poster.postSnippetToThread('thread.5', 'File content', 'code.ts')
      expect((client as any).filesUploadV2).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'File content', filename: 'code.ts' }),
      )
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
