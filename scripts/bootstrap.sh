#!/usr/bin/env bash
# Cairnkeep project bootstrap (core). Scaffolds a project's .ai/ launchers and a
# starter env file from the bundled templates. Generic and provider-neutral;
# variants can wrap this and add their own launchers/env afterward.
set -euo pipefail

CAIRN_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TPL="$CAIRN_ROOT/templates"

target="${1:-.}"
if [[ ! -d "$target" ]]; then
  echo "Bootstrap target is not a directory: $target" >&2
  exit 1
fi
target=$(cd "$target" && pwd)

mkdir -p "$target/.ai"

install_file() {
  local src="$1" dest="$2" mode="$3"
  if [[ -e "$dest" ]]; then
    echo "skip (exists): ${dest#"$target"/}"
    return 0
  fi
  cp "$src" "$dest"
  chmod "$mode" "$dest"
  echo "created: ${dest#"$target"/}"
}

install_file "$TPL/start-claude.sh.template"   "$target/.ai/start-claude.sh"   0755
install_file "$TPL/start-opencode.sh.template" "$target/.ai/start-opencode.sh" 0755
install_file "$TPL/env.example.template"       "$target/.ai/env.example"       0644

echo
echo "Cairnkeep bootstrapped into $target"
echo "Next: cp .ai/env.example .ai/.env and edit, then run ./.ai/start-claude.sh"
