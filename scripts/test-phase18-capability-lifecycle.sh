#!/usr/bin/env bash
# Phase 18 capability CLI, lifecycle, operating-overlay, and ablation contract.
# No-argument execution is the complete GREEN contract. Explicit expected-RED
# modes remain available only to classify historical missing-owner simulations.
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
EXPECTED_RED_EXIT=86
RED_MARKER="PHASE18_RED:CAPABILITY_LIFECYCLE_MISSING"
MODE="${1:-full}"
[[ $# -gt 0 ]] && shift
RUNTIME=0
HARNESS=""
CAPABILITY=""

usage() {
  cat <<'USAGE'
Usage: test-phase18-capability-lifecycle.sh [baseline|--expect-red-contract|contract|matrix|bootstrap|uninstall|lifecycle [--runtime]|claude-native|native-boundary|owner-retirement|full]
       test-phase18-capability-lifecycle.sh operating --harness claude|opencode-command|opencode-workflow --capability wiki|graph|security.audit
USAGE
}

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

case "$MODE" in
  baseline|--expect-red-contract|contract|matrix|bootstrap|uninstall|claude-native|native-boundary|owner-retirement|full)
    [[ $# -eq 0 ]] || { usage >&2; exit 2; }
    ;;
  lifecycle)
    if [[ "${1:-}" == "--runtime" ]]; then RUNTIME=1; shift; fi
    [[ $# -eq 0 ]] || { usage >&2; exit 2; }
    ;;
  operating)
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --harness) [[ $# -ge 2 ]] || { usage >&2; exit 2; }; HARNESS="$2"; shift 2 ;;
        --capability) [[ $# -ge 2 ]] || { usage >&2; exit 2; }; CAPABILITY="$2"; shift 2 ;;
        *) usage >&2; exit 2 ;;
      esac
    done
    case "$HARNESS" in claude|opencode-command|opencode-workflow) ;; *) usage >&2; exit 2 ;; esac
    case "$CAPABILITY" in wiki|graph|security.audit) ;; *) usage >&2; exit 2 ;; esac
    if [[ "$HARNESS" == "opencode-workflow" && "$CAPABILITY" == "graph" ]]; then
      echo "graph has no directly invokable OpenCode workflow" >&2
      exit 2
    fi
    ;;
  *) usage >&2; exit 2 ;;
esac

# Selector validation above intentionally precedes all fixture mutation.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
baseline_number=0

run_baseline_check() {
  baseline_number=$((baseline_number + 1))
  local output="$tmp/baseline-$baseline_number.out"
  if ! env -u CAIRN_CAPABILITY_CONTRACT "$@" >"$output" 2>&1; then
    cat "$output" >&2
    fail "baseline failed: $*"
  fi
  if grep -qF 'PHASE18_RED:' "$output"; then
    cat "$output" >&2
    fail "baseline emitted a Phase 18 RED marker: $*"
  fi
}

assert_same_file() {
  cmp -s "$1" "$2" || fail "installed bytes differ: $2"
}

run_master_off_identity() {
  local project="$tmp/identity-project"
  local fake_bin="$tmp/identity-bin"
  local trace="$tmp/identity.trace"
  local claude_live="$tmp/claude-live"
  local opencode_live="$tmp/opencode-live"
  mkdir -p "$project" "$fake_bin"
  git -C "$project" init -q
  "$ROOT/scripts/bootstrap.sh" "$project" >"$tmp/bootstrap.out"
  printf '%s' '{"schema_version":1,"capabilities":' >"$project/.ai/capabilities.json"
  chmod 600 "$project/.ai/capabilities.json"
  sha256sum "$project/.ai/capabilities.json" >"$tmp/config.before"

  for executable in claude opencode; do
    cat >"$fake_bin/$executable" <<'STUB'
#!/usr/bin/env bash
printf '%s|%s' "$(basename "$0")" "$PWD" >>"$TRACE_FILE"
printf '|%s' "$@" >>"$TRACE_FILE"
printf '\n' >>"$TRACE_FILE"
exit "${HARNESS_EXIT:-0}"
STUB
    chmod 755 "$fake_bin/$executable"
  done

  : >"$trace"
  if ! env -u CAIRN_CAPABILITY_CONTRACT PATH="$fake_bin:$PATH" TRACE_FILE="$trace" \
    "$project/.ai/start-claude.sh" --identity >"$tmp/claude.out" 2>"$tmp/claude.err"; then
    fail "master-off Claude launcher changed exit behavior"
  fi
  if ! env -u CAIRN_CAPABILITY_CONTRACT PATH="$fake_bin:$PATH" TRACE_FILE="$trace" \
    "$project/.ai/start-opencode.sh" --identity >"$tmp/opencode.out" 2>"$tmp/opencode.err"; then
    fail "master-off OpenCode launcher changed exit behavior"
  fi
  [[ ! -s "$tmp/claude.out" && ! -s "$tmp/claude.err" && ! -s "$tmp/opencode.out" && ! -s "$tmp/opencode.err" ]] || \
    fail "master-off launcher added output"
  printf 'claude|%s|--identity\nopencode|%s|--identity\n' "$project" "$project" >"$tmp/identity.expected"
  cmp -s "$tmp/identity.expected" "$trace" || fail "master-off launcher process/argv trace changed"

  env -u CAIRN_CAPABILITY_CONTRACT "$ROOT/scripts/sync-claude-assets.sh" --apply --live-root "$claude_live" >/dev/null
  for rel in commands/wiki-ingest.md commands/wiki-query.md commands/wiki-lint.md commands/graphify.md commands/security-audit.md; do
    assert_same_file "$ROOT/claude/$rel" "$claude_live/$rel"
  done
  env -u CAIRN_CAPABILITY_CONTRACT "$ROOT/scripts/sync-opencode-wiki-assets.sh" --apply --live-root "$opencode_live" >/dev/null
  env -u CAIRN_CAPABILITY_CONTRACT "$ROOT/scripts/sync-opencode-graphify-assets.sh" --apply --live-root "$opencode_live" >/dev/null
  env -u CAIRN_CAPABILITY_CONTRACT "$ROOT/scripts/sync-opencode-security-assets.sh" --apply --live-root "$opencode_live" >/dev/null
  for rel in \
    command/wiki-ingest.md command/wiki-query.md command/wiki-lint.md \
    workflows/wiki-ingest-workflow.md workflows/wiki-query-workflow.md workflows/wiki-lint-workflow.md \
    command/graphify.md command/security-audit.md workflows/security-audit-workflow.md
  do
    assert_same_file "$ROOT/opencode/$rel" "$opencode_live/$rel"
  done

  sha256sum -c "$tmp/config.before" >/dev/null || fail "master-off path changed malformed capability config"
  if find "$project/.agentfs" -type f \( -name '*.db' -o -name '*.db-wal' -o -name '*.db-shm' \) | grep -q .; then
    fail "master-off path created a capability/logging store"
  fi
  if grep -R -qF '{"schema_version":1,"capabilities":' "$tmp/claude.out" "$tmp/claude.err" "$tmp/opencode.out" "$tmp/opencode.err"; then
    fail "master-off path exposed configuration contents"
  fi
}

run_baseline() {
  run_baseline_check "$ROOT/scripts/test-cli-dispatch.sh"
  run_baseline_check "$ROOT/scripts/test-bootstrap-untracked.sh"
  run_baseline_check "$ROOT/scripts/test-doctor.sh"
  run_baseline_check "$ROOT/scripts/test-completion.sh"
  run_baseline_check "$ROOT/scripts/test-package-install.sh"
  run_baseline_check "$ROOT/scripts/test-uninstall.sh"
  run_baseline_check bash -n "$ROOT/bin/cairn"
  run_master_off_identity
  echo "PASS: Phase 18 master-off CLI/package/lifecycle identity baseline"
}

new_project() {
  local project="$1"
  mkdir -p "$project"
  git -C "$project" init -q
  "$ROOT/scripts/bootstrap.sh" "$project" >/dev/null
}

run_capability() {
  local project="$1"
  shift
  (cd "$project" && CAIRN_CAPABILITY_CONTRACT=1 "$ROOT/bin/cairn" capabilities "$@")
}

enable_all_capabilities() {
  local project="$1" id
  for id in memory.write memory.search notes.distill wiki graph security.audit route.check context.explore; do
    run_capability "$project" enable "$id" >/dev/null
  done
}

run_contract() {
  local project="$tmp/contract-project"
  local config_path="$project/.ai/capabilities.json"
  local status="$tmp/status.json"
  local before after
  new_project "$project"

  run_capability "$project" list >"$tmp/list.out" 2>"$tmp/list.err" || fail "capabilities list failed"
  run_capability "$project" status >"$tmp/status.out" 2>"$tmp/status.err" || fail "human status failed"
  run_capability "$project" status --json >"$status" 2>"$tmp/status-json.err" || fail "JSON status failed"
  node - "$status" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const ids = ["memory.write", "memory.search", "notes.distill", "wiki", "graph", "security.audit", "route.check", "context.explore"];
if (value.schema_version !== 1 || value.contract_enabled !== true) process.exit(1);
if (JSON.stringify(value.capabilities.map((row) => row.id)) !== JSON.stringify(ids)) process.exit(1);
if (!/^[0-9a-f]{64}$/.test(value.configuration_digest)) process.exit(1);
for (const row of value.capabilities) {
  if (row.restart_required !== (row.kind === "mcp-tool")) process.exit(1);
  if (!["environment", "project", "compatibility"].includes(row.source)) process.exit(1);
}
NODE

  before=$(sha256sum "$config_path" | cut -d' ' -f1)
  if run_capability "$project" disable unknown.owner >"$tmp/unknown.out" 2>"$tmp/unknown.err"; then
    fail "unknown capability ID was accepted"
  fi
  after=$(sha256sum "$config_path" | cut -d' ' -f1)
  [[ "$before" == "$after" ]] || fail "invalid ID mutated configuration"

  run_capability "$project" disable memory.write >/dev/null || fail "disable failed"
  run_capability "$project" enable wiki >/dev/null || fail "enable failed"
  run_capability "$project" reset memory.write >/dev/null || fail "reset failed"
  run_capability "$project" logging enable >/dev/null || fail "logging enable failed"
  run_capability "$project" logging disable >/dev/null || fail "logging disable failed"
  run_capability "$project" logging reset >/dev/null || fail "logging reset failed"
  node - "$config_path" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (Object.hasOwn(value.capabilities, "memory.write")) process.exit(1);
if (value.capabilities.wiki !== true) process.exit(1);
if (Object.hasOwn(value.logging, "callbacks")) process.exit(1);
NODE

  run_capability "$project" disable memory.search >"$tmp/concurrent-one.out" 2>&1 &
  local first_pid=$!
  run_capability "$project" disable security.audit >"$tmp/concurrent-two.out" 2>&1 &
  local second_pid=$!
  wait "$first_pid" || fail "first concurrent mutation failed"
  wait "$second_pid" || fail "second concurrent mutation failed"
  node - "$config_path" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (value.capabilities["memory.search"] !== false || value.capabilities["security.audit"] !== false) process.exit(1);
NODE

  printf '%s\n' '{"schema_version":1,"capabilities":{"memory.write":"PHASE18_RAW_SENTINEL","wiki":false},"logging":{"callbacks":false}}' >"$config_path"
  chmod 600 "$config_path"
  run_capability "$project" status --json >"$tmp/invalid-status.out" 2>"$tmp/invalid-status.err" || fail "row-local invalid status failed"
  (cd "$project" && CAIRN_CAPABILITY_CONTRACT=1 "$ROOT/bin/cairn" doctor) >"$tmp/invalid-doctor.out" 2>"$tmp/invalid-doctor.err" || true
  if grep -R -qF 'PHASE18_RAW_SENTINEL' "$tmp/invalid-status.out" "$tmp/invalid-status.err" "$tmp/invalid-doctor.out" "$tmp/invalid-doctor.err"; then
    fail "status or doctor exposed raw configuration contents"
  fi
  grep -qF 'invalid-capability-value' "$tmp/invalid-status.out" || fail "status omitted the fixed invalid-row issue"
  grep -q '"id":"wiki".*"enabled":false\|"enabled":false.*"id":"wiki"' "$tmp/invalid-status.out" || fail "one invalid row poisoned an unrelated valid row"

  cp "$config_path" "$tmp/config-before-rerun"
  "$ROOT/scripts/bootstrap.sh" "$project" >/dev/null
  cmp -s "$tmp/config-before-rerun" "$config_path" || fail "bootstrap rerun overwrote capability state"
  [[ $(stat -c '%a' "$config_path" 2>/dev/null || stat -f '%Lp' "$config_path") == 600 ]] || fail "capability config is not mode 0600"
  echo "PASS: Phase 18 capability CLI/configuration contract"
}

run_bootstrap() {
  local project="$tmp/bootstrap-project"
  local config_path="$project/.ai/capabilities.json"
  new_project "$project"
  [[ -f "$config_path" ]] || fail "fresh bootstrap omitted capabilities.json"
  cmp -s "$ROOT/templates/capabilities.json.template" "$config_path" || fail "fresh capability config differs from template"
  [[ $(stat -c '%a' "$config_path" 2>/dev/null || stat -f '%Lp' "$config_path") == 600 ]] || fail "fresh capability config is not mode 0600"
  printf '%s\n' '{"schema_version":1,"capabilities":{"wiki":false},"logging":{"callbacks":true}}' >"$config_path"
  chmod 600 "$config_path"
  cp "$config_path" "$tmp/bootstrap-operator-state"
  "$ROOT/scripts/bootstrap.sh" "$project" >/dev/null
  cmp -s "$tmp/bootstrap-operator-state" "$config_path" || fail "bootstrap rerun replaced operator state"

  local untracked="$tmp/bootstrap-untracked"
  mkdir -p "$untracked"
  git -C "$untracked" init -q
  "$ROOT/scripts/bootstrap.sh" --untracked "$untracked" >/dev/null
  [[ -f "$untracked/.ai/capabilities.json" ]] || fail "untracked bootstrap omitted capability config"
  [[ -z $(git -C "$untracked" status --porcelain) ]] || fail "untracked capability config became visible to git"
  echo "PASS: Phase 18 capability bootstrap fresh/rerun contract"
}

run_uninstall() {
  local project="$tmp/uninstall-project"
  local fixture_home="$tmp/uninstall-home"
  local fixture_bin="$tmp/uninstall-bin"
  local live="$tmp/uninstall-live"
  local config_before="$tmp/capabilities.before"
  local db_before="$tmp/callbacks.before"
  local unrelated_before="$tmp/unrelated-ai.before"
  local project_before="$tmp/uninstall-project.before"
  local bundle
  new_project "$project"
  mkdir -p "$fixture_home" "$fixture_bin" "$project/.agentfs"
  printf '#!/usr/bin/env bash\nexit 0\n' >"$fixture_bin/claude"
  printf '#!/usr/bin/env bash\nexit 0\n' >"$fixture_bin/systemctl"
  chmod 755 "$fixture_bin/claude" "$fixture_bin/systemctl"
  printf '%s\n' '{"schema_version":1,"capabilities":{"wiki":false},"logging":{"callbacks":true}}' >"$project/.ai/capabilities.json"
  chmod 600 "$project/.ai/capabilities.json"
  printf 'operator-owned ai bytes\000must-survive\377\n' >"$project/.ai/operator-state.bin"
  printf 'capability-callback-v1\000durable\377bytes\n' >"$project/.agentfs/trajectory.db"
  printf 'capability-wal-v1\000durable\377bytes\n' >"$project/.agentfs/trajectory.db-wal"
  cp "$project/.ai/capabilities.json" "$config_before"
  cp "$project/.ai/operator-state.bin" "$unrelated_before"
  cp "$project/.agentfs/trajectory.db" "$db_before"
  cp -a "$project" "$project_before"

  HOME="$fixture_home" XDG_CONFIG_HOME="$fixture_home/.config" PATH="$fixture_bin:$PATH" \
    "$ROOT/scripts/uninstall.sh" --dry-run --live-root "$live" "$project" >/dev/null 2>&1 || fail "capability uninstall dry-run failed"
  diff -qr "$project_before" "$project" >/dev/null || fail "capability uninstall dry-run changed project bytes"

  HOME="$fixture_home" XDG_CONFIG_HOME="$fixture_home/.config" PATH="$fixture_bin:$PATH" \
    "$ROOT/scripts/uninstall.sh" --yes --live-root "$live" "$project" >/dev/null 2>&1 || fail "default capability uninstall failed"
  [[ ! -e "$project/.ai/capabilities.json" ]] || fail "default uninstall retained project capability config"
  cmp -s "$unrelated_before" "$project/.ai/operator-state.bin" || fail "default uninstall changed unrelated .ai bytes"
  cmp -s "$db_before" "$project/.agentfs/trajectory.db" || fail "default uninstall changed callback store bytes"
  bundle=$(find "$fixture_home" -maxdepth 1 -type d -name '.cairnkeep-uninstall-*' | sort | tail -1)
  [[ -n "$bundle" && -x "$bundle/revert.sh" ]] || fail "default uninstall created no reversible backup"
  cmp -s "$config_before" "$bundle/files/${project#/}/.ai/capabilities.json" || fail "capability config backup is not exact"
  HOME="$fixture_home" XDG_CONFIG_HOME="$fixture_home/.config" bash "$bundle/revert.sh" >/dev/null 2>&1 || fail "capability revert failed"
  cmp -s "$config_before" "$project/.ai/capabilities.json" || fail "capability revert did not restore config bytes"
  [[ $(stat -c '%a' "$project/.ai/capabilities.json" 2>/dev/null || stat -f '%Lp' "$project/.ai/capabilities.json") == 600 ]] || fail "capability revert did not restore config mode"
  cmp -s "$unrelated_before" "$project/.ai/operator-state.bin" || fail "capability revert changed unrelated .ai bytes"

  HOME="$fixture_home" XDG_CONFIG_HOME="$fixture_home/.config" PATH="$fixture_bin:$PATH" \
    "$ROOT/scripts/uninstall.sh" --yes --purge-memory --live-root "$live" "$project" >/dev/null 2>&1 || fail "capability purge failed"
  [[ ! -e "$project/.agentfs" ]] || fail "purge retained callback store"
  bundle=$(find "$fixture_home" -maxdepth 1 -type d -name '.cairnkeep-uninstall-*' | sort | tail -1)
  cmp -s "$db_before" "$bundle/files/${project#/}/.agentfs/trajectory.db" || fail "callback store purge backup is not exact"
  HOME="$fixture_home" XDG_CONFIG_HOME="$fixture_home/.config" bash "$bundle/revert.sh" >/dev/null 2>&1 || fail "capability purge revert failed"
  cmp -s "$db_before" "$project/.agentfs/trajectory.db" || fail "capability purge revert did not restore callback bytes"
  cmp -s "$unrelated_before" "$project/.ai/operator-state.bin" || fail "capability purge revert changed unrelated .ai bytes"
  echo "PASS: Phase 18 capability uninstall keep/purge/revert contract"
}

operating_paths() {
  case "$HARNESS:$CAPABILITY" in
    claude:wiki) printf '%s\n' claude/capability-contract/commands/wiki-ingest.md claude/capability-contract/commands/wiki-query.md claude/capability-contract/commands/wiki-lint.md ;;
    claude:graph) printf '%s\n' claude/capability-contract/commands/graphify.md ;;
    claude:security.audit) printf '%s\n' claude/capability-contract/commands/security-audit.md ;;
    opencode-command:wiki) printf '%s\n' opencode/capability-contract/command/wiki-ingest.md opencode/capability-contract/command/wiki-query.md opencode/capability-contract/command/wiki-lint.md ;;
    opencode-command:graph) printf '%s\n' opencode/capability-contract/command/graphify.md ;;
    opencode-command:security.audit) printf '%s\n' opencode/capability-contract/command/security-audit.md ;;
    opencode-workflow:wiki) printf '%s\n' opencode/capability-contract/workflows/wiki-ingest-workflow.md opencode/capability-contract/workflows/wiki-query-workflow.md opencode/capability-contract/workflows/wiki-lint-workflow.md ;;
    opencode-workflow:security.audit) printf '%s\n' opencode/capability-contract/workflows/security-audit-workflow.md ;;
  esac
}

run_operating() {
  local path guard_line first_owner_line
  if [[ "$HARNESS" == "claude" ]]; then
    run_claude_native
    return
  fi
  while IFS= read -r path; do
    [[ -f "$ROOT/$path" ]] || fail "missing guarded overlay $path"
    guard_line=$(grep -n -m1 'cairn capabilities guard' "$ROOT/$path" | cut -d: -f1)
    first_owner_line=$(grep -n -m1 -E '^(## )?(Step 0|Process|Execution|Workflow)|<process>' "$ROOT/$path" | cut -d: -f1)
    [[ -n "$guard_line" ]] || fail "overlay lacks capability guard: $path"
    [[ -z "$first_owner_line" || "$guard_line" -lt "$first_owner_line" ]] || fail "guard is not pre-I/O: $path"
    grep -qF 'cairn capabilities start' "$ROOT/$path" || fail "overlay lacks owned-boundary start: $path"
    grep -qF 'cairn capabilities finish' "$ROOT/$path" || fail "overlay lacks finalization: $path"
    grep -qF "$CAPABILITY" "$ROOT/$path" || fail "overlay uses the wrong family capability: $path"
  done < <(operating_paths)
  echo "PASS: Phase 18 $HARNESS $CAPABILITY operating guard contract"
}

run_claude_native() {
  local start="$ROOT/claude/capability-contract/hooks/capability-command-start.sh"
  local finish="$ROOT/claude/capability-contract/hooks/capability-command-finish.sh"
  [[ -x "$start" && -x "$finish" ]] || fail "Claude native capability hooks are absent"
  grep -qF 'harness-before' "$start" || fail "Claude admission hook does not delegate to the coordinator"
  grep -qF 'harness-terminal' "$finish" || fail "Claude terminal hook does not delegate to the coordinator"
  grep -qF 'harness-cwd' "$finish" || fail "Claude cwd hook does not delegate to the coordinator"
  "$ROOT/scripts/test-phase18-harness-boundary.sh" claude-hooks >/dev/null || fail "Claude native lifecycle outcomes failed"
  echo "PASS: Phase 18 Claude native hook delegation and durable outcomes"
}

run_owner_retirement() {
  if grep -R -q -E 'cairn capabilities (guard|start|finish)' "$ROOT/claude/capability-contract/commands"; then
    fail "obsolete Claude Markdown capability owner remains"
  fi
  echo "PASS: Phase 18 Claude Markdown owner retirement"
}

run_matrix() {
  local fixture="$ROOT/mcp-memory-server/scripts/fixtures/capabilities/ablation-snapshots.json"
  local project="$tmp/matrix-project"
  [[ -f "$fixture" ]] || fail "missing ablation snapshot fixture"
  new_project "$project"
  node - "$fixture" <<'NODE'
const { createHash } = require("crypto");
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const ids = ["memory.write", "memory.search", "notes.distill", "wiki", "graph", "security.audit", "route.check", "context.explore"];
const tools = { "memory.write": "memory_write", "memory.search": "memory_search", "route.check": "route_check", "context.explore": "context_explore" };
const digest = (snapshot) => createHash("sha256").update(JSON.stringify({
  schema_version: 1,
  contract_enabled: true,
  capabilities: snapshot.capabilities.map(({ id, enabled }) => ({ id, enabled })),
  logging: { callbacks: snapshot.logging.enabled },
})).digest("hex");
if (value.schema_version !== 1 || !value.all_enabled || JSON.stringify(Object.keys(value.one_disabled)) !== JSON.stringify(ids)) process.exit(1);
if (value.all_enabled.configuration_digest !== digest(value.all_enabled)) process.exit(1);
if (JSON.stringify(value.all_enabled.capabilities.map((row) => row.id)) !== JSON.stringify(ids)) process.exit(1);
if (Object.values(value.all_enabled.owner_callbacks).some((ran) => ran !== true)) process.exit(1);
if (JSON.stringify(value.all_enabled.registered_mcp_tools) !== JSON.stringify(Object.values(tools))) process.exit(1);
for (const id of ids) {
  const snapshot = value.one_disabled[id];
  if (snapshot.configuration_digest !== digest(snapshot) || snapshot.configuration_digest === value.all_enabled.configuration_digest) process.exit(1);
  if (snapshot.logging.enabled !== value.all_enabled.logging.enabled || snapshot.logging.source !== value.all_enabled.logging.source) process.exit(1);
  if (snapshot.capabilities.filter((row) => !row.enabled).map((row) => row.id).join() !== id) process.exit(1);
  if (Object.entries(snapshot.owner_callbacks).filter(([, ran]) => !ran).map(([owner]) => owner).join() !== id) process.exit(1);
  for (const row of snapshot.capabilities) {
    const baseline = value.all_enabled.capabilities.find((candidate) => candidate.id === row.id);
    if (!baseline || row.source !== baseline.source || row.restart_required !== baseline.restart_required || row.kind !== baseline.kind) process.exit(1);
    if (row.id !== id && row.enabled !== baseline.enabled) process.exit(1);
  }
  const expectedTools = Object.entries(tools).filter(([capability]) => capability !== id).map(([, tool]) => tool);
  if (JSON.stringify(snapshot.registered_mcp_tools) !== JSON.stringify(expectedTools)) process.exit(1);
  if (tools[id]) {
    if (snapshot.omission_evidence?.tool !== tools[id] || snapshot.omission_evidence?.configuration_digest !== snapshot.configuration_digest) process.exit(1);
  } else if (snapshot.omission_evidence !== null) process.exit(1);
}
NODE
  CAIRN_CAPABILITY_CONTRACT=1 node "$ROOT/mcp-memory-server/scripts/smoke-capability-contract.mjs" --baseline >/dev/null
  run_capability "$project" reset --all >/dev/null
  enable_all_capabilities "$project"
  local id output="$tmp/matrix-status.json" matrix_states=1
  run_capability "$project" status --json >"$output"
  node - "$output" "$fixture" <<'NODE'
const fs = require("fs");
const [statusPath, fixturePath] = process.argv.slice(2);
const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
const expected = JSON.parse(fs.readFileSync(fixturePath, "utf8")).all_enabled;
if (status.configuration_digest !== expected.configuration_digest) process.exit(1);
if (JSON.stringify(status.logging) !== JSON.stringify(expected.logging)) process.exit(1);
if (JSON.stringify(status.capabilities) !== JSON.stringify(expected.capabilities)) process.exit(1);
NODE
  for id in memory.write memory.search notes.distill wiki graph security.audit route.check context.explore; do
    run_capability "$project" reset --all >/dev/null
    enable_all_capabilities "$project"
    run_capability "$project" disable "$id" >/dev/null
    run_capability "$project" status --json >"$output"
    node - "$output" "$fixture" "$id" <<'NODE'
const fs = require("fs");
const [statusPath, fixturePath, disabled] = process.argv.slice(2);
const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const expected = fixture.one_disabled[disabled];
if (!expected || status.configuration_digest !== expected.configuration_digest) process.exit(1);
if (status.capabilities.filter((row) => !row.enabled).map((row) => row.id).join() !== disabled) process.exit(1);
for (const row of status.capabilities) {
  const wanted = expected.capabilities.find((item) => item.id === row.id);
  if (!wanted || wanted.enabled !== row.enabled || wanted.source !== row.source || wanted.restart_required !== row.restart_required) process.exit(1);
}
NODE
    matrix_states=$((matrix_states + 1))
  done
  [[ "$matrix_states" -eq 9 ]] || fail "matrix did not execute exactly one all-enabled and eight one-disabled states"
  echo "PASS: Phase 18 all-enabled and eight one-disabled matrix"
}

run_runtime() {
  node --version | grep -qE '^v(22|24|26)\.' || fail "lifecycle runtime is outside the supported Node matrix"
  bash --version | head -1
  bash -n "$ROOT/scripts/test-phase18-capability-lifecycle.sh"
  echo "PASS: Phase 18 local runtime contract"
}

run_lifecycle() {
  run_contract
  run_matrix
  run_bootstrap
  run_uninstall
  [[ "$RUNTIME" -eq 0 ]] || run_runtime
  echo "PASS: Phase 18 complete capability lifecycle"
}

run_native_boundary() {
  local evidence="$tmp/native-boundary-evidence.log"
  run_matrix
  "$ROOT/scripts/test-phase18-harness-boundary.sh" evidence-scope >"$evidence" || {
    cat "$evidence" >&2
    fail "native delegate-call evidence failed"
  }
  node - "$evidence" <<'NODE' || fail "native boundary evidence overstated its acceptance scope"
const fs = require("node:fs");
const lines = fs.readFileSync(process.argv[2], "utf8").trim().split(/\n/);
const parse = (prefix) => {
  const line = lines.find((candidate) => candidate.startsWith(`${prefix}:`));
  if (!line) process.exit(1);
  return JSON.parse(line.slice(prefix.length + 1));
};
const boundary = parse("DETERMINISTIC_BOUNDARY_EVIDENCE");
const live = parse("PHASE18_REQUIRED_LIVE_MATRIX");
if (boundary.schema_version !== 1 || boundary.status !== "pass") process.exit(1);
if (boundary.scope !== "native-delegate-order" || boundary.owner_execution !== "simulated-after-admission") process.exit(1);
if (live.schema_version !== 1 || live.required_cells !== 56 || live.passing_cells !== 0) process.exit(1);
if (live.status !== "blocking" || live.acceptance !== false || live.replacement_plan !== "18-27") process.exit(1);
NODE
  cat "$evidence"
  echo "PASS: deterministic native-boundary coverage; live real-owner acceptance remains blocked"
}

case "$MODE" in
  baseline)
    run_baseline
    ;;
  --expect-red-contract)
    run_baseline
    set +e
    (cd "$tmp" && env -u CAIRN_CAPABILITY_CONTRACT "$ROOT/bin/cairn" capabilities status --json) >"$tmp/red.out" 2>"$tmp/red.err"
    red_status=$?
    set -e
    if [[ "$red_status" -eq 2 ]] && grep -qxF 'Unknown command: capabilities' "$tmp/red.err"; then
      printf '%s\n' "$RED_MARKER" >&2
      exit "$EXPECTED_RED_EXIT"
    fi
    cat "$tmp/red.out" "$tmp/red.err" >&2
    [[ "$red_status" -ne 0 ]] || fail "expected missing capability CLI, but the command succeeded"
    fail "capability CLI failed for a reason other than the absent dispatch surface"
    ;;
  contract) run_contract ;;
  matrix) run_matrix ;;
  operating) run_operating ;;
  bootstrap) run_bootstrap ;;
  uninstall) run_uninstall ;;
  claude-native) run_claude_native ;;
  native-boundary) run_native_boundary ;;
  owner-retirement) run_owner_retirement ;;
  lifecycle) run_lifecycle ;;
  full)
    run_baseline
    run_lifecycle
    HARNESS=claude CAPABILITY=wiki run_operating
    HARNESS=claude CAPABILITY=graph run_operating
    HARNESS=claude CAPABILITY=security.audit run_operating
    HARNESS=opencode-command CAPABILITY=wiki run_operating
    HARNESS=opencode-command CAPABILITY=graph run_operating
    HARNESS=opencode-command CAPABILITY=security.audit run_operating
    HARNESS=opencode-workflow CAPABILITY=wiki run_operating
    HARNESS=opencode-workflow CAPABILITY=security.audit run_operating
    ;;
esac
