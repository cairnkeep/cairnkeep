#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
EXPECTED_RED_EXIT=86
RED_MARKER="PHASE26_RED:SETUP_OUTPUT_MISSING"
MANAGED_PATHS=(.ai .planning .agentfs)

fail() { echo "FAIL: $1" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

assert_no_managed_paths() {
  local target=$1 label=$2 path
  for path in "${MANAGED_PATHS[@]}"; do
    [[ ! -e "$target/$path" ]] || fail "$label created $path"
  done
}

# Baseline and fixture checks always run, including while this is an intentional
# RED contract. This keeps routine test discovery useful before setup ships.
"$ROOT/bin/cairn" help >/dev/null || fail "existing help dispatch failed"
mkdir -p "$tmp/complete target" "$tmp/limited target" "$tmp/invalid target"
printf 'operator\n' >"$tmp/invalid target/operator.txt"
assert_no_managed_paths "$tmp/complete target" "complete fixture"
assert_no_managed_paths "$tmp/limited target" "limited fixture"
assert_no_managed_paths "$tmp/invalid target" "invalid fixture"

setup_surface_complete=true
for required in \
  "$ROOT/scripts/setup.mjs" \
  "$ROOT/scripts/setup-core.mjs" \
  "$ROOT/scripts/setup-reconcile.mjs" \
  "$ROOT/schemas/cairnkeep-setup.schema.json" \
  "$ROOT/schemas/cairnkeep-setup-policy.schema.json"; do
  [[ -f "$required" ]] || setup_surface_complete=false
done

if [[ "$setup_surface_complete" != true ]]; then
  if [[ "${CAIRN_PHASE26_RED:-0}" == 1 ]]; then
    echo "$RED_MARKER"
    exit "$EXPECTED_RED_EXIT"
  fi
  echo "SKIP: guided setup output production surface is not complete"
  exit 0
fi

complete_json="$tmp/complete.json"
"$ROOT/bin/cairn" setup "$tmp/complete target" \
  --git init --harness claude,pi --memory local --yes --json >"$complete_json"
node --input-type=module - "$complete_json" <<'NODE'
import assert from "node:assert/strict";
import fs from "node:fs";

const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
assert.equal(result.schema_version, 1);
assert.equal(result.status, "complete");
assert.equal(result.git, "init");
assert.equal(result.memory, "local");
assert.deepEqual(result.harnesses, ["claude", "pi"]);
assert.deepEqual(Object.keys(result.counts).sort(), ["created", "skipped", "unchanged", "updated"]);
for (const value of Object.values(result.counts)) assert.equal(Number.isInteger(value) && value >= 0, true);
assert.equal(Array.isArray(result.verification) && result.verification.length > 0, true);
assert.equal(Array.isArray(result.launch_commands) && result.launch_commands.length, 2);
assert.equal(result.launch_commands.some((line) => /start-claude\.sh/.test(line)), true);
assert.equal(result.launch_commands.some((line) => /start-pi\.sh/.test(line)), true);
assert.equal(Array.isArray(result.recovery), true);
assert.equal(result.machine_sync.automatic, false);
assert.match(result.machine_sync.command, /^cairn sync(?:-pi)? --(?:check|apply)/);
NODE

complete_human="$tmp/complete.txt"
"$ROOT/bin/cairn" setup "$tmp/complete target" \
  --git init --harness claude,pi --memory local --yes >"$complete_human"
for expected in \
  "Harnesses: claude, pi" \
  "Git mode: init" \
  "Memory mode: local" \
  "Created:" \
  "Updated:" \
  "Unchanged:" \
  "Skipped:" \
  "Verification:" \
  "Launch:" \
  "Recovery:"; do
  grep -qF "$expected" "$complete_human" || fail "human output missing $expected"
done
grep -qE 'cairn sync(-pi)? --(check|apply)' "$complete_human" || fail "human output omitted explicit machine sync direction"

limited_json="$tmp/limited.json"
"$ROOT/bin/cairn" setup "$tmp/limited target" \
  --git none --harness kimi --memory none --yes --json >"$limited_json"
node --input-type=module - "$limited_json" <<'NODE'
import assert from "node:assert/strict";
import fs from "node:fs";
const result = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
assert.equal(result.schema_version, 1);
assert.equal(result.status, "limited");
assert.equal(result.git, "none");
assert.equal(result.memory, "none");
assert.deepEqual(result.harnesses, ["kimi"]);
assert.equal(Array.isArray(result.limitations) && result.limitations.length > 0, true);
assert.equal(result.limitations.some((line) => /git|repository/i.test(line)), true);
assert.equal(Array.isArray(result.recovery), true);
NODE

set +e
"$ROOT/bin/cairn" setup "$tmp/invalid target" --yes >"$tmp/incomplete.out" 2>"$tmp/incomplete.err"
incomplete_status=$?
"$ROOT/bin/cairn" setup "$tmp/invalid target" --git sometimes --harness claude --memory local --yes >"$tmp/invalid.out" 2>"$tmp/invalid.err"
invalid_status=$?
set -e
[[ "$incomplete_status" -eq 2 ]] || fail "incomplete non-TTY choices must exit 2"
[[ "$invalid_status" -eq 2 ]] || fail "invalid syntax must exit 2"
grep -Eqi 'usage|requires|missing' "$tmp/incomplete.err" || fail "incomplete choices lack actionable usage"
grep -Eqi 'git|invalid|usage' "$tmp/invalid.err" || fail "invalid Git mode lacks actionable usage"
assert_no_managed_paths "$tmp/invalid target" "usage failures"

mkdir -p "$tmp/no-git-bin"
ln -s "$(command -v node)" "$tmp/no-git-bin/node"
set +e
PATH="$tmp/no-git-bin" "$ROOT/bin/cairn" setup "$tmp/operational target" \
  --git existing --harness claude --memory local --yes >"$tmp/operational.out" 2>"$tmp/operational.err"
operational_status=$?
set -e
[[ "$operational_status" -ne 0 && "$operational_status" -ne 2 ]] || fail "missing Git was collapsed into a usage error"
grep -qi 'git' "$tmp/operational.err" || fail "missing Git failure lacks recovery context"
assert_no_managed_paths "$tmp/operational target" "operational preflight failure"

echo "PASS: guided setup human, JSON, limited, usage, and recovery output contract"
