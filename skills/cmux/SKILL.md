---
name: cmux
description: Control cmux terminal app via its CLI. Use when the user wants to manage workspaces, panes, splits, send commands to terminals, show notifications, update sidebar status/progress/logs, read terminal screens, automate browsers, or any cmux terminal operations.
---

# cmux CLI

## Overview

cmux is a native macOS terminal built on Ghostty, designed for running multiple AI coding agents. This skill uses the `cmux` CLI (`/Applications/cmux.app/Contents/Resources/bin/cmux`) to control it programmatically via Unix socket.

## CLI Location

```bash
/Applications/cmux.app/Contents/Resources/bin/cmux
```

Or just `cmux` if symlinked to PATH.

## Environment Variables (auto-set in cmux terminals)

- `CMUX_WORKSPACE_ID` — default `--workspace` for all commands
- `CMUX_SURFACE_ID` — default `--surface` for all commands
- `CMUX_TAB_ID` — default `--tab` for tab commands
- `CMUX_SOCKET_PATH` — override Unix socket path

## Handle Inputs

Commands accept UUIDs, short refs (`window:1/workspace:2/pane:3/surface:4`), or indexes for window, workspace, pane, and surface arguments.

## Global Flags

- `--json` — output in JSON format (prefer this for parsing)
- `--id-format uuids|both` — include UUIDs in output
- `--socket <path>` — custom socket path
- `--password <text>` — socket auth password

---

## Commands Reference

### Connection

| Command | Description |
|---------|-------------|
| `cmux ping` | Check if cmux is running |
| `cmux capabilities` | List available socket methods |
| `cmux identify` | Show focused window/workspace/pane/surface context |
| `cmux version` | Show version |

### Windows

| Command | Description |
|---------|-------------|
| `cmux list-windows` | List all windows |
| `cmux current-window` | Get active window |
| `cmux new-window` | Create new window |
| `cmux focus-window --window <id>` | Focus a window |
| `cmux close-window --window <id>` | Close a window |
| `cmux rename-window [--workspace <id>] <title>` | Rename window |
| `cmux move-workspace-to-window --workspace <id> --window <id>` | Move workspace to window |

### Workspaces

| Command | Description |
|---------|-------------|
| `cmux list-workspaces` | List all workspaces |
| `cmux current-workspace` | Get active workspace |
| `cmux new-workspace [--cwd <path>] [--command <text>]` | Create workspace |
| `cmux select-workspace --workspace <id>` | Switch to workspace |
| `cmux close-workspace --workspace <id>` | Close workspace |
| `cmux rename-workspace [--workspace <id>] <title>` | Rename workspace |
| `cmux reorder-workspace --workspace <id> (--index <n> \| --before <id> \| --after <id>)` | Reorder workspace |
| `cmux workspace-action --action <name> [--workspace <id>] [--title <text>]` | Trigger workspace action |

### Panes & Surfaces

| Command | Description |
|---------|-------------|
| `cmux list-panes [--workspace <id>]` | List panes |
| `cmux list-pane-surfaces [--workspace <id>] [--pane <id>]` | List surfaces in pane |
| `cmux list-panels [--workspace <id>]` | List panels |
| `cmux tree [--all] [--workspace <id>]` | Show workspace tree |
| `cmux new-split <left\|right\|up\|down> [--workspace <id>] [--surface <id>]` | Create split pane |
| `cmux new-pane [--type <terminal\|browser>] [--direction <left\|right\|up\|down>]` | Create new pane |
| `cmux new-surface [--type <terminal\|browser>] [--pane <id>] [--workspace <id>]` | Create new surface |
| `cmux focus-pane --pane <id> [--workspace <id>]` | Focus pane |
| `cmux focus-panel --panel <id> [--workspace <id>]` | Focus panel |
| `cmux close-surface [--surface <id>] [--workspace <id>]` | Close surface |
| `cmux move-surface --surface <id> [--pane <id>] [--before <id>] [--after <id>]` | Move surface |
| `cmux reorder-surface --surface <id> (--index <n> \| --before <id> \| --after <id>)` | Reorder surface |
| `cmux drag-surface-to-split --surface <id> <left\|right\|up\|down>` | Drag surface to split |
| `cmux swap-pane --pane <id> --target-pane <id>` | Swap panes |
| `cmux break-pane [--workspace <id>] [--pane <id>] [--surface <id>]` | Break pane out |
| `cmux join-pane --target-pane <id> [--pane <id>] [--surface <id>]` | Join pane |
| `cmux resize-pane --pane <id> (-L\|-R\|-U\|-D) [--amount <n>]` | Resize pane |
| `cmux rename-tab [--tab <id>] [--surface <id>] <title>` | Rename tab |
| `cmux tab-action --action <name> [--tab <id>] [--surface <id>]` | Trigger tab action |
| `cmux refresh-surfaces` | Refresh all surfaces |
| `cmux surface-health [--workspace <id>]` | Check surface health |
| `cmux respawn-pane [--workspace <id>] [--surface <id>] [--command <cmd>]` | Respawn pane |

### Terminal I/O

| Command | Description |
|---------|-------------|
| `cmux send [--surface <id>] <text>` | Send text to terminal |
| `cmux send-key [--surface <id>] <key>` | Send key (enter, tab, escape, backspace, delete, up, down, left, right) |
| `cmux send-panel --panel <id> <text>` | Send text to panel |
| `cmux send-key-panel --panel <id> <key>` | Send key to panel |
| `cmux read-screen [--surface <id>] [--scrollback] [--lines <n>]` | Read terminal screen content |
| `cmux capture-pane [--surface <id>] [--scrollback] [--lines <n>]` | Capture pane content (tmux compat) |
| `cmux pipe-pane --command <shell-command> [--surface <id>]` | Pipe pane output to command |
| `cmux clear-history [--surface <id>]` | Clear scrollback history |

### Notifications

| Command | Description |
|---------|-------------|
| `cmux notify --title <text> [--subtitle <text>] [--body <text>]` | Send notification |
| `cmux list-notifications` | List notifications |
| `cmux clear-notifications` | Clear all notifications |
| `cmux claude-hook <session-start\|stop\|notification> [--surface <id>]` | Claude Code hook trigger |

### Sidebar Metadata

| Command | Description |
|---------|-------------|
| `cmux set-status <key> <value> [--icon <name>] [--color <#hex>]` | Set status pill |
| `cmux clear-status <key>` | Remove status entry |
| `cmux list-status` | List status entries |
| `cmux set-progress <0.0-1.0> [--label <text>]` | Set progress bar (0.0 to 1.0) |
| `cmux clear-progress` | Clear progress bar |
| `cmux log [--level <level>] [--source <name>] <message>` | Append log (levels: info, progress, success, warning, error) |
| `cmux clear-log` | Clear logs |
| `cmux list-log [--limit <n>]` | List log entries |
| `cmux sidebar-state` | Dump all sidebar metadata |

### Navigation

| Command | Description |
|---------|-------------|
| `cmux next-window` | Next window |
| `cmux previous-window` | Previous window |
| `cmux last-window` | Last window |
| `cmux last-pane` | Last pane |
| `cmux find-window [--content] [--select] <query>` | Find window by query |

### Clipboard & Buffers

| Command | Description |
|---------|-------------|
| `cmux set-buffer [--name <name>] <text>` | Set buffer |
| `cmux list-buffers` | List buffers |
| `cmux paste-buffer [--name <name>] [--surface <id>]` | Paste buffer |

### Hooks & Keys

| Command | Description |
|---------|-------------|
| `cmux set-hook [--list] [--unset <event>] \| <event> <command>` | Set/list/unset hooks |
| `cmux bind-key` | Bind key |
| `cmux unbind-key` | Unbind key |

### Utility

| Command | Description |
|---------|-------------|
| `cmux wait-for [-S\|--signal] <name> [--timeout <seconds>]` | Wait for signal |
| `cmux trigger-flash [--surface <id>]` | Trigger flash |
| `cmux display-message [-p\|--print] <text>` | Display message |
| `cmux markdown [open] <path>` | Open markdown in formatted viewer |
| `cmux set-app-focus <active\|inactive\|clear>` | Set app focus state |

---

## Browser Automation

cmux has a built-in browser with a full automation API. All browser commands target a browser surface.

```bash
cmux browser [--surface <id>] <subcommand> ...
```

### Navigation

| Command | Description |
|---------|-------------|
| `browser open [url]` | Open browser (creates split if needed) |
| `browser open-split [url]` | Open browser in split |
| `browser goto <url> [--snapshot-after]` | Navigate to URL |
| `browser back [--snapshot-after]` | Go back |
| `browser forward [--snapshot-after]` | Go forward |
| `browser reload [--snapshot-after]` | Reload page |

### Waiting

| Command | Description |
|---------|-------------|
| `browser wait --selector <css>` | Wait for CSS selector |
| `browser wait --text <text>` | Wait for text |
| `browser wait --url-contains <text>` | Wait for URL fragment |
| `browser wait --load-state <interactive\|complete>` | Wait for load state |
| `browser wait --function <js>` | Wait for JS condition |
| `browser wait --timeout-ms <ms>` | Set wait timeout |

### DOM Interaction

| Command | Description |
|---------|-------------|
| `browser click <selector> [--snapshot-after]` | Click element |
| `browser dblclick <selector>` | Double-click |
| `browser hover <selector>` | Hover element |
| `browser focus <selector>` | Focus element |
| `browser check <selector>` | Check checkbox |
| `browser uncheck <selector>` | Uncheck checkbox |
| `browser type <selector> <text> [--snapshot-after]` | Type into element |
| `browser fill <selector> [text] [--snapshot-after]` | Fill input (empty clears) |
| `browser press <key> [--snapshot-after]` | Press key |
| `browser keydown <key>` | Key down |
| `browser keyup <key>` | Key up |
| `browser select <selector> <value> [--snapshot-after]` | Select dropdown option |
| `browser scroll [--selector <css>] [--dx <n>] [--dy <n>] [--snapshot-after]` | Scroll |
| `browser scroll-into-view <selector>` | Scroll element into view |

### Reading Page State

| Command | Description |
|---------|-------------|
| `browser get url` | Get current URL |
| `browser get title` | Get page title |
| `browser get text [selector]` | Get element text |
| `browser get html [selector]` | Get element HTML |
| `browser get value [selector]` | Get input value |
| `browser get attr <selector> <attribute>` | Get attribute value |
| `browser get count <selector>` | Count matching elements |
| `browser get box <selector>` | Get bounding box |
| `browser get styles <selector>` | Get computed styles |
| `browser is visible <selector>` | Check visibility |
| `browser is enabled <selector>` | Check if enabled |
| `browser is checked <selector>` | Check if checked |
| `browser snapshot [--interactive\|-i] [--compact] [--max-depth <n>] [--selector <css>]` | Accessibility tree snapshot |
| `browser screenshot [--out <path>] [--json]` | Take screenshot |
| `browser console list\|clear` | Console logs |
| `browser errors list\|clear` | JS errors |

### Finding Elements

| Command | Description |
|---------|-------------|
| `browser find role <role>` | Find by ARIA role |
| `browser find text <text>` | Find by text |
| `browser find label <text>` | Find by label |
| `browser find placeholder <text>` | Find by placeholder |
| `browser find alt <text>` | Find by alt text |
| `browser find title <text>` | Find by title |
| `browser find testid <id>` | Find by test ID |
| `browser find first` | First match |
| `browser find last` | Last match |
| `browser find nth <n>` | Nth match |

### JavaScript

| Command | Description |
|---------|-------------|
| `browser eval <script>` | Evaluate JavaScript |
| `browser addinitscript <script>` | Add init script |
| `browser addscript <script>` | Inject script |
| `browser addstyle <css>` | Inject CSS |

### Frames, Tabs, Dialogs, Downloads

| Command | Description |
|---------|-------------|
| `browser frame <selector\|main>` | Switch frame |
| `browser tab new [url]` | New tab |
| `browser tab list` | List tabs |
| `browser tab switch <index>` | Switch tab |
| `browser tab close` | Close tab |
| `browser dialog accept [text]` | Accept dialog |
| `browser dialog dismiss` | Dismiss dialog |
| `browser download wait [--path <path>] [--timeout-ms <ms>]` | Wait for download |
| `browser highlight <selector>` | Highlight element |

### Storage & Cookies

| Command | Description |
|---------|-------------|
| `browser cookies get` | Get cookies |
| `browser cookies set <json>` | Set cookies |
| `browser cookies clear` | Clear cookies |
| `browser storage local get [key]` | Get localStorage |
| `browser storage local set <key> <value>` | Set localStorage |
| `browser storage local clear` | Clear localStorage |
| `browser storage session get [key]` | Get sessionStorage |
| `browser storage session set <key> <value>` | Set sessionStorage |
| `browser storage session clear` | Clear sessionStorage |

### State

| Command | Description |
|---------|-------------|
| `browser state save <path>` | Save browser state |
| `browser state load <path>` | Load browser state |
| `browser identify` | Identify browser surface |

---

## Common Patterns

### Check if running inside cmux
```bash
cmux ping
```

### Create a workspace and run a command
```bash
cmux new-workspace --cwd /path/to/project --command "npm run dev"
```

### Multi-agent layout: split and send commands
```bash
cmux new-split right
cmux send --surface surface:2 "claude-code"
cmux send-key --surface surface:2 enter
```

### Show progress in sidebar
```bash
cmux set-status "build" "running" --icon "hammer" --color "#f59e0b"
cmux set-progress 0.5 --label "Building..."
cmux log --level info "Step 1 complete"
cmux log --level success "Build finished"
cmux clear-progress
cmux set-status "build" "done" --color "#22c55e"
```

### Notify on completion
```bash
cmux notify --title "Task Complete" --body "Build succeeded"
```

### Read what's on a terminal screen
```bash
cmux read-screen --surface surface:1 --lines 50
```

### Open browser and interact with a page
```bash
cmux browser open "https://example.com"
cmux browser wait --load-state complete
cmux browser snapshot
cmux browser click "button.submit"
cmux browser screenshot --out /tmp/result.png
```
