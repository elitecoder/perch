# Changelog

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
