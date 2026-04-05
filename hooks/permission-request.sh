#!/bin/sh
# Perch hook: PermissionRequest
# Called by Claude Code when a tool needs user approval.
# Writes a marker file so the Perch daemon can detect the waiting state.

WAITING_DIR="${HOME}/.config/perch/waiting"
mkdir -p "${WAITING_DIR}"
echo "${CLAUDE_SESSION_ID}" > "${WAITING_DIR}/${CLAUDE_SESSION_ID:-$$}"
