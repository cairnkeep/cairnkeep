#!/usr/bin/env bash
# Round-trip test for `cairn memory export/import/path`.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

mem="$ROOT/scripts/memory-store.sh"

# path prints the resolved base dir.
CAIRN_AGENTFS_BASE_DIR="$tmp/store" "$mem" path | grep -qx "$tmp/store" \
  || fail "path did not print the resolved base dir"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "  (sqlite3 absent — skipped export/import round-trip)"
  echo "PASS: cairn memory path (export/import skipped)"
  exit 0
fi

# Seed a store with two scopes and known rows.
mkdir -p "$tmp/store"
sqlite3 "$tmp/store/identity.db" "CREATE TABLE m(k TEXT, v TEXT); INSERT INTO m VALUES('who','stefano');"
sqlite3 "$tmp/store/work-memory.db" "CREATE TABLE m(k TEXT, v TEXT); INSERT INTO m VALUES('proj','triumvir');"

# Export from store A.
CAIRN_AGENTFS_BASE_DIR="$tmp/store" "$mem" export "$tmp/export.tgz" >/dev/null
[[ -f "$tmp/export.tgz" ]] || fail "export archive not created"

# Import into a fresh store B and verify both scopes + rows survived.
CAIRN_AGENTFS_BASE_DIR="$tmp/store2" "$mem" import "$tmp/export.tgz" >/dev/null
[[ -f "$tmp/store2/identity.db" ]] || fail "identity.db missing after import"
[[ -f "$tmp/store2/work-memory.db" ]] || fail "work-memory.db missing after import"
got=$(sqlite3 "$tmp/store2/identity.db" "SELECT v FROM m WHERE k='who';")
[[ "$got" == "stefano" ]] || fail "identity row not preserved (got '$got')"
got=$(sqlite3 "$tmp/store2/work-memory.db" "SELECT v FROM m WHERE k='proj';")
[[ "$got" == "triumvir" ]] || fail "work-memory row not preserved (got '$got')"

# Import over an existing store backs up the prior file.
CAIRN_AGENTFS_BASE_DIR="$tmp/store2" "$mem" import "$tmp/export.tgz" >/dev/null
[[ -f "$tmp/store2/identity.db.bak-pre-import" ]] || fail "existing store not backed up on re-import"

echo "PASS: cairn memory export/import round-trip + path"
