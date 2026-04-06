#!/bin/sh
# Perch hook: Notification (interactive prompts)
# Called by Claude Code for various notification types. Only writes a payload
# for interactive notifications that need user action — ignores informational
# ones to avoid false "needs attention" buttons.

# Read the full JSON payload from stdin
INPUT=$(cat)

# Extract notification_type
NOTIF_TYPE=$(echo "$INPUT" | grep -o '"notification_type":"[^"]*"' | head -1 | cut -d'"' -f4)

# Only write for interactive notification types
case "$NOTIF_TYPE" in
  permission_prompt|idle_prompt|elicitation_dialog)
    INTERACTIVE_DIR="${HOME}/.config/perch/interactive"
    mkdir -p "${INTERACTIVE_DIR}"

    SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
    SESSION_ID="${SESSION_ID:-${CLAUDE_SESSION_ID:-unknown}}"

    echo "$INPUT" > "${INTERACTIVE_DIR}/${SESSION_ID}.json"
    ;;
esac
