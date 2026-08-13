#!/usr/bin/env bash
# Cairnkeep project bootstrap (core). Scaffolds a project's .ai/ launchers and a
# .planning/ derived-knowledge layer from the bundled templates. Generic and
# provider-neutral; variants can wrap this and add their own launchers/env.
set -euo pipefail

CAIRN_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TPL="$CAIRN_ROOT/templates"

untracked=0
target="."
for arg in "$@"; do
  case "$arg" in
    --untracked) untracked=1 ;;
    -*)
      echo "Unknown option: $arg" >&2
      echo "Usage: bootstrap.sh [--untracked] [path]" >&2
      exit 1
      ;;
    *) target="$arg" ;;
  esac
done
if [[ ! -d "$target" ]]; then
  echo "Bootstrap target is not a directory: $target" >&2
  exit 1
fi
target=$(cd "$target" && pwd)

# Contributor mode: keep the scaffold invisible to git via .git/info/exclude
# (per-clone, never touches the repo's .gitignore). Resolve everything up
# front so a non-repo target fails before any files are created.
exclude_file=""
exclude_prefix=""
if [[ $untracked -eq 1 ]]; then
  if ! exclude_file=$(cd "$target" && git rev-parse --git-path info/exclude 2>/dev/null); then
    echo "--untracked requires the target to be inside a git repository: $target" >&2
    exit 1
  fi
  [[ "$exclude_file" == /* ]] || exclude_file="$target/$exclude_file"
  exclude_prefix=$(cd "$target" && git rev-parse --show-prefix)
fi

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
while IFS=$'\t' read -r template destination mode; do
  install_file "$TPL/$template" "$target/$destination" "0$mode"
done < <(node "$CAIRN_ROOT/scripts/harness-registry.mjs" bootstrap-assets)
install_file "$TPL/env.example.template"       "$target/.ai/env.example"       0644
install_file "$TPL/trajectory-redaction.json.template" "$target/.ai/trajectory-redaction.json" 0644
install_file "$TPL/capabilities.json.template" "$target/.ai/capabilities.json" 0600

# Project-scope memory is private runtime data. Keep it out of version control
# even before the first .agentfs/project.db is created.
install_file "$TPL/agentfs-gitignore.template" "$target/.agentfs/.gitignore" 0644

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

if [[ $untracked -eq 1 ]]; then
  mkdir -p "$(dirname "$exclude_file")"
  for entry in "/${exclude_prefix}.ai/" "/${exclude_prefix}.planning/" "/${exclude_prefix}.agentfs/"; do
    if grep -qxF "$entry" "$exclude_file" 2>/dev/null; then
      echo "skip (already excluded): $entry"
    else
      echo "$entry" >>"$exclude_file"
      echo "excluded: $entry"
    fi
  done
  echo "Contributor mode: scaffold is local-only (${exclude_file#"$target"/});"
  echo "it is never committed, so it lives on this machine only."
fi

echo
echo "Cairnkeep bootstrapped into $target"
echo "Codex: run 'cairn setup' in the project and select Codex; then review trust and run .ai/start-codex.sh"
echo "Claude: claude mcp add cairn-memory -s user -- cairn memory-server; cairn sync --apply"
echo "Optional project overrides: cp .ai/env.example .ai/.env"
echo "For new projects, prefer 'cairn setup'; guide: docs/quickstart.md"
