#!/usr/bin/env bash
# Smoke test for `cairn bootstrap --untracked` (contributor mode).
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

# --untracked outside a git repo fails before creating anything
mkdir "$tmp/plain"
if "$ROOT/scripts/bootstrap.sh" --untracked "$tmp/plain" >/dev/null 2>&1; then
  fail "--untracked should refuse a non-git target"
fi
[[ ! -e "$tmp/plain/.ai" ]] || fail "non-git target was partially scaffolded"

# In a git repo: scaffold exists, git sees nothing, entries are anchored
mkdir "$tmp/repo"
git -C "$tmp/repo" init -q
"$ROOT/scripts/bootstrap.sh" --untracked "$tmp/repo" >/dev/null
[[ -f "$tmp/repo/.ai/start-claude.sh" ]] || fail "scaffold missing"
[[ -f "$tmp/repo/.planning/config.json" ]] || fail "planning layer missing"
[[ -z "$(git -C "$tmp/repo" status --porcelain)" ]] || fail "scaffold visible to git"
grep -qxF "/.ai/" "$tmp/repo/.git/info/exclude" || fail "missing /.ai/ exclude entry"
grep -qxF "/.planning/" "$tmp/repo/.git/info/exclude" || fail "missing /.planning/ exclude entry"

# Re-run is idempotent: no duplicate exclude entries
"$ROOT/scripts/bootstrap.sh" --untracked "$tmp/repo" >/dev/null
[[ $(grep -cxF "/.ai/" "$tmp/repo/.git/info/exclude") -eq 1 ]] || fail "duplicate exclude entries"

# Default mode is unchanged: scaffold stays visible to git
mkdir "$tmp/repo2"
git -C "$tmp/repo2" init -q
"$ROOT/scripts/bootstrap.sh" "$tmp/repo2" >/dev/null
git -C "$tmp/repo2" status --porcelain | grep -q "\.ai/" || fail "default mode should leave the scaffold tracked"

echo "PASS: bootstrap --untracked contributor mode"
