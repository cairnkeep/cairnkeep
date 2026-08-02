#!/usr/bin/env bash
# Contract test: Pi and Kimi expose thin graph adapters owned by `cairn graph`.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

PI_SOURCE="$ROOT/pi/prompts/graphify.md"
KIMI_SOURCE="$ROOT/kimi/skills/graphify/SKILL.md"

[[ -f "$PI_SOURCE" ]] || fail "Pi /graphify prompt source is missing"
[[ -f "$KIMI_SOURCE" ]] || fail "Kimi graphify skill source is missing"

for adapter in "$PI_SOURCE" "$KIMI_SOURCE"; do
  grep -qF 'cairn graph' "$adapter" || fail "adapter does not delegate to cairn graph: $adapter"
  if grep -Ei '(^|[^/[:alnum:]_-])graphify[[:space:]]+(build|update|query|status|diff|explain|path)' "$adapter" >/dev/null; then
    fail "adapter invokes Graphify directly: $adapter"
  fi
  if grep -Ei '(^|[[:space:]`])(curl|git|node|npm|npx|python|python3)[[:space:]]' "$adapter" >/dev/null; then
    fail "adapter introduces a second executable delegate: $adapter"
  fi
done

grep -qF '$ARGUMENTS' "$PI_SOURCE" || fail "Pi prompt does not forward command arguments"
grep -qF 'name: graphify' "$KIMI_SOURCE" || fail "Kimi skill does not register as graphify"
grep -qF '$ARGUMENTS' "$KIMI_SOURCE" || fail "Kimi skill does not forward command arguments"

PI_LIVE="$tmp/pi"
"$ROOT/scripts/sync-pi-assets.sh" --apply --live-root "$PI_LIVE" >"$tmp/pi-first"
[[ -f "$PI_LIVE/extensions/cairnkeep-trajectory.ts" ]] || fail "Pi sync omitted trajectory extension"
cmp -s "$PI_SOURCE" "$PI_LIVE/prompts/graphify.md" || fail "Pi sync changed graphify prompt bytes"
"$ROOT/scripts/sync-pi-assets.sh" --apply --live-root "$PI_LIVE" >"$tmp/pi-second"
grep -qF 'Applied 0 Pi asset(s); 2 already matched.' "$tmp/pi-second" || fail "Pi sync is not idempotent"

KIMI_LIVE="$tmp/kimi"
"$ROOT/scripts/sync-kimi-assets.sh" --apply --live-root "$KIMI_LIVE" >"$tmp/kimi-first"
cmp -s "$KIMI_SOURCE" "$KIMI_LIVE/skills/graphify/SKILL.md" || fail "Kimi sync changed graphify skill bytes"
"$ROOT/scripts/sync-kimi-assets.sh" --apply --live-root "$KIMI_LIVE" >"$tmp/kimi-second"
grep -qF 'Applied 0 Kimi asset(s); 1 already matched.' "$tmp/kimi-second" || fail "Kimi sync is not idempotent"

"$ROOT/bin/cairn" help | grep -qF 'cairn sync-kimi' || fail "CLI help omits sync-kimi"
"$ROOT/bin/cairn" sync-kimi --help >/dev/null || fail "CLI does not dispatch sync-kimi"

echo "PASS: thin Pi and Kimi graph adapters delegate only to cairn graph"
