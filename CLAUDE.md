# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Perch

Perch is a macOS background daemon that remote-controls terminal multiplexer sessions (cmux, tmux, Zellij, GNU Screen) from Slack. Users send commands like `list`, `read 4`, `send 4 echo hi`, `watch 4` in a Slack channel; the daemon executes them against the terminal and posts results back. Watch mode edits a single Slack thread message in-place for live updates with state detection (thinking/waiting/idle/error for Claude Code).

## Commands

```bash
pnpm build          # Build all 3 packages (shared → cli + daemon)
pnpm test           # Run all tests (vitest) across all packages
pnpm dev            # Watch-rebuild daemon only
pnpm lint           # ESLint across all packages

# Single package
pnpm --filter daemon run test
pnpm --filter cli run test

# Single test file
pnpm --filter daemon exec npx vitest run src/e2e.test.ts

# E2E tests require cmux running with Automation Mode enabled
# They create/destroy temporary workspaces automatically
```

## Architecture

**Monorepo** (pnpm workspaces) with 3 ESM packages:

- **`packages/shared`** — Config types and read/write (`~/.config/perch/config.json`, `state.json`)
- **`packages/cli`** — `perch` binary: setup wizard, status, restart, logs, uninstall. Slack tokens stored in macOS Keychain (service `dev.perch`).
- **`packages/daemon`** — Background process (LaunchAgent). Core runtime.

### Daemon — key files and data flow

Start from these files to understand each layer:
- **Adapters:** `adapters/interface.ts` (contract), `adapters/cmux.ts` or `adapters/tmux.ts` (implementation)
- **Plugins:** `plugins/interface.ts` (contract), `plugins/builtin/claude-code.ts` (primary implementation)
- **Watcher:** `watcher/manager.ts` (orchestrates polling, state transitions, delta posting)
- **Commands:** `commands/router.ts` (dispatch), `commands/terminal.ts` / `watch.ts` / `workspace.ts` / `system.ts`
- **Slack:** `slack/socket.ts` (`handleText()` is the central entry point), `slack/poster.ts`

```
Slack message → socket.ts handleText() → CommandRouter.dispatch()
  → handler calls adapter method → adapter runs CLI command
  → handler calls respond() → Poster posts to Slack

Watch tick: setInterval → adapter.readPane() → plugin.parseState() + computeDelta()
  → StateMachine.update() → LiveView.update() or .transition()
```

**Non-obvious details:**
- `handleText()` branches: thread replies go to the watched pane (as key alias or raw text), channel messages go to the router. Messages with `bot_id` are ignored.
- Pane IDs: full format is `cmux:workspace:1:surface:5` or `tmux:session:window:pane`. Users type short IDs (bare numbers like `5`) which `resolvePane()` in `terminal.ts` resolves by scanning all sessions.

## Testing

The `e2e.test.ts` wires up real `CmuxAdapter` + real plugins + real `WatcherManager` against live cmux, mocking only the Slack Poster. It clears `CMUX_SURFACE_ID`/`CMUX_WORKSPACE_ID` env vars to avoid conflicts when running inside a cmux terminal.

## Pre-commit / pre-push checklist

Always run all unit tests and E2E tests before committing and pushing:

```bash
pnpm test                                                        # unit tests
pnpm --filter daemon exec npx vitest run src/e2e-tmux.test.ts    # tmux E2E
pnpm --filter daemon exec npx vitest run src/e2e-cmux.test.ts    # cmux E2E (requires cmux with Automation Mode)
```

## Key conventions

- ESM throughout — imports use `.js` extensions even for `.ts` source files
- Config persisted to `~/.config/perch/`, tokens in macOS Keychain
- Daemon runs as `~/Library/LaunchAgents/dev.perch.plist` (KeepAlive)
