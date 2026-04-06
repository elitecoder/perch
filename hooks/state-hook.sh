#!/bin/sh
# Perch hook: state transitions
# Called by Claude Code hooks (Stop, UserPromptSubmit, Notification, PreToolUse).
# Writes the event type so the daemon can detect Claude's state.
#
# Usage: sh state-hook.sh <event>
# Events: stop, prompt-submit, notification, pre-tool-use
#
# Claude Code provides SESSION_ID via stdin JSON or CLAUDE_SESSION_ID env var.
# We read stdin to extract session_id from the JSON payload.

EVENT="$1"
STATE_DIR="${HOME}/.config/perch/hook-state"
mkdir -p "${STATE_DIR}"

# Read stdin (Claude sends JSON payload)
INPUT=$(cat)

# Extract session_id from JSON payload
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)

# Fallback to env var, then "unknown"
SESSION_ID="${SESSION_ID:-${CLAUDE_SESSION_ID:-unknown}}"

# Debug: log what we received
echo "{\"event\":\"${EVENT}\",\"session_id\":\"${SESSION_ID}\",\"ts\":$(date +%s),\"env_sid\":\"${CLAUDE_SESSION_ID:-}\"}" > "${STATE_DIR}/_debug_last.json"

# Append event (not overwrite) so no events are lost between ticks
SESSION_FILE="${STATE_DIR}/${SESSION_ID}.events"
echo "${EVENT}" >> "${SESSION_FILE}"
