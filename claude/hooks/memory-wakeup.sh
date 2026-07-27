#!/usr/bin/env bash
# SessionStart hook: surface the memory layers that are otherwise invisible at
# session start (AgentFS project scope + wiki index). File-memory (MEMORY.md)
# already auto-loads, so it is not duplicated here.
# ponytail: no-op outside a managed repo, so it is safe as a global hook.
set -euo pipefail

repo="$(pwd)"

compaction_enabled=0
case "${CAIRN_COMPACTION_CAPTURE:-}" in
  1|true|TRUE|yes|YES|on|ON) compaction_enabled=1 ;;
esac

if [ "$compaction_enabled" -eq 0 ]; then
  [ -f "$repo/.agentfs/project.db" ] || [ -f "$repo/.planning/wiki/index.md" ] || exit 0
else
  [ -f "$repo/.agentfs/project.db" ] || [ -f "$repo/.planning/wiki/index.md" ] \
    || [ -f "$repo/.agentfs/artifacts.db" ] || exit 0
fi

session_ref=""
if [ "$compaction_enabled" -eq 1 ]; then
  input="$(cat)"
  session_id="$(printf '%s' "$input" | python3 -c 'import json,re,sys
try:
    value=json.load(sys.stdin)
    session_id=value.get("session_id", "")
    source=value.get("source", "")
    safe=lambda item: isinstance(item, str) and re.fullmatch(r"[A-Za-z0-9._:/-]{1,160}", item)
    print(session_id if safe(session_id) and (source == "" or safe(source)) else "")
except Exception:
    print("")' 2>/dev/null || true)"
  [ -n "$session_id" ] && session_ref="claude-code:$session_id"
fi

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
  open_hard="$(awk '/<!-- wiki:contradictions:open:start -->/{f=1;next} /<!-- wiki:contradictions:open:end -->/{f=0} f' "$contradictions" | grep -iE 'severity:[[:space:]]*hard' || true)"
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

if [ "$compaction_enabled" -eq 1 ]; then
  artifact_entry="@@INFRA_ROOT@@/mcp-memory-server/dist/artifact-cli.js"
  if [ -f "$artifact_entry" ]; then
    recovery_file="${TMPDIR:-/tmp}/cairn-compaction-recovery.$$"
    if [ -n "$session_ref" ]; then
      node "$artifact_entry" recover "$repo" --session-ref "$session_ref" >"$recovery_file" 2>/dev/null &
    else
      node "$artifact_entry" recover "$repo" >"$recovery_file" 2>/dev/null &
    fi
    recovery_pid=$!
    (
      sleep 3
      kill -KILL "$recovery_pid" >/dev/null 2>&1 || true
    ) &
    recovery_watchdog_pid=$!
    wait "$recovery_pid" >/dev/null 2>&1 || true
    kill "$recovery_watchdog_pid" >/dev/null 2>&1 || true
    wait "$recovery_watchdog_pid" >/dev/null 2>&1 || true
    if [ -s "$recovery_file" ]; then
      echo
      grep -qF "## Compaction recovery" "$recovery_file" || echo "## Compaction recovery"
      cat "$recovery_file"
    fi
    rm -f "$recovery_file"
  fi
fi
