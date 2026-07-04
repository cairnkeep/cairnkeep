#!/usr/bin/env bash
set -euo pipefail

# FastContext raw-endpoint reliability probe (CTX-06 / Phase 6 D-01/D-02/D-03).
#
# Mirrors scripts/verify-opencode-live-parity.sh's shape (staged, env-driven,
# loopback-safe, generous timeouts, single exit-code pass/fail). Unlike that
# harness, this probe never touches opencode or the cairn-memory MCP at all —
# it drives the raw llama-server `/v1/chat/completions` endpoint directly with
# FastContext's own read/glob/grep tool schemas, isolating the variable under
# test (model + chat-template + --jinja + quant) from any execution loop.
#
# Every value that could identify the operator's real infra (the endpoint URL,
# any Authorization header / API key) is read from the ambient shell at
# runtime and is never hardcoded, echoed, or written to the evidence log
# (DEC-no-private-references). Only a loopback default is committed.
#
# --self-test is the offline, no-network backstop: it exercises the record-
# and-check logic (gate #1 /props recording, gate #2 per-turn assertion, and
# the refined-D-05 verdict scoring) against canned fixture JSON so the gate
# discriminates PASS from FAIL before any live endpoint is ever reached.

usage() {
  cat <<'EOF'
Usage: verify-fastcontext-reliability.sh --self-test
       verify-fastcontext-reliability.sh --props-only
       verify-fastcontext-reliability.sh --full
       verify-fastcontext-reliability.sh -h|--help

Probes a llama-server-hosted FastContext GGUF for tool-call reliability
(CTX-06). The go/no-go verdict is anchored to the empirical per-turn gate
(finish_reason == "tool_calls" on every turn of a multi-prompt, multi-turn
matrix); the /props chat_template_tool_use field is recorded as evidence
alongside the verdict, not used as an automatic blocker (refined D-05).

Options:
  --self-test
      Offline: exercises the /props recording, the strict per-turn tool-call
      assertion, and the refined-D-05 verdict logic against canned fixture
      JSON. No network access, no live model required. This is the automated
      Nyquist backstop for the operator-gated live probe below.
  --props-only
      Live: fetches GET /props from FASTCONTEXT_PROBE_URL and records
      chat_template_tool_use / chat_template_caps / build_info / the raw
      chat_template verbatim to the evidence log (gate #1 only, no chat
      round-trips).
  --full
      Live: gate #1 (/props) plus the full >=5-prompt x >=3-turn tool-call
      matrix (gate #2), then computes and records the go/no-go verdict.
      Exits 0 only on a GO verdict.
  -h, --help
      Show this help text.

Environment:
  FASTCONTEXT_PROBE_URL     OpenAI-compatible base URL for the deployed
                            llama-server. Defaults to a loopback address;
                            the operator supplies the real endpoint at
                            runtime. Never echoed to stdout or the evidence
                            log — only a presence indicator is logged.
  FASTCONTEXT_MODEL_ALIAS   Model alias sent in each chat-completion request.
                            Defaults to the FastContext RL alias documented
                            in 06-RESEARCH.md; override for a different quant.
  FASTCONTEXT_EVIDENCE_LOG  Path to the raw evidence log. Defaults to a
                            *.log file under this phase's directory, which
                            the repo .gitignore already excludes from commits.
EOF
}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

FASTCONTEXT_PROBE_URL_DEFAULT="http://127.0.0.1:8081/v1"
FASTCONTEXT_PROBE_URL="${FASTCONTEXT_PROBE_URL:-$FASTCONTEXT_PROBE_URL_DEFAULT}"
FASTCONTEXT_MODEL_ALIAS="${FASTCONTEXT_MODEL_ALIAS:-fastcontext-4b-rl}"
FASTCONTEXT_EVIDENCE_LOG="${FASTCONTEXT_EVIDENCE_LOG:-$ROOT_DIR/.planning/phases/06-fastcontext-reliability-spike/06-EVIDENCE.log}"

# System prompt copied verbatim from 06-RESEARCH.md finding #2's curl example
# (itself copied from token-miser/src/explore/client.rs) - inventing an
# approximate prompt would confound a no-go with a schema/prompt-mismatch
# artifact (RESEARCH #3 / Pitfall 5).
SYSTEM_PROMPT="You are a repository exploration agent. Locate the code relevant to the user's task using the read, glob, and grep tools. Do not attempt to solve the task."

# Tool schemas copied verbatim from 06-RESEARCH.md finding #2/#3 (the
# token-miser client.rs read/glob/grep shape) - field names, descriptions,
# and required lists are not to be re-derived approximately.
TOOL_SCHEMAS_JSON=$(cat <<'EOF'
[
  {
    "type": "function",
    "function": {
      "name": "read",
      "description": "Read a file's contents with line numbers. Use offset/limit to read a span.",
      "parameters": {
        "type": "object",
        "properties": {
          "path":   {"type": "string", "description": "Path relative to the repo root."},
          "offset": {"type": "integer", "description": "1-based first line to read."},
          "limit":  {"type": "integer", "description": "Number of lines to read."}
        },
        "required": ["path"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "glob",
      "description": "List files matching a glob pattern (gitignore-aware).",
      "parameters": {
        "type": "object",
        "properties": {
          "pattern": {"type": "string"},
          "base":    {"type": "string", "description": "Optional subdirectory to search under."}
        },
        "required": ["pattern"]
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "grep",
      "description": "Regex search across the repo (gitignore-aware). Returns path:line:content.",
      "parameters": {
        "type": "object",
        "properties": {
          "regex": {"type": "string"},
          "path":  {"type": "string", "description": "Optional single file to search."},
          "glob":  {"type": "string", "description": "Optional glob to limit which files are searched."}
        },
        "required": ["regex"]
      }
    }
  }
]
EOF
)

# >=5 distinct exploration prompts targeting cairnkeep's own repo (the same
# corpus Phase 9's A/B will measure), per CONTEXT.md Claude's Discretion.
# Plausible exploration asks only - the probe never executes them; every
# turn is answered with a static stubbed tool result regardless of what the
# model actually asked for (Pattern 1).
EXPLORATION_PROMPTS=(
  "Where is scope path containment implemented in this repo?"
  "Where is the AgentFS project scope resolved in this repo?"
  "Where is the git-provider abstraction configured in this repo?"
  "Where does the OpenCode memory-wakeup plugin live in this repo?"
  "Where do the asset-sync scripts render the infra-root placeholder value?"
)

# Globals populated by inspect_props()/record_props_evidence() and by
# run_turn_matrix()/compute_verdict() (Tasks 2-3). Declared here with safe
# defaults because `set -u` treats an unset reference as an error.
GATE1_STATUS=""
PROPS_RAW=""
MATRIX_TOTAL=0
MATRIX_PASS=0
MATRIX_RESULTS=()
VERDICT=""

# validate_probe_url(url): refuses to run against a value that doesn't look
# like an http(s) URL (T-06-03 / V5 input validation) before any curl use.
# Never includes the URL value itself in the error message (T-06-02).
validate_probe_url() {
  local url="$1"
  if [[ ! "$url" =~ ^https?:// ]]; then
    echo "FATAL: FASTCONTEXT_PROBE_URL does not look like an http(s) URL (value withheld)" >&2
    exit 1
  fi
}

# log_endpoint_presence(): echoes only whether FASTCONTEXT_PROBE_URL was
# overridden from the loopback default — never the value itself (T-06-02,
# mirrors log_env_presence() in verify-opencode-live-parity.sh).
log_endpoint_presence() {
  local overridden="no"
  [[ "$FASTCONTEXT_PROBE_URL" != "$FASTCONTEXT_PROBE_URL_DEFAULT" ]] && overridden="yes"
  echo "[env] FASTCONTEXT_PROBE_URL overridden from loopback default: $overridden" >&2
}

# append_evidence(line): appends one line to the evidence log, creating the
# parent directory if needed. Callers are responsible for never passing the
# endpoint URL or a secret through this helper.
append_evidence() {
  local line="$1"
  mkdir -p "$(dirname "$FASTCONTEXT_EVIDENCE_LOG")"
  echo "$line" >> "$FASTCONTEXT_EVIDENCE_LOG"
}

# record_props_evidence(props_json, log_target): records chat_template_tool_use
# (present-or-absent), chat_template_caps, build_info, and the raw
# chat_template verbatim to log_target (if non-empty), sets the GATE1_STATUS
# global, and echoes the gate-1 line to stdout (used by self-test to assert
# on the recorded outcome without a live network call).
record_props_evidence() {
  local props="$1"
  local log_target="${2:-}"
  local gate1_line

  if echo "$props" | jq -e 'has("chat_template_tool_use")' >/dev/null 2>&1; then
    GATE1_STATUS="PRESENT"
    gate1_line="[gate-1] chat_template_tool_use PRESENT"
  else
    GATE1_STATUS="ABSENT"
    gate1_line="[gate-1] chat_template_tool_use ABSENT (expected for a single-unified-template Qwen3-family GGUF - see 06-RESEARCH.md finding #1; recorded as evidence, NOT a script bug and NOT an auto-no-go per refined D-05)"
  fi

  if [[ -n "$log_target" ]]; then
    mkdir -p "$(dirname "$log_target")"
    {
      echo "=== /props snapshot ($(date -u +%FT%TZ)) ==="
      echo "$props" | jq '{chat_template_tool_use, chat_template_caps, build_info}'
      echo "raw chat_template:"
      echo "$props" | jq -r '.chat_template // "MISSING"'
      echo "$gate1_line"
    } >> "$log_target"
  fi

  echo "$gate1_line"
}

# inspect_props(url): GET {url}/props (falling back to {url%/v1}/props),
# records the raw payload verbatim via record_props_evidence(), and sets
# PROPS_RAW for later use (verdict finalize, Task 3). An absent
# chat_template_tool_use field never triggers a retry or a non-zero return
# on its own.
inspect_props() {
  local url="$1"
  local props
  props=$(curl -sf --max-time 15 "${url}/props" 2>/dev/null) || \
  props=$(curl -sf --max-time 15 "${url%/v1}/props" 2>/dev/null) || {
    echo "[inspect_props] FAIL: unable to reach a /props endpoint" >&2
    return 1
  }
  PROPS_RAW="$props"
  record_props_evidence "$props" "$FASTCONTEXT_EVIDENCE_LOG"
}

# assert_tool_call_turn(response_json): PASS only when finish_reason ==
# "tool_calls" AND message.tool_calls is a non-empty array - gated strictly
# on jq JSON structure, never a substring match on content. The stale-doc
# value "tool" (singular, docs/function-calling.md's example - confirmed
# stale against the current llama.cpp source in 06-RESEARCH.md finding #2)
# is deliberately NOT accepted as a pass; do not "fix" this to match the
# stale doc if a future build is observed to emit it.
assert_tool_call_turn() {
  local response_json="$1"
  local finish_reason n_calls

  finish_reason=$(echo "$response_json" | jq -r '.choices[0].finish_reason // "missing"')
  n_calls=$(echo "$response_json" | jq '.choices[0].message.tool_calls | length? // 0')

  if [[ "$finish_reason" == "tool_calls" && "$n_calls" -gt 0 ]]; then
    return 0
  fi
  return 1
}

# tool_result_message(tool_call_id): the stubbed role:"tool" reply appended
# after every observed tool_calls turn (Pattern 1 - the probe never executes
# real read/glob/grep against the filesystem; it only observes whether the
# model reliably emits well-formed tool calls turn after turn).
tool_result_message() {
  local tool_call_id="$1"
  jq -n --arg id "$tool_call_id" '{
    role: "tool",
    tool_call_id: $id,
    content: "1: fn placeholder() {}\n2:     // stubbed tool result for reliability probing\n3: }"
  }'
}

# run_turn_matrix(url, turns_per_prompt): the gate #2 matrix. For each
# EXPLORATION_PROMPTS entry, runs a genuine multi-turn loop over an
# accumulating messages array (system + user, then each assistant turn and
# stubbed tool result appended in place - never rebuilt as a fresh length-2
# array between turns, Pitfall 3). Populates MATRIX_TOTAL/MATRIX_PASS/
# MATRIX_RESULTS for compute_verdict() and finalize_evidence_log() (Task 3).
run_turn_matrix() {
  local url="$1"
  local turns_per_prompt="${2:-3}"
  local prompt prompt_idx=0 turn_idx
  local messages request response n_calls tool_call_id assistant_msg tool_msg result

  MATRIX_TOTAL=0
  MATRIX_PASS=0
  MATRIX_RESULTS=()

  for prompt in "${EXPLORATION_PROMPTS[@]}"; do
    prompt_idx=$((prompt_idx + 1))
    messages=$(jq -n --arg sys "$SYSTEM_PROMPT" --arg user "$prompt" \
      '[{role: "system", content: $sys}, {role: "user", content: $user}]')

    for ((turn_idx = 1; turn_idx <= turns_per_prompt; turn_idx++)); do
      MATRIX_TOTAL=$((MATRIX_TOTAL + 1))

      request=$(jq -n --argjson messages "$messages" --argjson tools "$TOOL_SCHEMAS_JSON" \
        --arg model "$FASTCONTEXT_MODEL_ALIAS" \
        '{model: $model, temperature: 0, stream: false, tool_choice: "auto", tools: $tools, messages: $messages}')

      if ! response=$(curl -sf --max-time 60 "${url}/chat/completions" \
        -H "Content-Type: application/json" -d "$request" 2>/dev/null); then
        echo "[matrix] FAIL: request error at prompt $prompt_idx turn $turn_idx" >&2
        MATRIX_RESULTS+=("$prompt_idx|$turn_idx|FAIL|request-error|0")
        append_evidence "[matrix] prompt=$prompt_idx turn=$turn_idx result=FAIL reason=request-error"
        continue
      fi

      # Log the raw tool-call arguments even though the result is stubbed -
      # a free early signal for Phase 7 planning (Pitfall 4).
      echo "$response" | jq -c '.choices[0].message.tool_calls[]?.function.arguments // empty' 2>/dev/null \
        | while IFS= read -r args; do
            append_evidence "[tool-call-args] prompt=$prompt_idx turn=$turn_idx args=$args"
          done

      n_calls=$(echo "$response" | jq '.choices[0].message.tool_calls | length? // 0')
      if assert_tool_call_turn "$response"; then
        MATRIX_PASS=$((MATRIX_PASS + 1))
        result="PASS"
      else
        result="FAIL"
      fi
      local finish_reason
      finish_reason=$(echo "$response" | jq -r '.choices[0].finish_reason // "missing"')
      MATRIX_RESULTS+=("$prompt_idx|$turn_idx|$result|$finish_reason|$n_calls")
      append_evidence "[matrix] prompt=$prompt_idx turn=$turn_idx result=$result finish_reason=$finish_reason tool_calls=$n_calls"

      # Append this turn to the accumulating conversation and continue -
      # never reset to a fresh length-2 messages array (Pitfall 3).
      assistant_msg=$(echo "$response" | jq '.choices[0].message')
      messages=$(echo "$messages" | jq --argjson m "$assistant_msg" '. + [$m]')

      tool_call_id=$(echo "$response" | jq -r '.choices[0].message.tool_calls[0].id // empty')
      if [[ -n "$tool_call_id" ]]; then
        tool_msg=$(tool_result_message "$tool_call_id")
        messages=$(echo "$messages" | jq --argjson t "$tool_msg" '. + [$t]')
      fi
    done
  done
}

# compute_verdict(): the refined-D-05 scoring ("Evidence, not hard gate",
# this plan's <d05_refinement>). GO only when every turn in the matrix
# passed assert_tool_call_turn (gate #2, D-06 hard blocker on any single
# narration/malformed turn). Gate #1 (chat_template_tool_use, from
# GATE1_STATUS) is recorded as evidence alongside the verdict and MUST NOT
# by itself force a NO-GO - its absence is expected and architecturally
# explainable for a single-unified-template Qwen3-family GGUF.
compute_verdict() {
  if [[ "$MATRIX_TOTAL" -gt 0 && "$MATRIX_PASS" -eq "$MATRIX_TOTAL" ]]; then
    VERDICT="GO"
  else
    VERDICT="NO-GO"
  fi

  echo "[verdict] gate-1 chat_template_tool_use: ${GATE1_STATUS:-UNKNOWN} (absence alone never forces NO-GO - refined D-05)"
  echo "[verdict] gate-2 tool-call matrix: ${MATRIX_PASS}/${MATRIX_TOTAL} turns passed"
  echo "[verdict] VERDICT: $VERDICT"
}

# run_token_miser_corroboration(): optional stage 3 (D-04). Corroboration
# only - never the verdict basis, and its absence is never a failure.
run_token_miser_corroboration() {
  if command -v token_miser >/dev/null 2>&1; then
    local out
    echo "[stage-3] token_miser found on PATH - running corroboration explore against this repo"
    out=$(cd "$ROOT_DIR" && timeout 60 token_miser explore --repo-root . 2>&1) || true
    append_evidence "[stage-3] token_miser corroboration output:"
    append_evidence "$out"
  else
    local msg="[stage-3] token_miser absent from PATH - optional corroboration skipped (D-04); verdict remains anchored to the raw endpoint (D-03)"
    echo "$msg"
    append_evidence "$msg"
  fi
}

# finalize_evidence_log(): appends the per-turn results table and the D-08
# pinned-combination block (build_info, chat_template excerpt, gate-1
# status from /props) to the evidence log, then re-affirms the URL/secret
# scrub - only a presence indicator is ever written, never the endpoint
# value or a bearer token.
finalize_evidence_log() {
  {
    echo "=== per-turn results ($(date -u +%FT%TZ)) ==="
    echo "prompt|turn|result|finish_reason|tool_calls_count"
    local r
    for r in "${MATRIX_RESULTS[@]:-}"; do
      [[ -n "$r" ]] && echo "$r"
    done

    echo "=== pinned combination (D-08) ==="
    if [[ -n "$PROPS_RAW" ]]; then
      echo "build_info: $(echo "$PROPS_RAW" | jq -r '.build_info // "unknown"')"
      echo "chat_template_tool_use: ${GATE1_STATUS:-UNKNOWN}"
      echo "--jinja: assumed on (server-side flag, not queryable via /props)"
      echo "chat_template excerpt (first 400 chars):"
      echo "$PROPS_RAW" | jq -r '.chat_template // "unknown"' | head -c 400
      echo
    else
      echo "PROPS_RAW unavailable - /props was not fetched this run"
    fi

    echo "=== verdict ==="
    echo "gate-1 chat_template_tool_use: ${GATE1_STATUS:-UNKNOWN}"
    echo "gate-2 matrix: ${MATRIX_PASS}/${MATRIX_TOTAL}"
    echo "VERDICT: ${VERDICT:-UNKNOWN}"
    echo "[scrub-check] this log never contains FASTCONTEXT_PROBE_URL's value or an Authorization header/API key"
  } >> "$FASTCONTEXT_EVIDENCE_LOG"

  echo "[finalize] evidence log updated at $FASTCONTEXT_EVIDENCE_LOG (URL/secrets never written)"
}

# self_test_verdict(): proves compute_verdict()'s refined-D-05 scoring
# offline - (a) an all-PASS matrix yields GO, (b) a single narration turn
# yields NO-GO (D-06 hard blocker), and (c) a chat_template_tool_use-ABSENT
# fixture with an all-PASS matrix still yields GO (the refined-D-05 guard:
# field absence alone must never block).
self_test_verdict() {
  local failures=0

  MATRIX_TOTAL=15
  MATRIX_PASS=15
  GATE1_STATUS="ABSENT"
  compute_verdict >/dev/null
  if [[ "$VERDICT" != "GO" ]]; then
    echo "[self-test:verdict] FAIL: all-PASS matrix + gate1 ABSENT expected GO, got $VERDICT" >&2
    failures=1
  fi

  MATRIX_TOTAL=15
  MATRIX_PASS=14
  GATE1_STATUS="ABSENT"
  compute_verdict >/dev/null
  if [[ "$VERDICT" != "NO-GO" ]]; then
    echo "[self-test:verdict] FAIL: one-narration-turn matrix expected NO-GO, got $VERDICT" >&2
    failures=1
  fi

  MATRIX_TOTAL=15
  MATRIX_PASS=15
  GATE1_STATUS="PRESENT"
  compute_verdict >/dev/null
  if [[ "$VERDICT" != "GO" ]]; then
    echo "[self-test:verdict] FAIL: all-PASS matrix + gate1 PRESENT expected GO, got $VERDICT" >&2
    failures=1
  fi

  if [[ "$failures" -eq 0 ]]; then
    echo "[self-test:verdict] OK: GO/NO-GO logic verified, including the refined-D-05 absent-field guard"
    return 0
  fi
  return 1
}

# self_test_matrix_assertion(): proves assert_tool_call_turn() discriminates
# a PASS fixture (finish_reason == "tool_calls" AND a non-empty tool_calls
# array) from a narration-FAIL fixture (finish_reason == "stop", content-only)
# - offline, no network call.
self_test_matrix_assertion() {
  local fixture_pass fixture_fail

  fixture_pass='{"choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"grep","arguments":"{\"regex\":\"selftest\"}"}}]}}]}'
  fixture_fail='{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"I will grep for selftest next..."}}]}'

  if ! assert_tool_call_turn "$fixture_pass"; then
    echo "[self-test:matrix] FAIL: PASS fixture was rejected by assert_tool_call_turn" >&2
    return 1
  fi

  if assert_tool_call_turn "$fixture_fail"; then
    echo "[self-test:matrix] FAIL: narration-FAIL fixture was incorrectly accepted by assert_tool_call_turn" >&2
    return 1
  fi

  echo "[self-test:matrix] OK: PASS fixture accepted, narration-FAIL fixture rejected"
}

# self_test_props(): exercises record_props_evidence() against a
# chat_template_tool_use-ABSENT fixture and a -PRESENT fixture, entirely
# offline (no curl, no FASTCONTEXT_PROBE_URL reachability required), and
# asserts the absent case is recorded as evidence rather than erroring.
self_test_props() {
  local tmp_log fixture_absent fixture_present out

  tmp_log=$(mktemp)

  fixture_absent='{"chat_template":"{% raw fixture, single unified template %}","chat_template_caps":{"tools":true},"build_info":"b0000-selftest"}'
  fixture_present='{"chat_template":"{% raw fixture, default variant %}","chat_template_tool_use":"{% raw fixture, tool_use variant %}","chat_template_caps":{"tools":true},"build_info":"b0000-selftest"}'

  out=$(record_props_evidence "$fixture_absent" "$tmp_log")
  if ! echo "$out" | grep -q "ABSENT"; then
    echo "[self-test:props] FAIL: absent-field fixture was not recorded as ABSENT" >&2
    rm -f "$tmp_log"
    return 1
  fi

  out=$(record_props_evidence "$fixture_present" "$tmp_log")
  if ! echo "$out" | grep -q "PRESENT"; then
    echo "[self-test:props] FAIL: present-field fixture was not recorded as PRESENT" >&2
    rm -f "$tmp_log"
    return 1
  fi

  rm -f "$tmp_log"
  echo "[self-test:props] OK: absent-field and present-field /props fixtures both recorded without error"
}

# run_self_test(): the offline self-test entry point. Task 1 covers only the
# /props recording path; Tasks 2-3 extend this with the tool-call-matrix
# assertion and verdict-scoring fixtures.
run_self_test() {
  local failures=0

  self_test_props || failures=1
  self_test_matrix_assertion || failures=1
  self_test_verdict || failures=1

  if [[ "$failures" -ne 0 ]]; then
    echo "[self-test] FAILED" >&2
    return 1
  fi
  echo "[self-test] PASSED"
}

main() {
  case "${1:-}" in
    --self-test)
      run_self_test
      ;;
    --props-only)
      validate_probe_url "$FASTCONTEXT_PROBE_URL"
      log_endpoint_presence
      inspect_props "$FASTCONTEXT_PROBE_URL"
      ;;
    --full)
      validate_probe_url "$FASTCONTEXT_PROBE_URL"
      log_endpoint_presence
      if ! inspect_props "$FASTCONTEXT_PROBE_URL"; then
        echo "[main:--full] FATAL: /props unreachable - server not up per D-07, recording as a no-go blocker" >&2
        append_evidence "[main:--full] FATAL: /props unreachable at run time; treated as a documented no-go blocker (D-08 - never a silent skip)"
        exit 1
      fi
      run_turn_matrix "$FASTCONTEXT_PROBE_URL" 3
      compute_verdict
      run_token_miser_corroboration
      finalize_evidence_log
      if [[ "$VERDICT" == "GO" ]]; then
        exit 0
      fi
      exit 1
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
