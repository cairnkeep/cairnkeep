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
  claude-hooks|opencode-plugin|opencode-sync-modes|claude-owner-only|opencode-command-owner-only|opencode-owner-only|evidence-scope)
    fail "production mode '$mode' is intentionally RED until its owning Phase 18 plan extends this driver"
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
