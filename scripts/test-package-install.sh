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
node "$ROOT/mcp-memory-server/dist/eval-cli.js" --help >"$tmp/source-eval-help"
node "$ROOT/mcp-memory-server/dist/skill-cli.js" --help >"$tmp/source-skill-help"
env -u CAIRN_EVAL "$ROOT/bin/cairn" eval validate \
  --task-set "$tmp/source-unread-task-set" \
  --adapter "$tmp/source-unread-adapter" \
  --output "$tmp/source-unwritten-output" --json >"$tmp/source-eval-disabled.json"
[[ ! -e "$tmp/source-unwritten-output" ]] || fail "source disabled eval created output"

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
[[ -x "$tmp/project/.ai/start-kimi.sh" ]] || fail "bootstrap did not install an executable Kimi launcher"
[[ -x "$tmp/project/.ai/start-qwen.sh" ]] || fail "bootstrap did not install an executable Qwen launcher"
[[ -f "$tmp/project/.planning/config.json" ]] || fail "bootstrap did not install the planning scaffold"

(cd "$tmp/project" && cairn doctor) >/dev/null || fail "installed package failed cairn doctor"
env -u CAIRN_NOTE_DISTILLATION cairn notes --help >/dev/null \
  || fail "installed package omitted the notes command"

installed_root="$tmp/prefix/lib/node_modules/@cairnkeep/cli"
cairn skill --help >"$tmp/installed-skill-help"
cmp -s "$tmp/source-skill-help" "$tmp/installed-skill-help" || \
  fail "source and installed skill help differ"
cairn skill list --project "$tmp/project" --json >"$tmp/installed-skill-list.json" || \
  fail "installed package skill list failed"
cairn eval --help >"$tmp/installed-eval-help"
cmp -s "$tmp/source-eval-help" "$tmp/installed-eval-help" || \
  fail "source and installed eval help differ"
env -u CAIRN_EVAL cairn eval validate \
  --task-set "$tmp/installed-unread-task-set" \
  --adapter "$tmp/installed-unread-adapter" \
  --output "$tmp/installed-unwritten-output" --json >"$tmp/installed-eval-disabled.json"
cmp -s "$tmp/source-eval-disabled.json" "$tmp/installed-eval-disabled.json" || \
  fail "source and installed disabled eval identity differ"
[[ ! -e "$tmp/installed-unwritten-output" ]] || fail "installed disabled eval created output"

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
  claude/capability-contract/hooks/capability-command-start.sh \
  claude/capability-contract/hooks/capability-command-finish.sh \
  opencode/capability-contract/plugins/capability-command.ts
do
  [[ -f "$installed_root/$required" ]] || fail "npm tarball omitted $required"
done

for required in \
  schemas/skill-adapter.schema.json \
  schemas/skill-proposal-protocol.schema.json \
  mcp-memory-server/dist/skill-schema.js \
  mcp-memory-server/dist/skill-store.js \
  mcp-memory-server/dist/skill-evaluation.js \
  mcp-memory-server/dist/skill-cli.js \
  docs/skill-improvement.md
do
  [[ -f "$installed_root/$required" ]] || fail "npm tarball omitted $required"
done

for required in \
  schemas/eval-task-set.schema.json \
  schemas/eval-adapter.schema.json \
  schemas/eval-protocol.schema.json \
  schemas/eval-report.schema.json \
  mcp-memory-server/dist/eval-schema.js \
  mcp-memory-server/dist/eval-process.js \
  mcp-memory-server/dist/eval-workspace.js \
  mcp-memory-server/dist/eval-plan.js \
  mcp-memory-server/dist/eval-statistics.js \
  mcp-memory-server/dist/eval-report.js \
  mcp-memory-server/dist/eval-runner.js \
  mcp-memory-server/dist/eval-cli.js \
  scripts/fake-eval-adapter.mjs \
  examples/eval/task-set.json \
  examples/eval/bundled-fake.json \
  examples/eval/adapter.json \
  examples/eval/README.md
do
  [[ -f "$installed_root/$required" ]] || fail "npm tarball omitted $required"
done
[[ -x "$installed_root/scripts/fake-eval-adapter.mjs" ]] || \
  fail "installed fake adapter is not executable"
for asset in \
  schemas/eval-task-set.schema.json \
  schemas/eval-adapter.schema.json \
  schemas/eval-protocol.schema.json \
  schemas/eval-report.schema.json \
  examples/eval/task-set.json \
  examples/eval/bundled-fake.json \
  examples/eval/adapter.json \
  examples/eval/README.md
do
  [[ ! -x "$installed_root/$asset" ]] || \
    fail "installed public eval data asset is unexpectedly executable: $asset"
done
eval_assets=$(cd "$installed_root/examples/eval" && find . -type f -print | LC_ALL=C sort)
[[ "$eval_assets" == $'./README.md\n./adapter.json\n./bundled-fake.json\n./task-set.json' ]] || \
  fail "installed eval examples contain an unexpected path"

node - "$installed_root/examples/eval/adapter.json" <<'NODE'
const value = require(process.argv[2]);
if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["command", "id", "schema_version", "turn_semantics"])) process.exit(1);
if (value.id !== "cairn-offline-fake" || value.command.program !== "../../scripts/fake-eval-adapter.mjs") process.exit(1);
if (!Array.isArray(value.command.args) || value.command.args.length !== 0) process.exit(1);
NODE
if grep -R -E 'https?://|CAIRN_LLM_API_KEY|CAIRN_LLM_ENDPOINT' \
  "$installed_root/examples/eval" "$installed_root/scripts/fake-eval-adapter.mjs" >/dev/null; then
  fail "installed eval fixture contains a live endpoint or credential default"
fi

installed_task_set="$installed_root/examples/eval/task-set.json"
installed_adapter="$installed_root/examples/eval/adapter.json"
installed_output="$tmp/installed-eval-output"
CAIRN_EVAL=1 cairn eval validate \
  --task-set "$installed_task_set" --adapter "$installed_adapter" \
  --output "$installed_output" --seed installed-package-seed --json >"$tmp/installed-eval-validate.json"
[[ ! -e "$installed_output" ]] || fail "installed eval validation created output"
CAIRN_EVAL=1 cairn eval run \
  --task-set "$installed_task_set" --adapter "$installed_adapter" \
  --output "$installed_output" --seed installed-package-seed --yes --json \
  >"$tmp/installed-eval-run.json" 2>"$tmp/installed-eval-run.err"

node - \
  "$installed_root/mcp-memory-server/dist/eval-schema.js" \
  "$installed_root/package.json" \
  "$installed_task_set" \
  "$installed_root/examples/eval/bundled-fake.json" \
  "$tmp/installed-eval-validate.json" \
  "$tmp/installed-eval-run.json" <<'NODE'
const { readFileSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
(async () => {
  const [schemaPath, packagePath, taskSetPath, bindingPath, validationPath, runPath] = process.argv.slice(2);
  const { canonicalDigest } = await import(pathToFileURL(schemaPath).href);
  const manifest = JSON.parse(readFileSync(taskSetPath, "utf8"));
  const binding = JSON.parse(readFileSync(bindingPath, "utf8"));
  const installedPackage = JSON.parse(readFileSync(packagePath, "utf8"));
  const validation = JSON.parse(readFileSync(validationPath, "utf8"));
  const run = JSON.parse(readFileSync(runPath, "utf8"));
  const digest = canonicalDigest(manifest);
  if (binding.identifier !== "cairn-offline-fake-v1") process.exit(1);
  if (binding.package_version !== installedPackage.version || binding.task_set_digest !== digest) process.exit(1);
  if (validation.operation !== "validate" || validation.invocation_count !== manifest.tasks.length * 2) process.exit(1);
  if (validation.plan.source.identifier !== binding.identifier
      || validation.plan.source.package_version !== installedPackage.version
      || validation.plan.task_set_digest !== digest) process.exit(1);
  if (run.operation !== "run" || run.status !== "final" || run.invocation_count !== manifest.tasks.length * 2) process.exit(1);
  const report = JSON.parse(readFileSync(run.report_path, "utf8"));
  if (report.task_set_digest !== digest || report.evidence.task_set_digest !== digest) process.exit(1);
  if (report.evidence.package_version !== installedPackage.version
      || report.evidence.evidence_scope !== "offline-framework"
      || report.observations.length !== manifest.tasks.length * 2) process.exit(1);
})().catch((error) => { console.error(error); process.exit(1); });
NODE

binding_path="$installed_root/examples/eval/bundled-fake.json"
cp "$binding_path" "$tmp/original-bundled-fake.json"
for field in identifier package_version task_set_digest; do
  node - "$binding_path" "$field" <<'NODE'
const { readFileSync, writeFileSync } = require("node:fs");
const [path, field] = process.argv.slice(2);
const value = JSON.parse(readFileSync(path, "utf8"));
value[field] = field === "task_set_digest" ? "0".repeat(64) : `mutated-${field}`;
writeFileSync(path, `${JSON.stringify(value)}\n`);
NODE
  if CAIRN_EVAL=1 cairn eval validate \
    --task-set "$installed_task_set" --adapter "$installed_adapter" \
    --output "$tmp/rejected-eval-output" --json >/dev/null 2>&1; then
    fail "installed eval accepted mutated $field binding"
  fi
  cp "$tmp/original-bundled-fake.json" "$binding_path"
done
[[ ! -e "$tmp/rejected-eval-output" ]] || fail "rejected installed eval fixture created output"
chmod -R u+w "$installed_output"

if find \
  "$installed_root/claude/capability-contract/commands" \
  "$installed_root/opencode/capability-contract/command" \
  "$installed_root/opencode/capability-contract/workflows" \
  -type f -print 2>/dev/null | grep -q .; then
  fail "npm tarball included a retired capability prompt owner"
fi

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
[[ -f "$installed_root/pi/prompts/graphify.md" ]] || \
  fail "npm tarball omitted the Pi graph prompt"
[[ -f "$installed_root/kimi/skills/graphify/SKILL.md" ]] || \
  fail "npm tarball omitted the Kimi graph Skill"
[[ -x "$installed_root/scripts/sync-pi-assets.sh" ]] || \
  fail "npm tarball omitted the Pi sync command"
[[ -x "$installed_root/scripts/sync-kimi-assets.sh" ]] || \
  fail "npm tarball omitted the Kimi sync command"
[[ -f "$installed_root/templates/start-pi.sh.template" ]] || \
  fail "npm tarball omitted the Pi launcher template"
[[ -f "$installed_root/templates/start-kimi.sh.template" ]] || \
  fail "npm tarball omitted the Kimi launcher template"
[[ -f "$installed_root/templates/start-qwen.sh.template" ]] || \
  fail "npm tarball omitted the Qwen launcher template"
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
  -o -path '*/.agentfs/*' -o -path '*/eval/experiments/*' \
  -o -path '*/eval/reports/*' -o -path '*/eval/snapshots/*' \
  -o -path '*/eval/runtime-evidence/*' -o -path '*/eval/evidence/*' \
  -o -path '*/eval/user-data/*' \
\) | grep -q .; then
  fail "npm tarball included generated capability, callback, eval evidence, or user data"
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
