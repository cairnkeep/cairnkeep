#!/usr/bin/env bash
# Smoke test for `cairn bootstrap --untracked` (contributor mode).
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

capability_env_keys='CAIRN_CAPABILITY_CONTRACT CAIRN_CAPABILITY_LOGGING CAIRN_CAPABILITY_MEMORY_WRITE CAIRN_CAPABILITY_MEMORY_SEARCH CAIRN_CAPABILITY_NOTES_DISTILL CAIRN_CAPABILITY_WIKI CAIRN_CAPABILITY_GRAPH CAIRN_CAPABILITY_SECURITY_AUDIT CAIRN_CAPABILITY_ROUTE_CHECK CAIRN_CAPABILITY_CONTEXT_EXPLORE'
for key in $capability_env_keys; do
  [[ $(grep -cxF "# $key=" "$ROOT/templates/env.example.template") -eq 1 ]] ||
    fail "environment template must document exactly one commented $key entry"
  if grep -q "^[[:space:]]*$key=" "$ROOT/templates/env.example.template"; then
    fail "environment template enabled $key by default"
  fi
done
node - "$ROOT/mcp-memory-server/src/capability-registry.ts" "$ROOT/templates/env.example.template" <<'NODE'
const fs = require("fs");
const [registryPath, templatePath] = process.argv.slice(2);
const registry = fs.readFileSync(registryPath, "utf8");
const template = fs.readFileSync(templatePath, "utf8");
const ids = [...registry.matchAll(/^\s*id: "([^"]+)",$/gm)].map((match) => match[1]);
const derived = ids.map((id) => `CAIRN_CAPABILITY_${id.toUpperCase().replaceAll(".", "_")}`);
const documented = [...template.matchAll(/^# (CAIRN_CAPABILITY_[A-Z_]+)=$/gm)]
  .map((match) => match[1])
  .filter((name) => name !== "CAIRN_CAPABILITY_CONTRACT" && name !== "CAIRN_CAPABILITY_LOGGING");
if (JSON.stringify(documented) !== JSON.stringify(derived)) process.exit(1);
NODE
grep -qF 'Strict booleans: 1 | true | yes | on; 0 | false | no | off.' "$ROOT/templates/env.example.template" ||
  fail "environment template omitted strict capability boolean guidance"
grep -qF 'CAIRN_NOTE_DISTILLATION remains a compatibility input' "$ROOT/templates/env.example.template" ||
  fail "environment template omitted the existing note compatibility input"
grep -qF 'CAIRN_TRAJECTORY_CAPTURE is separate required consent' "$ROOT/templates/env.example.template" ||
  fail "environment template omitted independent trajectory consent"
if grep -Eqi '(prisma|drizzle|typeorm|sequelize|db[[:space:]]+push|schema[[:space:]-]+push|migrat(e|ion))' "$ROOT/scripts/bootstrap.sh"; then
  fail "bootstrap contains an ORM, schema-push, or migration path"
fi

# --untracked outside a git repo fails before creating anything
mkdir "$tmp/plain"
if "$ROOT/scripts/bootstrap.sh" --untracked "$tmp/plain" >/dev/null 2>&1; then
  fail "--untracked should refuse a non-git target"
fi
[[ ! -e "$tmp/plain/.ai" ]] || fail "non-git target was partially scaffolded"

# In a git repo: scaffold exists, git sees nothing, entries are anchored
mkdir "$tmp/repo"
git -C "$tmp/repo" init -q
"$ROOT/scripts/bootstrap.sh" --untracked "$tmp/repo" >/dev/null
[[ -f "$tmp/repo/.ai/start-claude.sh" ]] || fail "scaffold missing"
[[ -x "$tmp/repo/.ai/start-kimi.sh" ]] || fail "Kimi launcher missing"
[[ -x "$tmp/repo/.ai/start-qwen.sh" ]] || fail "Qwen launcher missing"
[[ -f "$tmp/repo/.planning/config.json" ]] || fail "planning layer missing"
graph_policy="$tmp/repo/.planning/graphs/policy.md"
grep -qF '`uv tool install graphifyy`' "$graph_policy" ||
  fail "Graphify policy must install the CLI in an isolated uv tool environment"
if grep -qF '`uv pip install graphifyy && graphify install`' "$graph_policy"; then
  fail "Graphify policy must not install Graphify-owned skills or hooks"
fi
if ! grep -qF 'Do not run' "$graph_policy" ||
  ! grep -qF '`graphify install`: Cairnkeep owns' "$graph_policy"; then
  fail "Graphify policy must explain that Cairnkeep owns the harness wiring"
fi
grep -qF '`/graphify build`' "$graph_policy" ||
  fail "Graphify policy must name Cairnkeep's installed build command"
grep -qF '`cairn sync-kimi' "$graph_policy" ||
  fail "Graphify policy must identify the Kimi thin adapter"
grep -qF '`cairn sync-pi' "$graph_policy" ||
  fail "Graphify policy must identify the Pi thin adapter"
grep -qF '`cairn graph build`' "$graph_policy" ||
  fail "Graphify policy must provide the portable CLI equivalent"
if grep -qF '/gsd-graphify' "$graph_policy"; then
  fail "Graphify policy must not name the GSD-internal command"
fi
[[ -f "$tmp/repo/.agentfs/.gitignore" ]] || fail "project-memory ignore guard missing"
[[ -z "$(git -C "$tmp/repo" status --porcelain)" ]] || fail "scaffold visible to git"
grep -qxF "/.ai/" "$tmp/repo/.git/info/exclude" || fail "missing /.ai/ exclude entry"
grep -qxF "/.planning/" "$tmp/repo/.git/info/exclude" || fail "missing /.planning/ exclude entry"
grep -qxF "/.agentfs/" "$tmp/repo/.git/info/exclude" || fail "missing /.agentfs/ exclude entry"
[[ -f "$tmp/repo/.ai/capabilities.json" ]] || fail "capability configuration missing"
[[ ! -e "$tmp/repo/.agentfs/trajectory.db" ]] || fail "fresh bootstrap created a callback database"

# Existing scaffold and operator configuration bytes are preserved on rerun.
printf '%s\n' '{"schema_version":1,"capabilities":{"wiki":false},"logging":{"callbacks":true}}' >"$tmp/repo/.ai/capabilities.json"
chmod 600 "$tmp/repo/.ai/capabilities.json"
printf '%s\n' '# operator-owned environment' >"$tmp/repo/.ai/env.example"
asset_paths='.ai/start-claude.sh .ai/start-opencode.sh .ai/start-pi.sh .ai/start-kimi.sh .ai/start-qwen.sh .ai/env.example .ai/trajectory-redaction.json .ai/capabilities.json .agentfs/.gitignore .planning/config.json .planning/wiki/index.md .planning/wiki/policy.md .planning/wiki/CONTRADICTIONS.md .planning/wiki/LOG.md .planning/alignment/policy.md .planning/alignment/gap-register.yaml .planning/graphs/policy.md .planning/graphs/.gitignore .planning/security/policy.md'
mkdir -p "$tmp/assets-before"
for path in $asset_paths; do
  cp "$tmp/repo/$path" "$tmp/assets-before/${path//\//__}"
done

# Re-run is idempotent: no duplicate exclude entries
"$ROOT/scripts/bootstrap.sh" --untracked "$tmp/repo" >/dev/null
[[ $(grep -cxF "/.ai/" "$tmp/repo/.git/info/exclude") -eq 1 ]] || fail "duplicate exclude entries"
[[ $(grep -cxF "/.agentfs/" "$tmp/repo/.git/info/exclude") -eq 1 ]] || fail "duplicate .agentfs exclude entry"
for path in $asset_paths; do
  [[ -e "$tmp/repo/$path" ]] || fail "bootstrap rerun deleted installed asset: $path"
  cmp -s "$tmp/assets-before/${path//\//__}" "$tmp/repo/$path" || fail "bootstrap rerun rewrote installed asset: $path"
done
[[ ! -e "$tmp/repo/.agentfs/trajectory.db" ]] || fail "bootstrap rerun created a callback database"

# Default mode is unchanged: scaffold stays visible to git
mkdir "$tmp/repo2"
git -C "$tmp/repo2" init -q
"$ROOT/scripts/bootstrap.sh" "$tmp/repo2" >/dev/null
git -C "$tmp/repo2" status --porcelain | grep -q "\.ai/" || fail "default mode should leave the scaffold tracked"
git -C "$tmp/repo2" status --porcelain | grep -q "\.agentfs/" || fail "default mode should track the memory ignore guard"
[[ ! -e "$tmp/repo2/.agentfs/trajectory.db" ]] || fail "default bootstrap created a callback database"

echo "PASS: bootstrap --untracked contributor mode"
