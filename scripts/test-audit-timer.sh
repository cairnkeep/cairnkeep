#!/usr/bin/env bash
# Render test for install-audit-timer.sh: --render-only substitutes every
# placeholder and produces valid-looking unit files (no systemd required).
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

"$ROOT/scripts/install-audit-timer.sh" \
  --para-root "$tmp/PARA" --on-calendar "Mon *-*-* 04:00:00" \
  --report "$tmp/audit.md" --render-only "$tmp/units" >/dev/null

svc="$tmp/units/memory-wiki-audit.service"
tmr="$tmp/units/memory-wiki-audit.timer"
[[ -f "$svc" && -f "$tmr" ]] || fail "unit files not rendered"

# No placeholders left.
! grep -q "@@" "$svc" || fail "unsubstituted @@ placeholder left in service"
! grep -q "@@" "$tmr" || fail "unsubstituted @@ placeholder left in timer"

# Substitutions landed.
grep -q "scripts/memory-wiki-audit.sh --para-root $tmp/PARA --report $tmp/audit.md" "$svc" \
  || fail "service ExecStart not substituted as expected"
grep -q "OnCalendar=Mon \*-\*-\* 04:00:00" "$tmr" || fail "timer OnCalendar not substituted"
grep -q "WantedBy=timers.target" "$tmr" || fail "timer missing [Install] WantedBy"

echo "PASS: audit-timer render (placeholders substituted, units well-formed)"
