#!/usr/bin/env bash
# Smoke test for the launcher wrapper seams: .ai/pre-launch.sh (source + abort),
# CAIRN_EXTRA_SETTINGS layering, and .ai/post-exit.sh.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }

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
{ echo "args:$*"; echo "prelaunch:${PRELAUNCH_RAN:-0}"; echo "config:${OPENCODE_CONFIG_DIR:-}"; echo "contract:${CAIRN_CAPABILITY_CONTRACT:-}"; } > "$OPENCODE_LOG"
exit "${FAKE_EXIT:-0}"
FAKE
chmod +x "$tmp/bin/claude" "$tmp/bin/opencode"
ln -s "$ROOT/bin/cairn" "$tmp/bin/cairn"
export PATH="$tmp/bin:$PATH"
export CLAUDE_LOG="$tmp/claude.log"
export OPENCODE_LOG="$tmp/opencode.log"

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
  cmp -s "$ROOT/claude/capability-contract/$rel" "$claude_overlay/$rel" || fail "Claude overlay missing or partial: $rel"
done
"$ROOT/scripts/sync-claude-assets.sh" --check --capability-overlay --live-root "$claude_overlay" >/dev/null || fail "Claude overlay family is incomplete"

CAIRN_CAPABILITY_CONTRACT=1 OPENCODE_CONFIG_DIR="$legacy_opencode" \
  "$opencode_launcher" --overlay >/dev/null 2>&1 || fail "OpenCode capability-overlay launch failed"
opencode_overlay="$repo/.ai/capability-contract/opencode"
grep -qx "args:--overlay" "$OPENCODE_LOG" || fail "OpenCode overlay launch changed argv"
grep -qx "config:$opencode_overlay" "$OPENCODE_LOG" || fail "OpenCode overlay root was not selected"
for rel in \
  command/wiki-ingest.md command/wiki-query.md command/wiki-lint.md \
  workflows/wiki-ingest-workflow.md workflows/wiki-query-workflow.md workflows/wiki-lint-workflow.md \
  command/graphify.md command/security-audit.md workflows/security-audit-workflow.md
do
  cmp -s "$ROOT/opencode/capability-contract/$rel" "$opencode_overlay/$rel" || fail "OpenCode overlay missing or partial: $rel"
done
"$ROOT/scripts/sync-opencode-wiki-assets.sh" --check --capability-overlay --live-root "$opencode_overlay" >/dev/null || fail "OpenCode wiki overlay family is incomplete"
"$ROOT/scripts/sync-opencode-graphify-assets.sh" --check --capability-overlay --live-root "$opencode_overlay" >/dev/null || fail "OpenCode graph overlay family is incomplete"
"$ROOT/scripts/sync-opencode-security-assets.sh" --check --capability-overlay --live-root "$opencode_overlay" >/dev/null || fail "OpenCode security overlay family is incomplete"
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
