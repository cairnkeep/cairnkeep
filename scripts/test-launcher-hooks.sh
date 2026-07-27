#!/usr/bin/env bash
# Smoke test for the launcher wrapper seams: .ai/pre-launch.sh (source + abort),
# CAIRN_EXTRA_SETTINGS layering, and .ai/post-exit.sh.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }

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

# A git repo scaffolded with the real templates.
repo="$tmp/repo"; mkdir "$repo"; git -C "$repo" init -q
"$ROOT/scripts/bootstrap.sh" "$repo" >/dev/null
launcher="$repo/.ai/start-claude.sh"
[[ -x "$launcher" ]] || fail "launcher not scaffolded"
pi_launcher="$repo/.ai/start-pi.sh"
[[ -x "$pi_launcher" ]] || fail "Pi launcher not scaffolded"

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
