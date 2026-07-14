#!/usr/bin/env bash
# smoke-mcp-boot.sh — boot the memory server and run a real MCP `initialize`
# handshake over stdio. Proves the built server actually starts and responds:
# dist is present, deps resolve (esp. under a global install), and the MCP
# transport works. This is the core product path, and nothing else tests it
# after packaging/installation.
#
# Prefers `cairn memory-server` (a global install), else falls back to the
# repository build. The Node probe owns the timeout so this works on macOS,
# which does not ship GNU `timeout`.
set -uo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

if command -v cairn >/dev/null 2>&1; then
  probe=(node "$ROOT_DIR/scripts/probe-memory-server.mjs" --command cairn memory-server)
elif [[ -f "$ROOT_DIR/mcp-memory-server/dist/index.js" ]]; then
  probe=(node "$ROOT_DIR/scripts/probe-memory-server.mjs" "$ROOT_DIR/mcp-memory-server/dist/index.js")
else
  echo "smoke-mcp-boot: FAIL (no cairn on PATH and no dist build to run)"
  exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if HOME="$tmp" "${probe[@]}"; then
  echo "smoke-mcp-boot: OK (server booted, initialize returned tools capability)"
  exit 0
fi
echo "smoke-mcp-boot: FAIL (no valid initialize response)"
exit 1
