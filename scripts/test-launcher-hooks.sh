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

# Fake `claude` on PATH: records its args + a marker env var, exits FAKE_EXIT.
mkdir "$tmp/bin"
cat > "$tmp/bin/claude" <<'FAKE'
#!/usr/bin/env bash
{ echo "args:$*"; echo "prelaunch:${PRELAUNCH_RAN:-0}"; } > "$CLAUDE_LOG"
exit "${FAKE_EXIT:-0}"
FAKE
chmod +x "$tmp/bin/claude"
export PATH="$tmp/bin:$PATH"
export CLAUDE_LOG="$tmp/claude.log"

# 1. No hooks: launcher execs claude with the passed args (baseline unchanged).
rm -f "$CLAUDE_LOG"
"$launcher" --foo bar >/dev/null 2>&1 || fail "baseline launch failed"
grep -qx "args:--foo bar" "$CLAUDE_LOG" || fail "baseline did not pass args through"
grep -qx "prelaunch:0" "$CLAUDE_LOG" || fail "prelaunch marker leaked without a hook"

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

echo "PASS: launcher hook seams (pre-launch source/abort, settings layering, post-exit)"
