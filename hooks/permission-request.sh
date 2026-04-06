#!/bin/sh
# Perch hook: PermissionRequest
# Called by Claude Code when a tool needs user approval.
# Reads the full JSON payload from stdin and writes it as a marker file
# so the Perch daemon can detect the waiting state and show approval buttons.

WAITING_DIR="${HOME}/.config/perch/waiting"
mkdir -p "${WAITING_DIR}"

# Read the full JSON payload from stdin
INPUT=$(cat)

# Extract session_id from JSON payload
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
SESSION_ID="${SESSION_ID:-${CLAUDE_SESSION_ID:-$$}}"

# Write full payload as JSON (monitor reads <sessionId>.json)
echo "$INPUT" > "${WAITING_DIR}/${SESSION_ID}.json"
