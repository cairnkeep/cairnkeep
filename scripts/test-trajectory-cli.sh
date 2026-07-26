#!/usr/bin/env bash
# Public CLI contract for `cairn trajectory list|show|prune`.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

cairn="$ROOT/bin/cairn"
fixture="$ROOT/mcp-memory-server/scripts/fixtures/trajectory-opencode.json"
cli="$ROOT/mcp-memory-server/dist/trajectory-cli.js"
repo="$tmp/project"
mkdir -p "$repo/.agentfs"

"$cairn" help | grep -q "cairn trajectory" || fail "help missing trajectory"

printf '%s' "$(cat "$fixture")" | node "$cli" capture-opencode "$repo" >/dev/null

(cd "$repo" && "$cairn" trajectory list --json) > "$tmp/list.json"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(j.sessions?.[0]?.session_id!=="opencode-session-001")process.exit(1)' "$tmp/list.json" \
  || fail "trajectory list JSON missing captured session"

(cd "$repo" && "$cairn" trajectory show opencode-session-001 --json) > "$tmp/show.json"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(j.schema_version!==1||!Array.isArray(j.events))process.exit(1)' "$tmp/show.json" \
  || fail "trajectory show JSON is not a v1 session"

(cd "$repo" && "$cairn" trajectory prune --dry-run --json) > "$tmp/prune.json"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(!Array.isArray(j.removed)||j.dry_run!==true)process.exit(1)' "$tmp/prune.json" \
  || fail "trajectory prune dry-run JSON invalid"

if (cd "$repo" && "$cairn" trajectory show does-not-exist --json) >"$tmp/missing.out" 2>"$tmp/missing.err"; then
  fail "show of missing session should fail"
fi
grep -q "not found" "$tmp/missing.err" || fail "missing-session error is not actionable"

echo "PASS: cairn trajectory CLI dispatch and JSON contract"
