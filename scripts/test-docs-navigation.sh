#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

fail() {
  echo "FATAL: $*" >&2
  exit 1
}

require_term() {
  local file="$1" term="$2"
  grep -qF "$term" "$file" || fail "$file is missing required navigation term: $term"
}

check_local_links() {
  local file="$1" base target resolved
  base=$(dirname "$file")
  while IFS= read -r target; do
    case "$target" in
      http://*|https://*|mailto:*|'#'*|'') continue ;;
    esac
    target=${target%%#*}
    resolved="$base/$target"
    [[ -e "$resolved" ]] || fail "$file links to missing local target: $target"
  done < <(grep -oE '\]\([^)]+' "$file" | sed 's/^](//' || true)
}

readme_lines=$(wc -l < README.md | tr -d ' ')
[[ "$readme_lines" -le 140 ]] || fail "README.md must remain a lean landing page (found $readme_lines lines; limit 140)"

require_term README.md '## For coding agents'
require_term README.md 'docs/README.md'
require_term README.md 'docs/agents.md'
require_term README.md 'docs/quickstart.md'
require_term README.md 'docs/learning/README.md'

if grep -qE '\b(CAIRN_|MCP_HTTP_)' README.md; then
  fail 'README.md contains detailed environment configuration; keep it in versioned focused docs'
fi

for guide in \
  quickstart.md agents.md operating.md harness-compatibility.md \
  mcp-tool-profiles.md context-packs.md storage.md privacy-and-data-flow.md \
  work-evidence.md native-windows.md containers.md ecosystem.md \
  learning/README.md; do
  require_term docs/README.md "$guide"
done

for term in \
  'memory_search' 'locator' 'memory_write' 'cairn playbook check start' \
  'cairn playbook check finish' 'cairn mcp-tools set read-only' \
  'cannot enable a disabled feature' 'not evidence'; do
  require_term docs/agents.md "$term"
done

check_local_links README.md
check_local_links docs/README.md
check_local_links docs/agents.md
check_local_links docs/ecosystem.md

echo "PASS: lean README, agent contract, documentation index, and local navigation"
