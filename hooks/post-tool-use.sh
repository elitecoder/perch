#!/bin/sh
# Perch hook: PostToolUse / PostToolUseFailure
# Called by Claude Code after a tool completes or is rejected.
# Removes the waiting marker file and any interactive prompt file.

WAITING_DIR="${HOME}/.config/perch/waiting"
INTERACTIVE_DIR="${HOME}/.config/perch/interactive"

# Read stdin to extract session_id
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
SESSION_ID="${SESSION_ID:-${CLAUDE_SESSION_ID:-$$}}"

rm -f "${WAITING_DIR}/${SESSION_ID}.json"
rm -f "${INTERACTIVE_DIR}/${SESSION_ID}.json"
