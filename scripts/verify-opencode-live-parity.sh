#!/usr/bin/env bash
set -euo pipefail

# Live OpenCode parity verification harness (OCP-06).
#
# Extends the Phase-4 OCP-05 scratch-HOME acceptance pattern (04-06-SUMMARY.md)
# to register `cairn-memory` as a real local MCP server inside a fresh scratch
# OpenCode environment and confirm the registration loads before any stage
# assertion is trusted. Stage functions (wakeup/recall/capture/remember/recall,
# negative controls) are added in 05-02; this script only builds setup,
# registration, the positive-load check, and cleanup.
#
# Every value here is either read from the operator's own environment
# (CAIRN_LLM_API_KEY / CAIRN_LLM_API_URL / CAIRN_LLM_EXTRACTION_MODEL) or
# generated at runtime (canary tokens, scratch dirs via mktemp -d). No
# endpoint host, model name, or canary literal is hardcoded here
# (DEC-no-private-references).

usage() {
  cat <<'EOF'
Usage: verify-opencode-live-parity.sh --setup-only [seeded|unseeded]
       verify-opencode-live-parity.sh --stage wakeup
       verify-opencode-live-parity.sh --full

Stands up a fresh scratch OpenCode HOME, registers cairn-memory as a local
stdio MCP server pointing at the real mcp-memory-server/dist/index.js,
installs the OpenCode plugin/command assets, and runs a positive-load check
confirming cairn-memory_ tools are visible in the scratch environment.

Options:
  --setup-only [seeded|unseeded]
      Run setup_scratch, seed_canary, install_assets, write_scratch_config,
      and positive_load_check end to end, then clean up. Mode defaults to
      "seeded"; pass "unseeded" for a negative-control scratch project
      (no canary written).
  --stage wakeup
      Fastest per-commit signal: the setup above plus the wakeup
      FOUND/NOT-FOUND canary probe alone.
  --full
      The full suite: wakeup, recall-on-edit, capture, remember->recall
      against a seeded project, then the full negative-control sweep
      against a fresh unseeded project. Exits non-zero if any stage fails.
  -h, --help
      Show this help text.

Every run always cleans up scratch dirs and confirms the operator's real
~/.config/opencode and ~/.claude are unmodified, regardless of exit path.
EOF
}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SERVER_ENTRY="$ROOT_DIR/mcp-memory-server/dist/index.js"
AGENTFS_SDK_ENTRY="$ROOT_DIR/mcp-memory-server/node_modules/agentfs-sdk/dist/index_node.js"

# Captured before any HOME reassignment so cleanup() always compares against
# the operator's real config, never a scratch path (T-05-02 mitigation).
ORIG_HOME="$HOME"
REAL_OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$ORIG_HOME/.config/opencode}"
REAL_CLAUDE_DIR="$ORIG_HOME/.claude"

SCRATCH_HOME=""
SCRATCH_PROJECT=""
SCRATCH_PROJECT_UNSEEDED=""
CANARY_KEY=""
CANARY_VALUE=""
CLEANED_UP=0
PRE_OPENCODE_FINGERPRINT=""
PRE_CLAUDE_FINGERPRINT=""
CAPTURE_SERVE_PID=""
CAPTURE_SERVE_URL=""
CAPTURE_SERVE_LOG=""
LAST_ROUNDTRIP_RETRIES=0

fingerprint_dir() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    find "$dir" -type f -printf '%p %s %T@\n' 2>/dev/null | sort
  else
    echo "MISSING:$dir"
  fi
}

capture_real_config_fingerprint() {
  PRE_OPENCODE_FINGERPRINT=$(fingerprint_dir "$REAL_OPENCODE_CONFIG_DIR")
  PRE_CLAUDE_FINGERPRINT=$(fingerprint_dir "$REAL_CLAUDE_DIR")
}

cleanup() {
  if [[ "$CLEANED_UP" -eq 1 ]]; then
    return 0
  fi
  CLEANED_UP=1

  # Stop the capture stage's persistent `opencode serve` (if started) before
  # touching scratch dirs — it may still be holding the scratch HOME's
  # OPENCODE_CONFIG_DIR/cairn-memory MCP subprocess open.
  if [[ -n "$CAPTURE_SERVE_PID" ]]; then
    kill "$CAPTURE_SERVE_PID" 2>/dev/null || true
    wait "$CAPTURE_SERVE_PID" 2>/dev/null || true
    CAPTURE_SERVE_PID=""
  fi
  if [[ -n "$CAPTURE_SERVE_LOG" && -f "$CAPTURE_SERVE_LOG" ]]; then
    rm -f "$CAPTURE_SERVE_LOG"
  fi

  if [[ -n "$SCRATCH_HOME" && -d "$SCRATCH_HOME" ]]; then
    rm -rf "$SCRATCH_HOME"
  fi
  if [[ -n "$SCRATCH_PROJECT" && -d "$SCRATCH_PROJECT" ]]; then
    rm -rf "$SCRATCH_PROJECT"
  fi
  if [[ -n "$SCRATCH_PROJECT_UNSEEDED" && -d "$SCRATCH_PROJECT_UNSEEDED" ]]; then
    rm -rf "$SCRATCH_PROJECT_UNSEEDED"
  fi

  export HOME="$ORIG_HOME"
  unset OPENCODE_CONFIG_DIR || true

  local post_opencode post_claude tamper
  post_opencode=$(fingerprint_dir "$REAL_OPENCODE_CONFIG_DIR")
  post_claude=$(fingerprint_dir "$REAL_CLAUDE_DIR")
  tamper=0

  if [[ "$post_opencode" != "$PRE_OPENCODE_FINGERPRINT" ]]; then
    echo "FATAL: real OpenCode config changed during the run ($REAL_OPENCODE_CONFIG_DIR)" >&2
    tamper=1
  fi
  if [[ "$post_claude" != "$PRE_CLAUDE_FINGERPRINT" ]]; then
    echo "FATAL: real ~/.claude changed during the run ($REAL_CLAUDE_DIR)" >&2
    tamper=1
  fi

  if [[ "$tamper" -eq 0 ]]; then
    echo "[cleanup] real OpenCode config and ~/.claude confirmed untouched; scratch dirs removed"
  fi
}

# setup_scratch(): fresh scratch HOME + project, CAIRN_LLM_* env exported into
# this shell (reaches memory-capture.ts's/memory-wakeup.ts's direct `node
# <server>` shell-out, not only mcp.cairn-memory.environment — Pitfall 3),
# OPENCODE_CONFIG_DIR set to exactly $SCRATCH_HOME/.config/opencode (the
# default resolution path — never a custom path, avoiding the open #4399 bug).
setup_scratch() {
  SCRATCH_HOME=$(mktemp -d)
  SCRATCH_PROJECT=$(mktemp -d)

  export HOME="$SCRATCH_HOME"
  export OPENCODE_CONFIG_DIR="$SCRATCH_HOME/.config/opencode"

  export CAIRN_LLM_API_KEY="${CAIRN_LLM_API_KEY:-}"
  export CAIRN_LLM_API_URL="${CAIRN_LLM_API_URL:-}"
  export CAIRN_LLM_EXTRACTION_MODEL="${CAIRN_LLM_EXTRACTION_MODEL:-}"

  echo "[setup_scratch] SCRATCH_HOME=$SCRATCH_HOME"
  echo "[setup_scratch] SCRATCH_PROJECT=$SCRATCH_PROJECT"
  echo "[setup_scratch] OPENCODE_CONFIG_DIR=$OPENCODE_CONFIG_DIR"
  echo "[setup_scratch] CAIRN_LLM_API_KEY set: $([[ -n "$CAIRN_LLM_API_KEY" ]] && echo yes || echo no)"
  echo "[setup_scratch] CAIRN_LLM_API_URL set: $([[ -n "$CAIRN_LLM_API_URL" ]] && echo yes || echo no)"
  echo "[setup_scratch] CAIRN_LLM_EXTRACTION_MODEL set: $([[ -n "$CAIRN_LLM_EXTRACTION_MODEL" ]] && echo yes || echo no)"

  trap cleanup EXIT
}

# seed_canary(mode): mode="seeded" (default) writes a fresh, runtime-generated
# canary into the scratch project's AgentFS project scope
# ($SCRATCH_PROJECT/.agentfs/project.db, mirroring resolveScopePath("project")
# in mcp-memory-server/src/index.ts). mode="unseeded" leaves the project
# scope empty for a negative control (05-02).
seed_canary() {
  local mode="${1:-seeded}"
  local db_dir="$SCRATCH_PROJECT/.agentfs"
  local db_path="$db_dir/project.db"

  mkdir -p "$db_dir"

  if [[ "$mode" == "unseeded" ]]; then
    echo "[seed_canary] mode=unseeded — no canary written (negative-control project)"
    return 0
  fi

  CANARY_KEY="ocp-06-canary-fact"
  CANARY_VALUE="OCP-06-CANARY-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"

  SEED_DB_PATH="$db_path" \
  SEED_KEY="$CANARY_KEY" \
  SEED_VALUE="$CANARY_VALUE" \
  AGENTFS_SDK_ENTRY="$AGENTFS_SDK_ENTRY" \
    node --input-type=module -e '
import { pathToFileURL } from "node:url";
const mod = await import(pathToFileURL(process.env.AGENTFS_SDK_ENTRY).href);
const { AgentFS } = mod;
const agent = await AgentFS.open({ id: "project", path: process.env.SEED_DB_PATH });
try {
  await agent.kv.set(process.env.SEED_KEY, process.env.SEED_VALUE);
} finally {
  await agent.close();
}
'

  echo "[seed_canary] mode=seeded key=$CANARY_KEY value=$CANARY_VALUE db=$db_path"
}

# install_assets(): installs the OpenCode plugin + command assets into the
# scratch config tree via the existing idempotent sync scripts, rendering
# @@INFRA_ROOT@@ to this real repo checkout. No Claude assets are installed
# anywhere in this flow, proving the fresh-OpenCode-only install bar.
install_assets() {
  "$ROOT_DIR/scripts/sync-opencode-plugin-assets.sh" --apply --live-root "$OPENCODE_CONFIG_DIR"
  "$ROOT_DIR/scripts/sync-opencode-memory-assets.sh" --apply --live-root "$OPENCODE_CONFIG_DIR"
}

# write_scratch_config(): writes the scratch opencode.json registering
# cairn-memory as a local stdio MCP server (absolute real repo path — a
# relative path breaks once OpenCode's cwd differs from the repo root),
# a provider/model block interpolated from the exported CAIRN_LLM_* vars
# (no hardcoded host), and a permissive permission block so headless runs
# never hang on approval prompts (Pitfall 4). The config path is built
# explicitly from $SCRATCH_HOME, never from $HOME after reassignment
# (T-05-02 tampering mitigation).
write_scratch_config() {
  local config_dir="$SCRATCH_HOME/.config/opencode"
  local config_path="$config_dir/opencode.json"
  local api_key="${CAIRN_LLM_API_KEY:-}"
  local api_url="${CAIRN_LLM_API_URL:-}"
  local model_name="${CAIRN_LLM_EXTRACTION_MODEL:-}"

  mkdir -p "$config_dir"

  cat > "$config_path" <<EOF
{
  "\$schema": "https://opencode.ai/config.json",
  "mcp": {
    "cairn-memory": {
      "type": "local",
      "command": ["node", "$SERVER_ENTRY"],
      "enabled": true
    }
  },
  "provider": {
    "verify-local": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Verify Local",
      "options": { "apiKey": "$api_key", "baseURL": "$api_url" },
      "models": { "$model_name": { "name": "$model_name" } }
    }
  },
  "model": "verify-local/$model_name",
  "permission": {
    "exec": { "*": "allow" },
    "external_directory": { "**": "allow" },
    "read": { "**": "allow" },
    "write": { "**": "allow" }
  }
}
EOF

  echo "[write_scratch_config] wrote $config_path"
}

# positive_load_check(): a fast confirmation that the MCP registration loaded
# and no real-config tools leaked in — Pitfall 2's cheap pre-flight. Bounded
# by `timeout` so an unreachable model endpoint fails loudly instead of
# hanging the harness indefinitely.
#
# Note: the installed CLI (confirmed live: `opencode run --help`) has no
# `--auto` flag as 05-RESEARCH.md's docs-derived assumption expected; the
# real flag for "auto-approve permissions not explicitly denied" is
# --dangerously-skip-permissions. A fresh scratch opencode.json also carries
# a permissive `permission` block (write_scratch_config), so this flag is
# belt-and-suspenders against Pitfall 4, not the sole guard.
positive_load_check() {
  echo "[positive_load_check] running opencode run to list tools..."
  local out
  out=$(cd "$SCRATCH_PROJECT" && timeout 90 opencode run "list your available tools" --dir "$SCRATCH_PROJECT" --format json --dangerously-skip-permissions 2>&1) || true

  if echo "$out" | grep -q 'cairn-memory_'; then
    echo "[positive_load_check] OK: cairn-memory_ tools found in scratch env"
    return 0
  fi

  echo "[positive_load_check] FAIL: no cairn-memory_ tool names found in opencode run output" >&2
  echo "$out" | tail -n 40 >&2
  return 1
}

# log_env_presence(): echoes whether the CAIRN_LLM_* guard vars are set
# (never their values) so a stage failure can be triaged as "env wasn't
# exported into this shell" vs "a real plugin/model failure" (Pitfall 3).
log_env_presence() {
  echo "[env] CAIRN_LLM_API_KEY set: $([[ -n "${CAIRN_LLM_API_KEY:-}" ]] && echo yes || echo no)" >&2
  echo "[env] CAIRN_LLM_API_URL set: $([[ -n "${CAIRN_LLM_API_URL:-}" ]] && echo yes || echo no)" >&2
  echo "[env] CAIRN_LLM_EXTRACTION_MODEL set: $([[ -n "${CAIRN_LLM_EXTRACTION_MODEL:-}" ]] && echo yes || echo no)" >&2
}

# run_opencode(project_dir, timeout_secs, prompt, [extra opencode-run args...]):
# thin wrapper around `opencode run` used by every stage. Uses
# --dangerously-skip-permissions (not --auto — the installed CLI, v1.17.11,
# has no such flag; confirmed live in 05-01 and reconfirmed here). Never pass
# a prompt containing literal `<...>` angle-bracket placeholder syntax — live
# testing this phase found it makes the installed CLI hang indefinitely with
# zero output (reproduced twice, unrelated to model load/timeout); every
# prompt in this script is phrased without angle brackets for this reason.
run_opencode() {
  local project_dir="$1"; shift
  local timeout_secs="$1"; shift
  local prompt="$1"; shift
  (cd "$project_dir" && timeout "$timeout_secs" opencode run "$prompt" --dir "$project_dir" --format json --dangerously-skip-permissions "$@" 2>&1)
}

# CANARY_PREFIX: the fixed literal prefix every seed_canary()-generated value
# starts with, regardless of the random suffix. Used by negative controls to
# assert "no canary-shaped value leaked" even when the control project never
# had its own canary generated (T-05-01/T-05-03).
CANARY_PREFIX="OCP-06-CANARY"

# run_stage_wakeup(project_dir, mode): re-confirms OCP-05 live in THIS
# phase's own scratch env (05-RESEARCH.md anti-pattern: never assume Phase-4
# carryover). mode="seeded" asserts the seeded canary is echoed back under
# both an explicit-recite prompt and a natural-framing prompt (Phase-4 Run
# A/Run B pattern — rules out prompt leakage). mode="unseeded" asserts
# NOT-FOUND and no canary-shaped leak.
run_stage_wakeup() {
  local project_dir="$1" mode="$2"
  local explicit_prompt='Inspect your session-start system context. If it contains a line under a heading about project memory, reply with exactly: FOUND: the fact verbatim. If there is no such fact, reply exactly: NOT-FOUND.'
  local natural_prompt='Without me telling you anything new, what specific fact do you already know about this project?'
  local out_a out_b

  out_a=$(run_opencode "$project_dir" 60 "$explicit_prompt") || true
  out_b=$(run_opencode "$project_dir" 60 "$natural_prompt") || true

  if [[ "$mode" == "seeded" ]]; then
    if echo "$out_a" | grep -qF "$CANARY_VALUE" && echo "$out_b" | grep -qF "$CANARY_VALUE"; then
      echo "[run_stage_wakeup:$mode] OK: canary surfaced (explicit-recite AND natural-framing runs)"
      return 0
    fi
    echo "[run_stage_wakeup:$mode] FAIL: canary not surfaced in one or both runs" >&2
    log_env_presence
    echo "--- explicit-recite run (tail) ---" >&2
    echo "$out_a" | tail -n 20 >&2
    echo "--- natural-framing run (tail) ---" >&2
    echo "$out_b" | tail -n 20 >&2
    return 1
  else
    if echo "$out_a" | grep -qi "NOT-FOUND" && ! echo "$out_a" | grep -qF "$CANARY_PREFIX" && ! echo "$out_b" | grep -qF "$CANARY_PREFIX"; then
      echo "[run_stage_wakeup:$mode] OK: NOT-FOUND confirmed, no canary-shaped leak"
      return 0
    fi
    echo "[run_stage_wakeup:$mode] FAIL: expected NOT-FOUND / no canary-shaped leak" >&2
    log_env_presence
    echo "$out_a" | tail -n 20 >&2
    return 1
  fi
}

# run_stage_recall_edit(project_dir, mode): seeds a fact whose key IS the
# file stem (CANARY_KEY, seeded by seed_canary()) so memory-recall.ts's
# stem-substring match against the wakeup index's `- <key>: <preview>` line
# hits. mode="seeded" asserts a matching-file edit throws the injected
# "Memory recall" context containing the canary, AND a non-matching-file
# edit stays silent (the high-signal/low-noise pair, OCP-02). mode="unseeded"
# asserts a matching-file-name edit stays silent (no AgentFS data to surface).
run_stage_recall_edit() {
  local project_dir="$1" mode="$2"
  local match_file="${CANARY_KEY}.md"
  local nomatch_file="routine-notes.md"
  local out_match out_nomatch matched=0

  if [[ "$mode" == "seeded" ]]; then
    # Bounded retry (live testing this phase found the local model sometimes
    # narrates an edit without actually issuing the tool call, regardless of
    # prompt category — a general model-reliability characteristic, not a
    # plugin defect; delete the target file between attempts so a stale
    # "file already exists" observation from the model can't suppress the
    # next attempt's tool call).
    for _attempt in 1 2 3; do
      rm -f "${project_dir:?}/${match_file}"
      out_match=$(run_opencode "$project_dir" 60 "Create a new file named ${match_file} in the project root with the single line: placeholder") || true
      if echo "$out_match" | grep -qF "Memory recall (auto-injected" && echo "$out_match" | grep -qF "$CANARY_VALUE"; then
        matched=1
        break
      fi
    done

    if [[ "$matched" -eq 1 ]]; then
      echo "[run_stage_recall_edit:$mode] OK: matching-file edit threw injected recall context containing the canary"
    else
      echo "[run_stage_recall_edit:$mode] FAIL: matching-file edit did not surface the injected recall context after 3 attempts" >&2
      log_env_presence
      echo "$out_match" | tail -n 30 >&2
      return 1
    fi

    out_nomatch=$(run_opencode "$project_dir" 60 "Create a new file named ${nomatch_file} in the project root with the single line: placeholder") || true
    if echo "$out_nomatch" | grep -qF "Memory recall (auto-injected"; then
      echo "[run_stage_recall_edit:$mode] FAIL: non-matching-file edit unexpectedly surfaced recall context" >&2
      echo "$out_nomatch" | tail -n 30 >&2
      return 1
    fi
    echo "[run_stage_recall_edit:$mode] OK: non-matching-file edit stayed silent"
    return 0
  else
    out_match=$(run_opencode "$project_dir" 60 "Create a new file named ${match_file} in the project root with the single line: placeholder") || true
    if echo "$out_match" | grep -qF "Memory recall (auto-injected"; then
      echo "[run_stage_recall_edit:$mode] FAIL: unseeded project surfaced recall context unexpectedly" >&2
      echo "$out_match" | tail -n 30 >&2
      return 1
    fi
    echo "[run_stage_recall_edit:$mode] OK: unseeded project stayed silent on a matching-name edit (no AgentFS data)"
    return 0
  fi
}

# setup_negative_project(): a second scratch project directory (no .agentfs
# seeded) for every stage's negative control. Plugin/command assets are
# global (installed once into $OPENCODE_CONFIG_DIR by install_assets), so
# the negative-control project only needs to exist as a bare directory.
setup_negative_project() {
  SCRATCH_PROJECT_UNSEEDED=$(mktemp -d)
  echo "[setup_negative_project] SCRATCH_PROJECT_UNSEEDED=$SCRATCH_PROJECT_UNSEEDED"
}

# start_capture_server()/stop_capture_server(): the capture stage cannot use
# a bare `opencode run` invocation. Live verification this phase found that
# `opencode run` tears down its whole process (killing any still-running
# child processes, e.g. the extract subprocess memory-capture.ts spawns)
# immediately once its own turn finishes — it does not wait for plugin
# `event` handlers' async work (session.idle -> extract) to settle. This
# reproduced deterministically: an instrumented run showed the extract
# child process spawned successfully but was killed before its "close"
# event could fire, even though the whole `opencode run` invocation's own
# wall-clock time was only ~3s. This is a genuine limitation of `opencode
# run`'s headless process lifecycle, not something a plugin-side code
# change can outrun.
#
# Workaround (harness-only, no plugin/server change): `opencode serve`
# starts a headless, persistent server process; `opencode run --attach
# <url>` then drives it as a client whose own exit does NOT kill the
# server. The server keeps running long enough for session.idle's async
# extract call to complete naturally. Confirmed live: with --attach, the
# same extract subprocess's "close" event fired ~8s after the triggering
# turn, well after the `run` client itself had already exited.
start_capture_server() {
  CAPTURE_SERVE_LOG=$(mktemp)
  opencode serve --port 0 --hostname 127.0.0.1 >"$CAPTURE_SERVE_LOG" 2>&1 &
  CAPTURE_SERVE_PID=$!

  CAPTURE_SERVE_URL=""
  for _wait_sec in 1 2 3 4 5 6 7 8 9 10; do
    if grep -q "listening on" "$CAPTURE_SERVE_LOG" 2>/dev/null; then
      CAPTURE_SERVE_URL=$(grep -o 'http://[0-9.]*:[0-9]*' "$CAPTURE_SERVE_LOG" | head -1)
      break
    fi
    sleep 1
  done

  if [[ -z "$CAPTURE_SERVE_URL" ]]; then
    echo "[start_capture_server] FAIL: opencode serve did not report a listening URL within 10s" >&2
    cat "$CAPTURE_SERVE_LOG" >&2
    return 1
  fi
  echo "[start_capture_server] OK: $CAPTURE_SERVE_URL (pid=$CAPTURE_SERVE_PID)"
}

stop_capture_server() {
  if [[ -n "$CAPTURE_SERVE_PID" ]]; then
    kill "$CAPTURE_SERVE_PID" 2>/dev/null || true
    wait "$CAPTURE_SERVE_PID" 2>/dev/null || true
    CAPTURE_SERVE_PID=""
  fi
  CAPTURE_SERVE_URL=""
}

# run_stage_capture(project_dir, mode): drives the capture stage through the
# persistent server (start_capture_server must already be running). A
# durable-fact-worthy turn is sent via --attach; the stage then polls for a
# new .planning/memory-staging/*.json containing the turn's canary. Bounded
# retry (3 attempts for mode="seeded") absorbs an independently-confirmed
# characteristic of the configured local extraction model: it sometimes
# exhausts its response budget on reasoning tokens before emitting the
# candidates JSON, yielding an empty (not malformed) extraction result —
# not a plugin defect (mcp-memory-server's extractMemoryCandidates, out of
# this plan's file scope).
run_stage_capture() {
  local project_dir="$1" mode="$2"
  local staging_dir="$project_dir/.planning/memory-staging"
  rm -rf "${staging_dir:?}"

  if [[ -z "$CAPTURE_SERVE_URL" ]]; then
    echo "[run_stage_capture:$mode] FAIL: capture server not running (call start_capture_server first)" >&2
    return 1
  fi

  local attempts_list="1 2 3"
  [[ "$mode" == "unseeded" ]] && attempts_list="1"

  local canary found=0
  for _attempt in $attempts_list; do
    canary="OCP-06-CAPTURE-${mode}-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
    (cd "$project_dir" && timeout 60 opencode run "Important decision to remember for future sessions, no need to use any tools yourself: this project's staging deployment region is permanently fixed to $canary. This is a durable architectural constraint, not a temporary note." --attach "$CAPTURE_SERVE_URL" --dir "$project_dir" --format json --dangerously-skip-permissions >/dev/null 2>&1) || true

    for _poll_sec in 1 2 3 4 5 6 7 8 9 10; do
      if [[ -d "$staging_dir" ]] && grep -rq "$canary" "$staging_dir"/*.json 2>/dev/null; then
        found=1
        break
      fi
      sleep 1
    done
    [[ "$found" -eq 1 ]] && break
  done

  if [[ "$mode" == "seeded" ]]; then
    if [[ "$found" -eq 1 ]]; then
      echo "[run_stage_capture:$mode] OK: staged candidate contains the turn's canary"
      return 0
    fi
    echo "[run_stage_capture:$mode] FAIL: no staged candidate contained the canary after retries" >&2
    log_env_presence
    return 1
  else
    if [[ "$found" -eq 0 ]]; then
      echo "[run_stage_capture:$mode] OK: unseeded project staged nothing containing a canary"
      return 0
    fi
    echo "[run_stage_capture:$mode] FAIL: unseeded project unexpectedly staged a canary-bearing candidate" >&2
    return 1
  fi
}

# extract_session_id(): reads NDJSON `opencode run --format json` output on
# stdin, prints the first non-null top-level `sessionID` field (05-01
# confirmed this exact field name live) so a later `opencode run --session`
# call can continue the same session.
extract_session_id() {
  node -e '
let data = "";
process.stdin.on("data", (c) => { data += c; });
process.stdin.on("end", () => {
  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.sessionID) {
        process.stdout.write(parsed.sessionID);
        process.exit(0);
      }
    } catch {
      // not a JSON line, skip
    }
  }
});
'
}

# assert_tool_event(tool_name_regex, [canary]): bash wrapper around
# scripts/lib/assert-tool-event.mjs (D-08/D-09). Reads NDJSON on stdin,
# returns 0 only for a genuine completed tool_use event whose part.tool
# matches tool_name_regex (and, if canary is given, whose part.state.output
# contains it) -- never a narrated-but-unexecuted mention inside a text event.
assert_tool_event() {
  TOOL_EVENT_REGEX="$1" TOOL_EVENT_CANARY="${2:-}" node "$ROOT_DIR/scripts/lib/assert-tool-event.mjs"
}

# run_stage_remember_recall(project_dir, mode): mode="seeded" writes a fresh
# canary via `/remember`, asserting a genuine cairn-memory_memory_write/
# _supersede tool_use event (D-08/D-09, via assert_tool_event), captures the
# sessionID from that call's JSON output, then continues the SAME session
# with `/recall` for the topic, asserting a genuine
# cairn-memory_memory_search/_read tool_use event whose part.state.output
# contains the canary (OCP-03/OCP-04's write-then-read-back round trip).
# mode="unseeded" only runs `/recall` (nothing was ever remembered there)
# and asserts no canary-linked tool_use event fires.
#
# D-11: both halves drive through the persistent `opencode serve` via
# --attach (start_capture_server must already be running) rather than bare
# `opencode run`, matching run_stage_capture's transport.
#
# D-13 retry classification: a run's exit code is captured explicitly (never
# swallowed by `|| true` before being read). A run is retried (bounded to 3
# attempts per half, LAST_ROUNDTRIP_RETRIES incremented each retry) only on
# an INFRA failure — a `timeout`-triggered kill (exit 124) or empty output
# (extract_session_id yields nothing, i.e. no real events were emitted at
# all). A run that completed cleanly (a real session_id exists) but whose
# assert_tool_event check fails is a NARRATION failure: the iteration FAILs
# immediately, no retry — this is the exact upstream race (Pitfall 4) vs.
# model-narration distinction 13-RESEARCH.md pins down.
run_stage_remember_recall() {
  local project_dir="$1" mode="$2"
  local topic="the ci pipeline canary token"
  local canary out_remember out_recall session_id rc

  if [[ -z "$CAPTURE_SERVE_URL" ]]; then
    echo "[run_stage_remember_recall:$mode] FAIL: capture server not running (call start_capture_server first)" >&2
    return 1
  fi

  LAST_ROUNDTRIP_RETRIES=0

  if [[ "$mode" == "seeded" ]]; then
    canary="OCP-06-REMEMBER-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"

    for _attempt in 1 2 3; do
      rc=0
      out_remember=$(run_opencode "$project_dir" 60 "/remember ${topic} is ${canary}" --attach "$CAPTURE_SERVE_URL") || rc=$?
      session_id=$(printf '%s' "$out_remember" | extract_session_id)

      if [[ "$rc" -eq 124 || -z "$session_id" ]]; then
        if [[ "$_attempt" -lt 3 ]]; then
          LAST_ROUNDTRIP_RETRIES=$((LAST_ROUNDTRIP_RETRIES + 1))
          echo "[run_stage_remember_recall:$mode] INFRA retry: /remember attempt $_attempt (rc=$rc, no real events emitted)" >&2
          continue
        fi
        echo "[run_stage_remember_recall:$mode] FAIL: /remember exhausted infra retries (rc=$rc, no session established)" >&2
        log_env_presence
        printf '%s' "$out_remember" | tail -n 20 >&2
        return 1
      fi

      if printf '%s' "$out_remember" | assert_tool_event 'cairn-memory_memory_(write|supersede)'; then
        break
      fi

      echo "[run_stage_remember_recall:$mode] FAIL: /remember completed but performed no genuine memory_write/_supersede tool_use event (narration failure, no retry)" >&2
      log_env_presence
      printf '%s' "$out_remember" | tail -n 20 >&2
      return 1
    done
    echo "[run_stage_remember_recall:$mode] OK: /remember wrote via a genuine tool_use event (sessionID=$session_id, retries=$LAST_ROUNDTRIP_RETRIES)"

    for _attempt in 1 2 3; do
      rc=0
      out_recall=$( (cd "$project_dir" && timeout 60 opencode run "recall ${topic}" --dir "$project_dir" --format json --dangerously-skip-permissions --session "$session_id" --attach "$CAPTURE_SERVE_URL" 2>&1) ) || rc=$?
      local recall_session_id
      recall_session_id=$(printf '%s' "$out_recall" | extract_session_id)

      if [[ "$rc" -eq 124 || -z "$recall_session_id" ]]; then
        if [[ "$_attempt" -lt 3 ]]; then
          LAST_ROUNDTRIP_RETRIES=$((LAST_ROUNDTRIP_RETRIES + 1))
          echo "[run_stage_remember_recall:$mode] INFRA retry: /recall attempt $_attempt (rc=$rc, no real events emitted)" >&2
          continue
        fi
        echo "[run_stage_remember_recall:$mode] FAIL: /recall exhausted infra retries (rc=$rc, no real events emitted)" >&2
        log_env_presence
        printf '%s' "$out_recall" | tail -n 30 >&2
        return 1
      fi

      if printf '%s' "$out_recall" | assert_tool_event 'cairn-memory_memory_(search|read)' "$canary"; then
        echo "[run_stage_remember_recall:$mode] OK: recall retrieved the canary via a genuine memory_search/_read tool_use event (retries=$LAST_ROUNDTRIP_RETRIES)"
        return 0
      fi

      echo "[run_stage_remember_recall:$mode] FAIL: /recall completed but performed no genuine memory_search/_read tool_use event returning the canary (narration failure, no retry)" >&2
      log_env_presence
      printf '%s' "$out_recall" | tail -n 30 >&2
      return 1
    done
  else
    canary="OCP-06-REMEMBER-unseeded-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
    rc=0
    out_recall=$(run_opencode "$project_dir" 60 "recall ${topic}" --attach "$CAPTURE_SERVE_URL") || rc=$?

    if [[ "$rc" -eq 124 || -z "$(printf '%s' "$out_recall" | extract_session_id)" ]]; then
      echo "[run_stage_remember_recall:$mode] FAIL: unseeded recall infra failure (rc=$rc, no real events emitted)" >&2
      log_env_presence
      printf '%s' "$out_recall" | tail -n 20 >&2
      return 1
    fi

    if printf '%s' "$out_recall" | assert_tool_event 'cairn-memory_memory_(search|read)' "$canary"; then
      echo "[run_stage_remember_recall:$mode] FAIL: unseeded project unexpectedly returned a canary-linked memory_search/_read tool_use event" >&2
      return 1
    fi
    echo "[run_stage_remember_recall:$mode] OK: unseeded project recall performed no canary-linked tool_use event (not-found)"
    return 0
  fi
}

# run_negative_controls(): sweeps every stage against the unseeded
# negative-control project as one pass — the D-04 proof that a surfaced
# canary can only have come from injected memory, never model
# training/guessing. Returns non-zero if ANY control fails.
run_negative_controls() {
  local failures=0
  echo "=== Negative control sweep (unseeded project: $SCRATCH_PROJECT_UNSEEDED) ==="
  run_stage_wakeup "$SCRATCH_PROJECT_UNSEEDED" unseeded || failures=1
  run_stage_recall_edit "$SCRATCH_PROJECT_UNSEEDED" unseeded || failures=1
  run_stage_capture "$SCRATCH_PROJECT_UNSEEDED" unseeded || failures=1
  run_stage_remember_recall "$SCRATCH_PROJECT_UNSEEDED" unseeded || failures=1
  return "$failures"
}

main() {
  case "${1:-}" in
    --setup-only)
      capture_real_config_fingerprint
      setup_scratch
      seed_canary "${2:-seeded}"
      install_assets
      write_scratch_config
      positive_load_check
      ;;
    --stage)
      # Fastest per-commit signal: the wakeup FOUND/NOT-FOUND probe alone
      # (confirms MCP registration + isolation didn't regress) without the
      # slower capture/remember/recall stages.
      capture_real_config_fingerprint
      setup_scratch
      seed_canary seeded
      install_assets
      write_scratch_config
      positive_load_check
      case "${2:-wakeup}" in
        wakeup)
          run_stage_wakeup "$SCRATCH_PROJECT" seeded
          ;;
        *)
          echo "Unknown stage: ${2:-}" >&2
          exit 2
          ;;
      esac
      ;;
    --full)
      # Full suite: every stage against the seeded project, then the full
      # negative-control sweep against a fresh unseeded project. Single
      # non-zero-on-failure exit code for a 05-03-consumable green/red
      # signal.
      capture_real_config_fingerprint
      setup_scratch
      seed_canary seeded
      setup_negative_project
      install_assets
      write_scratch_config
      positive_load_check
      start_capture_server

      local failures=0
      run_stage_wakeup "$SCRATCH_PROJECT" seeded || failures=1
      run_stage_recall_edit "$SCRATCH_PROJECT" seeded || failures=1
      run_stage_capture "$SCRATCH_PROJECT" seeded || failures=1
      run_stage_remember_recall "$SCRATCH_PROJECT" seeded || failures=1
      run_negative_controls || failures=1

      stop_capture_server

      if [[ "$failures" -ne 0 ]]; then
        echo "[main:--full] ONE OR MORE STAGES FAILED" >&2
        return 1
      fi
      echo "[main:--full] ALL STAGES PASSED"
      ;;
    -h|--help)
      usage
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
}

main "$@"
