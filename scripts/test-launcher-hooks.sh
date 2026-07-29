#!/usr/bin/env bash
# Smoke test for the launcher wrapper seams: .ai/pre-launch.sh (source + abort),
# CAIRN_EXTRA_SETTINGS layering, and .ai/post-exit.sh.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }

write_recovery_runtime_fixture() {
  local runtime_root="$1"
  local name
  mkdir -p "$runtime_root/bin" "$runtime_root/mcp-memory-server/dist"
  for name in scripts claude opencode templates; do
    ln -s "$ROOT/$name" "$runtime_root/$name"
  done
  for asset in "$ROOT"/mcp-memory-server/dist/*; do
    name=${asset##*/}
    [[ "$name" == capability-cli.js ]] || ln -s "$asset" "$runtime_root/mcp-memory-server/dist/$name"
  done
  cat > "$runtime_root/bin/cairn" <<'SH'
#!/usr/bin/env bash
exit 0
SH
  chmod +x "$runtime_root/bin/cairn"
  cat > "$runtime_root/mcp-memory-server/dist/capability-cli.js" <<NODE
#!/usr/bin/env node
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const operation = process.argv[2] ?? "";
fs.appendFileSync(process.env.CAIRN_RECOVERY_TRACE, \`coordinator:\${operation}\\n\`);
if (operation === "harness-recover" && process.env.CAIRN_TEST_RECOVERY_FAIL === "1") process.exit(23);
const input = fs.readFileSync(0);
const result = spawnSync(process.execPath, ["$ROOT/mcp-memory-server/dist/capability-cli.js", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  input,
  encoding: "utf8",
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
NODE
  chmod +x "$runtime_root/mcp-memory-server/dist/capability-cli.js"
}

write_recovery_harness_fixtures() {
  local bin_root="$1"
  local name
  mkdir -p "$bin_root"
  for name in claude opencode; do
    cat > "$bin_root/$name" <<'SH'
#!/usr/bin/env bash
name=${0##*/}
if [[ "$name" == claude ]]; then config=${CLAUDE_CONFIG_DIR:-}; else config=${OPENCODE_CONFIG_DIR:-}; fi
printf 'harness:%s|args:%s|config:%s\n' "$name" "$*" "$config" >> "$CAIRN_RECOVERY_TRACE"
exit "${FAKE_EXIT:-0}"
SH
    chmod +x "$bin_root/$name"
  done
}

write_recovery_config() {
  local project="$1"
  mkdir -p "$project/.ai"
  printf '%s\n' '{"schema_version":1,"capabilities":{"wiki":true},"logging":{"callbacks":true}}' \
    > "$project/.ai/capabilities.json"
  chmod 600 "$project/.ai/capabilities.json"
}

create_recovery_lease() {
  local project="$1"
  local state_root="$2"
  local harness="$3"
  local session="$4"
  local output
  output=$(
    cd "$project"
    printf '%s' "{\"schema_version\":1,\"harness\":\"$harness\",\"command\":\"wiki-query\",\"session_id\":\"$session\",\"project_root\":\"$project\"}" | \
      env CAIRN_CAPABILITY_CONTRACT=1 CAIRN_CAPABILITY_LOGGING=1 CAIRN_TRAJECTORY_CAPTURE=1 \
        CAIRN_HARNESS_STATE_DIR="$state_root" \
        node "$ROOT/mcp-memory-server/dist/capability-cli.js" harness-before
  )
  [[ "$output" == '{"schema_version":1,"decision":"allow"}' ]] || fail "could not create genuine recovery lease"
}

inject_terminal_crash() {
  local project="$1"
  local state_root="$2"
  local harness="$3"
  local session="$4"
  (
    cd "$project"
    env CAIRN_CAPABILITY_CONTRACT=1 CAIRN_CAPABILITY_LOGGING=1 CAIRN_TRAJECTORY_CAPTURE=1 \
      CAIRN_HARNESS_STATE_DIR="$state_root" \
      node --input-type=module - "$ROOT/mcp-memory-server/dist/capability-harness.js" "$harness" "$session" <<'NODE'
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const [modulePath, harness, sessionID] = process.argv.slice(2);
const coordinator = await import(pathToFileURL(modulePath).href);
await assert.rejects(
  coordinator.finishHarnessCapability({
    schema_version: 1,
    harness,
    session_id: sessionID,
    outcome: "success",
  }, { testCrashAt: "after-claim" }),
  (error) => error?.name === "HarnessCrashInjection",
);
NODE
  )
}

expire_recovery_lease() {
  local state_root="$1"
  local lease
  lease=$(find "$state_root/capability-leases-v1" -type f -name '*.json' -print -quit)
  [[ -n "$lease" ]] || fail "active recovery lease is absent"
  node - "$lease" <<'NODE'
const fs = require("node:fs");
const path = process.argv[2];
const before = JSON.parse(fs.readFileSync(path, "utf8"));
const after = { ...before, expires_at: "2020-01-01T00:00:00.000Z" };
if (Object.keys(before).sort().join(",") !== Object.keys(after).sort().join(",")) process.exit(1);
fs.writeFileSync(path, `${JSON.stringify(after)}\n`, { mode: 0o600 });
fs.chmodSync(path, 0o600);
NODE
}

recovery_state() {
  local project="$1"
  local state_root="$2"
  (
    cd "$ROOT/mcp-memory-server"
    NODE_NO_WARNINGS=1 node --input-type=module - "$project" "$state_root" <<'NODE'
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { AgentFS } from "agentfs-sdk";
const [project, stateRoot] = process.argv.slice(2);
const database = join(project, ".agentfs", "trajectory.db");
let pending = [];
let finals = [];
if (existsSync(database)) {
  const agent = await AgentFS.open({ id: "trajectory", path: database });
  pending = await agent.kv.list("capability-callback/v1/pending/");
  finals = await agent.kv.list("capability-callback/v1/record/");
  await agent.close();
}
function files(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const stateFiles = files(stateRoot);
const raw = Buffer.concat([
  ...stateFiles.map((path) => readFileSync(path)),
  ...(existsSync(join(project, ".agentfs")) ? readdirSync(join(project, ".agentfs"))
    .filter((name) => /^trajectory\.db(?:-(?:wal|shm))?$/.test(name))
    .map((name) => readFileSync(join(project, ".agentfs", name))) : []),
]).toString("utf8");
process.stdout.write(JSON.stringify({
  pending: pending.length,
  finals: finals.map(({ value }) => value),
  leases: stateFiles.filter((path) => path.endsWith(".json")).length,
  leaked: ["launcher-argument-sentinel-18-28", "launcher-result-sentinel-18-28"].some((value) => raw.includes(value)),
}));
NODE
  )
}

assert_recovered_state() {
  local state="$1"
  local outcome="$2"
  node - "$state" "$outcome" <<'NODE'
const state = JSON.parse(process.argv[2]);
const outcome = process.argv[3];
if (state.pending !== 0 || state.leases !== 0 || state.leaked) process.exit(1);
if (state.finals.length !== 1 || state.finals[0].outcome !== outcome) process.exit(1);
  if (["launcher-argument-sentinel-18-28", "launcher-result-sentinel-18-28"]
    .some((value) => JSON.stringify(state.finals[0]).includes(value))) process.exit(1);
NODE
}

capability_recovery() {
  local recovery_root="$tmp/capability-recovery"
  local runtime_root="$recovery_root/runtime"
  local harness_bin="$recovery_root/harness-bin"
  local trace="$recovery_root/trace"
  local claude_repo="$recovery_root/claude-project"
  local opencode_repo="$recovery_root/opencode-project"
  local claude_state="$recovery_root/claude-state"
  local opencode_state="$recovery_root/opencode-state"
  local state before status launcher harness project state_root master_value

  npm --prefix "$ROOT/mcp-memory-server" run build >/dev/null
  mkdir -p "$claude_repo" "$opencode_repo"
  git -C "$claude_repo" init -q
  git -C "$opencode_repo" init -q
  "$ROOT/scripts/bootstrap.sh" "$claude_repo" >/dev/null
  "$ROOT/scripts/bootstrap.sh" "$opencode_repo" >/dev/null
  write_recovery_config "$claude_repo"
  write_recovery_config "$opencode_repo"
  write_recovery_runtime_fixture "$runtime_root"
  write_recovery_harness_fixtures "$harness_bin"
  : > "$trace"

  create_recovery_lease "$claude_repo" "$claude_state" claude-code launcher-crash-claude-18-28
  inject_terminal_crash "$claude_repo" "$claude_state" claude-code launcher-crash-claude-18-28
  create_recovery_lease "$opencode_repo" "$opencode_state" opencode launcher-expired-opencode-18-28
  expire_recovery_lease "$opencode_state"

  CAIRN_RECOVERY_TRACE="$trace" CAIRN_CAPABILITY_CONTRACT=1 CAIRN_CAPABILITY_LOGGING=1 \
    CAIRN_TRAJECTORY_CAPTURE=1 CAIRN_HARNESS_STATE_DIR="$claude_state" \
    PATH="$runtime_root/bin:$harness_bin:$PATH" \
    "$claude_repo/.ai/start-claude.sh" --launcher-argument-sentinel-18-28 >/dev/null 2>&1 || \
    fail "Claude recovery fixture did not reach the harness"
  CAIRN_RECOVERY_TRACE="$trace" CAIRN_CAPABILITY_CONTRACT=1 CAIRN_CAPABILITY_LOGGING=1 \
    CAIRN_TRAJECTORY_CAPTURE=1 CAIRN_HARNESS_STATE_DIR="$opencode_state" \
    PATH="$runtime_root/bin:$harness_bin:$PATH" \
    "$opencode_repo/.ai/start-opencode.sh" --launcher-argument-sentinel-18-28 >/dev/null 2>&1 || \
    fail "OpenCode recovery fixture did not reach the harness"

  if [[ $(grep -c '^coordinator:harness-recover$' "$trace" || true) -eq 0 ]]; then
    [[ $(grep -c '^harness:' "$trace" || true) -eq 2 ]] || fail "known launcher recovery gap changed harness execution"
    [[ $(node -e 'const s=JSON.parse(process.argv[1]);process.stdout.write(String(s.leases))' "$(recovery_state "$claude_repo" "$claude_state")") -eq 1 ]] || \
      fail "known launcher recovery gap consumed the Claude crash lease"
    [[ $(node -e 'const s=JSON.parse(process.argv[1]);process.stdout.write(String(s.leases))' "$(recovery_state "$opencode_repo" "$opencode_state")") -eq 1 ]] || \
      fail "known launcher recovery gap consumed the OpenCode expiry lease"
    echo "PHASE18_RED:PRODUCTION_STARTUP_RECOVERY"
    return 86
  fi

  node - "$trace" <<'NODE' || fail "recovery did not run once before each harness"
const fs = require("node:fs");
const rows = fs.readFileSync(process.argv[2], "utf8").trim().split(/\n/);
if (rows.length !== 4) process.exit(1);
if (rows[0] !== "coordinator:harness-recover" || !rows[1].startsWith("harness:claude|")) process.exit(1);
if (rows[2] !== "coordinator:harness-recover" || !rows[3].startsWith("harness:opencode|")) process.exit(1);
NODE
  assert_recovered_state "$(recovery_state "$claude_repo" "$claude_state")" success || fail "Claude crash recovery state is incorrect"
  assert_recovered_state "$(recovery_state "$opencode_repo" "$opencode_state")" timeout || fail "OpenCode expiry recovery state is incorrect"

  before="$(recovery_state "$claude_repo" "$claude_state")|$(recovery_state "$opencode_repo" "$opencode_state")"
  : > "$trace"
  CAIRN_RECOVERY_TRACE="$trace" CAIRN_CAPABILITY_CONTRACT=1 CAIRN_HARNESS_STATE_DIR="$claude_state" \
    PATH="$runtime_root/bin:$harness_bin:$PATH" "$claude_repo/.ai/start-claude.sh" --replay >/dev/null 2>&1
  CAIRN_RECOVERY_TRACE="$trace" CAIRN_CAPABILITY_CONTRACT=1 CAIRN_HARNESS_STATE_DIR="$opencode_state" \
    PATH="$runtime_root/bin:$harness_bin:$PATH" "$opencode_repo/.ai/start-opencode.sh" --replay >/dev/null 2>&1
  [[ "$before" == "$(recovery_state "$claude_repo" "$claude_state")|$(recovery_state "$opencode_repo" "$opencode_state")" ]] || \
    fail "replayed startup changed recovered finals"

  for harness in claude opencode; do
    if [[ "$harness" == claude ]]; then
      project="$claude_repo"; state_root="$claude_state"; launcher="$project/.ai/start-claude.sh"
    else
      project="$opencode_repo"; state_root="$opencode_state"; launcher="$project/.ai/start-opencode.sh"
    fi
    : > "$trace"
    status=0
    CAIRN_RECOVERY_TRACE="$trace" CAIRN_TEST_RECOVERY_FAIL=1 FAKE_EXIT=7 \
      CAIRN_CAPABILITY_CONTRACT=1 CAIRN_HARNESS_STATE_DIR="$state_root" \
      PATH="$runtime_root/bin:$harness_bin:$PATH" "$launcher" --failure-argv >/dev/null 2>&1 || status=$?
    [[ "$status" -eq 7 ]] || fail "$harness recovery failure changed the harness exit status"
    node - "$trace" "$harness" "$project" <<'NODE' || fail "recovery failure changed harness ordering, argv, or config"
const fs = require("node:fs");
const [trace, harness, project] = process.argv.slice(2);
const rows = fs.readFileSync(trace, "utf8").trim().split(/\n/);
if (rows.length !== 2 || rows[0] !== "coordinator:harness-recover") process.exit(1);
if (!rows[1].startsWith(`harness:${harness}|args:--failure-argv|`)) process.exit(1);
if (!rows[1].includes(`config:${project}/.ai/capability-contract/${harness}`)) process.exit(1);
NODE
  done

  for master_value in 0 false FALSE no off invalid; do
    for harness in claude opencode; do
      if [[ "$harness" == claude ]]; then project="$claude_repo"; launcher="$project/.ai/start-claude.sh"
      else project="$opencode_repo"; launcher="$project/.ai/start-opencode.sh"; fi
      : > "$trace"
      CAIRN_RECOVERY_TRACE="$trace" CAIRN_CAPABILITY_CONTRACT="$master_value" \
        PATH="$runtime_root/bin:$harness_bin:$PATH" "$launcher" --legacy-argv >/dev/null 2>&1 || \
        fail "$harness master-off spelling failed: $master_value"
      [[ $(grep -c '^coordinator:' "$trace" || true) -eq 0 ]] || fail "$harness master-off invoked recovery: $master_value"
      grep -q "^harness:$harness|args:--legacy-argv|config:$" "$trace" || \
        fail "$harness master-off changed argv or config: $master_value"
    done
  done

  echo "PASS: production launcher crash and expiry recovery contract"
}

opencode_sync_tree_digest() {
  local live_root="$1"
  (
    cd "$live_root"
    find . -type f -print | LC_ALL=C sort | while IFS= read -r asset; do
      sha256sum "$asset"
    done
  )
}

assert_opencode_legacy_plugins() {
  local live_root="$1"
  local plugin
  for plugin in memory-wakeup.ts memory-capture.ts memory-recall.ts; do
    [[ -f "$live_root/plugins/$plugin" ]] || fail "OpenCode sync omitted legacy plugin: $plugin"
    cmp -s <(sed "s|@@INFRA_ROOT@@|$ROOT|g" "$ROOT/opencode/plugins/$plugin") \
      "$live_root/plugins/$plugin" || fail "OpenCode sync changed legacy plugin bytes: $plugin"
  done
}

assert_no_retired_opencode_owners() {
  local live_root="$1"
  [[ ! -e "$live_root/capability-contract" ]] || fail "OpenCode sync installed a retired capability owner tree"
  [[ ! -e "$live_root/hooks/capability-command-start.sh" ]] || fail "OpenCode sync installed a Claude capability hook"
  [[ ! -e "$live_root/hooks/capability-command-finish.sh" ]] || fail "OpenCode sync installed a Claude capability hook"
  if grep -R -q -E 'cairn capabilities (guard|start|finish)|capability_handle' \
    "$live_root/command" "$live_root/workflows" 2>/dev/null; then
    fail "OpenCode sync installed retired model-visible lifecycle ownership"
  fi
}

assert_opencode_sync_assets() {
  local name="$1"
  local live_root="$2"
  case "$name" in
    wiki)
      cmp -s "$ROOT/opencode/command/wiki-ingest.md" "$live_root/command/wiki-ingest.md" || fail "wiki sync changed legacy command bytes"
      cmp -s "$ROOT/opencode/workflows/wiki-ingest-workflow.md" "$live_root/workflows/wiki-ingest-workflow.md" || fail "wiki sync changed legacy workflow bytes"
      ;;
    graph)
      cmp -s "$ROOT/opencode/command/graphify.md" "$live_root/command/graphify.md" || fail "graph sync changed legacy command bytes"
      ;;
    security)
      cmp -s "$ROOT/opencode/command/security-audit.md" "$live_root/command/security-audit.md" || fail "security sync changed legacy command bytes"
      cmp -s "$ROOT/opencode/workflows/security-audit-workflow.md" "$live_root/workflows/security-audit-workflow.md" || fail "security sync changed legacy workflow bytes"
      ;;
  esac
}

opencode_all_sync_modes() {
  local probe_bin="$tmp/sync-probe-bin"
  local process_log="$tmp/sync-processes.log"
  local entry name normal_root enabled_root before after output state_root plugin_count
  mkdir -p "$probe_bin"
  : > "$process_log"
  for command_name in cairn node; do
    cat > "$probe_bin/$command_name" <<EOF
#!/usr/bin/env bash
echo "$command_name:\$*" >> "$process_log"
exit 91
EOF
    chmod +x "$probe_bin/$command_name"
  done

  for spec in \
    "wiki:scripts/sync-opencode-wiki-assets.sh" \
    "graph:scripts/sync-opencode-graphify-assets.sh" \
    "security:scripts/sync-opencode-security-assets.sh"
  do
    name=${spec%%:*}
    entry="$ROOT/${spec#*:}"
    normal_root="$tmp/$name-normal"
    enabled_root="$tmp/$name-enabled"
    state_root="$tmp/$name-state"

    output=$(env -u CAIRN_CAPABILITY_CONTRACT \
      PATH="$probe_bin:$PATH" CAIRN_HARNESS_STATE_DIR="$state_root/normal" \
      "$entry" --apply --live-root "$normal_root") || fail "$name normal sync failed"
    assert_opencode_sync_assets "$name" "$normal_root"
    assert_opencode_legacy_plugins "$normal_root"
    assert_no_retired_opencode_owners "$normal_root"
    [[ ! -e "$normal_root/plugins/capability-command.ts" ]] || fail "$name normal sync registered capability plugin"
    before=$(opencode_sync_tree_digest "$normal_root")

    output+=$(CAIRN_CAPABILITY_CONTRACT=0 \
      PATH="$probe_bin:$PATH" CAIRN_HARNESS_STATE_DIR="$state_root/master-off" \
      "$entry" --apply --capability-overlay --live-root "$normal_root") || fail "$name master-off overlay sync failed"
    after=$(opencode_sync_tree_digest "$normal_root")
    [[ "$after" == "$before" ]] || fail "$name master-off overlay differs from exact normal sync"
    assert_no_retired_opencode_owners "$normal_root"
    [[ ! -e "$normal_root/plugins/capability-command.ts" ]] || fail "$name master-off sync registered capability plugin"

    output+=$(CAIRN_CAPABILITY_CONTRACT=1 \
      PATH="$probe_bin:$PATH" CAIRN_HARNESS_STATE_DIR="$state_root/enabled" \
      "$entry" --apply --capability-overlay --live-root "$enabled_root") || fail "$name enabled overlay sync failed"
    assert_opencode_sync_assets "$name" "$enabled_root"
    assert_opencode_legacy_plugins "$enabled_root"
    assert_no_retired_opencode_owners "$enabled_root"
    plugin_count=$(find "$enabled_root/plugins" -maxdepth 1 -type f -name 'capability-*.ts' | wc -l | tr -d ' ')
    [[ "$plugin_count" -eq 1 ]] || fail "$name enabled overlay installed more than the native capability plugin"
    cmp -s <(sed "s|@@INFRA_ROOT@@|$ROOT|g" "$ROOT/opencode/capability-contract/plugins/capability-command.ts") \
      "$enabled_root/plugins/capability-command.ts" || fail "$name enabled overlay capability plugin bytes differ"
    grep -qF 'export const CapabilityCommandPlugin' "$enabled_root/plugins/capability-command.ts" || \
      fail "$name enabled overlay omitted native plugin registration"
    [[ ! -e "$state_root" ]] || fail "$name sync created capability measurement state"
    [[ ! -s "$process_log" ]] || fail "$name sync started a capability coordinator process"
    if grep -q -E 'disabled|permissionDecision|block' <<<"$output"; then
      fail "$name sync emitted capability blocking state"
    fi
  done

  echo "PASS: all OpenCode sync entrypoints preserve inert identity and select only the native overlay plugin"
}

if [[ "${1:-}" == "opencode-all-sync-modes" ]]; then
  opencode_all_sync_modes
  exit 0
fi

if [[ "${1:-}" == "capability-recovery" ]]; then
  capability_recovery
  exit $?
fi

# A git repo scaffolded with the real templates.
repo="$tmp/repo"; mkdir "$repo"; git -C "$repo" init -q
"$ROOT/scripts/bootstrap.sh" "$repo" >/dev/null
launcher="$repo/.ai/start-claude.sh"
[[ -x "$launcher" ]] || fail "launcher not scaffolded"
pi_launcher="$repo/.ai/start-pi.sh"
[[ -x "$pi_launcher" ]] || fail "Pi launcher not scaffolded"

# OpenCode's run mode ends a turn after content-only output. Commands that need
# owner I/O must therefore make their first response action a tool call rather
# than requiring a standalone banner before the config gate.
! grep -qF '**Before ANY tool calls**, display this banner:' "$ROOT/opencode/command/graphify.md" \
  || fail "OpenCode graphify can stop after its pre-tool banner"
grep -qF '**First action:** invoke the Read tool' "$ROOT/opencode/command/graphify.md" \
  || fail "OpenCode graphify does not require the config-gate tool call first"
grep -qF '**Invoke the shell tool** with this exact command' "$ROOT/opencode/command/graphify.md" \
  || fail "OpenCode graphify does not require real shell delegation"
grep -qF '<argument>$ARGUMENTS</argument>' "$ROOT/opencode/command/graphify.md" \
  || fail "OpenCode graphify does not delimit its substituted argument"

# Fake harnesses on PATH: record argv, selected config root, and a marker env var.
mkdir "$tmp/bin"
cat > "$tmp/bin/claude" <<'FAKE'
#!/usr/bin/env bash
{ echo "args:$*"; echo "prelaunch:${PRELAUNCH_RAN:-0}"; echo "config:${CLAUDE_CONFIG_DIR:-}"; echo "contract:${CAIRN_CAPABILITY_CONTRACT:-}"; } > "$CLAUDE_LOG"
exit "${FAKE_EXIT:-0}"
FAKE
cat > "$tmp/bin/opencode" <<'FAKE'
#!/usr/bin/env bash
{
  echo "launch-time:$(date +%s)"
  echo "args:$*"
  echo "prelaunch:${PRELAUNCH_RAN:-0}"
  echo "config:${OPENCODE_CONFIG_DIR:-}"
  echo "explicit-config:${OPENCODE_CONFIG:-}"
  echo "contract:${CAIRN_CAPABILITY_CONTRACT:-}"
  if [[ -n "${OPENCODE_CONFIG_DIR:-}" && -d "$OPENCODE_CONFIG_DIR/plugins" ]]; then
    find "$OPENCODE_CONFIG_DIR/plugins" -maxdepth 1 -type f -name '*.ts' -printf 'plugin:%f\n' | LC_ALL=C sort
  fi
  if [[ -n "${OPENCODE_CONFIG_DIR:-}" && -f "$OPENCODE_CONFIG_DIR/plugins/capability-command.ts" ]] \
    && grep -qF 'export const CapabilityCommandPlugin' "$OPENCODE_CONFIG_DIR/plugins/capability-command.ts"; then
    echo "capability-registration:1"
  else
    echo "capability-registration:0"
  fi
} > "$OPENCODE_LOG"
exit "${FAKE_EXIT:-0}"
FAKE
chmod +x "$tmp/bin/claude" "$tmp/bin/opencode"
ln -s "$ROOT/bin/cairn" "$tmp/bin/cairn"
export PATH="$tmp/bin:$PATH"
export CLAUDE_LOG="$tmp/claude.log"
export OPENCODE_LOG="$tmp/opencode.log"

# Claude sync has three exact installation states. Normal sync and an explicit
# overlay request with the master off must contain no capability hook bytes or
# registrations; only master-on plus --capability-overlay may install them.
normal_sync="$tmp/claude-normal-sync"
normal_sync_before="$tmp/claude-normal-sync-before"
master_on_sync="$tmp/claude-master-on-sync"
env -u CAIRN_CAPABILITY_CONTRACT \
  "$ROOT/scripts/sync-claude-assets.sh" --apply --live-root "$normal_sync" >/dev/null
cp -a "$normal_sync" "$normal_sync_before"
CAIRN_CAPABILITY_CONTRACT=0 \
  "$ROOT/scripts/sync-claude-assets.sh" --apply --capability-overlay --live-root "$normal_sync" >/dev/null
for live in "$normal_sync" "$normal_sync_before"; do
  [[ ! -e "$live/hooks/capability-command-start.sh" ]] || fail "inert Claude sync installed start-hook bytes"
  [[ ! -e "$live/hooks/capability-command-finish.sh" ]] || fail "inert Claude sync installed finish-hook bytes"
  ! grep -R -qF 'capability-command-' "$live" || fail "inert Claude sync registered a capability hook"
  [[ ! -e "$repo/.agentfs/trajectory.db" ]] || fail "inert Claude sync created measurement state"
done
diff -qr "$normal_sync_before" "$normal_sync" >/dev/null || fail "master-off overlay differs from exact normal sync"

CAIRN_CAPABILITY_CONTRACT=1 \
  "$ROOT/scripts/sync-claude-assets.sh" --apply --capability-overlay --live-root "$master_on_sync" >/dev/null
for name in capability-command-start.sh capability-command-finish.sh; do
  installed="$master_on_sync/hooks/$name"
  [[ -x "$installed" ]] || fail "enabled Claude overlay omitted $name"
  grep -qF "INFRA_ROOT=\"$ROOT\"" "$installed" || fail "enabled Claude hook was not rendered"
  grep -qF 'mcp-memory-server/dist/capability-cli.js' "$installed" || fail "enabled Claude hook omitted coordinator delegation"
done
node - "$master_on_sync/settings.json" <<'NODE' || fail "enabled Claude overlay registrations are incomplete"
const fs = require("node:fs");
const settings = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const registrations = [];
for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
  for (const entry of entries) for (const hook of entry.hooks ?? []) {
    if (String(hook.command ?? "").includes("capability-command-")) {
      registrations.push({ event, matcher: entry.matcher ?? "", command: hook.command });
    }
  }
}
if (registrations.filter((row) => row.command.includes("capability-command-start.sh")).length !== 1) process.exit(1);
if (registrations.filter((row) => row.command.includes("capability-command-finish.sh")).length !== 4) process.exit(1);
if (!registrations.some((row) => row.event === "UserPromptExpansion" && row.matcher === "wiki-ingest|wiki-query|wiki-lint|graphify|security-audit")) process.exit(1);
if (["Stop", "StopFailure", "CwdChanged", "SessionEnd"].some((event) => !registrations.some((row) => row.event === event))) process.exit(1);
NODE

# 1. No hooks: launcher execs claude with the passed args (baseline unchanged).
rm -f "$CLAUDE_LOG"
"$launcher" --foo bar >/dev/null 2>&1 || fail "baseline launch failed"
grep -qx "args:--foo bar" "$CLAUDE_LOG" || fail "baseline did not pass args through"
grep -qx "prelaunch:0" "$CLAUDE_LOG" || fail "prelaunch marker leaked without a hook"
grep -qx "config:" "$CLAUDE_LOG" || fail "baseline selected a Claude config root"

opencode_launcher="$repo/.ai/start-opencode.sh"
[[ -x "$opencode_launcher" ]] || fail "OpenCode launcher not scaffolded"
"$opencode_launcher" --foo bar >/dev/null 2>&1 || fail "OpenCode baseline launch failed"
grep -qx "args:--foo bar" "$OPENCODE_LOG" || fail "OpenCode baseline did not pass args through"
grep -qx "config:" "$OPENCODE_LOG" || fail "OpenCode baseline selected a config root"
grep -qx "capability-registration:0" "$OPENCODE_LOG" || fail "OpenCode baseline registered a capability plugin"

# Invalid/off master values stay on the legacy direct-exec path: one harness
# process, unchanged argv/config environment, and no isolated assets or store.
legacy_claude="$tmp/legacy-claude"
legacy_opencode="$tmp/legacy-opencode"
mkdir -p "$legacy_claude/commands" "$legacy_opencode/command"
printf 'legacy-claude\n' > "$legacy_claude/commands/sentinel.md"
printf 'legacy-opencode\n' > "$legacy_opencode/command/sentinel.md"
sha256sum "$legacy_claude/commands/sentinel.md" > "$tmp/legacy-claude.sha"
sha256sum "$legacy_opencode/command/sentinel.md" > "$tmp/legacy-opencode.sha"
for master_value in 0 false FALSE no off invalid; do
  rm -rf "$repo/.ai/capability-contract" "$repo/.agentfs/trajectory.db" "$CLAUDE_LOG" "$OPENCODE_LOG"
  CAIRN_CAPABILITY_CONTRACT="$master_value" CLAUDE_CONFIG_DIR="$legacy_claude" \
    "$launcher" --identity >/dev/null 2>&1 || fail "Claude invalid-master launch failed: $master_value"
  CAIRN_CAPABILITY_CONTRACT="$master_value" OPENCODE_CONFIG_DIR="$legacy_opencode" \
    "$opencode_launcher" --identity >/dev/null 2>&1 || fail "OpenCode invalid-master launch failed: $master_value"
  grep -qx "args:--identity" "$CLAUDE_LOG" || fail "Claude invalid-master argv changed: $master_value"
  grep -qx "config:$legacy_claude" "$CLAUDE_LOG" || fail "Claude invalid-master config changed: $master_value"
  grep -qx "contract:$master_value" "$CLAUDE_LOG" || fail "Claude invalid-master environment changed: $master_value"
  grep -qx "args:--identity" "$OPENCODE_LOG" || fail "OpenCode invalid-master argv changed: $master_value"
  grep -qx "config:$legacy_opencode" "$OPENCODE_LOG" || fail "OpenCode invalid-master config changed: $master_value"
  grep -qx "contract:$master_value" "$OPENCODE_LOG" || fail "OpenCode invalid-master environment changed: $master_value"
  grep -qx "capability-registration:0" "$OPENCODE_LOG" || fail "OpenCode invalid-master launch registered a capability plugin: $master_value"
  [[ ! -e "$repo/.ai/capability-contract" ]] || fail "invalid master created an isolated root: $master_value"
  [[ ! -e "$repo/.agentfs/trajectory.db" ]] || fail "invalid master created a callback store: $master_value"
  sha256sum -c "$tmp/legacy-claude.sha" >/dev/null || fail "invalid master changed legacy Claude assets"
  sha256sum -c "$tmp/legacy-opencode.sha" >/dev/null || fail "invalid master changed legacy OpenCode assets"
done

# A truthy master selects project-local isolated roots and installs every guarded
# family through the explicit overlay modes. Legacy live roots remain untouched.
rm -rf "$repo/.ai/capability-contract" "$CLAUDE_LOG" "$OPENCODE_LOG"
CAIRN_CAPABILITY_CONTRACT=' TrUe ' CLAUDE_CONFIG_DIR="$legacy_claude" \
  "$launcher" --overlay >/dev/null 2>&1 || fail "Claude capability-overlay launch failed"
claude_overlay="$repo/.ai/capability-contract/claude"
grep -qx "args:--overlay" "$CLAUDE_LOG" || fail "Claude overlay launch changed argv"
grep -qx "config:$claude_overlay" "$CLAUDE_LOG" || fail "Claude overlay root was not selected"
for rel in commands/wiki-ingest.md commands/wiki-query.md commands/wiki-lint.md commands/graphify.md commands/security-audit.md; do
  cmp -s "$ROOT/claude/$rel" "$claude_overlay/$rel" || fail "Claude overlay changed legacy owner bytes: $rel"
done
CAIRN_CAPABILITY_CONTRACT=1 "$ROOT/scripts/sync-claude-assets.sh" --check --capability-overlay --live-root "$claude_overlay" >/dev/null || fail "Claude overlay family is incomplete"
for name in capability-command-start.sh capability-command-finish.sh; do
  cmp -s "$master_on_sync/hooks/$name" "$claude_overlay/hooks/$name" || fail "launcher overlay hook bytes differ: $name"
done

CAIRN_CAPABILITY_CONTRACT=1 OPENCODE_CONFIG_DIR="$legacy_opencode" \
  "$opencode_launcher" --overlay >/dev/null 2>&1 || fail "OpenCode capability-overlay launch failed"
opencode_overlay="$repo/.ai/capability-contract/opencode"
grep -qx "args:--overlay" "$OPENCODE_LOG" || fail "OpenCode overlay launch changed argv"
grep -qx "config:$opencode_overlay" "$OPENCODE_LOG" || fail "OpenCode overlay root was not selected"
grep -Eq '^launch-time:[0-9]+$' "$OPENCODE_LOG" || fail "OpenCode stub did not record launch time"
grep -qx 'capability-registration:1' "$OPENCODE_LOG" || fail "OpenCode capability plugin was not registered before process start"
for plugin in memory-wakeup.ts memory-capture.ts memory-recall.ts capability-command.ts; do
  grep -qx "plugin:$plugin" "$OPENCODE_LOG" || fail "OpenCode plugin was not present before process start: $plugin"
done
cmp -s <(sed "s|@@INFRA_ROOT@@|$ROOT|g" "$ROOT/opencode/capability-contract/plugins/capability-command.ts") \
  "$opencode_overlay/plugins/capability-command.ts" || fail "launcher capability plugin bytes differ from rendered source"
for rel in \
  command/wiki-ingest.md command/wiki-query.md command/wiki-lint.md \
  workflows/wiki-ingest-workflow.md workflows/wiki-query-workflow.md workflows/wiki-lint-workflow.md \
  command/graphify.md command/security-audit.md workflows/security-audit-workflow.md
do
  cmp -s "$ROOT/opencode/$rel" "$opencode_overlay/$rel" || fail "OpenCode overlay changed legacy owner bytes: $rel"
done
"$ROOT/scripts/sync-opencode-wiki-assets.sh" --check --capability-overlay --live-root "$opencode_overlay" >/dev/null || fail "OpenCode wiki overlay family is incomplete"
"$ROOT/scripts/sync-opencode-graphify-assets.sh" --check --capability-overlay --live-root "$opencode_overlay" >/dev/null || fail "OpenCode graph overlay family is incomplete"
"$ROOT/scripts/sync-opencode-security-assets.sh" --check --capability-overlay --live-root "$opencode_overlay" >/dev/null || fail "OpenCode security overlay family is incomplete"
CAIRN_CAPABILITY_CONTRACT=1 "$ROOT/scripts/sync-opencode-plugin-assets.sh" --check --capability-overlay --live-root "$opencode_overlay" >/dev/null || fail "OpenCode plugin overlay family is incomplete"
[[ ! -e "$repo/.agentfs/trajectory.db" ]] || fail "OpenCode launcher sync created measurement state before command admission"
"$ROOT/scripts/test-phase18-capability-lifecycle.sh" operating --harness opencode-workflow --capability wiki >/dev/null
"$ROOT/scripts/test-phase18-capability-lifecycle.sh" operating --harness opencode-workflow --capability security.audit >/dev/null
sha256sum -c "$tmp/legacy-claude.sha" >/dev/null || fail "overlay launch changed legacy Claude assets"
sha256sum -c "$tmp/legacy-opencode.sha" >/dev/null || fail "overlay launch changed legacy OpenCode assets"

# 2. pre-launch.sh is sourced (can export env) + CAIRN_EXTRA_SETTINGS layers in.
rm -f "$CLAUDE_LOG"
cat > "$repo/.ai/pre-launch.sh" <<EOF
export PRELAUNCH_RAN=1
export CAIRN_EXTRA_SETTINGS="$tmp/settings.json"
EOF
echo '{}' > "$tmp/settings.json"
"$launcher" >/dev/null 2>&1 || fail "launch with pre-launch failed"
grep -qx "prelaunch:1" "$CLAUDE_LOG" || fail "pre-launch env not visible to harness"
grep -q -- "--settings $tmp/settings.json" "$CLAUDE_LOG" || fail "CAIRN_EXTRA_SETTINGS not passed as --settings"

rm -f "$OPENCODE_LOG"
"$opencode_launcher" --settings-probe >/dev/null 2>&1 || fail "OpenCode launch with extra config failed"
grep -qx "prelaunch:1" "$OPENCODE_LOG" || fail "OpenCode pre-launch env not visible to harness"
grep -qx "args:--settings-probe" "$OPENCODE_LOG" || fail "OpenCode extra config changed harness argv"
grep -qx "explicit-config:$tmp/settings.json" "$OPENCODE_LOG" || fail "CAIRN_EXTRA_SETTINGS not exported as OPENCODE_CONFIG"

# 3. pre-launch.sh non-zero aborts the launch before the harness runs.
rm -f "$CLAUDE_LOG"
cat > "$repo/.ai/pre-launch.sh" <<'EOF'
echo "pre-launch says no" >&2
return 1
EOF
if "$launcher" >/dev/null 2>&1; then fail "non-zero pre-launch should abort the launch"; fi
[[ ! -f "$CLAUDE_LOG" ]] || fail "harness ran despite pre-launch abort"
rm -f "$repo/.ai/pre-launch.sh"

# 4. post-exit.sh runs after the harness with $CAIRN_EXIT_STATUS.
rm -f "$CLAUDE_LOG" "$tmp/post.log"
cat > "$repo/.ai/post-exit.sh" <<EOF
echo "post:\${CAIRN_EXIT_STATUS}" > "$tmp/post.log"
EOF
FAKE_EXIT=7 "$launcher" >/dev/null 2>&1 && fail "launcher should propagate harness exit code"
status=$?
[[ "$status" -eq 7 ]] || fail "expected exit 7 from launcher, got $status"
grep -qx "post:7" "$tmp/post.log" || fail "post-exit hook did not see CAIRN_EXIT_STATUS"

# 5. Pi launcher preserves the same env/pre/post seams and passes arguments
# unchanged; Pi has no generic settings-file flag so CAIRN_EXTRA_SETTINGS is ignored.
rm -f "$repo/.ai/pre-launch.sh" "$repo/.ai/post-exit.sh"
cat > "$tmp/bin/pi" <<'FAKE'
#!/usr/bin/env bash
{ echo "args:$*"; echo "prelaunch:${PRELAUNCH_RAN:-0}"; echo "extra:${CAIRN_EXTRA_SETTINGS:-}"; } > "$PI_LOG"
exit "${FAKE_EXIT:-0}"
FAKE
chmod +x "$tmp/bin/pi"
export PI_LOG="$tmp/pi.log"
cat > "$repo/.ai/pre-launch.sh" <<EOF
export PRELAUNCH_RAN=1
export CAIRN_EXTRA_SETTINGS="$tmp/pi-settings.json"
EOF
cat > "$repo/.ai/post-exit.sh" <<EOF
echo "pi-post:\${CAIRN_EXIT_STATUS}" > "$tmp/pi-post.log"
EOF
FAKE_EXIT=9 "$pi_launcher" --model fixture/model >/dev/null 2>&1 && fail "Pi launcher should propagate harness exit code"
status=$?
[[ "$status" -eq 9 ]] || fail "expected exit 9 from Pi launcher, got $status"
grep -qx "args:--model fixture/model" "$PI_LOG" || fail "Pi launcher changed arguments"
grep -qx "prelaunch:1" "$PI_LOG" || fail "Pi launcher did not source pre-launch"
grep -qx "pi-post:9" "$tmp/pi-post.log" || fail "Pi launcher post-exit status missing"

echo "PASS: launcher hook seams (pre-launch source/abort, settings layering, post-exit)"
