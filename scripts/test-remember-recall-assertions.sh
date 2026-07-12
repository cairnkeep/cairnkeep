#!/usr/bin/env bash
set -euo pipefail

# Offline fixture test for scripts/lib/assert-tool-event.mjs (D-08/D-09,
# T-13-01). Proves the NDJSON tool-event matcher distinguishes a genuine
# tool_use event from a narrated-but-unexecuted text-event mention, with
# and without canary linkage, and that it never crashes on malformed/empty
# input. Fixtures are the verbatim live-captured NDJSON lines from
# 13-RESEARCH.md's Code Examples section, embedded inline (single-quoted,
# no shell interpolation) so this test is self-contained and runs offline.

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MATCHER="$ROOT_DIR/scripts/lib/assert-tool-event.mjs"

# Verbatim live capture, 13-RESEARCH.md Pattern 2:
# `opencode run "remember that the test canary value is XYZ123" --format json --auto`
WRITE_EVENT='{"type":"tool_use","timestamp":1783468394936,"sessionID":"ses_0c1000285ffeB3LgTc2lL6lpX7","part":{"type":"tool","tool":"cairn-memory_memory_write","callID":"call_00_HwYj7yo6GPefkOwdragE3435","state":{"status":"completed","input":{"scope":"work","key":"test-canary","value":"The test canary value is XYZ123."},"output":"{\n  \"ok\": true,\n  \"scope\": \"work\",\n  \"key\": \"test-canary\",\n  \"collisions\": []\n}","metadata":{"truncated":false},"title":"","time":{"start":1783468394919,"end":1783468394935}},"id":"prt_f3f000825001ZCly3HCQBHAmWC","sessionID":"ses_0c1000285ffeB3LgTc2lL6lpX7","messageID":"msg_f3efffdec001R3DoelYr4jBzyz"}}'

# Verbatim live capture, 13-RESEARCH.md Pattern 2:
# `opencode run "search your memory for the test canary value..." --format json --auto`
# Its part.state.output (a JSON-encoded string) contains the literal substring
# "XYZ123" — the D-09 canary-linkage fixture.
SEARCH_EVENT='{"type":"tool_use","timestamp":1783468410962,"sessionID":"ses_0c0ffc42fffean1LIPrMRiv0Gj","part":{"type":"tool","tool":"cairn-memory_memory_search","callID":"call_00_ojFUlRfeg7RdkhxkZudF4674","state":{"status":"completed","input":{"scope":"work","query":"test canary value"},"output":"{\n  \"mode\": \"substring\",\n  \"count\": 1,\n  \"results\": [\n    {\n      \"scope\": \"work\",\n      \"key\": \"test-canary\",\n      \"value\": \"The test canary value is XYZ123.\",\n      \"score\": 1\n    }\n  ]\n}","metadata":{"truncated":false},"title":"","time":{"start":1783468410951,"end":1783468410961}},"id":"prt_f3f004761001QGw1GlWtp0nfgx","sessionID":"ses_0c0ffc42fffean1LIPrMRiv0Gj","messageID":"msg_f3f003c45001tYJ94eWqStsR7W"}}'

# Synthesized (not live-captured): a "text" event whose part.text merely
# narrates the write tool name in prose. Top-level type is "text", not
# "tool_use" — must NOT match (the D-08 narrated-but-unexecuted case).
TEXT_NARRATION_EVENT='{"type":"text","timestamp":1783468394000,"sessionID":"ses_test0000000000000000000","part":{"id":"prt_test0000000000000000001","messageID":"msg_test0000000000000000001","sessionID":"ses_test0000000000000000000","type":"text","text":"I will now call cairn-memory_memory_write to remember this fact.","time":{"start":1,"end":2}}}'

failures=0

# check(name, expected_exit, input, env_assignments...)
check() {
  local name="$1" expected_exit="$2" input="$3"
  shift 3
  local actual_exit=0
  printf '%s' "$input" | env "$@" node "$MATCHER" >/dev/null 2>&1 || actual_exit=$?
  if [[ "$actual_exit" -eq "$expected_exit" ]]; then
    echo "[test-remember-recall-assertions] PASS: $name"
  else
    echo "[test-remember-recall-assertions] FAIL: $name (expected exit $expected_exit, got $actual_exit)" >&2
    failures=1
  fi
}

check "genuine write tool_use event, no canary required -> exit 0" \
  0 "$WRITE_EVENT" \
  TOOL_EVENT_REGEX='cairn-memory_memory_(write|supersede)'

check "genuine search tool_use event with matching canary -> exit 0" \
  0 "$SEARCH_EVENT" \
  TOOL_EVENT_REGEX='cairn-memory_memory_(search|read)' TOOL_EVENT_CANARY='XYZ123'

check "genuine search tool_use event with a canary absent from output -> exit 1" \
  1 "$SEARCH_EVENT" \
  TOOL_EVENT_REGEX='cairn-memory_memory_(search|read)' TOOL_EVENT_CANARY='CANARY-NOT-PRESENT-ANYWHERE'

check "narrated-only text event (D-08 false-positive class) -> exit 1" \
  1 "$TEXT_NARRATION_EVENT" \
  TOOL_EVENT_REGEX='cairn-memory_memory_(write|supersede)'

check "empty stdin -> exit 1" \
  1 "" \
  TOOL_EVENT_REGEX='cairn-memory_memory_(write|supersede)'

if [[ "$failures" -ne 0 ]]; then
  echo "[test-remember-recall-assertions] FAIL: one or more fixture cases failed" >&2
  exit 1
fi
echo "[test-remember-recall-assertions] PASS: all 5 fixture cases passed"
