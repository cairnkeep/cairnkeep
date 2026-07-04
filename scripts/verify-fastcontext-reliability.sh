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
      # Chat-completion matrix + verdict scoring wired in Tasks 2-3; this
      # stage currently runs gate #1 only.
      validate_probe_url "$FASTCONTEXT_PROBE_URL"
      log_endpoint_presence
      inspect_props "$FASTCONTEXT_PROBE_URL"
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
