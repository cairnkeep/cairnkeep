#!/usr/bin/env bash
# Public CLI contract for `cairn trajectory list|show|prune`.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

cairn="$ROOT/bin/cairn"
fixture="$ROOT/mcp-memory-server/scripts/fixtures/trajectory-opencode.json"
cli="$ROOT/mcp-memory-server/dist/trajectory-cli.js"
repo="$tmp/project"
mkdir -p "$repo/.agentfs"

"$cairn" help | grep -q "cairn trajectory" || fail "help missing trajectory"

for shell in bash zsh fish; do
  "$cairn" completion "$shell" > "$tmp/completion-$shell"
  grep -q "trajectory" "$tmp/completion-$shell" || fail "$shell completion missing trajectory"
  grep -q "list.*show.*prune\|list show prune" "$tmp/completion-$shell" \
    || fail "$shell completion missing trajectory subcommands"
done

bootstrap_repo="$tmp/bootstrap"
mkdir -p "$bootstrap_repo"
"$cairn" bootstrap "$bootstrap_repo" >/dev/null
[[ -f "$bootstrap_repo/.ai/trajectory-redaction.json" ]] \
  || fail "bootstrap missing optional trajectory redaction template"
if grep -R -E -q '^[[:space:]]*CAIRN_TRAJECTORY_CAPTURE[[:space:]]*=[[:space:]]*1' "$bootstrap_repo"; then
  fail "bootstrap enabled trajectory capture"
fi
printf '{"version":1,"patterns":[]}\n' > "$bootstrap_repo/.ai/trajectory-redaction.json"
"$cairn" bootstrap "$bootstrap_repo" >/dev/null
grep -q '"patterns":\[\]' "$bootstrap_repo/.ai/trajectory-redaction.json" \
  || fail "bootstrap overwrote an existing redaction configuration"

printf '%s' "$(cat "$fixture")" | node "$cli" capture-opencode "$repo" >/dev/null

(cd "$repo" && "$cairn" trajectory list --json) > "$tmp/list.json"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(j.sessions?.[0]?.session_id!=="opencode-session-001")process.exit(1)' "$tmp/list.json" \
  || fail "trajectory list JSON missing captured session"

(cd "$repo" && "$cairn" trajectory show opencode-session-001 --json) > "$tmp/show.json"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(j.schema_version!==1||!Array.isArray(j.events))process.exit(1)' "$tmp/show.json" \
  || fail "trajectory show JSON is not a v1 session"

(cd "$repo" && "$cairn" trajectory prune --dry-run --json) > "$tmp/prune.json"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(!Array.isArray(j.removed)||j.dry_run!==true)process.exit(1)' "$tmp/prune.json" \
  || fail "trajectory prune dry-run JSON invalid"

if (cd "$repo" && "$cairn" trajectory show does-not-exist --json) >"$tmp/missing.out" 2>"$tmp/missing.err"; then
  fail "show of missing session should fail"
fi
grep -q "not found" "$tmp/missing.err" || fail "missing-session error is not actionable"

# Doctor detects missing trajectory metadata and repairs indexes explicitly,
# preserving the valid full session record.
(cd "$ROOT/mcp-memory-server" && node --input-type=module -e '
import { AgentFS } from "agentfs-sdk"
const agent = await AgentFS.open({ id: "trajectory", path: process.argv[1] })
for (const row of await agent.kv.list("trajectory/index/")) await agent.kv.delete(row.key)
await agent.kv.delete("trajectory/meta/schema-version")
await agent.close()
' "$repo/.agentfs/trajectory.db")

mkdir -p "$tmp/home"
if (cd "$repo" && env -u CAIRN_LLM_API_URL -u CAIRN_MEMORY_EMBEDDING_URL \
  -u CAIRN_GIT_PROVIDER HOME="$tmp/home" "$cairn" doctor) >"$tmp/doctor-bad.out" 2>&1; then
  fail "doctor accepted missing trajectory metadata"
fi
grep -q 'cairn doctor --repair' "$tmp/doctor-bad.out" \
  || fail "doctor did not offer an actionable trajectory repair"

(cd "$repo" && env -u CAIRN_LLM_API_URL -u CAIRN_MEMORY_EMBEDDING_URL \
  -u CAIRN_GIT_PROVIDER HOME="$tmp/home" "$cairn" doctor --repair) >"$tmp/doctor-repair.out" 2>&1 \
  || fail "doctor failed to repair trajectory metadata/indexes"
grep -q '\[PASS\] trajectory store repaired' "$tmp/doctor-repair.out" \
  || fail "doctor did not report trajectory repair"
(cd "$repo" && "$cairn" trajectory show opencode-session-001 --json) >/dev/null \
  || fail "trajectory record was lost during doctor repair"

echo "PASS: cairn trajectory CLI dispatch and JSON contract"
