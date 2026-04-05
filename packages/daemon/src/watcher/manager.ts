import type { ITerminalAdapter } from '../adapters/interface.js'
import type { IToolPlugin } from '../plugins/interface.js'
import type { LiveView, Poster } from '../slack/poster.js'
import { parseScreen } from '../screen-parser/index.js'
import { StateMachine } from './state-machine.js'
import { TranscriptMonitor } from '../transcript/monitor.js'

interface WatchEntry {
  paneId: string
  threadTs: string
  adapter: ITerminalAdapter
  plugin: IToolPlugin
  liveView: LiveView
  prevContent: string
  stateMachine: StateMachine
  timer: ReturnType<typeof setInterval>
}

export class WatcherManager {
  private _watches = new Map<string, WatchEntry>()
  private _threadToPane = new Map<string, string>()
  private _transcriptMonitor = new TranscriptMonitor()

  /**
   * Start watching a pane. Posts meaningful updates via liveView.
   * No-op if already watching.
   */
  watch(paneId: string, adapter: ITerminalAdapter, plugin: IToolPlugin, liveView: LiveView, threadTs?: string): void {
    if (this._watches.has(paneId)) return

    const stateMachine = new StateMachine('idle')
    const entry: WatchEntry = {
      paneId,
      threadTs: threadTs ?? '',
      adapter,
      plugin,
      liveView,
      prevContent: '',
      stateMachine,
      timer: setInterval(() => {
        void this._tick(paneId)
      }, plugin.watch.pollIntervalMs),
    }
    this._watches.set(paneId, entry)
    if (threadTs) this._threadToPane.set(threadTs, paneId)
  }

  /**
   * Start monitoring a Claude Code JSONL transcript instead of scraping the
   * terminal. Posts conversational updates to Slack.
   */
  watchTranscript(paneId: string, jsonlPath: string, poster: Poster, threadTs: string, plugin?: IToolPlugin, startFromEnd = true, claudePid?: number): Promise<void> {
    return this._transcriptMonitor.watch(paneId, jsonlPath, poster, threadTs, plugin, startFromEnd, claudePid)
  }

  /**
   * Register a pane for thread-based interactions (key aliases, text forwarding)
   * without JSONL monitoring. Used when no Claude session file is found.
   */
  registerWatch(paneId: string, threadTs: string, plugin?: IToolPlugin): void {
    this._transcriptMonitor.register(paneId, threadTs, plugin)
  }

  /** Stop watching a pane (either scraping or transcript). No-op if not watching. */
  unwatch(paneId: string): void {
    // Stop transcript watch if present
    this._transcriptMonitor.unwatch(paneId)

    // Stop scraping watch if present
    const entry = this._watches.get(paneId)
    if (!entry) return
    clearInterval(entry.timer)
    if (entry.threadTs) this._threadToPane.delete(entry.threadTs)
    this._watches.delete(paneId)
  }

  /** Look up a watch by thread timestamp (checks both transcript and scraping). */
  getByThread(threadTs: string): { paneId: string; plugin?: IToolPlugin } | undefined {
    // Check transcript monitor first
    const transcriptWatch = this._transcriptMonitor.getByThread(threadTs)
    if (transcriptWatch) return transcriptWatch

    // Fall back to scraping watch
    const paneId = this._threadToPane.get(threadTs)
    if (!paneId) return undefined
    return this._watches.get(paneId)
  }

  /** List all currently watched pane IDs (both transcript and scraping). */
  listWatches(): string[] {
    return [
      ...this._watches.keys(),
      ...this._transcriptMonitor.listWatches(),
    ]
  }

  /** Record text forwarded from Slack to a pane, to suppress JSONL echo. */
  recordForwardedText(paneId: string, text: string): void {
    this._transcriptMonitor.recordForwardedText(paneId, text)
  }

  /** Stop all watches (clean shutdown). */
  dispose(): void {
    for (const paneId of [...this._watches.keys()]) {
      this.unwatch(paneId)
    }
    this._transcriptMonitor.dispose()
  }

  private async _tick(paneId: string): Promise<void> {
    const entry = this._watches.get(paneId)
    if (!entry) return

    let raw: string
    try {
      raw = await entry.adapter.readPane(paneId)
    } catch (err) {
      console.error(`[tick] readPane error for ${paneId}:`, err)
      return // transient read error; try again next tick
    }

    const { clean } = parseScreen(raw, entry.plugin)
    const newState = entry.plugin.parseState(raw)
    const transition = entry.stateMachine.update(newState)
    const delta = entry.plugin.computeDelta(entry.prevContent, clean)

    console.log(`[tick] pane=${paneId} state=${newState} transition=${transition ? `${transition.from}→${transition.to}` : 'none'} delta=${delta ? delta.type : 'null'} prevLen=${entry.prevContent.length} cleanLen=${clean.length}`)

    entry.prevContent = clean

    const shouldNotifyTransition =
      transition !== null &&
      StateMachine.shouldNotify(transition, entry.plugin.watch.notifyOnTransitions)

    if (shouldNotifyTransition) {
      console.log(`[tick] posting transition: ${transition.from}→${transition.to}`)
      const msg = `*State:* ${transition.from} → ${transition.to}\n${clean}`.trim()
      await entry.liveView.update(msg)
    } else if (delta !== null) {
      console.log(`[tick] posting delta (${delta.type}): ${delta.content.slice(0, 100)}...`)
      await entry.liveView.update(delta.content)
    } else {
      console.log(`[tick] skipped — no transition, no delta`)
    }
  }
}
