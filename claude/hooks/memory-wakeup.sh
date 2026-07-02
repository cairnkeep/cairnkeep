#!/usr/bin/env bash
# SessionStart hook: surface the memory layers that are otherwise invisible at
# session start (AgentFS project scope + wiki index). File-memory (MEMORY.md)
# already auto-loads, so it is not duplicated here.
# ponytail: no-op outside a managed repo, so it is safe as a global hook.
set -euo pipefail

repo="$(pwd)"
[ -f "$repo/.agentfs/project.db" ] || [ -f "$repo/.planning/wiki/index.md" ] || exit 0

if [ -f "$repo/.agentfs/project.db" ]; then
  echo "## Project memory (AgentFS)"
  node "@@INFRA_ROOT@@/mcp-memory-server/dist/index.js" wakeup 2>/dev/null || true
fi

if [ -f "$repo/.planning/wiki/index.md" ]; then
  echo
  echo "## Wiki index"
  cat "$repo/.planning/wiki/index.md"
fi

# Surface open HARD wiki contradictions so the agent (and user) see them at
# session start without anyone having to remember to scan the register. Hard
# entries cannot both be correct and must be resolved before dependent work.
contradictions="$repo/.planning/wiki/CONTRADICTIONS.md"
if [ -f "$contradictions" ]; then
  open_hard="$(awk '/<!-- wiki:contradictions:open:start -->/{f=1;next} /<!-- wiki:contradictions:open:end -->/{f=0} f' "$contradictions" | grep -iE 'severity:[[:space:]]*hard')"
  if [ -n "$open_hard" ]; then
    echo
    echo "## Open HARD contradictions — resolve before dependent work"
    echo "$open_hard"
  fi
fi

# Surface staged memory candidates captured by the SessionEnd hook
# (memory-capture.sh). These are extracted automatically from the last session
# but NOT yet written to AgentFS — /memory-review is the accept gate.
if [ -d "$repo/.planning/memory-staging" ]; then
  staged="$(ls -1 "$repo/.planning/memory-staging/"*.json 2>/dev/null | wc -l)"
  if [ "$staged" -gt 0 ]; then
    echo
    echo "## Staged memory candidates ($staged session(s)) — UNREVIEWED"
    echo "Run /memory-review to accept (→ AgentFS) or discard these before doing other work."
  fi
fi
