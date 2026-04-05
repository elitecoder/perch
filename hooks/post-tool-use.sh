#!/bin/sh
# Perch hook: PostToolUse / PostToolUseFailure
# Called by Claude Code after a tool completes or is rejected.
# Removes the waiting marker file.

WAITING_DIR="${HOME}/.config/perch/waiting"
rm -f "${WAITING_DIR}/${CLAUDE_SESSION_ID:-$$}"
