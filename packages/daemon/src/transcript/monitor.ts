import { readdir, stat, access, unlink } from 'fs/promises'
import { join, dirname } from 'path'
import { homedir } from 'os'
import type { IToolPlugin } from '../plugins/interface.js'
import type { Poster } from '../slack/poster.js'
import { ConversationalView } from '../slack/poster.js'
import type { SlackAction } from './formatter.js'
import { TranscriptReader } from './reader.js'
import { ConversationalFormatter } from './formatter.js'
import { readPidSessionId } from './resolver.js'
import { summarizeTranscript, formatSummary } from './summary.js'

/** Tracks emoji reaction state on the watch parent message. */
type ReactionState = 'none' | 'eyes' | 'thinking_face' | 'wrench' | 'speech_balloon' | 'white_check_mark' | 'x' | 'hourglass_flowing_sand' | 'warning'

export class StatusReactor {
  private _current: ReactionState = 'none'
  private _parentTs: string
  private _threadTs: string

  /** Once true, all transitions are blocked until setTarget() resets. */
  private _finished = false
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null
  private _pendingEmoji: ReactionState = 'none'
  private _typingLeaseTimer: ReturnType<typeof setInterval> | null = null
  private _stallSoftTimer: ReturnType<typeof setTimeout> | null = null
  private _stallHardTimer: ReturnType<typeof setTimeout> | null = null

  /** Debounce interval for intermediate states (OpenClaw: 700ms). */
  static readonly DEBOUNCE_MS = 700
  /** Typing indicator refresh interval (ms). */
  static readonly TYPING_LEASE_MS = 3000
  /** Stall soft threshold (OpenClaw: 10s). */
  static readonly STALL_SOFT_MS = 10_000
  /** Stall hard threshold (OpenClaw: 30s). */
  static readonly STALL_HARD_MS = 30_000

  constructor(
    private readonly poster: Poster,
    parentTs: string,
    threadTs: string,
  ) {
    this._parentTs = parentTs
    this._threadTs = threadTs
  }

  /** Update the message that reactions target and reset finished state. */
  setTarget(ts: string): void {
    this._clearAllTimers()
    this._finished = false
    this._parentTs = ts
    this._current = 'none'
  }

  /** Reset the finished flag without changing the target (for prompt-submit). */
  reset(): void {
    this._clearAllTimers()
    this._finished = false
    // Remove the old terminal reaction
    if (this._current === 'white_check_mark' || this._current === 'x') {
      this.poster.removeReaction(this._parentTs, this._current).catch(() => {})
      this._current = 'none'
    }
  }

  /** Start typing lease and stall timers. Called when activity begins. */
  activate(): void {
    if (this._finished) return
    // Start typing lease
    if (!this._typingLeaseTimer) {
      this.poster.setTypingStatus(this._threadTs, 'is thinking...').catch(() => {})
      this._typingLeaseTimer = setInterval(() => {
        if (!this._finished) {
          this.poster.setTypingStatus(this._threadTs, 'is thinking...').catch(() => {})
        }
      }, StatusReactor.TYPING_LEASE_MS)
    }
    this._resetStallTimers()
  }

  /** Transition to a new reaction state. Terminal states are immediate; others debounce. */
  async transition(next: ReactionState): Promise<void> {
    if (this._finished || next === this._current) return

    const isTerminal = next === 'white_check_mark' || next === 'x'
    if (isTerminal) {
      this._finished = true
      this._clearAllTimers()
      this.poster.clearTypingStatus(this._threadTs).catch(() => {})
      if (this._debounceTimer) {
        clearTimeout(this._debounceTimer)
        this._debounceTimer = null
      }
      await this._applyEmoji(next)
    } else {
      // Debounce intermediate states to prevent flickering
      this._pendingEmoji = next
      if (this._debounceTimer) clearTimeout(this._debounceTimer)
      this._debounceTimer = setTimeout(() => {
        this._debounceTimer = null
        void this._applyEmoji(this._pendingEmoji)
      }, StatusReactor.DEBOUNCE_MS)
      // Reset stall timers on every phase change
      this._resetStallTimers()
    }
  }

  private _resetStallTimers(): void {
    if (this._stallSoftTimer) clearTimeout(this._stallSoftTimer)
    if (this._stallHardTimer) clearTimeout(this._stallHardTimer)
    this._stallSoftTimer = setTimeout(() => {
      void this.transition('hourglass_flowing_sand')
    }, StatusReactor.STALL_SOFT_MS)
    this._stallHardTimer = setTimeout(() => {
      void this.transition('warning')
    }, StatusReactor.STALL_HARD_MS)
  }

  private _clearAllTimers(): void {
    if (this._debounceTimer) { clearTimeout(this._debounceTimer); this._debounceTimer = null }
    if (this._typingLeaseTimer) { clearInterval(this._typingLeaseTimer); this._typingLeaseTimer = null }
    if (this._stallSoftTimer) { clearTimeout(this._stallSoftTimer); this._stallSoftTimer = null }
    if (this._stallHardTimer) { clearTimeout(this._stallHardTimer); this._stallHardTimer = null }
  }

  private async _applyEmoji(next: ReactionState): Promise<void> {
    if (next === this._current) return
    console.log(`[reactor] :${this._current}: → :${next}: on message ${this._parentTs}`)
    if (this._current !== 'none') {
      await this.poster.removeReaction(this._parentTs, this._current)
    }
    if (next !== 'none') {
      await this.poster.addReaction(this._parentTs, next)
    }
    this._current = next
  }

  get current(): ReactionState { return this._current }

  /** Clean up all timers (for shutdown). */
  dispose(): void {
    this._clearAllTimers()
  }
}

export interface TranscriptWatch {
  paneId: string
  threadTs: string
  /** Timestamp of the top-level "Watching" message (for reactions). */
  parentTs: string
  /** The tool plugin associated with this session (for key aliases etc.). */
  plugin?: IToolPlugin
  poster: Poster
  /** PID of the Claude process, used to scope permission-waiting detection. */
  claudePid?: number
  reader: TranscriptReader
  formatter: ConversationalFormatter
  view: ConversationalView
  reactor: StatusReactor
  timer: ReturnType<typeof setInterval>
  /** Consecutive ticks with no new records. Used to detect session rotation. */
  emptyTicks: number
  /** Whether we already posted a "waiting for approval" notification. */
  waitingNotified: boolean
  /** Timestamp of the approval buttons message (for clearing buttons after action). */
  approvalTs?: string
}

/** Minimal stub for panes registered without a live JSONL file. */
interface StubWatch {
  paneId: string
  plugin?: IToolPlugin
}

const POLL_INTERVAL_MS = 1000
/** After this many empty ticks, check if Claude rotated to a new JSONL file. */
const ROTATION_CHECK_TICKS = 10
/** Minimum empty ticks before checking for interactive prompts (avoids transient files). */
const INTERACTIVE_CHECK_TICKS = 3
/** How long (ms) a forwarded text stays suppressed. */
const FORWARDED_TTL_MS = 30_000
/** Marker files older than this (ms) are considered stale and ignored. */
const MARKER_FILE_MAX_AGE_MS = 60_000
/** Directory where PermissionRequest hooks write marker files. */
const WAITING_DIR = join(homedir(), '.config', 'perch', 'waiting')
/** Directory where state hooks write event files. */
const HOOK_STATE_DIR = join(homedir(), '.config', 'perch', 'hook-state')
/** Directory where Notification/PreToolUse hooks write interactive prompt payloads. */
const INTERACTIVE_DIR = join(homedir(), '.config', 'perch', 'interactive')

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
  async watch(paneId: string, jsonlPath: string, poster: Poster, threadTs: string, plugin?: IToolPlugin, startFromEnd = true, claudePid?: number, parentTs?: string): Promise<void> {
    if (this._watches.has(paneId)) return
    // Promote stub to full watch if one exists
    this._stubs.delete(paneId)

    const reader = new TranscriptReader(jsonlPath)
    if (startFromEnd) {
      // Post a one-shot context summary to the thread before entering live-tail,
      // so the viewer knows what Claude was doing when they attached. Best-effort:
      // a missing or unreadable file means the user sees an empty thread as before.
      try {
        const summary = await summarizeTranscript(jsonlPath)
        const text = formatSummary(summary)
        if (text) await poster.postToThread(threadTs, text)
      } catch (err) {
        console.error(`[transcript] summary post failed for ${paneId}:`, err)
      }
      await reader.seekToEnd()
    }

    const formatter = new ConversationalFormatter()
    const view = poster.makeConversationalView(threadTs)
    const effectiveParentTs = parentTs ?? threadTs
    const reactor = new StatusReactor(poster, effectiveParentTs, threadTs)

    // No indicators on startup — only activate when actual JSONL activity is detected

    const entry: TranscriptWatch = {
      paneId,
      threadTs,
      parentTs: effectiveParentTs,
      plugin,
      poster,
      claudePid,
      reader,
      formatter,
      view,
      reactor,
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
    watch.reactor.dispose()
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
  recordForwardedText(paneId: string, text: string, messageTs?: string): void {
    this._forwardedTexts.set(paneId, { text: text.trim(), ts: Date.now() })
    // Update reactor to target the user's message for status reactions
    if (messageTs) {
      const watch = this._watches.get(paneId)
      if (watch) {
        // Clear old reaction from previous message
        watch.reactor.transition('none').catch(() => {})
        watch.reactor.setTarget(messageTs)
      }
    }
  }

  /** Manually trigger a tick — exposed for testing. */
  async tick(paneId: string): Promise<void> {
    return this._tick(paneId)
  }

  private async _tick(paneId: string): Promise<void> {
    const entry = this._watches.get(paneId)
    if (!entry) return

    // Process hook state events (Stop, UserPromptSubmit, etc.)
    const hookEvents = await this._consumeHookEvents(entry)
    for (const hookEvent of hookEvents) {
      if (hookEvent === 'stop') {
        await entry.reactor.transition('white_check_mark')
      } else if (hookEvent === 'prompt-submit') {
        // User submitted a new prompt — reset and re-activate
        entry.reactor.reset()
        await entry.reactor.transition('thinking_face')
        entry.reactor.activate()
      } else if (hookEvent === 'pre-tool-use') {
        await entry.reactor.transition('wrench')
        entry.reactor.activate()
      } else if (hookEvent === 'notification') {
        await entry.reactor.transition('eyes')
      }
    }

    let records
    try {
      records = await entry.reader.readNew()
    } catch (err) {
      console.error(`[transcript] readNew error for ${paneId}:`, err)
      return
    }

    if (records.length === 0) {
      entry.emptyTicks++

      // Typing lease and stall timers are managed by StatusReactor (timer-based, not tick-based)

      // Check if Claude is waiting for user input (permission approval or interactive prompt).
      // Wait a few ticks before checking to avoid transient files from non-blocking tools.
      if (!entry.waitingNotified && entry.emptyTicks >= INTERACTIVE_CHECK_TICKS) {
        const posted = await this._tryPostInteractiveButtons(entry, paneId)
        if (posted) {
          entry.waitingNotified = true
        }
      } else {
        // Clear notification and buttons once all marker files are gone
        const waiting = await this._getWaitingPayload(entry)
        const interactive = await this._getInteractivePayload(entry)
        if (!waiting && !interactive) {
          entry.waitingNotified = false
          if (entry.approvalTs) {
            entry.poster.clearButtons(entry.approvalTs, ':white_check_mark: Resolved').catch(() => {})
            entry.approvalTs = undefined
          }
        }
      }
      if (entry.emptyTicks >= ROTATION_CHECK_TICKS) {
        entry.emptyTicks = 0
        await this._checkRotation(entry)
      }
      return
    }

    entry.emptyTicks = 0
    entry.waitingNotified = false
    if (entry.approvalTs) {
      entry.poster.clearButtons(entry.approvalTs, ':white_check_mark: Resolved').catch(() => {})
      entry.approvalTs = undefined
    }
    // Claude is producing output — it's not waiting. Clean up stale marker files
    // so they don't trigger false "needs attention" buttons on the next empty period.
    await this._cleanupMarkerFiles(entry)

    // Activate typing lease and stall timers on first real activity
    if (entry.reactor.current === 'none') {
      await entry.reactor.transition('eyes')
    }
    entry.reactor.activate()

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
          await entry.reactor.transition('wrench')
          await entry.view.updateStatus(action.text)
        } else if (action.type === 'post_response') {
          await entry.reactor.transition('speech_balloon')
          await entry.view.postResponse(action.text)
        } else if (action.type === 'update_response') {
          await entry.reactor.transition('speech_balloon')
          await entry.view.updateResponse(action.text)
        } else if (action.type === 'post_user') {
          await entry.reactor.transition('thinking_face')
          await entry.view.postUser(action.text)
        } else if (action.type === 'post_snippet') {
          const title = (action as SlackAction & { title?: string }).title
          await entry.poster.postSnippetToThread(entry.threadTs, action.text, title)
        }
      } catch (err) {
        console.error(`[transcript] slack action failed (${action.type}):`, err)
        await entry.reactor.transition('x').catch(() => {})
      }
    }

    // Flush any buffered status/response text so short updates aren't lost.
    // The view buffers edits to avoid excessive API calls during streaming,
    // but at tick boundaries we always want to deliver what we have.
    await entry.view.flush()

    // Done detection is handled by the Stop hook (writes state file consumed above).
  }

  /**
   * Read and consume the hook state file for a session.
   * Returns the event type ('stop', 'prompt-submit', 'notification', 'pre-tool-use') or null.
   */
  /**
   * Read and consume all hook state events for a session.
   * Returns array of event strings in order (e.g., ['prompt-submit', 'pre-tool-use', 'stop']).
   */
  private async _consumeHookEvents(entry: TranscriptWatch): Promise<string[]> {
    const jsonlName = entry.reader.filePath.split('/').pop() ?? ''
    const sessionId = jsonlName.replace('.jsonl', '')
    if (!sessionId) return []
    const stateFile = join(HOOK_STATE_DIR, `${sessionId}.events`)
    try {
      const { readFile, writeFile } = await import('fs/promises')
      const content = await readFile(stateFile, 'utf-8')
      await writeFile(stateFile, '') // clear — don't process the same events twice
      const events = content.trim().split('\n').filter(Boolean)
      if (events.length > 0) console.error(`[hook-state] consumed [${events.join(', ')}] for ${sessionId}`)
      return events
    } catch {
      return []
    }
  }

  /** Extract the session ID from a watch entry's JSONL path. */
  private _sessionId(entry: TranscriptWatch): string {
    const jsonlName = entry.reader.filePath.split('/').pop() ?? ''
    return jsonlName.replace('.jsonl', '')
  }

  /**
   * Check if a PermissionRequest marker file exists for this watch's Claude session.
   * The hook writes JSON payload to ~/.config/perch/waiting/<session-id>.json.
   * Returns the parsed payload if waiting, or null. Ignores stale files.
   */
  private async _getWaitingPayload(entry: TranscriptWatch): Promise<Record<string, unknown> | null> {
    const sessionId = this._sessionId(entry)
    if (!sessionId) return null
    const filePath = join(WAITING_DIR, `${sessionId}.json`)
    try {
      const fileStat = await stat(filePath)
      if (Date.now() - fileStat.mtimeMs > MARKER_FILE_MAX_AGE_MS) {
        // Stale file — clean it up
        await unlink(filePath).catch(() => {})
        return null
      }
      const { readFile } = await import('fs/promises')
      const content = await readFile(filePath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return null
    }
  }

  /**
   * Check if an interactive prompt payload exists (from Notification or PreToolUse hooks).
   * Returns the parsed payload if present, or null. Ignores stale files.
   */
  private async _getInteractivePayload(entry: TranscriptWatch): Promise<Record<string, unknown> | null> {
    const sessionId = this._sessionId(entry)
    if (!sessionId) return null
    const filePath = join(INTERACTIVE_DIR, `${sessionId}.json`)
    try {
      const fileStat = await stat(filePath)
      if (Date.now() - fileStat.mtimeMs > MARKER_FILE_MAX_AGE_MS) {
        // Stale file — clean it up
        await unlink(filePath).catch(() => {})
        return null
      }
      const { readFile } = await import('fs/promises')
      const content = await readFile(filePath, 'utf-8')
      return JSON.parse(content)
    } catch {
      return null
    }
  }

  /**
   * Remove marker files for a session. Called when new JSONL records arrive,
   * proving Claude is actively working and not waiting for input.
   */
  private async _cleanupMarkerFiles(entry: TranscriptWatch): Promise<void> {
    const sessionId = this._sessionId(entry)
    if (!sessionId) return
    await unlink(join(WAITING_DIR, `${sessionId}.json`)).catch(() => {})
    await unlink(join(INTERACTIVE_DIR, `${sessionId}.json`)).catch(() => {})
  }

  /**
   * Try to detect and post interactive buttons for a waiting Claude session.
   * Checks both PermissionRequest (waiting/) and interactive prompts (interactive/).
   * Returns true if buttons were posted.
   */
  private async _tryPostInteractiveButtons(entry: TranscriptWatch, paneId: string): Promise<boolean> {
    // First check for interactive prompts (AskUserQuestion, etc.)
    const interactive = await this._getInteractivePayload(entry)
    if (interactive) {
      const toolName = interactive.tool_name as string | undefined
      const toolInput = interactive.tool_input as Record<string, unknown> | undefined

      // AskUserQuestion: post choice buttons for each option
      if (toolName === 'AskUserQuestion' && toolInput) {
        const questions = toolInput.questions as Array<{ question: string; options?: Array<{ label: string }> }> | undefined
        const firstQ = questions?.[0]
        if (firstQ?.options?.length) {
          try {
            const msg = `:grey_question: *Claude is asking:*\n> ${firstQ.question}`
            const choices = firstQ.options.map((o, i) => ({ label: o.label, index: i }))
            const { ts } = await entry.poster.postChoiceButtons(entry.threadTs, msg, paneId, choices)
            entry.approvalTs = ts
            return true
          } catch (err) {
            console.error(`[transcript] interactive prompt failed:`, err)
          }
        }
      }

      // ExitPlanMode / EnterPlanMode: approval buttons
      if (toolName === 'ExitPlanMode' || toolName === 'EnterPlanMode') {
        try {
          const label = toolName === 'ExitPlanMode' ? 'Exit Plan Mode' : 'Enter Plan Mode'
          const msg = `:clipboard: *${label}*`
          const { ts } = await entry.poster.postApprovalButtons(entry.threadTs, msg, paneId, [
            { label: 'Approve', key: 'Enter', style: 'primary' },
            { label: 'Reject', key: 'Escape', style: 'danger' },
          ])
          entry.approvalTs = ts
          return true
        } catch (err) {
          console.error(`[transcript] plan mode prompt failed:`, err)
        }
      }

      // Interactive notification types that actually need user action
      const INTERACTIVE_NOTIF_TYPES = new Set(['permission_prompt', 'idle_prompt', 'elicitation_dialog'])
      const notifType = interactive.notification_type as string | undefined
      if (notifType && !toolName && INTERACTIVE_NOTIF_TYPES.has(notifType)) {
        try {
          const msg = `:eyes: *Claude needs your attention*`
          const { ts } = await entry.poster.postApprovalButtons(entry.threadTs, msg, paneId, [
            { label: 'Continue', key: 'Enter', style: 'primary' },
            { label: 'Cancel', key: 'Escape', style: 'danger' },
          ])
          entry.approvalTs = ts
          return true
        } catch (err) {
          console.error(`[transcript] notification prompt failed:`, err)
        }
      }
    }

    // Fall back to PermissionRequest check (tool approval)
    const payload = await this._getWaitingPayload(entry)
    if (payload) {
      try {
        const tool = formatWaitingPayload(payload) || entry.formatter.lastToolDescription
        const msg = [
          `:hourglass_flowing_sand: *Waiting for approval*`,
          tool ? `> ${tool}` : '',
        ].filter(Boolean).join('\n')

        const { ts } = await entry.poster.postApprovalButtons(entry.threadTs, msg, paneId, [
          { label: 'Accept', key: 'Enter', style: 'primary' },
          { label: 'Reject', key: 'Escape', style: 'danger' },
        ])
        entry.approvalTs = ts
        return true
      } catch (err) {
        console.error(`[transcript] waiting notification failed:`, err)
      }
    }

    return false
  }

  /**
   * Check if Claude Code rotated to a new JSONL file. Prefers the hook-maintained
   * PID→sessionId map (ground truth for *this* watch's Claude process); only falls
   * back to the "newest JSONL in the project directory" heuristic when no PID is
   * known (e.g. tmux or tests). The directory-freshness fallback is unsafe when
   * multiple Claude processes share a CWD — it's what caused cross-contaminated
   * threads to ping-pong between sibling sessions, which the initial resolver
   * hook fix (commit e30a56c) deliberately avoided.
   */
  private async _checkRotation(entry: TranscriptWatch): Promise<void> {
    const currentPath = entry.reader.filePath
    const dir = dirname(currentPath)

    if (entry.claudePid !== undefined) {
      const sid = await readPidSessionId(entry.claudePid)
      if (!sid) return // hook hasn't fired recently — stay on current file
      const targetPath = join(dir, `${sid}.jsonl`)
      if (targetPath === currentPath) return
      try {
        await stat(targetPath)
      } catch {
        return // hook-recorded file doesn't exist yet
      }
      console.log(`[transcript] session rotated: ${currentPath} → ${targetPath} (via hook, pid ${entry.claudePid})`)
      await entry.reader.close()
      entry.reader = new TranscriptReader(targetPath)
      await entry.reader.seekToEnd()
      return
    }

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

/**
 * Format the PermissionRequest hook payload into a human-readable tool description.
 */
function formatWaitingPayload(payload: Record<string, unknown>): string {
  const toolName = payload.tool_name as string | undefined
  const toolInput = payload.tool_input as Record<string, unknown> | undefined
  if (!toolName) return ''

  const path = toolInput?.file_path as string | undefined
  const command = toolInput?.command as string | undefined
  const description = toolInput?.description as string | undefined
  const pattern = toolInput?.pattern as string | undefined
  const short = (s: string, max = 50) => {
    const base = s.includes('/') ? s.split('/').pop()! : s
    return base.length <= max ? base : base.slice(0, max - 1) + '…'
  }

  switch (toolName) {
    case 'Bash': return `:terminal: ${short(description ?? command ?? 'Run command', 60)}`
    case 'Write': return `:pencil2: Write \`${short(path ?? '...')}\``
    case 'Edit':
    case 'MultiEdit': return `:pencil2: Edit \`${short(path ?? '...')}\``
    case 'Read': return `:page_facing_up: Read \`${short(path ?? '...')}\``
    case 'Grep': return `:mag: Search for \`${short(pattern ?? '...')}\``
    case 'Glob': return `:open_file_folder: Find files \`${short(pattern ?? '...')}\``
    default: return `:gear: ${toolName}`
  }
}
