import type { WebClient } from '@slack/web-api'

/** Conservative limit for chat.postMessage (safe for all contexts). */
export const MAX_POST_LENGTH = 3000
/** Higher limit for chat.update (Slack allows ~4000 for text field). */
export const MAX_UPDATE_LENGTH = 4000

function truncate(text: string, limit = MAX_POST_LENGTH): string {
  if (text.length <= limit) return text
  // Try to break at a newline to avoid cutting mid-code-block
  const region = text.slice(0, limit - 3)
  const lastNl = region.lastIndexOf('\n')
  const cutPoint = lastNl > limit * 0.6 ? lastNl : limit - 3
  // If we're inside an open code fence, close it
  const slice = text.slice(0, cutPoint)
  const fenceCount = (slice.match(/^```/gm) || []).length
  const suffix = fenceCount % 2 !== 0 ? '\n```\n...' : '...'
  return slice + suffix
}

/**
 * Split long text into chunks, preserving code fence boundaries.
 * When splitting inside a fenced code block, closes the fence before
 * the split and reopens it (with the language tag) in the next chunk.
 */
function splitContent(text: string, maxChunk: number): string[] {
  if (text.length <= maxChunk) return [text]

  const FENCE_CLOSE = '\n```'
  const chunks: string[] = []
  let remaining = text
  let carryLang: string | null = null

  while (remaining.length > 0) {
    const prefix = carryLang !== null ? `\`\`\`${carryLang}\n` : ''

    // Everything fits in one final chunk
    if (prefix.length + remaining.length <= maxChunk) {
      chunks.push(prefix + remaining)
      break
    }

    const headroom = Math.max(
      maxChunk - prefix.length - FENCE_CLOSE.length,
      maxChunk >> 1,
    )

    // Find split point (prefer newline, then space)
    const region = remaining.slice(0, headroom)
    let splitIdx = region.lastIndexOf('\n')
    if (splitIdx < headroom >> 1) splitIdx = region.lastIndexOf(' ')
    if (splitIdx < 1) splitIdx = headroom

    const chunkBody = remaining.slice(0, splitIdx)
    remaining = remaining.slice(splitIdx).replace(/^\n/, '')

    // Walk chunkBody to determine if we end inside an open code block
    let inCode = carryLang !== null
    let lang: string = carryLang ?? ''
    for (const line of chunkBody.split('\n')) {
      const stripped = line.trim()
      if (stripped.startsWith('```')) {
        if (inCode) {
          inCode = false
          lang = ''
        } else {
          inCode = true
          const tag = stripped.slice(3).trim()
          lang = tag ? tag.split(/\s/)[0]! : ''
        }
      }
    }

    let fullChunk = prefix + chunkBody
    if (inCode) {
      fullChunk += FENCE_CLOSE
      carryLang = lang
    } else {
      carryLang = null
    }

    chunks.push(fullChunk)
  }

  return chunks
}

export class Poster {
  constructor(
    readonly client: WebClient,
    readonly readClient: WebClient,
    readonly channelId: string,
  ) {}

  async post(text: string): Promise<{ ts: string }> {
    const res = await this.client.chat.postMessage({
      channel: this.channelId,
      text: truncate(text),
    })
    return { ts: res.ts as string }
  }

  async postToThread(threadTs: string, text: string): Promise<{ ts: string }> {
    const res = await this.client.chat.postMessage({
      channel: this.channelId,
      thread_ts: threadTs,
      text: truncate(text),
    })
    return { ts: res.ts as string }
  }

  async postCode(text: string): Promise<{ ts: string }> {
    return this.post('```\n' + truncate(text) + '\n```')
  }

  async postError(message: string): Promise<void> {
    await this.post(`:x: ${message}`)
  }

  async update(ts: string, text: string): Promise<void> {
    await this.client.chat.update({
      channel: this.channelId,
      ts,
      text: truncate(text, MAX_UPDATE_LENGTH),
    })
  }

  /** Post a message with interactive buttons to a thread. */
  async postApprovalButtons(
    threadTs: string,
    text: string,
    paneId: string,
    buttons: Array<{ label: string; key: string; style?: 'primary' | 'danger' }>,
  ): Promise<{ ts: string }> {
    const res = await this.client.chat.postMessage({
      channel: this.channelId,
      thread_ts: threadTs,
      text, // fallback for notifications
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text } },
        {
          type: 'actions',
          elements: buttons.map(b => ({
            type: 'button' as const,
            text: { type: 'plain_text' as const, text: b.label },
            action_id: `perch_key:${paneId}:${b.key}`,
            ...(b.style ? { style: b.style } : {}),
          })),
        },
      ],
    })
    return { ts: res.ts as string }
  }

  /** Remove buttons from a message (replace with text-only). */
  async clearButtons(ts: string, text: string): Promise<void> {
    await this.client.chat.update({
      channel: this.channelId,
      ts,
      text,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
    })
  }

  /** Get a permalink URL for a message. */
  async threadPermalink(ts: string): Promise<string> {
    const res = await this.readClient.chat.getPermalink({
      channel: this.channelId,
      message_ts: ts,
    })
    return res.permalink as string
  }

  /** Set the typing status in a thread (Slack AI agent feature). */
  async setTypingStatus(threadTs: string, status: string): Promise<void> {
    try {
      await (this.client as any).assistant.threads.setStatus({
        channel_id: this.channelId,
        thread_ts: threadTs,
        status,
      })
    } catch {
      // Silently ignore — assistant:write scope may not be available
    }
  }

  /** Clear the typing status in a thread. */
  async clearTypingStatus(threadTs: string): Promise<void> {
    try {
      await (this.client as any).assistant.threads.setStatus({
        channel_id: this.channelId,
        thread_ts: threadTs,
        status: '',
      })
    } catch {
      // Silently ignore
    }
  }

  /** Add an emoji reaction to a message. */
  async addReaction(ts: string, emoji: string): Promise<void> {
    try {
      await this.client.reactions.add({
        channel: this.channelId,
        timestamp: ts,
        name: emoji,
      })
    } catch (err) {
      const code = (err as any)?.data?.error
      // already_reacted is fine — the emoji is already showing
      if (code !== 'already_reacted') {
        console.error(`[poster] addReaction(${emoji}) failed:`, code ?? err)
      }
    }
  }

  /** Remove an emoji reaction from a message. */
  async removeReaction(ts: string, emoji: string): Promise<void> {
    try {
      await this.client.reactions.remove({
        channel: this.channelId,
        timestamp: ts,
        name: emoji,
      })
    } catch (err) {
      const code = (err as any)?.data?.error
      // no_reaction is fine — already removed
      if (code !== 'no_reaction') {
        console.error(`[poster] removeReaction(${emoji}) failed:`, code ?? err)
      }
    }
  }

  /** Build a postFn suitable for WatcherManager that posts to a thread */
  makeThreadPostFn(threadTs: string): (msg: string) => Promise<void> {
    return (msg: string) => this.postToThread(threadTs, msg).then(() => undefined)
  }

  /**
   * Post long content to a thread as a file attachment.
   * Falls back to chunked text messages if files:write scope is missing.
   */
  async postSnippetToThread(threadTs: string, content: string, title?: string): Promise<void> {
    try {
      await this.client.filesUploadV2({
        channel_id: this.channelId,
        thread_ts: threadTs,
        content,
        filename: title ?? 'response.md',
        title: title ?? 'Claude response',
      })
      return
    } catch (err: unknown) {
      const slackErr = err as { data?: { error?: string } }
      if (slackErr.data?.error !== 'missing_scope') throw err
      // Fall back to chunked text messages
    }
    const header = title ? `*${title}*\n` : ''
    const maxChunk = MAX_POST_LENGTH - header.length - 10
    const chunks = splitContent(content, maxChunk)
    for (let i = 0; i < chunks.length; i++) {
      const prefix = i === 0 ? header : ''
      const suffix = chunks.length > 1 ? `\n_— part ${i + 1}/${chunks.length}_` : ''
      await this.postToThread(threadTs, prefix + chunks[i] + suffix)
    }
  }

  /**
   * Build a ConversationalView: collapses tool activity into an editable status
   * message, posts final Claude responses as new thread messages for notifications.
   */
  makeConversationalView(threadTs: string): ConversationalView {
    return new ConversationalView(this, threadTs)
  }
}

/**
 * Conversational Slack view for JSONL-based transcript monitoring.
 *
 * - Tool activity (update_status) edits a single "status" message in place.
 * - Final Claude responses (post_response) post a new thread message → notification.
 * - User messages (post_user) post a new brief thread message.
 */
export class ConversationalView {
  private _statusTs: string | null = null
  private _statusLineCount = 0
  private _lastStatusEditAt = 0
  private _pendingStatusText: string | null = null
  private _responseTs: string | null = null
  private _lastResponseText: string | null = null
  private _lastResponseEditAt = 0
  private _pendingResponseText: string | null = null
  private _lastSentResponseLen = 0
  /** Once an edit fails, all future updates post new messages. */
  private _editDisabled = false

  /** Milliseconds between tool-progress edits (Hermes: 1.5s). */
  static readonly STATUS_EDIT_INTERVAL_MS = 1500
  /** Milliseconds between streaming-text edits (Hermes: 0.3s). */
  static readonly RESPONSE_EDIT_INTERVAL_MS = 300
  /** Minimum new chars before bothering to edit (Hermes: 40). */
  static readonly BUFFER_THRESHOLD = 40

  constructor(
    private readonly poster: Poster,
    private readonly threadTs: string,
  ) {}

  /** Flush any buffered status and response text (call before state resets). */
  async flush(): Promise<void> {
    if (this._pendingStatusText && this._statusTs && !this._editDisabled) {
      try {
        await this.poster.client.chat.update({
          channel: this.poster.channelId,
          ts: this._statusTs,
          text: this._pendingStatusText,
        })
        this._lastStatusEditAt = Date.now()
        this._statusLineCount = this._pendingStatusText.split('\n').length
      } catch {
        this._editDisabled = true
      }
      this._pendingStatusText = null
    }
    if (this._pendingResponseText && this._responseTs && !this._editDisabled) {
      try {
        await this.poster.client.chat.update({
          channel: this.poster.channelId,
          ts: this._responseTs,
          text: this._pendingResponseText,
        })
        this._lastResponseEditAt = Date.now()
        this._lastSentResponseLen = this._pendingResponseText.length
      } catch {
        this._editDisabled = true
      }
      this._pendingResponseText = null
    }
  }

  /** Edit the status message in place (tool activity, partial text). */
  async updateStatus(text: string): Promise<void> {
    if (this._statusTs && !this._editDisabled) {
      const now = Date.now()
      if (now - this._lastStatusEditAt < ConversationalView.STATUS_EDIT_INTERVAL_MS) {
        this._pendingStatusText = text
        return
      }
      try {
        await this.poster.client.chat.update({
          channel: this.poster.channelId,
          ts: this._statusTs,
          text,
        })
        this._lastStatusEditAt = now
        this._pendingStatusText = null
        this._statusLineCount = text.split('\n').length
        return
      } catch {
        this._editDisabled = true
        // fall through to post new
      }
    }
    // Strip lines already shown in the previous status message
    const lines = text.split('\n')
    const newText = this._statusLineCount > 0 ? lines.slice(this._statusLineCount).join('\n') : text
    const { ts } = await this.poster.postToThread(this.threadTs, newText || text)
    this._statusTs = ts
    this._lastStatusEditAt = Date.now()
    this._pendingStatusText = null
    this._statusLineCount = lines.length
  }

  /**
   * Verify the last response edit actually applied; post correction if not.
   * Disabled: Slack's mrkdwn processing can alter stored text (e.g., link
   * unfurling, entity encoding), causing false mismatches that spam the thread.
   */
  private async _verifyLastResponse(): Promise<void> {
    // no-op — readback comparison is unreliable due to Slack text normalization
  }

  /** Post a new thread message for a Claude response chunk (first chunk of a turn). */
  async postResponse(text: string): Promise<void> {
    await this.flush()
    await this._verifyLastResponse()

    if (text.length > MAX_POST_LENGTH) {
      // Long response — split into chunks so nothing is truncated
      await this.poster.postSnippetToThread(this.threadTs, text)
      this._responseTs = null
    } else {
      const { ts } = await this.poster.postToThread(this.threadTs, text)
      this._responseTs = ts
    }
    this._lastResponseText = text
    this._lastSentResponseLen = 0
    this._statusTs = null
    this._statusLineCount = 0
  }

  /** Edit the current response message in place (subsequent streaming chunks). */
  async updateResponse(text: string): Promise<void> {
    this._lastResponseText = text

    // If text exceeds edit limit, stop editing and post new
    if (text.length > MAX_UPDATE_LENGTH) {
      this._responseTs = null
      this._pendingResponseText = null
      const { ts } = await this.poster.postToThread(this.threadTs, text)
      this._responseTs = ts
      this._lastSentResponseLen = text.length
      return
    }

    if (this._responseTs && !this._editDisabled) {
      const now = Date.now()
      // Throttle: skip if too soon since last edit
      if (now - this._lastResponseEditAt < ConversationalView.RESPONSE_EDIT_INTERVAL_MS) {
        this._pendingResponseText = text
        return
      }
      // Buffer threshold: skip if delta is too small
      const delta = text.length - this._lastSentResponseLen
      if (delta < ConversationalView.BUFFER_THRESHOLD) {
        this._pendingResponseText = text
        return
      }
      try {
        await this.poster.client.chat.update({
          channel: this.poster.channelId,
          ts: this._responseTs,
          text,
        })
        this._lastResponseEditAt = now
        this._lastSentResponseLen = text.length
        this._pendingResponseText = null
        return
      } catch {
        this._editDisabled = true
        // fall through to post new
      }
    }
    // No existing response message or edits disabled — create one
    const { ts } = await this.poster.postToThread(this.threadTs, text)
    this._responseTs = ts
    this._lastSentResponseLen = text.length
  }

  /** Post a brief user message indicator. */
  async postUser(text: string): Promise<void> {
    await this.flush()
    await this.poster.postToThread(this.threadTs, text)
  }
}
