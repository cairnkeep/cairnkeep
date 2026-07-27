#!/usr/bin/env bash
# Prove that the actual npm tarball installs and runs without relying on files
# or dependencies from the source checkout.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

manifest_field() {
  node -e 'const value=require(process.argv[1]); process.stdout.write(JSON.stringify(value[process.argv[2]] ?? null))' "$1" "$2"
}

root_version_before=$(manifest_field "$ROOT/package.json" version)
root_dependencies_before=$(manifest_field "$ROOT/package.json" dependencies)
server_dependencies_before=$(manifest_field "$ROOT/mcp-memory-server/package.json" dependencies)
server_dev_dependencies_before=$(manifest_field "$ROOT/mcp-memory-server/package.json" devDependencies)
root_lock_before=$(sha256sum "$ROOT/package-lock.json" | cut -d' ' -f1)
server_lock_before=$(sha256sum "$ROOT/mcp-memory-server/package-lock.json" | cut -d' ' -f1)

cd "$ROOT"
npm pack --silent --pack-destination "$tmp" --dry-run=false >/dev/null
tarballs=("$tmp"/*.tgz)
[[ ${#tarballs[@]} -eq 1 && -f "${tarballs[0]}" ]] || fail "npm pack did not produce exactly one tarball"

npm install -g --silent --prefix "$tmp/prefix" --dry-run=false "${tarballs[0]}"
export HOME="$tmp/home"
export PATH="$tmp/prefix/bin:$PATH"
mkdir -p "$HOME" "$tmp/project"

expected=$(node -p 'require(process.argv[1]).version' "$ROOT/package.json")
[[ "$(cairn version)" == "cairnkeep $expected" ]] || fail "installed CLI reports the wrong version"

bootstrap_output=$(cairn bootstrap "$tmp/project")
[[ "$bootstrap_output" == *"cairn memory-server"* ]] || fail "bootstrap printed invalid memory-server setup instructions"
[[ "$bootstrap_output" == *"cairn sync --apply"* ]] || fail "bootstrap printed invalid operating-layer setup instructions"
[[ -x "$tmp/project/.ai/start-claude.sh" ]] || fail "bootstrap did not install an executable Claude launcher"
[[ -x "$tmp/project/.ai/start-pi.sh" ]] || fail "bootstrap did not install an executable Pi launcher"
[[ -f "$tmp/project/.planning/config.json" ]] || fail "bootstrap did not install the planning scaffold"

(cd "$tmp/project" && cairn doctor) >/dev/null || fail "installed package failed cairn doctor"
env -u CAIRN_NOTE_DISTILLATION cairn notes --help >/dev/null \
  || fail "installed package omitted the notes command"

installed_root="$tmp/prefix/lib/node_modules/@cairnkeep/cli"
for required in \
  schemas/capability-contract.schema.json \
  schemas/capability-callback.schema.json \
  templates/capabilities.json.template \
  mcp-memory-server/dist/capability-schema.js \
  mcp-memory-server/dist/capability-registry.js \
  mcp-memory-server/dist/capability-config.js \
  mcp-memory-server/dist/capability-store.js \
  mcp-memory-server/dist/capability-adapter.js \
  mcp-memory-server/dist/capability-cli.js \
  claude/capability-contract/commands/graphify.md \
  claude/capability-contract/commands/security-audit.md \
  claude/capability-contract/commands/wiki-ingest.md \
  claude/capability-contract/commands/wiki-lint.md \
  claude/capability-contract/commands/wiki-query.md \
  opencode/capability-contract/command/graphify.md \
  opencode/capability-contract/command/security-audit.md \
  opencode/capability-contract/command/wiki-ingest.md \
  opencode/capability-contract/command/wiki-lint.md \
  opencode/capability-contract/command/wiki-query.md \
  opencode/capability-contract/workflows/security-audit-workflow.md \
  opencode/capability-contract/workflows/wiki-ingest-workflow.md \
  opencode/capability-contract/workflows/wiki-lint-workflow.md \
  opencode/capability-contract/workflows/wiki-query-workflow.md
do
  [[ -f "$installed_root/$required" ]] || fail "npm tarball omitted $required"
done

CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities status --json >"$tmp/capability-status.json" \
  || fail "installed package capability status failed"
node - "$tmp/capability-status.json" <<'NODE'
const fs = require("fs")
const value = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
const expected = ["memory.write", "memory.search", "notes.distill", "wiki", "graph", "security.audit", "route.check", "context.explore"]
if (value.schema_version !== 1 || value.contract_enabled !== true) process.exit(1)
if (JSON.stringify(value.capabilities.map((row) => row.id)) !== JSON.stringify(expected)) process.exit(1)
if (!/^[0-9a-f]{64}$/.test(value.configuration_digest)) process.exit(1)
NODE
[[ -f "$installed_root/examples/anythingllm/sync_to_anythingllm.py" ]] || \
  fail "npm tarball omitted the default AnythingLLM sync script"
[[ -f "$installed_root/pi/extensions/cairnkeep-trajectory.ts" ]] || \
  fail "npm tarball omitted the Pi trajectory extension"
[[ -x "$installed_root/scripts/sync-pi-assets.sh" ]] || \
  fail "npm tarball omitted the Pi sync command"
[[ -f "$installed_root/templates/start-pi.sh.template" ]] || \
  fail "npm tarball omitted the Pi launcher template"
[[ -f "$installed_root/schemas/note.schema.json" ]] || \
  fail "npm tarball omitted the note schema"
[[ -f "$installed_root/schemas/memory-node.schema.json" ]] || \
  fail "npm tarball omitted the typed memory-node schema"
[[ -f "$installed_root/schemas/artifact.schema.json" ]] || \
  fail "npm tarball omitted the artifact schema"
for module in node-schema node-store node-cli; do
  [[ -f "$installed_root/mcp-memory-server/dist/$module.js" ]] || \
    fail "npm tarball omitted compiled $module"
done
[[ -f "$installed_root/mcp-memory-server/dist/note-cli.js" ]] || \
  fail "npm tarball omitted the compiled note CLI"
[[ -f "$installed_root/mcp-memory-server/dist/note-enrichment.js" ]] || \
  fail "npm tarball omitted optional note enrichment"
[[ -f "$installed_root/mcp-memory-server/dist/note-store.js" ]] || \
  fail "npm tarball omitted the deterministic note store"
for module in artifact-schema artifact-store compaction-normalize artifact-cli; do
  [[ -f "$installed_root/mcp-memory-server/dist/$module.js" ]] || \
    fail "npm tarball omitted compiled $module"
done
[[ -x "$installed_root/claude/hooks/compaction-capture.sh" ]] || \
  fail "npm tarball omitted the executable Claude compaction hook"
[[ -f "$installed_root/opencode/plugins/memory-capture.ts" ]] || \
  fail "npm tarball omitted the OpenCode capture plugin"
[[ -f "$installed_root/opencode/plugins/memory-wakeup.ts" ]] || \
  fail "npm tarball omitted the OpenCode recovery plugin"
for fixture in \
  compaction-claude-code-2.1.219.json \
  compaction-claude-code-2.1.220.json \
  compaction-opencode-1.17.20-event.json \
  compaction-opencode-1.17.20-messages.json
do
  [[ -f "$installed_root/mcp-memory-server/scripts/fixtures/$fixture" ]] || \
    fail "npm tarball omitted versioned fixture $fixture"
done
if find "$installed_root" -type f \( \
  -path '*/.ai/capabilities.json' \
  -o -name 'manifest-v1.json' \
  -o -name '*.db' -o -name '*.db-wal' -o -name '*.db-shm' \
  -o -path '*/notes/projects/*' -o -path '*/transactions/*' -o -path '*/backups/*' \
  -o -path '*/runtime-evidence/*' -o -path '*/generated-artifacts/*' \
  -o -path '*/artifacts/projects/*' -o -path '*/artifacts/sessions/*' -o -path '*/artifacts/data/*' \
  -o -path '*/capability-callback/*' -o -path '*/test-tmp/*' \
\) | grep -q .; then
  fail "npm tarball included generated capability, callback, evidence, or user data"
fi

if find "$installed_root" -type f \( -name 'token_miser' -o -name 'token-miser' -o -name 'token_miser.*' -o -name 'token-miser.*' \) | grep -q .; then
  fail "npm tarball included a token-miser implementation instead of the existing delegate boundary"
fi
[[ -f "$installed_root/mcp-memory-server/dist/index.js" ]] || fail "npm tarball omitted the existing MCP delegate owner"
[[ -x "$installed_root/scripts/sync-opencode-explore-assets.sh" ]] || fail "npm tarball omitted the existing explore asset delegate"

[[ "$(manifest_field "$ROOT/package.json" version)" == "$root_version_before" ]] || fail "package version changed during pack/install"
[[ "$(manifest_field "$ROOT/package.json" dependencies)" == "$root_dependencies_before" ]] || fail "root dependencies changed during pack/install"
[[ "$(manifest_field "$ROOT/mcp-memory-server/package.json" dependencies)" == "$server_dependencies_before" ]] || fail "server dependencies changed during pack/install"
[[ "$(manifest_field "$ROOT/mcp-memory-server/package.json" devDependencies)" == "$server_dev_dependencies_before" ]] || fail "server devDependencies changed during pack/install"
[[ "$(sha256sum "$ROOT/package-lock.json" | cut -d' ' -f1)" == "$root_lock_before" ]] || fail "root lockfile changed during pack/install"
[[ "$(sha256sum "$ROOT/mcp-memory-server/package-lock.json" | cut -d' ' -f1)" == "$server_lock_before" ]] || fail "server lockfile changed during pack/install"

echo "PASS: npm tarball installs a self-contained CLI and MCP server"
