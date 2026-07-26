#!/usr/bin/env bash
# Cross-harness trajectory capture and disabled-path regression test.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

claude_fixture="$ROOT/mcp-memory-server/scripts/fixtures/trajectory-claude.jsonl"
opencode_fixture="$ROOT/mcp-memory-server/scripts/fixtures/trajectory-opencode.json"

render() {
  sed "s|@@INFRA_ROOT@@|$ROOT|g" "$1" > "$2"
}

# Claude: flag off must not read stdin, create a store, or perturb the existing
# no-model/no-project-db path.
claude_repo="$tmp/claude-off"
mkdir -p "$claude_repo/.agentfs"
render "$ROOT/claude/hooks/memory-capture.sh" "$tmp/memory-capture.sh"
chmod +x "$tmp/memory-capture.sh"
before=$(find "$claude_repo" -type f -print | sort)
(cd "$claude_repo" && printf '%s\n' '{"transcript_path":"/does/not/exist"}' | "$tmp/memory-capture.sh") >"$tmp/claude-off.out" 2>"$tmp/claude-off.err"
after=$(find "$claude_repo" -type f -print | sort)
[[ "$before" == "$after" ]] || fail "Claude flag-off path changed files"
[[ ! -s "$tmp/claude-off.out" && ! -s "$tmp/claude-off.err" ]] || fail "Claude flag-off path emitted output"

# In a bootstrapped project, the original no-model path also exits before
# parsing stdin. A python spy makes that no-process guarantee observable.
claude_bootstrapped_off="$tmp/claude-bootstrapped-off"
mkdir -p "$claude_bootstrapped_off/.agentfs" "$tmp/spy-bin"
touch "$claude_bootstrapped_off/.agentfs/project.db"
cat > "$tmp/spy-bin/python3" <<EOF
#!/usr/bin/env bash
touch "$tmp/python-was-called"
exit 1
EOF
chmod +x "$tmp/spy-bin/python3"
(cd "$claude_bootstrapped_off" && printf '%s\n' '{"transcript_path":"/does/not/exist"}' \
  | PATH="$tmp/spy-bin:$PATH" "$tmp/memory-capture.sh") >/dev/null 2>&1
[[ ! -e "$tmp/python-was-called" ]] || fail "Claude flag-off no-model path parsed stdin"

# Claude: enabled capture works without project.db, API key, extraction model,
# or network service.
claude_repo="$tmp/claude-on"
mkdir -p "$claude_repo/.agentfs"
hook_input=$(node -e 'console.log(JSON.stringify({transcript_path:process.argv[1],hook_event_name:"SessionEnd"}))' "$claude_fixture")
(cd "$claude_repo" && CAIRN_TRAJECTORY_CAPTURE=1 printf '%s\n' "$hook_input" | CAIRN_TRAJECTORY_CAPTURE=1 "$tmp/memory-capture.sh") >"$tmp/claude-on.out" 2>"$tmp/claude-on.err"
[[ -f "$claude_repo/.agentfs/trajectory.db" ]] || fail "Claude enabled hook did not create trajectory store"
(cd "$claude_repo" && node "$ROOT/mcp-memory-server/dist/trajectory-cli.js" show claude-session-001 --json) >/dev/null \
  || fail "Claude hook trajectory not readable"

# OpenCode: render the installed plugin shape and drive a real session.idle
# callback with the SDK fixture. Type-only imports are stripped by Node 22+.
render "$ROOT/opencode/plugins/memory-capture.ts" "$tmp/memory-capture.ts"
opencode_off="$tmp/opencode-off"
mkdir -p "$opencode_off/.agentfs"
node --experimental-strip-types "$ROOT/scripts/lib/trajectory-opencode-plugin-harness.mjs" \
  "$tmp/memory-capture.ts" "$opencode_off" "$opencode_fixture" >/dev/null 2>"$tmp/opencode-off.err"
[[ ! -f "$opencode_off/.agentfs/trajectory.db" ]] || fail "OpenCode flag-off path created trajectory store"

opencode_on="$tmp/opencode-on"
mkdir -p "$opencode_on/.agentfs"
CAIRN_TRAJECTORY_CAPTURE=1 node --experimental-strip-types \
  "$ROOT/scripts/lib/trajectory-opencode-plugin-harness.mjs" \
  "$tmp/memory-capture.ts" "$opencode_on" "$opencode_fixture" >/dev/null 2>"$tmp/opencode-on.err"
[[ -f "$opencode_on/.agentfs/trajectory.db" ]] || fail "OpenCode enabled plugin did not create trajectory store"
(cd "$opencode_on" && node "$ROOT/mcp-memory-server/dist/trajectory-cli.js" show opencode-session-001 --json) >/dev/null \
  || fail "OpenCode plugin trajectory not readable"

# Exercise the real backup-first sync paths twice and compare their rendered
# installed assets, rather than relying only on the source-level render above.
claude_live="$tmp/claude-live"
"$ROOT/scripts/sync-claude-assets.sh" --apply --live-root "$claude_live" >/dev/null
"$ROOT/scripts/sync-claude-assets.sh" --apply --live-root "$claude_live" >/dev/null
render "$ROOT/claude/hooks/memory-capture.sh" "$tmp/expected-claude-capture.sh"
cmp -s "$tmp/expected-claude-capture.sh" "$claude_live/hooks/memory-capture.sh" \
  || fail "installed Claude trajectory hook differs from rendered source"
claude_capture_registrations=$(node -e '
const fs = require("fs")
const settings = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
let count = 0
for (const entry of settings.hooks?.SessionEnd ?? []) {
  for (const hook of entry.hooks ?? []) {
    if (String(hook.command ?? "").includes("memory-capture.sh")) count += 1
  }
}
process.stdout.write(String(count))
' "$claude_live/settings.json")
[[ "$claude_capture_registrations" -eq 1 ]] \
  || fail "Claude SessionEnd memory-capture registration is missing or duplicated"

opencode_live="$tmp/opencode-live"
"$ROOT/scripts/sync-opencode-plugin-assets.sh" --apply --live-root "$opencode_live" >/dev/null
"$ROOT/scripts/sync-opencode-plugin-assets.sh" --apply --live-root "$opencode_live" >/dev/null
render "$ROOT/opencode/plugins/memory-capture.ts" "$tmp/expected-opencode-capture.ts"
cmp -s "$tmp/expected-opencode-capture.ts" "$opencode_live/plugins/memory-capture.ts" \
  || fail "installed OpenCode trajectory plugin differs from rendered source"
[[ $(find "$opencode_live" -type f -name 'memory-capture.ts' | wc -l) -eq 1 ]] \
  || fail "OpenCode memory-capture plugin is duplicated"

# Integration must reuse the existing capture registration rather than add a
# second SessionEnd hook or plugin asset.
[[ $(grep -c 'memory-capture.sh)' "$ROOT/scripts/sync-claude-assets.sh") -eq 1 ]] \
  || fail "Claude memory-capture hook registration is missing or duplicated"
[[ $(grep -c 'plugins/memory-capture.ts' "$ROOT/scripts/sync-opencode-plugin-assets.sh") -eq 1 ]] \
  || fail "OpenCode memory-capture plugin asset is missing or duplicated"

echo "PASS: Claude/OpenCode trajectory hooks and flag-off regression"
