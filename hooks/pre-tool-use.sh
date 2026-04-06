#!/bin/sh
# Perch hook: PreToolUse (AskUserQuestion, ExitPlanMode, etc.)
# Called by Claude Code before a tool runs. For interactive tools like
# AskUserQuestion, writes the payload so the daemon can post options to Slack.
# Non-blocking: exits immediately (Claude shows its own terminal UI).

INTERACTIVE_DIR="${HOME}/.config/perch/interactive"
mkdir -p "${INTERACTIVE_DIR}"

# Read the full JSON payload from stdin
INPUT=$(cat)

# Extract session_id from JSON payload
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
SESSION_ID="${SESSION_ID:-${CLAUDE_SESSION_ID:-unknown}}"

# Extract tool_name to tag the type
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)

echo "$INPUT" > "${INTERACTIVE_DIR}/${SESSION_ID}.json"
