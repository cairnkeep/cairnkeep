#!/usr/bin/env bash
# memory-recall.sh — PreToolUse hook (fires before Edit/Write/MultiEdit).
#
# When the model is about to edit a file, surface AgentFS facts and wiki pages
# that specifically mention that file. This turns "the model might search memory"
# into "the model always sees relevant pitfalls/decisions for the exact file."
#
# High-signal / low-noise design: injects context ONLY when there is a specific
# match (memory preview or wiki page mentioning the file path or basename). If
# nothing specific matches, it injects nothing — no noise on routine edits.
#
# Protocol: JSON on stdin { tool_name, tool_input: { file_path, ... }, cwd, ... }.
# Output: JSON { hookSpecificOutput: { hookEventName, additionalContext } } when
# there is a match; empty output otherwise. Fail-open: any error exits 0.
set -euo pipefail

repo="$(pwd)"
[ -f "$repo/.agentfs/project.db" ] || [ -d "$repo/.planning/wiki/sources" ] || exit 0

INFRA_ROOT="@@INFRA_ROOT@@"
SERVER_ENTRY="$INFRA_ROOT/mcp-memory-server/dist/index.js"

input="$(cat)"

# Extract the target file path from the tool input.
file_path="$(printf '%s' "$input" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); ti=d.get("tool_input",{})
    print(ti.get("file_path") or ti.get("path") or "")
except Exception: print("")' 2>/dev/null || true)"
[ -n "$file_path" ] || exit 0

# Derive search tokens: basename and the repo-relative stem.
base="$(basename "$file_path")"
stem="${base%.*}"
# Avoid matching on tiny/generic stems that would noise up results.
${#stem} -lt 4 && exit 0

matches=()

# 1. AgentFS project memory: filter the compact wakeup index by the stem.
if [ -f "$repo/.agentfs/project.db" ] && [ -f "$SERVER_ENTRY" ]; then
  idx="$(node "$SERVER_ENTRY" wakeup 2>/dev/null || true)"
  if [ -n "$idx" ]; then
    hit_lines="$(printf '%s' "$idx" | grep -iF "$stem" 2>/dev/null | head -8 || true)"
    if [ -n "$hit_lines" ]; then
      matches+=("## Relevant project memory for $base" "" "$hit_lines" "")
    fi
  fi
fi

# 2. Wiki source pages whose name or content mentions the path/basename.
if [ -d "$repo/.planning/wiki/sources" ]; then
  wiki_hits=""
  while IFS= read -r page; do
    [[ -n "$page" ]] || continue
    if grep -qiF "$stem" "$page" 2>/dev/null; then
      # Pull the first stable-fact bullet as a teaser.
      teaser="$(grep -m1 -E '^- \*\*' "$page" 2>/dev/null | cut -c1-160 || true)"
      wiki_hits+="- [$(basename "$page")] ${teaser}"$'\n'
    fi
  done < <(find "$repo/.planning/wiki/sources" -maxdepth 1 -name '*.md' -type f 2>/dev/null)
  if [ -n "$wiki_hits" ]; then
    matches+=("## Relevant wiki pages for $base" "" "${wiki_hits}" "")
  fi
fi

# Inject only when there is something specific.
if [ "${#matches[@]}" -eq 0 ]; then
  exit 0
fi

context="$(printf '%s\n' "${matches[@]}" | head -40)"
# Emit the hook output JSON that injects additionalContext before the tool runs.
python3 -c 'import sys,json
ctx = sys.stdin.read()
print(json.dumps({
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "Memory recall (auto-injected for this file edit):\n\n" + ctx
  }
}))' <<<"$context" 2>/dev/null || true

exit 0
