import type { WebClient } from '@slack/web-api'

const MAX_TEXT_LENGTH = 3000

function truncate(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) return text
  return text.slice(0, MAX_TEXT_LENGTH - 3) + '...'
}

function splitContent(text: string, maxChunk: number): string[] {
  if (text.length <= maxChunk) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= maxChunk) {
      chunks.push(remaining)
      break
    }
    // Split at last newline within the limit
    let splitIdx = remaining.lastIndexOf('\n', maxChunk)
    if (splitIdx <= 0) splitIdx = maxChunk
    chunks.push(remaining.slice(0, splitIdx))
    remaining = remaining.slice(splitIdx + 1)
  }
  return chunks
}

export class Poster {
  constructor(
    readonly client: WebClient,
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
      text: truncate(text),
    })
  }

  /** Build a postFn suitable for WatcherManager that posts to a thread */
  makeThreadPostFn(threadTs: string): (msg: string) => Promise<void> {
    return (msg: string) => this.postToThread(threadTs, msg).then(() => undefined)
  }

  /**
   * Build a LiveView: edits a single thread message in place for deltas,
   * posts a new thread message on significant state transitions.
   */
  makeLiveView(threadTs: string): LiveView {
    return new LiveView(this, threadTs)
  }

  /**
   * Post long text as a Slack file snippet attached to a thread.
   * Returns the thread message ts.
   */
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
    const maxChunk = MAX_TEXT_LENGTH - header.length - 10
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
  private _responseTs: string | null = null

  constructor(
    private readonly poster: Poster,
    private readonly threadTs: string,
  ) {}

  /** Edit the status message in place (tool activity, partial text). */
  async updateStatus(text: string): Promise<void> {
    if (this._statusTs) {
      try {
        await this.poster.client.chat.update({
          channel: this.poster.channelId,
          ts: this._statusTs,
          text: truncate(text),
        })
        return
      } catch {
        // message deleted; fall through to post new
      }
    }
    const { ts } = await this.poster.postToThread(this.threadTs, text)
    this._statusTs = ts
  }

  /** Post a new thread message for a Claude response chunk (first chunk of a turn). */
  async postResponse(text: string): Promise<void> {
    if (text.length > MAX_TEXT_LENGTH) {
      // Long response — split into chunks so nothing is truncated
      await this.poster.postSnippetToThread(this.threadTs, text)
      this._responseTs = null
    } else {
      const { ts } = await this.poster.postToThread(this.threadTs, text)
      this._responseTs = ts
    }
    this._statusTs = null // next tool activity gets a fresh status message
  }

  /** Edit the current response message in place (subsequent streaming chunks). */
  async updateResponse(text: string): Promise<void> {
    if (this._responseTs) {
      try {
        await this.poster.client.chat.update({
          channel: this.poster.channelId,
          ts: this._responseTs,
          text: truncate(text),
        })
        return
      } catch {
        // message deleted; fall through to post new
      }
    }
    // No existing response message — create one
    const { ts } = await this.poster.postToThread(this.threadTs, text)
    this._responseTs = ts
  }

  /** Post a brief user message indicator. */
  async postUser(text: string): Promise<void> {
    await this.poster.postToThread(this.threadTs, text)
  }
}

export class LiveView {
  private _liveTs: string | null = null

  constructor(
    private readonly poster: Poster,
    private readonly threadTs: string,
  ) {}

  async update(text: string): Promise<void> {
    if (this._liveTs) {
      try {
        await this.poster.client.chat.update({
          channel: this.poster.channelId,
          ts: this._liveTs,
          text: truncate(text),
        })
        return
      } catch {
        // message may have been deleted; fall through to post new
      }
    }
    const { ts } = await this.poster.postToThread(this.threadTs, text)
    this._liveTs = ts
  }

  async transition(text: string): Promise<void> {
    // Post a new message for significant transitions (generates a notification ping)
    const { ts } = await this.poster.postToThread(this.threadTs, text)
    this._liveTs = ts
  }
}
