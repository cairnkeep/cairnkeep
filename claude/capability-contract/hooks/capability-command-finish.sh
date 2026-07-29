#!/usr/bin/env bash
# Stop/StopFailure/CwdChanged/SessionEnd hook: lifecycle settlement transport.
set -euo pipefail

case "${CAIRN_CAPABILITY_CONTRACT:-}" in
  1|true|TRUE|yes|YES|on|ON) ;;
  *) exit 0 ;;
esac

INFRA_ROOT="@@INFRA_ROOT@@"
COORDINATOR="$INFRA_ROOT/mcp-memory-server/dist/capability-cli.js"
[ -f "$COORDINATOR" ] || exit 0

input=$(cat) || exit 0
validated=$(printf '%s' "$input" | python3 /dev/fd/3 3<<'PY'
import json
import re
import sys

common = {"session_id", "transcript_path", "cwd", "hook_event_name"}
optional = {"prompt_id", "permission_mode", "effort", "agent_id", "agent_type"}
shapes = {
    "Stop": ({"stop_hook_active", "last_assistant_message", "background_tasks", "session_crons"}, set()),
    "StopFailure": ({"error"}, {"error_details", "last_assistant_message"}),
    "CwdChanged": ({"old_cwd", "new_cwd"}, set()),
    "SessionEnd": ({"reason"}, set()),
}
errors = {
    "rate_limit", "overloaded", "authentication_failed", "oauth_org_not_allowed",
    "billing_error", "invalid_request", "model_not_found", "server_error",
    "max_output_tokens", "unknown",
}
reasons = {"clear", "resume", "logout", "prompt_input_exit", "bypass_permissions_disabled", "other"}

try:
    value = json.load(sys.stdin)
    if not isinstance(value, dict) or not common <= set(value):
        raise ValueError
    event = value["hook_event_name"]
    if event not in shapes:
        raise ValueError
    event_required, event_optional = shapes[event]
    required = common | event_required
    if not required <= set(value) or set(value) - required - optional - event_optional:
        raise ValueError
    for name in ("session_id", "transcript_path", "cwd"):
        if not isinstance(value[name], str):
            raise ValueError
    session = value["session_id"]
    if not isinstance(session, str) or not re.fullmatch(r"(?:cairn:)?[A-Za-z0-9][A-Za-z0-9._:-]{0,255}", session) or session == "unknown":
        raise ValueError
    if event == "Stop":
        if not isinstance(value["stop_hook_active"], bool) or not isinstance(value["last_assistant_message"], str):
            raise ValueError
        if not isinstance(value["background_tasks"], list) or not isinstance(value["session_crons"], list):
            raise ValueError
        operation, body = "harness-terminal", {"outcome": "success"}
    elif event == "StopFailure":
        if value["error"] not in errors:
            raise ValueError
        operation, body = "harness-terminal", {"outcome": "error"}
    elif event == "SessionEnd":
        if value["reason"] not in reasons:
            raise ValueError
        operation, body = "harness-terminal", {"outcome": "abandoned"}
    else:
        if not isinstance(value["old_cwd"], str) or not isinstance(value["new_cwd"], str):
            raise ValueError
        operation, body = "harness-cwd", {"old_cwd": value["old_cwd"], "new_cwd": value["new_cwd"]}
    body.update({"schema_version": 1, "harness": "claude-code", "session_id": session})
    print(operation)
    print(json.dumps(body, separators=(",", ":")))
except Exception:
    sys.exit(1)
PY
) || exit 0

operation=${validated%%$'\n'*}
payload=${validated#*$'\n'}
printf '%s' "$payload" | node "$COORDINATOR" "$operation" >/dev/null 2>&1 || true
exit 0
