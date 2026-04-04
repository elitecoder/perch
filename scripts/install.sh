#!/usr/bin/env bash
set -euo pipefail

REPO="elitecoder/perch"
INSTALL_DIR="$HOME/.perch"

info()  { printf "\033[0;36m%s\033[0m\n" "$*"; }
error() { printf "\033[0;31m%s\033[0m\n" "$*" >&2; }
ok()    { printf "\033[0;32m✓ %s\033[0m\n" "$*"; }

# Check dependencies
if ! command -v node &>/dev/null; then
  error "Node.js is required. Install it from https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 20 ]; then
  error "Node.js 20+ is required (found v$(node -v))"
  exit 1
fi

if ! command -v pnpm &>/dev/null; then
  info "Installing pnpm..."
  npm install --global pnpm
fi

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
  info "Updating existing installation..."
  cd "$INSTALL_DIR"
  git pull --ff-only
else
  info "Cloning perch..."
  git clone "https://github.com/$REPO.git" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Build
info "Installing dependencies..."
pnpm install --frozen-lockfile

info "Building..."
pnpm build

# Link CLI
if [ -L "$(command -v perch 2>/dev/null || true)" ]; then
  ok "perch is already linked"
else
  info "Linking perch CLI..."
  pnpm --filter cli link --global 2>/dev/null || npm link
fi

echo ""
ok "Perch installed successfully!"
info "Run 'perch setup' to get started."
