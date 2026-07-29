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

# Scheduled note distillation stays in the same separate audit process and is
# activated only by the effective note capability state.
npm --prefix "$ROOT/mcp-memory-server" run build >/dev/null
mkdir -p "$tmp/PARA/Projects/empty-project"
[[ -x "$ROOT/scripts/memory-wiki-audit.sh" ]] || fail "audit script is not executable for systemd"
CAIRN_AGENTFS_BASE_DIR="$tmp/store-off" env -u CAIRN_NOTE_DISTILLATION \
  "$ROOT/scripts/memory-wiki-audit.sh" --para-root "$tmp/PARA" >"$tmp/audit-off.md"
[[ ! -e "$tmp/store-off/notes" ]] || fail "flag-off audit created note storage"
CAIRN_AGENTFS_BASE_DIR="$tmp/store-on" CAIRN_NOTE_DISTILLATION=1 \
  "$ROOT/scripts/memory-wiki-audit.sh" --para-root "$tmp/PARA" >"$tmp/audit-on.md"
grep -q "Note distillation" "$tmp/audit-on.md" || fail "flag-on audit omitted note distillation status"

managed="$tmp/managed"
managed_para="$managed/PARA"
mkdir -p "$managed_para/Projects/empty-project"

# Master-off keeps the inherited compatibility path even when staged managed
# state says otherwise.
(cd "$managed" && CAIRN_CAPABILITY_CONTRACT=1 "$ROOT/bin/cairn" capabilities enable notes.distill --json >/dev/null)
(cd "$managed" && env -u CAIRN_CAPABILITY_CONTRACT -u CAIRN_NOTE_DISTILLATION -u CAIRN_CAPABILITY_NOTES_DISTILL \
  CAIRN_AGENTFS_BASE_DIR="$tmp/store-master-off" \
  "$ROOT/scripts/memory-wiki-audit.sh" --para-root "$managed_para" >"$tmp/audit-master-off.md")
! grep -q "Note distillation" "$tmp/audit-master-off.md" || fail "master-off audit consumed staged managed state"

# Project state and the derived environment override follow the central
# environment > project > compatibility precedence.
(cd "$managed" && CAIRN_CAPABILITY_CONTRACT=1 "$ROOT/bin/cairn" capabilities disable notes.distill --json >/dev/null)
(cd "$managed" && CAIRN_CAPABILITY_CONTRACT=1 CAIRN_NOTE_DISTILLATION=1 \
  "$ROOT/scripts/memory-wiki-audit.sh" --para-root "$managed_para" >"$tmp/audit-managed-disabled.md")
! grep -q "Note distillation" "$tmp/audit-managed-disabled.md" || fail "managed disable did not override compatibility enable"

(cd "$managed" && CAIRN_CAPABILITY_CONTRACT=1 CAIRN_CAPABILITY_NOTES_DISTILL=1 \
  "$ROOT/scripts/memory-wiki-audit.sh" --para-root "$managed_para" >"$tmp/audit-env-enabled.md")
grep -q "Note distillation: completed" "$tmp/audit-env-enabled.md" || fail "environment enable did not override managed disable"

(cd "$managed" && CAIRN_CAPABILITY_CONTRACT=1 "$ROOT/bin/cairn" capabilities enable notes.distill --json >/dev/null)
(cd "$managed" && CAIRN_CAPABILITY_CONTRACT=1 CAIRN_CAPABILITY_NOTES_DISTILL=0 CAIRN_NOTE_DISTILLATION=1 \
  "$ROOT/scripts/memory-wiki-audit.sh" --para-root "$managed_para" >"$tmp/audit-env-disabled.md")
! grep -q "Note distillation" "$tmp/audit-env-disabled.md" || fail "environment disable did not override managed enable"

(cd "$managed" && CAIRN_CAPABILITY_CONTRACT=1 "$ROOT/bin/cairn" capabilities reset notes.distill --json >/dev/null)
(cd "$managed" && env -u CAIRN_NOTE_DISTILLATION CAIRN_CAPABILITY_CONTRACT=1 \
  "$ROOT/scripts/memory-wiki-audit.sh" --para-root "$managed_para" >"$tmp/audit-reset-off.md")
! grep -q "Note distillation" "$tmp/audit-reset-off.md" || fail "reset did not restore inherited default-off state"
(cd "$managed" && CAIRN_CAPABILITY_CONTRACT=1 CAIRN_NOTE_DISTILLATION=1 \
  "$ROOT/scripts/memory-wiki-audit.sh" --para-root "$managed_para" >"$tmp/audit-reset-on.md")
grep -q "Note distillation: completed" "$tmp/audit-reset-on.md" || fail "reset did not restore compatibility enable"

# Disabled state performs no note or callback-store work even when logging and
# trajectory capture are both consented.
(cd "$managed" && CAIRN_CAPABILITY_CONTRACT=1 "$ROOT/bin/cairn" capabilities disable notes.distill --json >/dev/null)
(cd "$managed" && CAIRN_CAPABILITY_CONTRACT=1 CAIRN_CAPABILITY_LOGGING=1 CAIRN_TRAJECTORY_CAPTURE=1 \
  "$ROOT/scripts/memory-wiki-audit.sh" --para-root "$managed_para" >"$tmp/audit-disabled-consented.md")
[[ ! -e "$managed/.agentfs/trajectory.db" ]] || fail "disabled audit created callback storage"

# Enabled jobs create callback metadata only when all three consents are on.
logging="$tmp/logging"
logging_para="$logging/PARA"
mkdir -p "$logging_para/Projects/empty-project"
(cd "$logging" && CAIRN_CAPABILITY_CONTRACT=1 "$ROOT/bin/cairn" capabilities enable notes.distill --json >/dev/null)
(cd "$logging" && CAIRN_CAPABILITY_CONTRACT=1 CAIRN_CAPABILITY_LOGGING=1 \
  "$ROOT/scripts/memory-wiki-audit.sh" --para-root "$logging_para" >"$tmp/audit-no-capture.md")
[[ ! -e "$logging/.agentfs/trajectory.db" ]] || fail "capture-off audit created callback storage"
(cd "$logging" && CAIRN_CAPABILITY_CONTRACT=1 CAIRN_TRAJECTORY_CAPTURE=1 \
  "$ROOT/scripts/memory-wiki-audit.sh" --para-root "$logging_para" >"$tmp/audit-no-logging.md")
[[ ! -e "$logging/.agentfs/trajectory.db" ]] || fail "logging-off audit created callback storage"
(cd "$logging" && CAIRN_CAPABILITY_CONTRACT=1 CAIRN_CAPABILITY_LOGGING=1 CAIRN_TRAJECTORY_CAPTURE=1 \
  "$ROOT/scripts/memory-wiki-audit.sh" --para-root "$logging_para" >"$tmp/audit-logged.md")
PROJECT="$logging" node --input-type=module -e '
  const { listCapabilityRecords } = await import("./mcp-memory-server/dist/capability-store.js");
  const rows = (await listCapabilityRecords(process.env.PROJECT)).records;
  if (rows.length !== 1 || rows[0].capability_id !== "notes.distill" || rows[0].outcome !== "success"
      || rows[0].source !== "notes-cli" || rows[0].transport !== "local-process") process.exit(1);
' || fail "all-consent audit did not create one exact note callback record"

# A note child failure remains visible but cannot mask deterministic wiki
# findings or change their established exit code.
failure="$tmp/failure"
failure_para="$failure/PARA"
wiki="$failure_para/Projects/stale/.planning/wiki"
mkdir -p "$wiki/sources" "$failure/fake-bin"
printf '%s\n' '- Last reviewed: 2000-01-01' >"$wiki/sources/stale.md"
printf '%s\n' '# Index' >"$wiki/index.md"
(cd "$failure" && CAIRN_CAPABILITY_CONTRACT=1 "$ROOT/bin/cairn" capabilities enable notes.distill --json >/dev/null)
real_node=$(command -v node)
printf '%s\n' '#!/usr/bin/env bash' \
  'if [[ "$1" == *"/note-cli.js" ]]; then exit 42; fi' \
  'exec "$REAL_NODE" "$@"' >"$failure/fake-bin/node"
chmod +x "$failure/fake-bin/node"
set +e
(cd "$failure" && REAL_NODE="$real_node" PATH="$failure/fake-bin:$PATH" CAIRN_CAPABILITY_CONTRACT=1 \
  "$ROOT/scripts/memory-wiki-audit.sh" --para-root "$failure_para" >"$tmp/audit-failed-note.md")
audit_status=$?
set -e
[[ "$audit_status" == 3 ]] || fail "note failure changed deterministic wiki audit exit status"
grep -q "stale source pages" "$tmp/audit-failed-note.md" || fail "note failure masked deterministic wiki findings"
grep -q "Note distillation: failed" "$tmp/audit-failed-note.md" || fail "note failure status was not reported"

echo "PASS: audit-timer render (placeholders substituted, units well-formed)"
