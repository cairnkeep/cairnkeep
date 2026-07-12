#!/usr/bin/env bash
# memory-capture.sh — SessionEnd hook (Claude Code + OpenCode share this protocol).
#
# At session end, extract durable memory candidates from the session transcript
# using the configured extraction model, and stage them for review — NOT write
# them directly. The next session's memory-wakeup.sh surfaces staged candidates;
# /memory-review is the accept gate that writes accepted ones to AgentFS via the
# cairn-memory MCP. This keeps writes agent-gated (no premature/auto writes, no
# AgentFS lock contention) while making extraction fully automatic.
#
# Protocol: JSON on stdin with { transcript_path, cwd, hook_event_name, ... }.
# ponytail: no-op outside a bootstrapped repo or when the extraction config is
# absent, so it is safe as a global hook.
set -euo pipefail

repo="$(pwd)"
[ -f "$repo/.agentfs/project.db" ] || exit 0

INFRA_ROOT="@@INFRA_ROOT@@"
SERVER_ENTRY="$INFRA_ROOT/mcp-memory-server/dist/index.js"
TEXT_HELPER="$INFRA_ROOT/scripts/transcript-to-text.mjs"
[ -f "$SERVER_ENTRY" ] || exit 0
[ -z "${CAIRN_LLM_API_KEY:-}" ] && exit 0
EXTRACT_MODEL="${CAIRN_LLM_EXTRACTION_MODEL:-}"
[ -z "$EXTRACT_MODEL" ] && exit 0

# Read hook JSON from stdin; pull transcript_path (fail-open if absent/malformed).
input="$(cat)"
transcript_path="$(printf '%s' "$input" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print(d.get("transcript_path",""))
except Exception: print("")' 2>/dev/null || true)"
[ -n "$transcript_path" ] && [ -f "$transcript_path" ] || exit 0

# Convert transcript JSONL → readable text, then extract candidates.
text="$(node "$TEXT_HELPER" "$transcript_path" 2>/dev/null || true)"
[ -n "$text" ] || exit 0

candidates_json="$(printf '%s' "$text" | node "$SERVER_ENTRY" extract "$EXTRACT_MODEL" 2>/dev/null || true)"
[ -n "$candidates_json" ] || exit 0

count="$(printf '%s' "$candidates_json" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print(len(d.get("candidates",[])))
except Exception: print(0)' 2>/dev/null || echo 0)"
[ "$count" -gt 0 ] || exit 0

# Stage for the next session's accept gate. One file per session.
mkdir -p "$repo/.planning/memory-staging"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
stage_file="$repo/.planning/memory-staging/$ts.json"
printf '%s\n' "$candidates_json" > "$stage_file"

# Keep the staging dir bounded — drop the oldest beyond 5 sessions.
ls -1t "$repo/.planning/memory-staging/"*.json 2>/dev/null | tail -n +6 | while read -r old; do
  rm -f "$old"
done

exit 0
