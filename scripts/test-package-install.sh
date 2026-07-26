#!/usr/bin/env bash
# Prove that the actual npm tarball installs and runs without relying on files
# or dependencies from the source checkout.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

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
if find "$installed_root" -type f \( -name 'manifest-v1.json' -o -name '*.db' -o -name '*.db-wal' -o -name '*.db-shm' -o -path '*/notes/projects/*' -o -path '*/transactions/*' -o -path '*/backups/*' \) | grep -q .; then
  fail "npm tarball included generated user note data"
fi

echo "PASS: npm tarball installs a self-contained CLI and MCP server"
