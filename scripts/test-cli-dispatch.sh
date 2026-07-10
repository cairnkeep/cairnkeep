#!/usr/bin/env bash
# Smoke test: bin/cairn dispatches the new subcommands.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
fail() { echo "FAIL: $1" >&2; exit 1; }
cairn="$ROOT/bin/cairn"

"$cairn" help | grep -q "cairn doctor" || fail "help missing doctor"
"$cairn" help | grep -q "cairn memory" || fail "help missing memory"
"$cairn" help | grep -q "cairn audit-timer" || fail "help missing audit-timer"

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
CAIRN_AGENTFS_BASE_DIR="$tmp/store" "$cairn" memory path | grep -qx "$tmp/store" || fail "cairn memory path dispatch"
( cd "$tmp" && "$cairn" doctor ) >/dev/null || fail "cairn doctor dispatch (clean env should exit 0)"
"$cairn" audit-timer --render-only "$tmp/u" >/dev/null || fail "cairn audit-timer dispatch"
[[ -f "$tmp/u/memory-wiki-audit.timer" ]] || fail "audit-timer render via cairn produced no units"

echo "PASS: cairn dispatch (doctor, memory, audit-timer)"
