# Perch

Remote-control your terminal sessions from Slack.

Perch runs as a background daemon on your Mac, connecting your terminal multiplexer (tmux, cmux, Zellij, or GNU Screen) to a Slack channel. Send commands from Slack, watch pane output in real time, and interact with tools like Claude Code — all without switching windows.

## Features

- **Terminal control** — list sessions, read pane output, send text and keystrokes
- **Live watch** — monitor a pane with updates edited in place (no message flood)
- **Preset plugins** — `claude` preset understands Claude Code's states (thinking, waiting, idle, error); `generic` works with anything
- **Workspace management** — create/close sessions, split panes, rename, select
- **macOS native** — runs as a LaunchAgent, restarts on login, credentials stored in Keychain

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/elitecoder/perch/main/scripts/install.sh | bash
```

This installs Perch to `~/.perch`, builds it, and links the `perch` command globally. Requires Node.js 20+.

To update:

```bash
curl -fsSL https://raw.githubusercontent.com/elitecoder/perch/main/scripts/install.sh | bash
```

Same command — it pulls the latest changes if already installed.

To uninstall:

```bash
perch uninstall
```

## Setup

```bash
perch setup
```

This walks you through:
1. Detecting your terminal multiplexer
2. Creating a Slack app (manifest provided)
3. Collecting and validating tokens (stored in Keychain)
4. Configuring the Slack channel
5. Installing the LaunchAgent

## Slack Commands

### Terminal
| Command | Description |
|---------|-------------|
| `list` | List all sessions, windows, and panes |
| `tree [session]` | Show session tree |
| `read <pane> [lines]` | Read pane output (default 50 lines) |
| `send <pane> <text>` | Send text + Enter to a pane |
| `key <pane> <key>` | Send a single keystroke |

### Watch
| Command | Description |
|---------|-------------|
| `watch <pane> [--preset id]` | Start watching a pane (use `list` to get pane IDs) |
| `unwatch <pane>` | Stop watching |
| `watching` | List currently watched panes |
| `preset <plugin-id>` | Set global default preset |
| `preset <pane> <plugin-id>` | Override preset for a specific pane |

### Workspace
| Command | Description |
|---------|-------------|
| `new session <name>` | Create a new session |
| `new split <dir> <pane>` | Split pane (left/right/up/down) |
| `rename <target> <name>` | Rename a session |
| `close <target>` | Close a session |
| `select <pane>` | Switch active pane |

### System
| Command | Description |
|---------|-------------|
| `help` | Show command list |
| `status` | Daemon status, uptime, active watches |

## CLI Commands

```bash
perch setup      # Interactive setup wizard
perch status     # Check daemon status
perch restart    # Restart the daemon
perch logs       # Tail daemon logs
perch uninstall  # Remove Perch
```

## Presets

| Preset | Description |
|--------|-------------|
| `claude` | Claude Code — state tracking, transition alerts, key aliases (`accept`, `reject`, `interrupt`) |
| `generic` | Any terminal process — raw output diffing, no state awareness |

The first `watch` auto-saves the detected preset as the global default. Override per-pane with `preset <pane> <plugin-id>`.

## Architecture

```
packages/
  cli/        # CLI tool (perch setup, status, restart, logs, uninstall)
  daemon/     # Background daemon (Slack socket mode, terminal adapters, watcher)
  shared/     # Shared config types and utilities
scripts/      # Install script
slack/        # Slack app manifest
launchd/      # LaunchAgent plist template
```

## Supported Multiplexers

- **tmux** — detected via `which tmux`
- **cmux** — detected via app bundle path or `which cmux`
- **Zellij** — detected via `which zellij`
- **GNU Screen** — detected via `which screen`

## Configuration

Config lives at `~/.config/perch/config.json`:

```json
{
  "slackChannelId": "C...",
  "pollIntervalMs": 2000,
  "maxScreenLines": 50,
  "adapterPriority": ["cmux", "tmux", "zellij", "screen"],
  "defaultPreset": "claude",
  "panePresets": {}
}
```

## License

Apache 2.0
