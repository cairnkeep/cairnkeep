#!/usr/bin/env bash
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MARKER="PHASE16_RED:PACKAGE_UNINSTALL_CONTRACT_MISSING"

case "${1:-}" in
  "")
    test "$#" -eq 0 || exit 2
    "$ROOT/scripts/test-package-install.sh" || exit 1
    "$ROOT/scripts/test-uninstall.sh" || exit 1
    echo "PASS: Phase 16 package/uninstall baseline"
    ;;
  --expect-red)
    test "$#" -eq 1 || exit 2
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT

    mkdir -p "$tmp/expected/schemas" "$tmp/expected/mcp-memory-server/dist"
    mkdir -p "$tmp/store/notes/.cairnkeep/transactions/txn-prepared/history"
    printf '%s\n' '{"schema_version":1,"node_type":"knowledge","tags":["release"]}' >"$tmp/store/identity-node-metadata.json"
    printf '%s\n' '{"schema_version":1,"import_id":"package-fixture","batch_digest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}' >"$tmp/store/identity-import-replay.json"
    printf '%s\n' '{"schema_version":1,"state":"prepared"}' >"$tmp/store/notes/.cairnkeep/transactions/txn-prepared/journal.json"
    printf '%s\n' 'history bytes' >"$tmp/store/notes/.cairnkeep/transactions/txn-prepared/history/note.json"

    expected="schemas/memory-node.schema.json mcp-memory-server/dist/node-schema.js mcp-memory-server/dist/node-store.js mcp-memory-server/dist/node-cli.js"
    listing=$(cd "$ROOT" && npm pack --dry-run --json --ignore-scripts 2>/dev/null) || exit 1
    missing=0
    for path in $expected; do
      if ! printf '%s\n' "$listing" | grep -Fq "\"path\": \"$path\""; then
        missing=$((missing + 1))
      fi
    done
    test "$missing" -gt 0 || {
      echo "Phase 16 package artifacts are already present; expected RED is stale" >&2
      exit 1
    }
    grep -q -- '--purge-memory' "$ROOT/scripts/uninstall.sh" || exit 1
    if grep -q 'identity-node-metadata\|txn-prepared' "$ROOT/scripts/test-uninstall.sh"; then
      echo "Phase 16 uninstall fixtures are already covered; expected RED is stale" >&2
      exit 1
    fi
    printf '%s\n' "$MARKER" >&2
    exit 86
    ;;
  *)
    echo "Usage: $0 [--expect-red]" >&2
    exit 2
    ;;
esac
