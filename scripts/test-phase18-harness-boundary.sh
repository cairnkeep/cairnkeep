#!/usr/bin/env bash
# Native Claude/OpenCode capability-boundary contract tests. The no-argument
# path is intentionally inert until the production owners land in Plans 19-20.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FIXTURE="$ROOT/scripts/fixtures/capability-harness-contracts.json"
CLAUDE_START="$ROOT/claude/capability-contract/hooks/capability-command-start.sh"
CLAUDE_FINISH="$ROOT/claude/capability-contract/hooks/capability-command-finish.sh"
OPENCODE_PLUGIN="$ROOT/opencode/capability-contract/plugins/capability-command.ts"
OPENCODE_HARNESS="$ROOT/scripts/lib/capability-opencode-plugin-harness.mjs"
RED_EXIT=86

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

usage() {
  printf '%s\n' \
    "Usage: test-phase18-harness-boundary.sh MODE" \
    "" \
    "RED modes:" \
    "  --expect-red-claude     prove native Claude hook ownership is absent" \
    "  --expect-red-opencode   prove native OpenCode plugin ownership is absent" \
    "" \
    "Production modes (enabled by later Phase 18 plans):" \
    "  claude-hooks | opencode-plugin | opencode-sync-modes" \
    "  claude-owner-only | opencode-command-owner-only | opencode-owner-only" \
    "  evidence-scope" \
    "" \
    "Live negative controls:" \
    "  --live-claude | --live-opencode"
}

validate_fixture() {
  node - "$FIXTURE" <<'NODE'
const fs = require("node:fs");
const fixture = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (fixture?.claude?.version !== "2.1.220") process.exit(1);
if (fixture?.opencode?.version !== "1.17.20") process.exit(1);
if (fixture?.opencode?.source?.commit !== "4473fc3c9055046183990a965d68df3db7ea6f62") process.exit(1);
const claudeEvents = Object.keys(fixture.claude.events).sort().join(",");
if (claudeEvents !== "CwdChanged,SessionEnd,Stop,StopFailure,UserPromptExpansion,UserPromptSubmit") process.exit(1);
const openCodeEvents = Object.keys(fixture.opencode.events).sort().join(",");
if (openCodeEvents !== "session.deleted,session.error,session.idle,session.status") process.exit(1);
if (fixture.opencode.hook.name !== "command.execute.before") process.exit(1);
NODE
}

assert_no_native_claude_assets() {
  local live_root="$1"
  [[ ! -e "$live_root/hooks/capability-command-start.sh" ]] || fail "normal Claude sync installed the capability start hook"
  [[ ! -e "$live_root/hooks/capability-command-finish.sh" ]] || fail "normal Claude sync installed the capability finish hook"
  if [[ -f "$live_root/settings.json" ]] && grep -q 'capability-command-' "$live_root/settings.json"; then
    fail "normal Claude sync registered a capability hook"
  fi
}

assert_no_native_opencode_assets() {
  local live_root="$1"
  [[ ! -e "$live_root/plugins/capability-command.ts" ]] || fail "normal OpenCode sync installed the capability plugin"
  if [[ -d "$live_root/plugins" ]] && grep -R -q 'CapabilityCommandPlugin' "$live_root/plugins"; then
    fail "normal OpenCode sync registered the capability plugin"
  fi
}

normal_sync_trace() {
  local temp_root="$1"
  local claude_root="$temp_root/claude"
  local opencode_root="$temp_root/opencode"
  local trace="$temp_root/process.trace"

  : > "$trace"
  printf 'sync:claude:normal\n' >> "$trace"
  "$ROOT/scripts/sync-claude-assets.sh" --apply --live-root "$claude_root" >/dev/null
  printf 'sync:opencode:normal\n' >> "$trace"
  "$ROOT/scripts/sync-opencode-plugin-assets.sh" --apply --live-root "$opencode_root" >/dev/null

  assert_no_native_claude_assets "$claude_root"
  assert_no_native_opencode_assets "$opencode_root"
  [[ $(wc -l < "$trace" | tr -d ' ') -eq 2 ]] || fail "unexpected normal-sync process trace"
  [[ ! -e "$temp_root/project/.agentfs/trajectory.db" ]] || fail "normal sync created measurement state"
  [[ ! -e "$temp_root/project/.agentfs/project.db" ]] || fail "normal sync created project state"
}

install_claude_hook_fixture() {
  local source="$1"
  local target="$2"
  sed "s|@@INFRA_ROOT@@|$ROOT|g" "$source" > "$target"
  chmod 700 "$target"
}

write_capability_config() {
  local project="$1"
  local wiki="$2"
  local logging="$3"
  mkdir -p "$project/.ai"
  cat > "$project/.ai/capabilities.json" <<JSON
{"schema_version":1,"capabilities":{"wiki":$wiki},"logging":{"callbacks":$logging}}
JSON
  chmod 600 "$project/.ai/capabilities.json"
}

run_claude_hook() {
  local hook="$1"
  local project="$2"
  local state_root="$3"
  local payload="$4"
  local stdout_file="$5"
  local stderr_file="$6"
  local trajectory="${7:-1}"
  local status=0
  (
    cd "$project"
    printf '%s' "$payload" | env \
      CAIRN_CAPABILITY_CONTRACT=1 \
      CAIRN_HARNESS_STATE_DIR="$state_root" \
      CAIRN_TRAJECTORY_CAPTURE="$trajectory" \
      "$hook" >"$stdout_file" 2>"$stderr_file"
  ) || status=$?
  return "$status"
}

assert_fixed_block() {
  local stdout_file="$1"
  local stderr_file="$2"
  local status="$3"
  [[ "$status" -eq 2 ]] || fail "Claude admission did not fail closed with exit 2"
  [[ "$(cat "$stdout_file")" == '{"decision":"block","reason":"capability disabled"}' ]] || \
    fail "Claude admission did not emit the fixed disabled block"
  [[ ! -s "$stderr_file" ]] || fail "Claude admission disclosed rejected input on stderr"
}

callback_rows() {
  local project="$1"
  local database="$project/.agentfs/trajectory.db"
  [[ -f "$database" ]] || { printf '[]'; return; }
  (
    cd "$ROOT/mcp-memory-server"
    NODE_NO_WARNINGS=1 node --input-type=module - "$database" <<'NODE'
import { AgentFS } from "agentfs-sdk";
const agent = await AgentFS.open({ id: "trajectory", path: process.argv[2] });
try {
  const rows = await agent.kv.list("capability-callback/v1/record/");
  process.stdout.write(JSON.stringify(rows.map((row) => row.value)));
} finally {
  await agent.close();
}
NODE
  )
}

assert_value_free_rows() {
  local rows="$1"
  local expected_outcome="$2"
  node - "$rows" "$expected_outcome" <<'NODE'
const rows = JSON.parse(process.argv[2]);
const expected = process.argv[3];
if (rows.length !== 1 || rows[0].outcome !== expected) process.exit(1);
const forbidden = ["argument", "result", "prompt", "query", "path", "stack", "error_message", "secret"];
const raw = JSON.stringify(rows[0]).toLowerCase();
if (forbidden.some((name) => raw.includes(name))) process.exit(1);
NODE
}

assert_opencode_result() {
  local result="$1"
  local expected="$2"
  node - "$result" "$expected" <<'NODE'
const value = JSON.parse(process.argv[2]);
const expected = process.argv[3];
const admission = value.calls.find((call) => call.boundary === "command.execute.before");
if (!admission || admission.result !== expected) process.exit(1);
if (expected === "blocked" && admission.error !== "Cairn capability disabled.") process.exit(1);
if (expected === "allowed" && admission.parts !== 0) process.exit(1);
NODE
}

run_opencode_scenario() {
  local plugin="$1"
  local project="$2"
  local state_root="$3"
  local scenario="$4"
  local session="$5"
  local trajectory="${6:-1}"
  (
    cd "$project"
    env \
      CAIRN_CAPABILITY_CONTRACT=1 \
      CAIRN_HARNESS_STATE_DIR="$state_root" \
      CAIRN_TRAJECTORY_CAPTURE="$trajectory" \
      CAIRN_TEST_SESSION="$session" \
      node --experimental-strip-types "$OPENCODE_HARNESS" \
        "$plugin" "$project" "$FIXTURE" "$scenario"
  )
}

opencode_plugin() {
  local temp_root plugin result rows case_root project decoy state_root
  temp_root=$(mktemp -d)
  trap "rm -rf '$temp_root'" EXIT
  plugin="$temp_root/capability-command.ts"

  validate_fixture
  [[ -f "$OPENCODE_PLUGIN" ]] || fail "OpenCode capability plugin is absent"
  sed "s|@@INFRA_ROOT@@|$ROOT|g" "$OPENCODE_PLUGIN" > "$plugin"

  result=$(node --experimental-strip-types "$OPENCODE_HARNESS" \
    "$plugin" "$temp_root/contract-project" "$FIXTURE" contract)
  node - "$result" <<'NODE' || fail "OpenCode implementation disagrees with the pinned contract"
const value = JSON.parse(process.argv[2]);
if (value.fixture.version !== "1.17.20") process.exit(1);
if (value.fixture.commit !== "4473fc3c9055046183990a965d68df3db7ea6f62") process.exit(1);
if (value.calls.length !== 0) process.exit(1);
NODE

  case_root="$temp_root/malformed"
  project="$case_root/project"
  decoy="$project-decoy"
  state_root="$case_root/state"
  mkdir -p "$project" "$decoy"
  write_capability_config "$project" true true
  result=$(run_opencode_scenario "$plugin" "$project" "$state_root" malformed-admission malformed 1)
  assert_opencode_result "$result" blocked || fail "malformed OpenCode admission did not fail closed"
  [[ "$(callback_rows "$project")" == '[]' ]] || fail "malformed OpenCode admission created callback state"
  [[ ! -e "$state_root/capability-leases-v1" ]] || fail "malformed OpenCode admission created lease state"

  case_root="$temp_root/identity"
  project="$case_root/project"
  decoy="$project-decoy"
  state_root="$case_root/state"
  mkdir -p "$project" "$decoy"
  write_capability_config "$project" true true
  result=$(run_opencode_scenario "$plugin" "$project" "$state_root" identity-mismatch identity 1)
  assert_opencode_result "$result" blocked || fail "ambiguous OpenCode project identity did not fail closed"
  [[ "$(callback_rows "$project")" == '[]' ]] || fail "ambiguous OpenCode identity created callback state"

  for consent in false:1 true:0; do
    local logging=${consent%%:*}
    local trajectory=${consent#*:}
    case_root="$temp_root/enabled-$logging-$trajectory"
    project="$case_root/project"
    decoy="$project-decoy"
    state_root="$case_root/state"
    mkdir -p "$project" "$decoy"
    write_capability_config "$project" true "$logging"
    result=$(run_opencode_scenario "$plugin" "$project" "$state_root" admission "enabled-$logging-$trajectory" "$trajectory")
    assert_opencode_result "$result" allowed || fail "enabled unmeasured OpenCode command changed owner execution"
    [[ "$(callback_rows "$project")" == '[]' ]] || fail "enabled unmeasured OpenCode command created callback state"
    [[ ! -e "$state_root/capability-leases-v1" ]] || fail "enabled unmeasured OpenCode command created lease state"
  done

  for consent in false:1 true:0; do
    local logging=${consent%%:*}
    local trajectory=${consent#*:}
    case_root="$temp_root/disabled-$logging-$trajectory"
    project="$case_root/project"
    decoy="$project-decoy"
    state_root="$case_root/state"
    mkdir -p "$project" "$decoy"
    write_capability_config "$project" false "$logging"
    result=$(run_opencode_scenario "$plugin" "$project" "$state_root" admission "disabled-$logging-$trajectory" "$trajectory")
    assert_opencode_result "$result" blocked || fail "disabled unmeasured OpenCode command did not return the fixed block"
    [[ "$(callback_rows "$project")" == '[]' ]] || fail "disabled unmeasured OpenCode command created callback state"
    find "$state_root/capability-leases-v1" -type f -print -quit 2>/dev/null | grep -q . && \
      fail "disabled unmeasured OpenCode command left lease state"
  done

  case_root="$temp_root/disabled-measured"
  project="$case_root/project"
  decoy="$project-decoy"
  state_root="$case_root/state"
  mkdir -p "$project" "$decoy"
  write_capability_config "$project" false true
  result=$(run_opencode_scenario "$plugin" "$project" "$state_root" admission disabled-measured 1)
  assert_opencode_result "$result" blocked || fail "disabled measured OpenCode command did not return the fixed block"
  rows=$(callback_rows "$project")
  assert_value_free_rows "$rows" disabled || fail "disabled OpenCode command did not settle one value-free final"

  for terminal in success error; do
    case_root="$temp_root/$terminal"
    project="$case_root/project"
    decoy="$project-decoy"
    state_root="$case_root/state"
    mkdir -p "$project" "$decoy"
    write_capability_config "$project" true true
    result=$(run_opencode_scenario "$plugin" "$project" "$state_root" "$terminal" "terminal-$terminal" 1)
    assert_opencode_result "$result" allowed || fail "OpenCode $terminal terminal changed owner execution"
    rows=$(callback_rows "$project")
    assert_value_free_rows "$rows" "$terminal" || fail "OpenCode $terminal terminal did not settle exactly once"
  done

  for terminal in success error; do
    case_root="$temp_root/duplicate-$terminal"
    project="$case_root/project"
    decoy="$project-decoy"
    state_root="$case_root/state"
    mkdir -p "$project" "$decoy"
    write_capability_config "$project" true true
    result=$(run_opencode_scenario "$plugin" "$project" "$state_root" "duplicate-$terminal" "duplicate-$terminal" 1)
    assert_opencode_result "$result" allowed || fail "duplicate OpenCode $terminal changed owner execution"
    rows=$(callback_rows "$project")
    assert_value_free_rows "$rows" "$terminal" || fail "duplicate OpenCode $terminal delivery was not idempotent"
  done

  case_root="$temp_root/settled-delete"
  project="$case_root/project"
  decoy="$project-decoy"
  state_root="$case_root/state"
  mkdir -p "$project" "$decoy"
  write_capability_config "$project" true true
  result=$(run_opencode_scenario "$plugin" "$project" "$state_root" settled-then-delete settled-delete 1)
  assert_opencode_result "$result" allowed || fail "settled OpenCode command changed owner execution"
  rows=$(callback_rows "$project")
  assert_value_free_rows "$rows" success || fail "session deletion replaced a settled OpenCode terminal"

  case_root="$temp_root/abandonment"
  project="$case_root/project"
  decoy="$project-decoy"
  state_root="$case_root/state"
  mkdir -p "$project" "$decoy"
  write_capability_config "$project" true true
  result=$(run_opencode_scenario "$plugin" "$project" "$state_root" abandonment abandonment 1)
  assert_opencode_result "$result" allowed || fail "OpenCode abandonment changed owner execution"
  [[ "$(callback_rows "$project")" == '[]' ]] || fail "OpenCode abandonment created a final callback"
  find "$state_root/capability-leases-v1" -type f -print -quit 2>/dev/null | grep -q . && \
    fail "OpenCode abandonment left an unfinished recoverable lease"

  case_root="$temp_root/cwd-drift"
  project="$case_root/project"
  decoy="$project-decoy"
  state_root="$case_root/state"
  mkdir -p "$project" "$decoy"
  write_capability_config "$project" true true
  result=$(run_opencode_scenario "$plugin" "$project" "$state_root" cwd-drift-success cwd-drift 1)
  assert_opencode_result "$result" allowed || fail "OpenCode cwd drift changed owner execution"
  rows=$(callback_rows "$project")
  assert_value_free_rows "$rows" success || fail "OpenCode cwd drift rebound immutable project identity"
  [[ "$(callback_rows "$decoy")" == '[]' ]] || fail "OpenCode cwd drift wrote callback state to the decoy project"

  echo "PASS: OpenCode native capability plugin"
}

plugin_tree_digest() {
  local live_root="$1"
  (
    cd "$live_root"
    find plugins -type f -print | LC_ALL=C sort | while IFS= read -r asset; do
      sha256sum "$asset"
    done
  )
}

assert_legacy_opencode_plugins() {
  local live_root="$1"
  local asset
  for asset in memory-wakeup.ts memory-capture.ts memory-recall.ts; do
    [[ -f "$live_root/plugins/$asset" ]] || fail "legacy OpenCode plugin is missing: $asset"
    cmp -s <(sed "s|@@INFRA_ROOT@@|$ROOT|g" "$ROOT/opencode/plugins/$asset") \
      "$live_root/plugins/$asset" || fail "legacy OpenCode plugin changed: $asset"
  done
}

opencode_sync_modes() {
  local temp_root normal_root enabled_root before after plugin_count
  temp_root=$(mktemp -d)
  trap "rm -rf '$temp_root'" EXIT
  normal_root="$temp_root/normal"
  enabled_root="$temp_root/enabled"

  env -u CAIRN_CAPABILITY_CONTRACT \
    CAIRN_HARNESS_STATE_DIR="$temp_root/normal-state" \
    "$ROOT/scripts/sync-opencode-plugin-assets.sh" --apply --live-root "$normal_root" >/dev/null
  assert_legacy_opencode_plugins "$normal_root"
  assert_no_native_opencode_assets "$normal_root"
  before=$(plugin_tree_digest "$normal_root")
  [[ ! -e "$temp_root/normal-state" ]] || fail "normal OpenCode sync invoked capability state"

  env -u CAIRN_CAPABILITY_CONTRACT \
    CAIRN_HARNESS_STATE_DIR="$temp_root/master-off-state" \
    "$ROOT/scripts/sync-opencode-plugin-assets.sh" --apply --capability-overlay --live-root "$normal_root" >/dev/null
  after=$(plugin_tree_digest "$normal_root")
  [[ "$after" == "$before" ]] || fail "master-off OpenCode overlay changed legacy plugin bytes"
  assert_no_native_opencode_assets "$normal_root"
  [[ ! -e "$temp_root/master-off-state" ]] || fail "master-off OpenCode overlay invoked capability state"

  CAIRN_CAPABILITY_CONTRACT=1 \
    CAIRN_HARNESS_STATE_DIR="$temp_root/enabled-state" \
    "$ROOT/scripts/sync-opencode-plugin-assets.sh" --apply --capability-overlay --live-root "$enabled_root" >/dev/null
  assert_legacy_opencode_plugins "$enabled_root"
  plugin_count=$(find "$enabled_root/plugins" -maxdepth 1 -type f -name '*.ts' | wc -l | tr -d ' ')
  [[ "$plugin_count" -eq 4 ]] || fail "enabled OpenCode overlay did not install exactly one additional plugin"
  [[ -f "$enabled_root/plugins/capability-command.ts" ]] || fail "enabled OpenCode overlay did not register the capability plugin"
  cmp -s <(sed "s|@@INFRA_ROOT@@|$ROOT|g" "$OPENCODE_PLUGIN") \
    "$enabled_root/plugins/capability-command.ts" || fail "enabled OpenCode capability plugin bytes do not match source"
  grep -qF 'export const CapabilityCommandPlugin' "$enabled_root/plugins/capability-command.ts" || \
    fail "enabled OpenCode capability plugin registration is absent"
  [[ ! -e "$temp_root/enabled-state" ]] || fail "enabled OpenCode sync invoked the capability coordinator"

  CAIRN_CAPABILITY_CONTRACT=1 \
    "$ROOT/scripts/sync-opencode-plugin-assets.sh" --check --capability-overlay --live-root "$enabled_root" >/dev/null

  echo "PASS: OpenCode capability plugin sync modes"
}

claude_hooks() {
  local temp_root project decoy state_root start_hook finish_hook stdout_file stderr_file status payload rows
  temp_root=$(mktemp -d)
  trap "rm -rf '$temp_root'" EXIT
  project="$temp_root/project"
  decoy="$temp_root/decoy"
  state_root="$temp_root/state"
  start_hook="$temp_root/capability-command-start.sh"
  finish_hook="$temp_root/capability-command-finish.sh"
  stdout_file="$temp_root/stdout"
  stderr_file="$temp_root/stderr"
  mkdir -p "$project" "$decoy"

  validate_fixture
  [[ -f "$CLAUDE_START" ]] || fail "Claude capability start hook is absent"
  [[ -f "$CLAUDE_FINISH" ]] || fail "Claude capability finish hook is absent"
  install_claude_hook_fixture "$CLAUDE_START" "$start_hook"
  install_claude_hook_fixture "$CLAUDE_FINISH" "$finish_hook"

  status=0
  run_claude_hook "$start_hook" "$project" "$state_root" '{bad-json' "$stdout_file" "$stderr_file" || status=$?
  assert_fixed_block "$stdout_file" "$stderr_file" "$status"

  payload=$(node - "$FIXTURE" "$project" <<'NODE'
const fixture = require(process.argv[2]);
const value = structuredClone(fixture.claude.events.UserPromptExpansion.sample);
value.cwd = process.argv[3];
value.transcript_path = `${process.argv[3]}/transcript.jsonl`;
value.command_name = "wiki-query";
value.session_id = "claude-enabled-no-measurement";
process.stdout.write(JSON.stringify(value));
NODE
)
  status=0
  run_claude_hook "$start_hook" "$decoy" "$state_root" "$payload" "$stdout_file" "$stderr_file" || status=$?
  assert_fixed_block "$stdout_file" "$stderr_file" "$status"

  write_capability_config "$project" true false
  run_claude_hook "$start_hook" "$project" "$state_root" "$payload" "$stdout_file" "$stderr_file" 1 || \
    fail "enabled unmeasured Claude command was changed"
  [[ "$(cat "$stdout_file")" == '{}' ]] || fail "enabled Claude command was not passed through unchanged"
  [[ "$(callback_rows "$project")" == '[]' ]] || fail "enabled unmeasured Claude command created callback state"
  [[ ! -e "$state_root/capability-leases-v1" ]] || fail "enabled unmeasured Claude command created lease state"

  for consent in false:1 true:0; do
    local logging=${consent%%:*}
    local trajectory=${consent#*:}
    write_capability_config "$project" false "$logging"
    payload=$(node - "$FIXTURE" "$project" "$logging" <<'NODE'
const fixture = require(process.argv[2]);
const value = structuredClone(fixture.claude.events.UserPromptExpansion.sample);
value.cwd = process.argv[3];
value.transcript_path = `${process.argv[3]}/transcript.jsonl`;
value.session_id = `claude-disabled-unmeasured-${process.argv[4]}`;
process.stdout.write(JSON.stringify(value));
NODE
)
    status=0
    run_claude_hook "$start_hook" "$project" "$state_root" "$payload" "$stdout_file" "$stderr_file" "$trajectory" || status=$?
    assert_fixed_block "$stdout_file" "$stderr_file" "$status"
    [[ "$(callback_rows "$project")" == '[]' ]] || fail "disabled unmeasured Claude command created callback state"
  done

  write_capability_config "$project" false true
  payload=$(node - "$FIXTURE" "$project" <<'NODE'
const fixture = require(process.argv[2]);
const value = structuredClone(fixture.claude.events.UserPromptExpansion.sample);
value.cwd = process.argv[3];
value.transcript_path = `${process.argv[3]}/transcript.jsonl`;
value.session_id = "claude-disabled-measured";
process.stdout.write(JSON.stringify(value));
NODE
)
  status=0
  run_claude_hook "$start_hook" "$project" "$state_root" "$payload" "$stdout_file" "$stderr_file" 1 || status=$?
  assert_fixed_block "$stdout_file" "$stderr_file" "$status"
  rows=$(callback_rows "$project")
  assert_value_free_rows "$rows" disabled || fail "disabled Claude command did not settle one value-free final"

  write_capability_config "$project" true true
  for terminal in Stop StopFailure; do
    local session="claude-${terminal,,}"
    payload=$(node - "$FIXTURE" "$project" "$session" <<'NODE'
const fixture = require(process.argv[2]);
const value = structuredClone(fixture.claude.events.UserPromptExpansion.sample);
value.cwd = process.argv[3];
value.transcript_path = `${process.argv[3]}/transcript.jsonl`;
value.session_id = process.argv[4];
process.stdout.write(JSON.stringify(value));
NODE
)
    run_claude_hook "$start_hook" "$project" "$state_root" "$payload" "$stdout_file" "$stderr_file" 1 || \
      fail "Claude start failed for $terminal"
    payload=$(node - "$FIXTURE" "$project" "$session" "$terminal" <<'NODE'
const fixture = require(process.argv[2]);
const value = structuredClone(fixture.claude.events[process.argv[5]].sample);
value.cwd = process.argv[3];
value.transcript_path = `${process.argv[3]}/transcript.jsonl`;
value.session_id = process.argv[4];
process.stdout.write(JSON.stringify(value));
NODE
)
    run_claude_hook "$finish_hook" "$project" "$state_root" "$payload" "$stdout_file" "$stderr_file" 1 || \
      fail "Claude $terminal hook changed the owner terminal"
    run_claude_hook "$finish_hook" "$project" "$state_root" "$payload" "$stdout_file" "$stderr_file" 1 || \
      fail "repeated Claude $terminal hook changed the owner terminal"
    payload=$(node - "$FIXTURE" "$project" "$session" <<'NODE'
const fixture = require(process.argv[2]);
const value = structuredClone(fixture.claude.events.SessionEnd.sample);
value.cwd = process.argv[3];
value.transcript_path = `${process.argv[3]}/transcript.jsonl`;
value.session_id = process.argv[4];
process.stdout.write(JSON.stringify(value));
NODE
)
    run_claude_hook "$finish_hook" "$project" "$state_root" "$payload" "$stdout_file" "$stderr_file" 1 || \
      fail "SessionEnd changed a settled $terminal owner terminal"
  done
  rows=$(callback_rows "$project")
  node - "$rows" <<'NODE' || fail "Claude terminal hooks did not settle exact success/error outcomes"
const rows = JSON.parse(process.argv[2]);
const outcomes = rows.map((row) => row.outcome).sort();
if (outcomes.join(",") !== "disabled,error,success") process.exit(1);
NODE

  payload=$(node - "$FIXTURE" "$project" <<'NODE'
const fixture = require(process.argv[2]);
const value = structuredClone(fixture.claude.events.UserPromptExpansion.sample);
value.cwd = process.argv[3];
value.transcript_path = `${process.argv[3]}/transcript.jsonl`;
value.session_id = "claude-abandon";
process.stdout.write(JSON.stringify(value));
NODE
)
  run_claude_hook "$start_hook" "$project" "$state_root" "$payload" "$stdout_file" "$stderr_file" 1 || fail "Claude abandonment start failed"
  payload=$(node - "$FIXTURE" "$project" "$decoy" <<'NODE'
const fixture = require(process.argv[2]);
const value = structuredClone(fixture.claude.events.CwdChanged.sample);
value.cwd = process.argv[3];
value.old_cwd = process.argv[3];
value.new_cwd = process.argv[4];
value.session_id = "claude-abandon";
process.stdout.write(JSON.stringify(value));
NODE
)
  run_claude_hook "$finish_hook" "$decoy" "$state_root" "$payload" "$stdout_file" "$stderr_file" 1 || fail "Claude CwdChanged observation failed"
  payload=$(node - "$FIXTURE" "$decoy" <<'NODE'
const fixture = require(process.argv[2]);
const value = structuredClone(fixture.claude.events.SessionEnd.sample);
value.cwd = process.argv[3];
value.transcript_path = `${process.argv[3]}/transcript.jsonl`;
value.session_id = "claude-abandon";
process.stdout.write(JSON.stringify(value));
NODE
)
  run_claude_hook "$finish_hook" "$decoy" "$state_root" "$payload" "$stdout_file" "$stderr_file" 1 || fail "Claude SessionEnd cleanup failed"
  [[ "$(callback_rows "$project")" == "$rows" ]] || fail "SessionEnd rewrote a settled terminal or emitted an abandonment final"
  find "$state_root/capability-leases-v1" -type f -print -quit 2>/dev/null | grep -q . && fail "SessionEnd left an unfinished recoverable lease"

  echo "PASS: Claude native capability hooks"
}

claude_owner_only() {
  [[ ! -e "$ROOT/claude/hooks/capability-command-start.sh" ]] || fail "capability start hook entered the normal hook tree"
  [[ ! -e "$ROOT/claude/hooks/capability-command-finish.sh" ]] || fail "capability finish hook entered the normal hook tree"
  grep -qF 'harness-before' "$CLAUDE_START" || fail "Claude admission is not owned by the native coordinator"
  grep -qF 'harness-terminal' "$CLAUDE_FINISH" || fail "Claude terminal settlement is not owned by the native coordinator"
  if grep -q -E 'cairn capabilities (guard|start|finish)' "$CLAUDE_START" "$CLAUDE_FINISH"; then
    fail "Claude native hooks delegate through obsolete model-authored operations"
  fi
  claude_hooks
  echo "PASS: Claude native hook owner is isolated from the normal hook tree"
}

expect_red_claude() {
  local temp_root
  temp_root=$(mktemp -d)
  trap 'rm -rf "$temp_root"' EXIT
  validate_fixture
  normal_sync_trace "$temp_root"

  [[ -d "$ROOT/claude/capability-contract/commands" ]] || fail "obsolete Claude Markdown authority was not found"
  grep -R -q 'cairn capabilities guard' "$ROOT/claude/capability-contract/commands" || \
    fail "obsolete Claude Markdown authority was not attributable"
  if [[ ! -f "$CLAUDE_START" && ! -f "$CLAUDE_FINISH" ]]; then
    echo "PHASE18_RED:CLAUDE_CAPABILITY_HOOKS"
    exit "$RED_EXIT"
  fi
  fail "Claude expected-RED mode was run after native hooks became available"
}

expect_red_opencode() {
  local temp_root
  temp_root=$(mktemp -d)
  trap 'rm -rf "$temp_root"' EXIT
  validate_fixture
  normal_sync_trace "$temp_root"

  [[ -d "$ROOT/opencode/capability-contract/workflows" ]] || fail "obsolete OpenCode workflow authority was not found"
  grep -R -q 'cairn capabilities finish' "$ROOT/opencode/capability-contract/workflows" || \
    fail "obsolete OpenCode Markdown authority was not attributable"
  grep -q 'sync-opencode-plugin-assets.sh' "$ROOT/templates/start-opencode.sh.template" && \
    fail "OpenCode launcher plugin wiring exists while its native plugin is absent"
  if [[ ! -f "$OPENCODE_PLUGIN" ]]; then
    echo "PHASE18_RED:OPENCODE_CAPABILITY_PLUGIN"
    exit "$RED_EXIT"
  fi
  fail "OpenCode expected-RED mode was run after the native plugin became available"
}

live_claude() {
  command -v claude >/dev/null 2>&1 || fail "Claude live control unavailable: claude is not on PATH"
  [[ -n "${CAIRN_PHASE18_CLAUDE_MODEL:-}" ]] || fail "Claude live control unavailable: CAIRN_PHASE18_CLAUDE_MODEL is unset"
  [[ -n "${CAIRN_PHASE18_LIVE_PROJECT:-}" ]] || fail "Claude live control unavailable: CAIRN_PHASE18_LIVE_PROJECT is unset"
  [[ -d "$CAIRN_PHASE18_LIVE_PROJECT" ]] || fail "Claude live control project does not exist"
  [[ -f "$CLAUDE_START" && -f "$CLAUDE_FINISH" ]] || fail "Claude native hooks are not installed in the source tree"
  echo "LIVE_REQUIRED:CLAUDE_HAIKU_NEGATIVE_CONTROL"
  return 1
}

live_opencode() {
  command -v opencode >/dev/null 2>&1 || fail "OpenCode live control unavailable: opencode is not on PATH"
  [[ -n "${CAIRN_PHASE18_OPENCODE_MODEL:-}" ]] || fail "OpenCode live control unavailable: CAIRN_PHASE18_OPENCODE_MODEL is unset"
  [[ -n "${CAIRN_PHASE18_LIVE_PROJECT:-}" ]] || fail "OpenCode live control unavailable: CAIRN_PHASE18_LIVE_PROJECT is unset"
  [[ -d "$CAIRN_PHASE18_LIVE_PROJECT" ]] || fail "OpenCode live control project does not exist"
  [[ -f "$OPENCODE_PLUGIN" ]] || fail "OpenCode native plugin is not installed in the source tree"
  echo "LIVE_REQUIRED:OPENCODE_QWEN_NEGATIVE_CONTROL"
  return 1
}

mode="${1:-}"
case "$mode" in
  "")
    echo "SKIP: native capability harness boundary is opt-in until production owners are green"
    ;;
  -h|--help)
    usage
    ;;
  --expect-red-claude)
    expect_red_claude
    ;;
  --expect-red-opencode)
    expect_red_opencode
    ;;
  --live-claude)
    live_claude
    ;;
  --live-opencode)
    live_opencode
    ;;
  claude-hooks)
    claude_hooks
    ;;
  claude-owner-only)
    claude_owner_only
    ;;
  opencode-plugin|opencode-sync-modes|opencode-command-owner-only|opencode-owner-only|evidence-scope)
    case "$mode" in
      opencode-plugin) opencode_plugin ;;
      opencode-sync-modes) opencode_sync_modes ;;
      *) fail "production mode '$mode' is intentionally RED until its owning Phase 18 plan extends this driver" ;;
    esac
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
