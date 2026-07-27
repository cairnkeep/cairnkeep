#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

for shell in bash zsh fish; do
  "$ROOT/bin/cairn" completion "$shell" > "$tmp/$shell"
  [[ -s $tmp/$shell ]]
  grep -q 'completion' "$tmp/$shell"
done

capability_ids='memory.write memory.search notes.distill wiki graph security.audit route.check context.explore'
for shell in bash zsh fish; do
  grep -q 'capabilities' "$tmp/$shell"
  grep -q 'list.*status.*enable.*disable.*reset.*logging\|list status enable disable reset logging' "$tmp/$shell"
  grep -q -- '--json\|-l json' "$tmp/$shell"
  for capability_id in $capability_ids; do
    grep -qF "$capability_id" "$tmp/$shell"
  done
  if grep -Eq '(^|[[:space:]"'"'"'])(guard|start|finish)([[:space:]"'"'"']|$)' "$tmp/$shell"; then
    echo "completion exposed a private capability operation for $shell" >&2
    exit 1
  fi
done

node - "$ROOT/mcp-memory-server/src/capability-registry.ts" "$tmp/bash" "$tmp/zsh" "$tmp/fish" <<'NODE'
const fs = require("fs");
const [registryPath, ...completionPaths] = process.argv.slice(2);
const registry = fs.readFileSync(registryPath, "utf8");
const ids = [...registry.matchAll(/^\s*id: "([^"]+)",$/gm)].map((match) => match[1]);
const expected = ["memory.write", "memory.search", "notes.distill", "wiki", "graph", "security.audit", "route.check", "context.explore"];
if (JSON.stringify(ids) !== JSON.stringify(expected)) process.exit(1);
for (const path of completionPaths) {
  const output = fs.readFileSync(path, "utf8");
  if (!output.includes(ids.join(" "))) process.exit(1);
}
NODE

grep -q 'complete -F _cairn_complete cairn' "$tmp/bash"
grep -q '#compdef cairn' "$tmp/zsh"
grep -q 'complete -c cairn' "$tmp/fish"
for shell in bash zsh; do
  grep -q 'sync-pi' "$tmp/$shell"
  grep -q -- '--live-root' "$tmp/$shell"
done
grep -q 'sync-pi' "$tmp/fish"
grep -q -- '-l live-root' "$tmp/fish"
for shell in bash zsh fish; do
  grep -q 'notes' "$tmp/$shell"
  grep -q 'distill.*search-error.*promote.*doctor\|distill search-error promote doctor' "$tmp/$shell"
  grep -q 'artifact' "$tmp/$shell"
  grep -q 'list.*show.*delete.*prune' "$tmp/$shell"
  grep -q -- '--json\|-l json' "$tmp/$shell"
  grep -q -- '--dry-run\|-l dry-run' "$tmp/$shell"
  grep -q -- '--include-protected\|-l include-protected' "$tmp/$shell"
done

grep -q -- '--kind' "$tmp/bash"
grep -q -- '--session' "$tmp/bash"
grep -q -- '--kind' "$tmp/zsh"
grep -q -- '--session' "$tmp/zsh"
grep -q -- '-l kind' "$tmp/fish"
grep -q -- '-l session' "$tmp/fish"

if "$ROOT/bin/cairn" completion unsupported >/dev/null 2>&1; then
  echo "completion accepted an unsupported shell" >&2
  exit 1
fi

git -C "$ROOT" diff --check
echo "PASS: shell completion generation"
