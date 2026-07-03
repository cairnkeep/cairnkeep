#!/usr/bin/env bash
# Cairnkeep project bootstrap (core). Scaffolds a project's .ai/ launchers and a
# .planning/ derived-knowledge layer from the bundled templates. Generic and
# provider-neutral; variants can wrap this and add their own launchers/env.
set -euo pipefail

CAIRN_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TPL="$CAIRN_ROOT/templates"

target="${1:-.}"
if [[ ! -d "$target" ]]; then
  echo "Bootstrap target is not a directory: $target" >&2
  exit 1
fi
target=$(cd "$target" && pwd)

install_file() {
  local src="$1" dest="$2" mode="$3"
  if [[ -e "$dest" ]]; then
    echo "skip (exists): ${dest#"$target"/}"
    return 0
  fi
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  chmod "$mode" "$dest"
  echo "created: ${dest#"$target"/}"
}

# .ai/ launchers + env
install_file "$TPL/start-claude.sh.template"   "$target/.ai/start-claude.sh"   0755
install_file "$TPL/start-opencode.sh.template" "$target/.ai/start-opencode.sh" 0755
install_file "$TPL/env.example.template"       "$target/.ai/env.example"       0644

# .planning/ derived-knowledge layer  (template : destination)
planning_pairs=(
  "planning-config.json.template:.planning/config.json"
  "project-brief.md.template:.planning/PROJECT-BRIEF.md"
  "wiki-index.md.template:.planning/wiki/index.md"
  "wiki-policy.md.template:.planning/wiki/policy.md"
  "wiki-contradictions.md.template:.planning/wiki/CONTRADICTIONS.md"
  "wiki-log.md.template:.planning/wiki/LOG.md"
  "alignment-policy.md.template:.planning/alignment/policy.md"
  "alignment-gap-register.yaml.template:.planning/alignment/gap-register.yaml"
  "graph-policy.md.template:.planning/graphs/policy.md"
  "graphs-gitignore.template:.planning/graphs/.gitignore"
  "security-policy.md.template:.planning/security/policy.md"
)
for pair in "${planning_pairs[@]}"; do
  install_file "$TPL/${pair%%:*}" "$target/${pair#*:}" 0644
done

echo
echo "Cairnkeep bootstrapped into $target"
echo "Next steps (full guide: docs/operating.md):"
echo "  1. cp .ai/env.example .ai/.env  and edit"
echo "  2. Build + register the memory server: cd mcp-memory-server && npm install && npm run build,"
echo "     then: claude mcp add cairn-memory -s user -- node \"\$PWD/dist/index.js\""
echo "  3. Install the operating layer (commands/agents/hooks): scripts/sync-claude-assets.sh --apply"
echo "  4. Launch: $target/.ai/start-claude.sh"
