#!/usr/bin/env bash
# Smoke test: bin/cairn dispatches the new subcommands.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
fail() { echo "FAIL: $1" >&2; exit 1; }
cairn="$ROOT/bin/cairn"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

"$cairn" help | grep -q "cairn doctor" || fail "help missing doctor"
"$cairn" help | grep -q "cairn memory" || fail "help missing memory"
"$cairn" help | grep -q "cairn audit-timer" || fail "help missing audit-timer"
"$cairn" help | grep -q "cairn sync" || fail "help missing sync"
"$cairn" help | grep -q "cairn sync-pi" || fail "help missing sync-pi"
"$cairn" help | grep -q "cairn sync-kimi" || fail "help missing sync-kimi"
"$cairn" help | grep -q "cairn memory-server" || fail "help missing memory-server"
"$cairn" help | grep -q "cairn notes" || fail "help missing notes"
"$cairn" help | grep -q "cairn artifact <list|show|delete|prune>" || fail "help missing artifact"
"$cairn" help | grep -q "cairn evidence <list|show|delete|prune|doctor>" || fail "help missing evidence"
"$cairn" help | grep -q "cairn playbook <list|status|init|set|enable|disable|reset|check|record|receipts|instructions|doctor>" || fail "help missing playbook"
"$cairn" help | grep -q "cairn capabilities <list|status|enable|disable|reset|logging>" || fail "help missing capabilities"
"$cairn" help | grep -q "cairn mcp-tools <list|status|set|reset>" || fail "help missing mcp-tools"
"$cairn" help | grep -q "cairn pack <init|lock|validate|install|list|show|remove|enable|disable|update|skills|approve-skill|revoke-skill>" || fail "help missing pack"
"$cairn" help | grep -q "cairn graph <build|query|status|diff|explain|path>" || fail "help missing graph"
"$cairn" sync --help >/dev/null 2>&1 || fail "cairn sync dispatch"
"$cairn" sync-pi --help >/dev/null 2>&1 || fail "cairn sync-pi dispatch"
"$cairn" sync-kimi --help >/dev/null 2>&1 || fail "cairn sync-kimi dispatch"
env -u CAIRN_NOTE_DISTILLATION "$cairn" notes --help >/dev/null 2>&1 || fail "cairn notes dispatch"
"$cairn" artifact --help | grep -q "cairn artifact list" || fail "cairn artifact dispatch"
"$cairn" evidence --help | grep -q "cairn evidence list" || fail "cairn evidence dispatch"
"$cairn" playbook --help | grep -q "cairn playbook list" || fail "cairn playbook dispatch"
"$cairn" capabilities --help >"$tmp/capabilities-help" 2>/dev/null || fail "cairn capabilities dispatch"
"$cairn" mcp-tools list --json >"$tmp/mcp-tools.json" || fail "cairn mcp-tools dispatch"
CAIRN_PACK_BASE_DIR="$tmp/pack-store" "$cairn" pack list --json >"$tmp/packs.json" || fail "cairn pack dispatch"
node -e 'const v=require(process.argv[1]);if(v.schema_version!==1||!Array.isArray(v.tools))process.exit(1)' "$tmp/mcp-tools.json" || fail "mcp-tools JSON contract"
node -e 'const v=require(process.argv[1]);if(v.schema_version!==1||!Array.isArray(v.packs))process.exit(1)' "$tmp/packs.json" || fail "pack JSON contract"
"$cairn" graph --help | grep -q "cairn graph explain <symbol>" || fail "cairn graph dispatch"
grep -qxF 'MCP capability changes require a memory-server restart. Operating capability' "$tmp/capabilities-help" || fail "capability help missing exact restart wording"
grep -qxF 'changes apply on the next invocation.' "$tmp/capabilities-help" || fail "capability help missing exact invocation wording"
if grep -Eq '^  cairn capabilities (guard|start|finish|doctor)' "$tmp/capabilities-help"; then
  fail "capability help exposed a private operation"
fi
if "$cairn" not-a-command >/dev/null 2>&1; then
  fail "unknown command should exit non-zero"
fi

mkdir -p "$tmp/prefix/bin" "$tmp/project"
ln -s "$ROOT/bin/cairn" "$tmp/prefix/bin/cairn"
(
  cd "$tmp/project"
  env -u CAIRN_CAPABILITY_CONTRACT "$tmp/prefix/bin/cairn" capabilities status --json >"$tmp/status-one.json"
  env -u CAIRN_CAPABILITY_CONTRACT "$tmp/prefix/bin/cairn" capabilities status --json >"$tmp/status-two.json"
)
cmp -s "$tmp/status-one.json" "$tmp/status-two.json" || fail "installed capability status JSON is unstable"
node - "$tmp/status-one.json" <<'NODE'
const fs = require("fs");
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const ids = ["memory.write", "memory.search", "notes.distill", "wiki", "graph", "security.audit", "route.check", "context.explore"];
if (value.schema_version !== 1 || value.contract_enabled !== false) process.exit(1);
if (JSON.stringify(value.capabilities.map(({ id }) => id)) !== JSON.stringify(ids)) process.exit(1);
if (!/^[0-9a-f]{64}$/.test(value.configuration_digest)) process.exit(1);
NODE
set +e
(cd "$tmp/project" && "$tmp/prefix/bin/cairn" capabilities PHASE18_RAW_SENTINEL) >"$tmp/unknown.out" 2>"$tmp/unknown.err"
unknown_status=$?
set -e
[[ "$unknown_status" -eq 2 ]] || fail "unknown capability operation should exit 2"
[[ ! -s "$tmp/unknown.out" ]] || fail "unknown capability operation wrote stdout"
grep -qxF 'cairn capabilities: invalid command, arguments, or managed state.' "$tmp/unknown.err" || fail "unknown capability operation was not value-free"
if grep -qF 'PHASE18_RAW_SENTINEL' "$tmp/unknown.out" "$tmp/unknown.err"; then
  fail "unknown capability operation exposed its raw value"
fi
CAIRN_AGENTFS_BASE_DIR="$tmp/store" "$cairn" memory path | grep -qx "$tmp/store" || fail "cairn memory path dispatch"
( cd "$tmp" && "$cairn" doctor ) >/dev/null || fail "cairn doctor dispatch (clean env should exit 0)"
"$cairn" audit-timer --render-only "$tmp/u" >/dev/null || fail "cairn audit-timer dispatch"
[[ -f "$tmp/u/memory-wiki-audit.timer" ]] || fail "audit-timer render via cairn produced no units"

echo "PASS: cairn dispatch (doctor, memory, artifact, evidence, audit-timer)"
