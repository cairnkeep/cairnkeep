#!/usr/bin/env bash
# PostCompact hook: persist the harness-produced compaction summary locally.
# The hook never generates or changes a summary and always fails open.
set -euo pipefail

case "${CAIRN_COMPACTION_CAPTURE:-}" in
  1|true|TRUE|yes|YES|on|ON) ;;
  *) exit 0 ;;
esac

repo="$(pwd)"
ARTIFACT_ENTRY="@@INFRA_ROOT@@/mcp-memory-server/dist/artifact-cli.js"
[ -f "$ARTIFACT_ENTRY" ] || exit 0

# The payload has no version field. Resolve the running harness locally so an
# unpinned future shape cannot be accepted merely because its keys look known.
harness_version=$(claude --version 2>/dev/null | sed -nE 's/[^0-9]*([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' | head -1)
[ -n "$harness_version" ] || harness_version=unknown

# Forward the documented PostCompact payload unchanged. The local CLI owns
# shape validation, redaction, and persistence; this boundary stays bounded
# and cannot block or fail the harness event.
node "$ARTIFACT_ENTRY" capture-claude "$repo" --harness-version "$harness_version" <&0 >/dev/null 2>&1 &
capture_pid=$!
(
  sleep 3
  kill -KILL "$capture_pid" >/dev/null 2>&1 || true
) &
watchdog_pid=$!
wait "$capture_pid" >/dev/null 2>&1 || true
kill "$watchdog_pid" >/dev/null 2>&1 || true
wait "$watchdog_pid" >/dev/null 2>&1 || true

exit 0
