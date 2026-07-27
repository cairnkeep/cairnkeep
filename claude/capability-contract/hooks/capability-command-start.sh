#!/usr/bin/env bash
# UserPromptExpansion hook: deterministic operating-capability admission.
set -euo pipefail

case "${CAIRN_CAPABILITY_CONTRACT:-}" in
  1|true|TRUE|yes|YES|on|ON) ;;
  *) printf '{}\n'; exit 0 ;;
esac

INFRA_ROOT="@@INFRA_ROOT@@"
COORDINATOR="$INFRA_ROOT/mcp-memory-server/dist/capability-cli.js"
FIXED_BLOCK='{"decision":"block","reason":"capability disabled"}'

block() {
  printf '%s\n' "$FIXED_BLOCK"
  exit 2
}

[ -f "$COORDINATOR" ] || block
input=$(cat) || block

validated=$(printf '%s' "$input" | python3 /dev/fd/3 "$PWD" 3<<'PY'
import json
import os
import re
import sys

required = {
    "session_id", "transcript_path", "cwd", "hook_event_name",
    "expansion_type", "command_name", "command_args", "command_source", "prompt",
}
optional = {"prompt_id", "permission_mode", "effort", "agent_id", "agent_type"}
commands = {"wiki-ingest", "wiki-query", "wiki-lint", "graphify", "security-audit"}

try:
    value = json.load(sys.stdin)
    if not isinstance(value, dict) or set(value) - required - optional or not required <= set(value):
        raise ValueError
    if value["hook_event_name"] != "UserPromptExpansion":
        raise ValueError
    if value["expansion_type"] not in {"slash_command", "mcp_prompt"}:
        raise ValueError
    if value["command_name"] not in commands:
        raise ValueError
    for name in required - {"hook_event_name", "expansion_type"}:
        if not isinstance(value[name], str):
            raise ValueError
    session = value["session_id"]
    if not isinstance(session, str) or not re.fullmatch(r"(?:cairn:)?[A-Za-z0-9][A-Za-z0-9._:-]{0,255}", session) or session == "unknown":
        raise ValueError
    event_root = os.path.realpath(value["cwd"])
    process_root = os.path.realpath(sys.argv[1])
    if not os.path.isabs(value["cwd"]) or event_root != process_root or not os.path.isdir(event_root):
        raise ValueError
    print(json.dumps({
        "schema_version": 1,
        "harness": "claude-code",
        "command": value["command_name"],
        "session_id": session,
        "project_root": event_root,
    }, separators=(",", ":")))
except Exception:
    sys.exit(1)
PY
) || block

decision=$(printf '%s' "$validated" | node "$COORDINATOR" harness-before 2>/dev/null) || {
  printf '{}\n'
  exit 0
}

case "$decision" in
  '{"schema_version":1,"decision":"block","reason":"capability-disabled"}') block ;;
  '{"schema_version":1,"decision":"allow"}') printf '{}\n' ;;
  *) printf '{}\n' ;;
esac
