#!/bin/sh
# Perch hook: PreToolUse (AskUserQuestion, ExitPlanMode, etc.)
# Called by Claude Code before a tool runs. Only writes a payload for
# interactive tools that need Slack buttons — ignores regular tools
# (Read, Bash, etc.) to avoid false "needs attention" notifications.

# Read the full JSON payload from stdin
INPUT=$(cat)

# Extract tool_name
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name":"[^"]*"' | head -1 | cut -d'"' -f4)

# Only write for tools that actually require user interaction
case "$TOOL_NAME" in
  AskUserQuestion|ExitPlanMode|EnterPlanMode)
    INTERACTIVE_DIR="${HOME}/.config/perch/interactive"
    mkdir -p "${INTERACTIVE_DIR}"

    SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
    SESSION_ID="${SESSION_ID:-${CLAUDE_SESSION_ID:-unknown}}"

    echo "$INPUT" > "${INTERACTIVE_DIR}/${SESSION_ID}.json"
    ;;
esac
