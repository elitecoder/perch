# Changelog

## Unreleased

### Features

- **Watch bootstrap summary** — attaching to an already-running Claude session used to leave the Slack thread empty until Claude's next activity, so viewers had no context. `watch` now reads the tail of the JSONL and posts a one-line `*Last prompt:*` / `*Last response:*` summary to the thread before entering live-tail. Best-effort: a missing or unreadable file posts nothing, as before.

### Fixes

- **`list` command shows workspace name only** — the Slack `list` response labeled every Claude session with its cmux workspace name, which made two panes in the same workspace indistinguishable and hid the current task. `list` now renders `*Workspace — Surface title*` when the two differ (falling back to workspace-only when they match or when the adapter doesn't expose a pane title). The cmux adapter already parses the surface title from `list-panels`; it's now propagated through `Pane.title` → `ClaudePane.paneTitle` → the list renderer.

## 0.1.7 (2026-04-15)

### Fixes

- **cmux 0.63 API compatibility** — the daemon crashed with `not_found: Workspace not found` whenever a watched pane lived outside the user's currently focused cmux workspace. cmux 0.63 stopped resolving bare surface refs against any workspace; `capture-pane`, `send`, and `send-key` now pass `--workspace` alongside `--surface` so cross-workspace operations work again.
- **cmux `new-split` output parsing** — cmux 0.63 wraps the new ref as `OK surface:N workspace:M` instead of emitting a bare `surface:N`; `splitPane` now extracts the surface ref from either form.
- **cmux `selectPane`** — cmux 0.63 removed the `focus-surface` subcommand; switched to the `surface.focus` RPC method (which is still supported).

## 0.1.6 (2026-04-09)

### Fixes

- **Node 25.5.0 startup crash** — `import { App } from '@slack/bolt'` failed on Node 25.5.0 with `SyntaxError: Named export 'App' not found` because that release's bundled `cjs-module-lexer` didn't detect bolt's CJS named exports. Switched to default-import + destructure, which is version-agnostic.

## 0.1.5 (2026-04-06)

### Features

- **Interactive prompt buttons** — Claude Code `AskUserQuestion`, `ExitPlanMode`, and permission prompts now show interactive choice/approval buttons in Slack threads
- **Per-user Slack apps** — each user creates their own Slack app named `Perch-<username>` instead of sharing one
- **Improved setup flow** — clearer Slack app install instructions, channel ID guidance, bot invite reminders, and auto-restart of cmux after enabling Automation Mode
- **Auto permission mode** — `new` command launches Claude Code with `--permission-mode auto`
- **Channel isolation** — daemon only responds in the configured Slack channel, ignoring messages elsewhere

### Fixes

- **False "needs attention" buttons** — stale marker files in `waiting/` and `interactive/` dirs are now cleaned up when new JSONL records arrive and auto-pruned after 60 seconds
- **Buffered view text lost** — `flush()` is now called at the end of each tick so short status updates aren't dropped
- **Response state not resetting** — user records consisting entirely of system-injected XML tags no longer leave the response state stuck
- **System tag leakage** — `<system-reminder>` and similar tags injected by Claude Code are stripped from user records before posting to Slack
- **Node 20-22/25+ compatibility** — reverted CJS interop hacks that broke on Node 24; restricted engine to supported versions

### Changes

- **Remove `assistant:write` scope** — removed assistant view and typing status scope from Slack manifest (not required for core functionality)
- **Remove shared app setup** — simplified to single-user app creation flow
- **Unit test coverage expansion** — added tests for session manager, screen-parser utils, claude-finder, socket handler, and error paths across all adapters and poster (+81 tests, 240 → 322)

## 0.1.4 (2026-04-06)

### Features

- **Claude Code prerequisite check** — setup now verifies Claude Code is installed before proceeding, with install instructions if missing
- **cmux install offer** — when no multiplexer is detected, setup offers to install cmux via `brew install --cask cmux`
- **Auto-enable Automation Mode** — setup reads cmux's `socketControlMode` preference and offers to enable it via `defaults write` instead of requiring manual UI navigation
- **cmux skill for Claude Code** — when cmux is selected, setup installs a comprehensive cmux CLI skill to `~/.claude/skills/cmux/` so Claude Code sessions have native awareness of all cmux commands (terminal I/O, workspaces, splits, browser automation, sidebar metadata, notifications)
- **Skill cleanup on uninstall** — `perch uninstall` removes installed Claude Code skills

### Fixes

- **Setup manifest path** — read canonical `slack/manifest.json` instead of hardcoded copy

## 0.1.3 (2026-04-06)

### Features

- **Approval buttons** — permission requests now show interactive Accept/Reject buttons in Slack instead of text-only prompts, with hook-based approvals for plan mode
- **Emoji status reactions** — parent watch messages show live emoji indicators (wrench, speech balloon, thinking, hourglass, checkmark) reflecting Claude's current state
- **Typing indicator** — Slack assistant typing status ("is thinking...") with automatic lease renewal
- **Stall detection** — hourglass at 10s and warning at 30s of inactivity, with debounced intermediate states
- **State hooks** — new `state-hook.sh` and PreToolUse/Stop/UserPromptSubmit/Notification Claude Code hooks feed real-time state events to the daemon
- **New thread command** — `new thread` in a watch thread starts a fresh thread and links back to the old one
- **Slash command forwarding** — `!clear` or `.clear` in a watch thread sends `/clear` to Claude
- **Smart text splitting** — content chunking now preserves code fence boundaries across Slack messages
- **Slack mrkdwn escaping** — `toSlackMrkdwn` now properly escapes `&`, `<`, `>` in plain text while preserving code blocks and inline code
- **Tool call deduplication** — consecutive identical tool calls are collapsed with a repeat count (e.g., `Read a.ts (x3)`)

### Changes

- **Remove LiveView / scraping watch** — all monitoring now uses transcript-based `ConversationalView`; removed `LiveView` class, `StateMachine` ticking, and `watch()` method from `WatcherManager`
- **Two-tier throttling** — status edits throttled at 1.5s, response edits at 300ms with 40-char buffer threshold; `flush()` drains pending edits
- **Higher edit limit** — `chat.update` now uses 4000-char limit (vs 3000 for `postMessage`)
- **Extract resume logic** — watch resume moved to `resume.ts` module
- **Separate read/write Slack clients** — poster now takes a dedicated read client with conservative retry config
- **New Slack scopes** — added `assistant:write`, `reactions:read`, `reactions:write`; updated manifest with assistant view and `assistant_thread_started` event
- **E2E CI job** — added self-hosted E2E runner to CI workflow

## 0.1.2 (2026-04-05)

### Features

- **Watch thread persistence** — daemon restarts now silently resume posting to the same Slack thread instead of creating a new one
- **Watch confirmation in thread** — "Started watching" message now posts inside the watch thread instead of the main channel

### Fixes

- **False Claude session listings** — `list` no longer shows non-Claude panes that happen to share a CWD with a recent Claude session
- **Short IDs everywhere** — all Slack-facing pane references now use short IDs consistently

## 0.1.1 (2026-04-05)

### Features

- **Transcript monitoring** — new transcript system reads Claude Code JSONL session files, detects tool calls, end-of-turn events, and formats them as Slack status updates and responses
- **Ask command** — interactive Claude Code sessions managed via Slack threads with session lifecycle tracking
- **Claude Code hooks** — `perch setup` now installs hooks into Claude Code settings for session-start, stop, and notification events
- **Claude pane finder** — auto-discovers active Claude Code sessions by scanning for `.claude` JSONL transcript files

### Fixes

- **Add `files:read` Slack bot scope** — image and file attachments sent through Slack now download correctly instead of silently saving HTML error pages
- **Validate file download content-type** — Slack file downloads now check for HTML responses and log a clear error when the bot lacks `files:read` scope
- **cmux sendText split** — send text and Enter as separate commands for better TUI compatibility (fixes input issues with Claude Code)

### Changes

- **Short IDs in `list`** — `list` command now shows compact short IDs (e.g. `5`) instead of full pane IDs
- **Remove generic plugin** — removed unused `generic` preset plugin
- **Remove Zellij support** — removed Zellij E2E tests and references (no adapter implemented)
- **Key alias updates** — `accept` now sends Enter, `reject` sends Escape
- **E2E test improvements** — added cmux Claude session E2E test, replaced shell-command forwarding tests with prompt forwarding, added dedicated vitest E2E config
- **README rewrite** — updated to reflect transcript-powered workflow, Claude-only focus, current command set

## 0.1.0 (2026-04-04)

First public release.

### Features

- **Terminal control via Slack** — list sessions, read pane output, send text and keystrokes from any Slack channel
- **Live watch** — monitor a pane with updates edited in place (single message, no flood)
- **Short pane IDs** — type bare numbers like `5` instead of full IDs like `cmux:workspace:1:surface:5`; `list` shows the short form
- **Preset plugins** — `claude` preset tracks Claude Code states (thinking, waiting, idle, error) with smart transition detection; `generic` preset works with any terminal process
- **Key aliases in watch threads** — type `accept`, `reject`, `esc`, `ctrl-c`, `up`, `down`, `tab`, etc. in a watch thread to send keys to the pane
- **Thread replies forwarded** — replies in a watch thread are sent directly to the pane as text or key aliases
- **Global default preset** — auto-saved on first watch, applied to all future panes; override per-pane with `preset <pane> <plugin-id>`
- **Watch persistence** — watches resume automatically after `perch restart`
- **Re-watch** — watching an already-watched pane starts a fresh thread (no error, no hunting for the old one)
- **Workspace management** — create/close sessions, split panes, rename, select
- **Setup wizard** — interactive `perch setup` walks through multiplexer detection, Slack app creation, token validation, channel config, and LaunchAgent installation
- **Existing config defaults** — re-running setup preserves your channel ID and tokens
- **curl installer** — single command install, auto-restarts daemon if already running
- **Clean uninstall** — `perch uninstall` removes `~/.perch`, LaunchAgent, and the global binary

### Supported multiplexers

- tmux
- cmux (detected via app bundle path when not in PATH)
- Zellij (v0.44+)

### Architecture

- macOS LaunchAgent daemon with automatic restart on login
- Credentials stored in macOS Keychain
- Slack Socket Mode (no public URL required)
- Monorepo: `cli`, `daemon`, `shared` packages
