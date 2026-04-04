# Changelog

## 0.1.1 (2026-04-03)

### Fixes

- **npm install works** — `@perch-dev/shared` is now bundled inline into the CLI dist, so `npm install --global perch` resolves correctly
- **CI passes** — fixed workflow to build shared package first; updated all tests for LiveView, cmux adapter mocks, and fs fallback paths
- **Re-watch starts fresh** — watching an already-watched pane silently unwatches and starts a new thread instead of erroring
- **Setup preserves channel** — re-running `perch setup` shows existing channel ID as default

### Changes

- Removed menubar app from distribution (CLI covers all functionality)
- Licensed under Apache 2.0

## 0.1.0 (2026-04-03)

First public release.

### Features

- **Terminal control via Slack** — list sessions, read pane output, send text and keystrokes from any Slack channel
- **Live watch** — monitor a pane with updates edited in place (single message, no flood)
- **Preset plugins** — `claude` preset tracks Claude Code states (thinking, waiting, idle, error) with smart transition detection; `generic` preset works with any terminal process
- **Key aliases in watch threads** — type `accept`, `reject`, `esc`, `ctrl-c`, `up`, `down`, `tab`, etc. in a watch thread to send keys to the pane
- **Thread-aware controls** — `unwatch` and `keys`/`help` work directly in the watch thread
- **Global default preset** — auto-saved on first watch, applied to all future panes; override per-pane with `preset <pane> <plugin-id>`
- **Watch persistence** — watches resume automatically after `perch restart`
- **Re-watch** — watching an already-watched pane starts a fresh thread (no error, no hunting for the old one)
- **Workspace management** — create/close sessions, split panes, rename, select
- **Setup wizard** — interactive `perch setup` walks through multiplexer detection, Slack app creation, token validation, channel config, and LaunchAgent installation
- **Existing config defaults** — re-running setup preserves your channel ID and tokens

### Supported multiplexers

- tmux
- cmux (detected via app bundle path when not in PATH)
- Zellij

### Architecture

- macOS LaunchAgent daemon with automatic restart on login
- Credentials stored in macOS Keychain
- Slack Socket Mode (no public URL required)
- Monorepo: `cli`, `daemon`, `shared` packages published as single `perch` npm package
