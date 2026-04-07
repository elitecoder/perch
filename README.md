# Perch: manage Claude Code from Slack

[![GitHub Stars](https://img.shields.io/github/stars/elitecoder/perch?style=flat-square)](https://github.com/elitecoder/perch)
[![Node.js 20+](https://img.shields.io/badge/node-20%2B-blue?style=flat-square)](https://nodejs.org/)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-green?style=flat-square)](./LICENSE)
[![Open Issues](https://img.shields.io/github/issues/elitecoder/perch?style=flat-square)](https://github.com/elitecoder/perch/issues)

Launch, watch, and talk to Claude Code sessions from Slack — on any device.

Perch is a macOS daemon that connects Slack to your terminal multiplexer (tmux or cmux). It monitors Claude Code via transcript files, so you see exactly what Claude is doing: tool calls, responses, and state changes — streamed to a Slack thread in real time.

*No SSH. No port forwarding. No VPN. Just Slack.*

https://github.com/user-attachments/assets/8e5a6832-14d8-4241-b704-97a5cba146e4

---

## Why Perch

You're running Claude Code on your workstation. You step away. Now what?

Perch lets you **stay in the loop from anywhere Slack works**. Watch Claude think, accept or reject tool calls, send follow-up prompts, and spin up new sessions — all from your phone.

- **Transcript-powered** — reads Claude Code's JSONL session files directly, not screen scraping. You get structured tool calls, responses, and state transitions.
- **Live threads** — `watch` a session and get a Slack thread with streaming updates. Claude runs a bash command? You see it. Claude responds? You see it.
- **Interactive** — reply in the thread to send prompts. Type `accept` to approve, `reject` to decline, `interrupt` to cancel.
- **Launch remotely** — `new my-feature --cwd ~/dev/project` spins up a fresh Claude Code session.
- **Unobtrusive** — macOS LaunchAgent, starts on login, credentials in Keychain.

---

## Quick Start

```bash
# 1. Install
curl -fsSL https://raw.githubusercontent.com/elitecoder/perch/main/scripts/install.sh | bash

# 2. Setup (creates Slack app, stores tokens, installs daemon)
perch setup

# 3. Go to your Slack channel and type:
#    list
```

Setup walks you through everything: it checks for Claude Code, offers to install cmux via Homebrew if no multiplexer is found, auto-enables cmux Automation Mode, creates the Slack app, and installs the daemon. For cmux users, it also installs a Claude Code skill so your agents know how to use cmux commands natively.

## Slack Commands

### Sessions

| Command | Description |
|---------|-------------|
| `list` | List active Claude Code sessions with short IDs |
| `new <name> [--cwd <path>]` | Create a session and launch `claude` |

### Watch

| Command | Description |
|---------|-------------|
| `watch <id>` | Monitor a Claude session — updates stream to a thread |
| `unwatch <id>` | Stop monitoring |
| `watching` | List currently watched sessions |

### Thread Replies

When you're in a watch thread, replies go directly to Claude:

| Reply | Effect |
|-------|--------|
| Any text | Sent as a prompt to Claude |
| `accept` | Press Enter (approve tool call) |
| `reject` | Press Escape (decline) |
| `interrupt` | Send Ctrl-C |
| `expand` | Send Ctrl-O (expand input) |
| `esc` / `escape` | Press Escape |
| `confirm` / `enter` | Press Enter |
| `tab`, `up`, `down`, `left`, `right`, `space` | Navigation keys |
| `keys` / `help` | List all available key aliases |
| `unwatch` | Stop watching from the thread |

You can also send images and files as attachments in a watch thread — they're downloaded and forwarded to the Claude session.

### System

| Command | Description |
|---------|-------------|
| `help` | Show command reference |
| `status` | Daemon status, uptime, active watches |

## How It Works

```
You (Slack) ──→ Perch daemon ──→ terminal multiplexer ──→ Claude Code
                     │
                     ├── reads JSONL transcript
                     └── posts structured updates to Slack thread
```

Perch reads Claude Code's transcript files (`~/.claude/projects/.../*.jsonl`) to understand what's happening — tool calls, responses, state changes. This is more reliable than screen scraping and gives you structured output.

**Watch thread flow:**

1. You type `watch 5` in Slack
2. Perch finds the Claude Code session in pane `5`, locates its transcript file
3. A Slack thread is created — new transcript entries are posted as they appear
4. You reply in the thread — your text is sent to Claude as input
5. Key aliases like `accept` are translated to keystrokes

**Watches persist across restarts** — if the daemon restarts, it picks up where it left off.

## CLI

```bash
perch setup      # Interactive setup wizard
perch status     # Check daemon status
perch restart    # Restart the daemon
perch logs       # Tail daemon logs
perch uninstall  # Remove everything cleanly
```

## Supported Multiplexers

| Multiplexer | Detection |
|-------------|-----------|
| **tmux** | `which tmux` |
| **cmux** | App bundle path or `which cmux` |

## Architecture

Monorepo with three packages:

```
packages/
  shared/     Config types and read/write utilities
  cli/        CLI — setup wizard, status, restart, logs, uninstall
  daemon/     Background daemon:
                slack/       Slack Socket Mode connection
                adapters/    tmux + cmux terminal adapters
                transcript/  JSONL transcript reader + monitor
                watcher/     Orchestrates polling and Slack updates
                plugins/     Claude Code state detection
                commands/    Slack command handlers
scripts/      curl installer
skills/       Claude Code skills (installed to ~/.claude/skills/)
slack/        Slack app manifest
launchd/      LaunchAgent plist template
```

## Configuration

Stored at `~/.config/perch/config.json`:

```json
{
  "slackChannelId": "C...",
  "adapterPriority": ["cmux", "tmux"],
  "defaultPreset": "claude",
  "panePresets": {}
}
```

Credentials are stored in macOS Keychain (service `dev.perch`), not on disk.

## Install / Update / Uninstall

```bash
# Install (or update — same command)
curl -fsSL https://raw.githubusercontent.com/elitecoder/perch/main/scripts/install.sh | bash

# Uninstall
perch uninstall
```

Requires Node.js 20+. Installs to `~/.perch`, links `perch` globally.

## Contributing

Contributions welcome! Open an issue or PR at [github.com/elitecoder/perch](https://github.com/elitecoder/perch).

## License

Apache 2.0
