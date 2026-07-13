#!/usr/bin/env bash
# smoke-mcp-boot.sh — boot the memory server and run a real MCP `initialize`
# handshake over stdio. Proves the built server actually starts and responds:
# dist is present, deps resolve (esp. under a global install), and the MCP
# transport works. This is the core product path, and nothing else tests it
# after packaging/installation.
#
# Prefers `cairn memory-server` (a global install), else falls back to node on
# the repo's dist build — so it works both post-install and from a clone.
set -uo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

if command -v cairn >/dev/null 2>&1; then
  server=(cairn memory-server)
elif [[ -f "$ROOT_DIR/mcp-memory-server/dist/index.js" ]]; then
  server=(node "$ROOT_DIR/mcp-memory-server/dist/index.js")
else
  echo "smoke-mcp-boot: FAIL (no cairn on PATH and no dist build to run)"
  exit 1
fi

req='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"ci","version":"0"}}}'

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# HOME points at a throwaway dir so the server's default store (~/.cairnkeep)
# lands there; `head -1` closes stdin after the first reply, so the server sees
# EOF and exits cleanly.
out=$(printf '%s\n' "$req" | HOME="$tmp" timeout 15 "${server[@]}" 2>/dev/null | head -1)

if grep -q '"result"' <<<"$out" && grep -q '"tools"' <<<"$out"; then
  echo "smoke-mcp-boot: OK (server booted, initialize returned tools capability)"
  exit 0
fi
echo "smoke-mcp-boot: FAIL (no valid initialize response)"
echo "  got: ${out:0:200}"
exit 1
