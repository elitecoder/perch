#!/bin/sh
# Perch hook: Notification (interactive prompts)
# Called by Claude Code when it needs user attention (permission_prompt,
# idle_prompt, elicitation_dialog). Writes the full payload so the daemon
# can post rich Slack buttons with the available options.

INTERACTIVE_DIR="${HOME}/.config/perch/interactive"
mkdir -p "${INTERACTIVE_DIR}"

# Read the full JSON payload from stdin
INPUT=$(cat)

# Extract session_id from JSON payload
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
SESSION_ID="${SESSION_ID:-${CLAUDE_SESSION_ID:-unknown}}"

echo "$INPUT" > "${INTERACTIVE_DIR}/${SESSION_ID}.json"
