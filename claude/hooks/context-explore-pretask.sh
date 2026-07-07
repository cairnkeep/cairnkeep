#!/usr/bin/env bash
# context-explore-pretask.sh — UserPromptSubmit hook (fires when the user
# submits a prompt, before the model responds).
#
# Auto-invokes context_explore for the submitted prompt so exploration runs
# for a task with no manual /context-explore call (CTX-09). Double opt-in
# (D-07): inert unless CAIRN_EXPLORE_BINARY is set AND
# CAIRN_EXPLORE_AUTOINVOKE=1. High-signal gated: skips short prompts, slash
# commands, and bare acknowledgements. Shells out to the shared `explore` CLI
# subcommand (D-06) with an explicit short timeout (Pitfall 1) so cache
# (CTX-10) and cross-refs (CTX-08) apply identically to hook and MCP-tool
# invocations. Fail-open: any error injects nothing, exit 0 always.
#
# Protocol: JSON on stdin { prompt, ... }. Output: JSON
# { hookSpecificOutput: { hookEventName, additionalContext } } only when the
# explore result is ok:true with non-empty citations; empty output otherwise.
set -euo pipefail

# Double opt-in (D-07): inert unless both are set.
[ -n "${CAIRN_EXPLORE_BINARY:-}" ] || exit 0
[ "${CAIRN_EXPLORE_AUTOINVOKE:-}" = "1" ] || exit 0

INFRA_ROOT="@@INFRA_ROOT@@"
SERVER_ENTRY="$INFRA_ROOT/mcp-memory-server/dist/index.js"
[ -f "$SERVER_ENTRY" ] || exit 0

input="$(cat)"

# Extract the submitted prompt text.
prompt="$(printf '%s' "$input" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    print(d.get("prompt") or "")
except Exception: print("")' 2>/dev/null || true)"
[ -n "$prompt" ] || exit 0

# Low-signal skip (Open Question 2 -- ponytail: first-pass heuristic, not a
# rigorously derived one; revisit thresholds if noise/misses show up live).
# Skips: too short, a slash command, or a bare acknowledgement.
[ "${#prompt}" -ge 10 ] || exit 0
case "$prompt" in
  /*) exit 0 ;;
esac
if printf '%s' "$prompt" | grep -Eqi '^[[:space:]]*(ok|yes|no|thanks?)\.?[[:space:]]*$'; then
  exit 0
fi

# Explicit short timeout (Pitfall 1) -- never the tool's own 120s default.
# `|| true` so a timeout/failure never aborts the hook (fail-open).
result="$(timeout 20 node "$SERVER_ENTRY" explore "$prompt" 2>/dev/null || true)"
[ -n "$result" ] || exit 0

# Inject only on ok:true + non-empty citations (D-07); compact citations +
# cross-ref flags only, never expanded_snippets (D-14).
context="$(printf '%s' "$result" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    if d.get("ok") is not True:
        sys.exit(0)
    citations = d.get("citations") or []
    if not citations:
        sys.exit(0)
    lines=[]
    for c in citations:
        line = str(c.get("path")) + ":" + str(c.get("start_line")) + "-" + str(c.get("end_line"))
        parts=[]
        if c.get("memory_refs"):
            parts.append("memory: " + ", ".join(c["memory_refs"]))
        if c.get("wiki_refs"):
            parts.append("wiki: " + ", ".join(c["wiki_refs"]))
        if parts:
            line += " <- " + " - ".join(parts)
        lines.append(line)
    print("\n".join(lines))
except Exception:
    pass' 2>/dev/null || true)"
[ -n "$context" ] || exit 0

context="$(printf '%s\n' "$context" | head -40)"

# Emit the hook output JSON that injects additionalContext for this prompt.
# The prefix identifies the block as auto-invoked exploration context so the
# model knows its provenance (D-14).
python3 -c 'import sys,json
ctx = sys.stdin.read()
print(json.dumps({
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Auto-invoked exploration context (context_explore, no manual /context-explore call):\n\n" + ctx
  }
}))' <<<"$context" 2>/dev/null || true

exit 0
