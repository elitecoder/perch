import { readdir, stat, access } from 'fs/promises'
import { join, dirname } from 'path'
import { homedir } from 'os'
import type { IToolPlugin } from '../plugins/interface.js'
import type { Poster } from '../slack/poster.js'
import { ConversationalView } from '../slack/poster.js'
import type { SlackAction } from './formatter.js'
import { TranscriptReader } from './reader.js'
import { ConversationalFormatter } from './formatter.js'

export interface TranscriptWatch {
  paneId: string
  threadTs: string
  /** The tool plugin associated with this session (for key aliases etc.). */
  plugin?: IToolPlugin
  poster: Poster
  /** PID of the Claude process, used to scope permission-waiting detection. */
  claudePid?: number
  reader: TranscriptReader
  formatter: ConversationalFormatter
  view: ConversationalView
  timer: ReturnType<typeof setInterval>
  /** Consecutive ticks with no new records. Used to detect session rotation. */
  emptyTicks: number
  /** Whether we already posted a "waiting for approval" notification. */
  waitingNotified: boolean
}

/** Minimal stub for panes registered without a live JSONL file. */
interface StubWatch {
  paneId: string
  plugin?: IToolPlugin
}

const POLL_INTERVAL_MS = 1000
/** After this many empty ticks, check if Claude rotated to a new JSONL file. */
const ROTATION_CHECK_TICKS = 10
/** How long (ms) a forwarded text stays suppressed. */
const FORWARDED_TTL_MS = 30_000
/** Directory where PermissionRequest hooks write marker files. */
const WAITING_DIR = join(homedir(), '.config', 'perch', 'waiting')

/**
 * Monitors Claude Code JSONL transcript files and posts conversational updates
 * to Slack. Replaces the terminal-scraping watcher tick for Claude sessions.
 */
export class TranscriptMonitor {
  private _watches = new Map<string, TranscriptWatch>()
  private _stubs = new Map<string, StubWatch>()
  private _threadToPane = new Map<string, string>()
  /** Text recently forwarded from Slack → pane, keyed by paneId. Suppresses echo. */
  private _forwardedTexts = new Map<string, { text: string; ts: number }>()

  /**
   * Start monitoring a JSONL transcript and posting to a Slack thread.
   *
   * @param startFromEnd - If true (default), seeks to the current end of the
   *   file so only new content is posted. Pass false for fresh sessions (ask)
   *   where you want to capture output from the beginning.
   */
  async watch(paneId: string, jsonlPath: string, poster: Poster, threadTs: string, plugin?: IToolPlugin, startFromEnd = true, claudePid?: number): Promise<void> {
    if (this._watches.has(paneId)) return
    // Promote stub to full watch if one exists
    this._stubs.delete(paneId)

    const reader = new TranscriptReader(jsonlPath)
    if (startFromEnd) await reader.seekToEnd()

    const formatter = new ConversationalFormatter()
    const view = poster.makeConversationalView(threadTs)

    const entry: TranscriptWatch = {
      paneId,
      threadTs,
      plugin,
      poster,
      claudePid,
      reader,
      formatter,
      view,
      emptyTicks: 0,
      waitingNotified: false,
      timer: setInterval(() => {
        void this._tick(paneId)
      }, POLL_INTERVAL_MS),
    }

    this._watches.set(paneId, entry)
    if (threadTs) this._threadToPane.set(threadTs, paneId)
  }

  /**
   * Register a pane for thread-based interactions (key aliases, text forwarding)
   * without starting JSONL monitoring. Used when no Claude session file is found.
   */
  register(paneId: string, threadTs: string, plugin?: IToolPlugin): void {
    if (this._watches.has(paneId) || this._stubs.has(paneId)) return
    this._stubs.set(paneId, { paneId, plugin })
    if (threadTs) this._threadToPane.set(threadTs, paneId)
  }

  /** Stop monitoring a pane. No-op if not watching. */
  unwatch(paneId: string): void {
    // Remove stub if present
    if (this._stubs.has(paneId)) {
      const entry = [...this._threadToPane.entries()].find(([, p]) => p === paneId)
      if (entry) this._threadToPane.delete(entry[0])
      this._stubs.delete(paneId)
    }

    const watch = this._watches.get(paneId)
    if (!watch) return
    clearInterval(watch.timer)
    void watch.reader.close()
    if (watch.threadTs) this._threadToPane.delete(watch.threadTs)
    this._watches.delete(paneId)
  }

  /** Look up a watch by the Slack thread timestamp. */
  getByThread(threadTs: string): { paneId: string; plugin?: IToolPlugin } | undefined {
    const paneId = this._threadToPane.get(threadTs)
    if (!paneId) return undefined
    return this._watches.get(paneId) ?? this._stubs.get(paneId)
  }

  /** List all currently monitored pane IDs (including stubs). */
  listWatches(): string[] {
    return [...this._watches.keys(), ...this._stubs.keys()]
  }

  /** Stop all monitors (clean shutdown). */
  dispose(): void {
    for (const paneId of [...this._watches.keys(), ...this._stubs.keys()]) {
      this.unwatch(paneId)
    }
  }

  /**
   * Record text that was just forwarded from Slack to the pane. When Claude's
   * JSONL echoes it back as a user record, the monitor will suppress the
   * redundant ":speech_balloon: User:" post.
   */
  recordForwardedText(paneId: string, text: string): void {
    this._forwardedTexts.set(paneId, { text: text.trim(), ts: Date.now() })
  }

  /** Manually trigger a tick — exposed for testing. */
  async tick(paneId: string): Promise<void> {
    return this._tick(paneId)
  }

  private async _tick(paneId: string): Promise<void> {
    const entry = this._watches.get(paneId)
    if (!entry) return

    let records
    try {
      records = await entry.reader.readNew()
    } catch (err) {
      console.error(`[transcript] readNew error for ${paneId}:`, err)
      return
    }

    if (records.length === 0) {
      entry.emptyTicks++
      // Check if Claude is waiting for permission approval (marker file from hook)
      if (!entry.waitingNotified) {
        const waiting = await this._isWaitingForApproval(entry)
        if (waiting) {
          entry.waitingNotified = true
          try {
            const tool = entry.formatter.lastToolDescription
            const msg = [
              `:hourglass_flowing_sand: *Waiting for approval*`,
              tool ? `> ${tool}` : '',
              `\`accept\` — Yes  ·  \`reject\` — No  ·  \`escape\` — Dismiss`,
            ].filter(Boolean).join('\n')
            await entry.poster.postToThread(entry.threadTs, msg)
          } catch (err) {
            console.error(`[transcript] waiting notification failed:`, err)
          }
        }
      } else {
        // Clear notification once marker file is gone
        const stillWaiting = await this._isWaitingForApproval(entry)
        if (!stillWaiting) entry.waitingNotified = false
      }
      if (entry.emptyTicks >= ROTATION_CHECK_TICKS) {
        entry.emptyTicks = 0
        await this._checkRotation(entry)
      }
      return
    }

    entry.emptyTicks = 0
    entry.waitingNotified = false

    console.log(`[transcript-tick] ${paneId}: ${records.length} new records, types: ${records.map(r => r.type).join(', ')}`)

    // Filter noise: only process user + assistant + system records
    const relevant = records.filter(r =>
      r.type === 'user' || r.type === 'assistant' || r.type === 'system',
    )
    if (relevant.length === 0) return

    let actions = entry.formatter.processRecords(relevant)

    // Suppress user echo: if we recently forwarded this text from Slack,
    // don't post it back to the thread.
    const forwarded = this._forwardedTexts.get(paneId)
    if (forwarded && Date.now() - forwarded.ts < FORWARDED_TTL_MS) {
      actions = actions.filter(a => {
        if (a.type !== 'post_user') return true
        // The formatter prefixes with ":speech_balloon: *User:* "
        const userText = a.text.replace(/^:speech_balloon: \*User:\* /, '').trim()
        if (userText === forwarded.text) {
          this._forwardedTexts.delete(paneId)
          return false
        }
        return true
      })
    }

    if (actions.length === 0) return

    console.log(`[transcript-tick] ${paneId}: ${relevant.length} relevant → ${actions.length} actions: ${actions.map(a => a.type).join(', ')}`)

    // Post snippets first (file uploads are slow), then other actions.
    // This ensures plan content appears before the "waiting for approval" status.
    const snippets = actions.filter(a => a.type === 'post_snippet')
    const rest = actions.filter(a => a.type !== 'post_snippet')

    for (const action of [...snippets, ...rest]) {
      try {
        if (action.type === 'update_status') {
          await entry.view.updateStatus(action.text)
        } else if (action.type === 'post_response') {
          await entry.view.postResponse(action.text)
        } else if (action.type === 'update_response') {
          await entry.view.updateResponse(action.text)
        } else if (action.type === 'post_user') {
          await entry.view.postUser(action.text)
        } else if (action.type === 'post_snippet') {
          const title = (action as SlackAction & { title?: string }).title
          await entry.poster.postSnippetToThread(entry.threadTs, action.text, title)
        }
      } catch (err) {
        console.error(`[transcript] slack action failed (${action.type}):`, err)
      }
    }
  }

  /**
   * Check if a PermissionRequest marker file exists for this watch's Claude process.
   * The hook writes to ~/.config/perch/waiting/<pid>.
   */
  private async _isWaitingForApproval(entry: TranscriptWatch): Promise<boolean> {
    if (!entry.claudePid) return false
    try {
      await access(join(WAITING_DIR, String(entry.claudePid)))
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if Claude Code rotated to a new JSONL file. If a sibling file in the
   * same project directory has a more recent mtime, switch the reader to it.
   */
  private async _checkRotation(entry: TranscriptWatch): Promise<void> {
    const currentPath = entry.reader.filePath
    const dir = dirname(currentPath)

    let currentMtime: number
    try {
      const s = await stat(currentPath)
      currentMtime = s.mtimeMs
    } catch {
      return // current file gone; will be caught by readNew errors
    }

    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }

    let newestPath: string | null = null
    let newestMtime = currentMtime
    for (const name of entries) {
      if (!name.endsWith('.jsonl')) continue
      const fullPath = join(dir, name)
      if (fullPath === currentPath) continue
      try {
        const s = await stat(fullPath)
        if (s.mtimeMs > newestMtime) {
          newestMtime = s.mtimeMs
          newestPath = fullPath
        }
      } catch {
        // skip
      }
    }

    if (!newestPath) return

    console.log(`[transcript] session rotated: ${currentPath} → ${newestPath}`)
    await entry.reader.close()
    entry.reader = new TranscriptReader(newestPath)
    // Read from end — we only want new content going forward
    await entry.reader.seekToEnd()
  }
}
