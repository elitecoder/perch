import type { WebClient } from '@slack/web-api'

const MAX_TEXT_LENGTH = 3000

function truncate(text: string): string {
  if (text.length <= MAX_TEXT_LENGTH) return text
  return text.slice(0, MAX_TEXT_LENGTH - 3) + '...'
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
