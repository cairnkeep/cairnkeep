#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

render() {
  sed "s|@@INFRA_ROOT@@|$ROOT|g" "$1" > "$2"
}

mkdir -p "$tmp/project" "$tmp/rendered"
render "$ROOT/opencode/plugins/memory-capture.ts" "$tmp/rendered/memory-capture.ts"
render "$ROOT/opencode/plugins/memory-recall.ts" "$tmp/rendered/memory-recall.ts"
render "$ROOT/opencode/plugins/memory-wakeup.ts" "$tmp/rendered/memory-wakeup.ts"

CAIRN_TRAJECTORY_CAPTURE=1 node --experimental-strip-types \
  "$ROOT/scripts/lib/opencode-v2-plugin-harness.mjs" \
  "$tmp/rendered/memory-capture.ts" \
  "$tmp/rendered/memory-recall.ts" \
  "$tmp/rendered/memory-wakeup.ts" \
  "$tmp/project" \
  "$ROOT/mcp-memory-server/dist/trajectory-cli.js"

# When a V2 binary is available, also exercise the real loader in a sterile
# config/data tree. CI remains deterministic without installing an unrelated
# harness package; release workstations run this second gate automatically.
if ! command -v opencode >/dev/null 2>&1; then
  echo "SKIP: live OpenCode V2 loader (opencode not installed)"
  exit 0
fi

version=$(opencode --version 2>/dev/null || true)
major=$(printf '%s\n' "$version" | sed -nE 's/.*v([0-9]+).*/\1/p')
if [[ -z "$major" || "$major" -lt 2 ]]; then
  echo "SKIP: live OpenCode V2 loader ($version)"
  exit 0
fi

git -C "$tmp/project" init -q
"$ROOT/scripts/sync-opencode-plugin-assets.sh" --apply --live-root "$tmp/config" >/dev/null

set +e
(
  cd "$tmp/project"
  XDG_DATA_HOME="$tmp/data" \
    XDG_CACHE_HOME="$tmp/cache" \
    XDG_STATE_HOME="$tmp/state" \
    OPENCODE_CONFIG_DIR="$tmp/config" \
    TERM=dumb \
    timeout 5 opencode --standalone --print-logs --log-level debug
) >"$tmp/live.out" 2>"$tmp/live.err"
live_status=$?
set -e

if [[ "$live_status" -ne 0 && "$live_status" -ne 124 ]]; then
  echo "FAIL: live OpenCode V2 loader exited with $live_status" >&2
  sed -n '1,160p' "$tmp/live.err" >&2
  exit 1
fi

for plugin in memory-capture.ts memory-recall.ts memory-wakeup.ts; do
  grep -q "loading plugin.*$plugin" "$tmp/live.err" || {
    echo "FAIL: live OpenCode V2 did not load $plugin" >&2
    exit 1
  }
done

if grep -Eq 'SchemaError|Missing key at \["default"\]|failed to load plugin' "$tmp/live.err"; then
  echo "FAIL: live OpenCode V2 rejected a Cairnkeep plugin" >&2
  sed -n '1,200p' "$tmp/live.err" >&2
  exit 1
fi

echo "PASS: live OpenCode $version loaded all Cairnkeep V2 plugins"
