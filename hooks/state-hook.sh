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

# Record pid→sessionId so the transcript resolver can disambiguate
# same-cwd sibling Claude processes. The hook runs as a child of the
# Claude process (or its tool-use shell) — walk up until we find a
# process whose args contain --session-id <SESSION_ID>. $PPID alone
# is not enough on macOS because some hook events are wrapped by an
# extra shell. We write atomically (tmp + mv) so concurrent writers
# never leave a half-written file for the daemon to read.
if [ -n "${SESSION_ID}" ] && [ "${SESSION_ID}" != "unknown" ]; then
  CUR="${PPID}"
  CLAUDE_PID=""
  for _ in 1 2 3 4; do
    [ -z "${CUR}" ] || [ "${CUR}" -le 1 ] && break
    if ps -o args= -p "${CUR}" 2>/dev/null | grep -q -- "--session-id"; then
      CLAUDE_PID="${CUR}"
      break
    fi
    CUR=$(ps -o ppid= -p "${CUR}" 2>/dev/null | tr -d ' ')
  done
  if [ -n "${CLAUDE_PID}" ]; then
    TMP="${STATE_DIR}/.${CLAUDE_PID}.sid.$$"
    printf '%s' "${SESSION_ID}" > "${TMP}" && mv "${TMP}" "${STATE_DIR}/${CLAUDE_PID}.sid"
  fi
fi
