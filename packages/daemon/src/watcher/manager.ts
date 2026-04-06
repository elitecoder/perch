import type { ITerminalAdapter } from '../adapters/interface.js'
import type { IToolPlugin } from '../plugins/interface.js'
import type { Poster } from '../slack/poster.js'
import { TranscriptMonitor } from '../transcript/monitor.js'

export class WatcherManager {
  private _transcriptMonitor = new TranscriptMonitor()

  /**
   * Start monitoring a Claude Code JSONL transcript.
   * Posts conversational updates to Slack.
   */
  watchTranscript(paneId: string, jsonlPath: string, poster: Poster, threadTs: string, plugin?: IToolPlugin, startFromEnd = true, claudePid?: number, parentTs?: string): Promise<void> {
    return this._transcriptMonitor.watch(paneId, jsonlPath, poster, threadTs, plugin, startFromEnd, claudePid, parentTs)
  }

  /**
   * Register a pane for thread-based interactions (key aliases, text forwarding)
   * without JSONL monitoring. Used when no Claude session file is found.
   */
  registerWatch(paneId: string, threadTs: string, plugin?: IToolPlugin): void {
    this._transcriptMonitor.register(paneId, threadTs, plugin)
  }

  /** Stop watching a pane. No-op if not watching. */
  unwatch(paneId: string): void {
    this._transcriptMonitor.unwatch(paneId)
  }

  /** Look up a watch by thread timestamp. */
  getByThread(threadTs: string): { paneId: string; plugin?: IToolPlugin } | undefined {
    return this._transcriptMonitor.getByThread(threadTs)
  }

  /** List all currently watched pane IDs. */
  listWatches(): string[] {
    return this._transcriptMonitor.listWatches()
  }

  /** Record text forwarded from Slack to a pane, to suppress JSONL echo. */
  recordForwardedText(paneId: string, text: string, messageTs?: string): void {
    this._transcriptMonitor.recordForwardedText(paneId, text, messageTs)
  }

  /** Stop all watches (clean shutdown). */
  dispose(): void {
    this._transcriptMonitor.dispose()
  }
}
