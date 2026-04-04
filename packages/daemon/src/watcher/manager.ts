import type { ITerminalAdapter } from '../adapters/interface.js'
import type { IToolPlugin } from '../plugins/interface.js'
import type { LiveView } from '../slack/poster.js'
import { parseScreen } from '../screen-parser/index.js'
import { StateMachine } from './state-machine.js'

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

  /** Stop watching a pane. No-op if not watching. */
  unwatch(paneId: string): void {
    const entry = this._watches.get(paneId)
    if (!entry) return
    clearInterval(entry.timer)
    if (entry.threadTs) this._threadToPane.delete(entry.threadTs)
    this._watches.delete(paneId)
  }

  /** Look up pane ID and its watch entry by thread timestamp. */
  getByThread(threadTs: string): WatchEntry | undefined {
    const paneId = this._threadToPane.get(threadTs)
    if (!paneId) return undefined
    return this._watches.get(paneId)
  }

  /** List all currently watched pane IDs. */
  listWatches(): string[] {
    return [...this._watches.keys()]
  }

  /** Stop all watches (clean shutdown). */
  dispose(): void {
    for (const paneId of this._watches.keys()) {
      this.unwatch(paneId)
    }
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
