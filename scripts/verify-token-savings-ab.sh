#!/usr/bin/env bash
set -euo pipefail

# CTX-07 A/B token-savings harness (Phase 9 Plan 01/02).
#
# Computes the native-exploration ("before") vs context_explore ("after")
# byte/char delta deterministically against a real repo (default: cairnkeep's
# own repo, D-02). The byte/char delta is the tokenizer-free ground-truth
# anchor; the additionally-reported token number is a provider-neutral
# chars/4 estimate (D-01a) - never a vendor tokenizer. No endpoint host/IP,
# model alias, or vendor tokenizer is ever committed or written to the
# evidence log; only loopback/placeholder defaults are committed and real
# values (if any) come from the ambient shell / gitignored .ai/.env
# (DEC-no-private-references).
#
# Stages:
#   --self-test  offline Nyquist backstop (byte-delta arithmetic, chars/4
#                estimate, D-03 gate both directions, renderCitations-shape
#                reproduction) - no network, no backend. (Task 3)
#   --native     offline "before" side - reads only the local git repo via a
#                fixed grep -> window recipe (D-02, reproducible/auditable).
#                (Task 2)
#   --explore    live "after" side (D-04, operator-gated) - shells out to the
#                token_miser explore binary and counts the renderCitations
#                citation-text shape, not the full Evidence JSON. Fails loud
#                (never a silent skip) when the binary is absent, not
#                executable, times out, or exits non-zero. (Task 2)
#   --full       runs both sides over the same query set, computes the
#                per-query byte/char/token-estimate delta, and applies the
#                D-03 net-savings gate to the aggregate byte totals. (Task 2)
#
# Mirrors scripts/verify-fastcontext-reliability.sh's committed, env-driven,
# loopback-only, staged-with-generous-timeouts harness discipline (Phase 6
# D-01/D-02, re-runnability).
#
# Native-exploration recipe (D-02 - reproducible/auditable baseline; each
# pattern is run via `git grep -nE` against tracked files only):
#
#   # | query                                                       | git grep -nE pattern | window | hit cap
#   1 | scope path containment implemented in this repo             | containment           | +/-25  | 12
#   2 | AgentFS project scope resolved in this repo                  | AgentFS.*scope        | +/-25  | 12
#   3 | git-provider abstraction configured in this repo             | git-provider          | +/-25  | 12
#   4 | OpenCode memory-wakeup plugin lives in this repo              | memory-wakeup         | +/-25  | 12
#   5 | asset-sync scripts render the infra-root placeholder value    | infraRoot             | +/-25  | 12

usage() {
  cat <<'EOF'
Usage: verify-token-savings-ab.sh --self-test
       verify-token-savings-ab.sh --native  [--repo <path>]
       verify-token-savings-ab.sh --explore [--repo <path>]
       verify-token-savings-ab.sh --full    [--repo <path>]
       verify-token-savings-ab.sh -h|--help

CTX-07 A/B token-savings harness: measures the byte/char delta between a
fixed native-exploration recipe ("before") and context_explore's compact
citation output ("after") against a real repo, and reports a provider-
neutral chars/4 token estimate alongside the mandatory byte-delta anchor.

Options:
  --self-test
      Offline: proves the byte/char-count arithmetic, the chars/4 token
      estimate, the D-03 net-savings gate (both PASS and loud-FAIL
      directions), and the explore-side renderCitations-shape reproduction
      against canned fixtures. No network, no backend, no live binary. This
      is the automated Nyquist backstop for the operator-gated live run.
  --native
      Offline: reads only the local git repo. For each query, runs a fixed
      `git grep` pattern, takes up to 12 hits, extracts a +/-25 line window
      around each hit, dedupes identical spans, and reports the total
      byte/char count per query. No backend required.
  --explore
      Live, operator-gated (D-04): shells out to the token_miser explore
      binary for each query and counts the bytes/chars of the exact
      renderCitations `path:start-end` citation text (never the full
      Evidence JSON). Fails loud and exits non-zero if the binary is
      absent/not executable, times out, or exits non-zero - never a silent
      skip.
  --full
      Runs --native then --explore over the same query set, computes the
      per-query byte/char/token-estimate delta and the median byte-savings
      percentage, and applies the D-03 net-savings gate to the aggregate
      byte totals. Exits 0 only when the gate passes.
  -h, --help
      Show this help text.

Environment:
  CAIRN_EXPLORE_BINARY      Absolute path to the token_miser binary (the
                            same env var context_explore reads). Defaults to
                            empty; falls back to `token_miser` on PATH.
                            Never echoed - only a presence indicator is
                            logged.
  CAIRN_EXPLORE_REPO_ROOT   Repo root to measure against. Defaults to this
                            repo (cairnkeep's own repo, D-02). Overridable
                            per-invocation via --repo. Never echoed - only a
                            presence indicator is logged.
  AB_EVIDENCE_LOG           Path to the evidence log. Defaults to a *.log
                            file under this phase's directory, already
                            excluded from commits by the repo .gitignore.

--repo <path>
      Override the repo root for this invocation (takes precedence over
      CAIRN_EXPLORE_REPO_ROOT). Useful for pointing at a fresh `cairn
      bootstrap` scratch project (D-02).
EOF
}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

CAIRN_EXPLORE_BINARY="${CAIRN_EXPLORE_BINARY:-}"
CAIRN_EXPLORE_REPO_ROOT="${CAIRN_EXPLORE_REPO_ROOT:-$ROOT_DIR}"
AB_EVIDENCE_LOG="${AB_EVIDENCE_LOG:-$ROOT_DIR/.planning/phases/09-live-verification-a-b-token-savings/09-AB.log}"

NATIVE_WINDOW=25
NATIVE_HIT_CAP=12

# 5 curated cairnkeep exploration prompts (same corpus Phase 6 probed),
# paired 1:1 with a fixed `git grep -nE` pattern per D-02 - see the recipe
# table in the header comment above for the reproducible/auditable baseline.
QUERIES=(
  "Where is scope path containment implemented in this repo?"
  "Where is the AgentFS project scope resolved in this repo?"
  "Where is the git-provider abstraction configured in this repo?"
  "Where does the OpenCode memory-wakeup plugin live in this repo?"
  "Where do the asset-sync scripts render the infra-root placeholder value?"
)
PATTERNS=(
  "containment"
  "AgentFS.*scope"
  "git-provider"
  "memory-wakeup"
  "infraRoot"
)

NATIVE_QUERY_BYTES=()
NATIVE_QUERY_CHARS=()
EXPLORE_QUERY_BYTES=()
EXPLORE_QUERY_CHARS=()

# log_repo_presence(override): logs only whether --repo/env overrode the
# default repo root - never the path value (mirrors log_endpoint_presence()
# in verify-fastcontext-reliability.sh, T-09-01).
log_repo_presence() {
  local override="${1:-}"
  local overridden="no"
  if [[ -n "$override" || "$CAIRN_EXPLORE_REPO_ROOT" != "$ROOT_DIR" ]]; then
    overridden="yes"
  fi
  echo "[env] repo root overridden from default (cairnkeep's own repo): $overridden" >&2
}

# append_evidence(line): appends one line to the evidence log, creating the
# parent directory if needed. Callers never pass an endpoint/model/secret
# value through this helper (T-09-02).
append_evidence() {
  local line="$1"
  mkdir -p "$(dirname "$AB_EVIDENCE_LOG")"
  echo "$line" >> "$AB_EVIDENCE_LOG"
}

# count_bytes / count_chars: read from stdin, print an integer with no
# surrounding whitespace.
count_bytes() {
  wc -c | tr -d '[:space:]'
}

count_chars() {
  wc -m | tr -d '[:space:]'
}

# est_tokens(chars): provider-neutral chars/4 estimate (N=4 - the
# industry-standard ~4-chars/token English approximation). Dependency-free
# and provider-neutral; the byte delta remains the mandatory anchor (D-01a).
# Do NOT vendor a real tokenizer here.
est_tokens() {
  local chars="$1"
  echo $(( chars / 4 ))
}

# net_savings_gate(native_bytes, explore_bytes): the D-03 milestone-close
# gate. PASS (0) only when native strictly exceeds explore; otherwise a loud
# FAIL (1) with a documented-finding line - a regression must never pass
# silently.
net_savings_gate() {
  local native_bytes="$1" explore_bytes="$2"
  local delta=$((native_bytes - explore_bytes))
  if [[ "$delta" -gt 0 ]]; then
    return 0
  fi
  echo "FATAL: net savings not positive (native=$native_bytes explore=$explore_bytes delta=$delta) - documented finding, not a silent pass (D-03)" >&2
  append_evidence "[gate] FATAL: net savings not positive (native=$native_bytes explore=$explore_bytes delta=$delta) - documented finding, not a silent pass (D-03)"
  return 1
}

# median(...): integer median of the given numbers (nearest-integer average
# for an even count).
median() {
  local -a sorted
  sorted=($(printf '%s\n' "$@" | sort -n))
  local n=${#sorted[@]}
  local mid=$((n / 2))
  if (( n % 2 == 1 )); then
    echo "${sorted[$mid]}"
  else
    echo $(( (sorted[mid-1] + sorted[mid]) / 2 ))
  fi
}

# resolve_explore_binary(): CAIRN_EXPLORE_BINARY (the real env var
# context_explore reads) or a `token_miser` on PATH. Prints the resolved
# path on success; callers must never echo it further (T-09-01).
resolve_explore_binary() {
  if [[ -n "$CAIRN_EXPLORE_BINARY" ]]; then
    echo "$CAIRN_EXPLORE_BINARY"
    return 0
  fi
  if command -v token_miser >/dev/null 2>&1; then
    command -v token_miser
    return 0
  fi
  return 1
}

# render_citation_text(evidence_json): reproduces mcp-memory-server's
# renderCitations() shape byte-for-byte (index.ts ~L604-615) - the compact
# `path:start-end` newline-joined text, or the exact empty-citations note
# with turns/tool_calls interpolated. Fails (non-zero) on malformed JSON.
render_citation_text() {
  local evidence_json="$1"
  jq -e -r '
    if (.citations | length) == 0 then
      "(no citations found; turns=" + (.stats.turns|tostring) + ", tool_calls=" + (.stats.tool_calls|tostring) + ")"
    else
      [.citations[] | "\(.path):\(.start_line)-\(.end_line)"] | join("\n")
    end
  ' <<< "$evidence_json"
}

# run_native(repo): the "before" side, fully offline (D-02). For each query,
# runs the fixed git-grep pattern, takes up to NATIVE_HIT_CAP hits, extracts
# a +/-NATIVE_WINDOW line window per hit, dedupes identical (path,window)
# spans, and totals the bytes/chars. Populates NATIVE_QUERY_BYTES/CHARS for
# --full.
run_native() {
  local repo="$1"
  local qi pattern hits path line _rest start end key
  local -A seen_spans
  local hit_count query_bytes query_chars span_bytes span_chars

  NATIVE_QUERY_BYTES=()
  NATIVE_QUERY_CHARS=()

  for qi in "${!QUERIES[@]}"; do
    pattern="${PATTERNS[$qi]}"
    seen_spans=()
    hit_count=0
    query_bytes=0
    query_chars=0

    hits=$(git -C "$repo" grep -nE "$pattern" -- . 2>/dev/null | head -n "$NATIVE_HIT_CAP" || true)

    while IFS=: read -r path line _rest; do
      [[ -z "$path" ]] && continue
      hit_count=$((hit_count + 1))
      start=$(( line - NATIVE_WINDOW ))
      [[ "$start" -lt 1 ]] && start=1
      end=$(( line + NATIVE_WINDOW ))
      key="${path}:${start}-${end}"
      [[ -n "${seen_spans[$key]:-}" ]] && continue
      seen_spans[$key]=1

      span_bytes=$(sed -n "${start},${end}p" "$repo/$path" | count_bytes)
      span_chars=$(sed -n "${start},${end}p" "$repo/$path" | count_chars)
      query_bytes=$((query_bytes + span_bytes))
      query_chars=$((query_chars + span_chars))
    done <<< "$hits"

    NATIVE_QUERY_BYTES[$qi]=$query_bytes
    NATIVE_QUERY_CHARS[$qi]=$query_chars
    echo "[native] query=$((qi + 1)) hits=$hit_count bytes=$query_bytes chars=$query_chars"
    append_evidence "[native] query=$((qi + 1)) hits=$hit_count bytes=$query_bytes chars=$query_chars"
  done
}

# run_explore(repo): the "after" side, live and operator-gated (D-04). Fails
# loud (non-zero, documented gap) on a missing/non-executable binary, a
# timeout, a non-zero exit, or malformed Evidence JSON - never a silent
# skip. Counts only the renderCitations citation-text shape (never the raw
# Evidence JSON). Populates EXPLORE_QUERY_BYTES/CHARS for --full.
run_explore() {
  local repo="$1"
  local binary qi query raw_out exit_code citation_text bytes chars n_citations

  if ! binary=$(resolve_explore_binary); then
    echo "FATAL: no exploration binary found (CAIRN_EXPLORE_BINARY unset and token_miser absent from PATH) - documented gap, not a silent skip (D-04)" >&2
    append_evidence "[explore] FATAL: no exploration binary found - documented gap (D-04)"
    return 1
  fi
  if [[ ! -x "$binary" ]] && ! command -v "$binary" >/dev/null 2>&1; then
    echo "FATAL: resolved exploration binary is not executable - documented gap (D-04)" >&2
    append_evidence "[explore] FATAL: resolved exploration binary is not executable - documented gap (D-04)"
    return 1
  fi

  EXPLORE_QUERY_BYTES=()
  EXPLORE_QUERY_CHARS=()

  for qi in "${!QUERIES[@]}"; do
    query="${QUERIES[$qi]}"
    exit_code=0
    raw_out=$(NO_COLOR=1 timeout 120 "$binary" explore --query "$query" --repo-root "$repo" 2>/dev/null) || exit_code=$?

    if [[ "$exit_code" -ne 0 ]]; then
      echo "FATAL: exploration binary failed or timed out for query $((qi + 1)) (exit=$exit_code) - documented gap, not a silent skip (D-04)" >&2
      append_evidence "[explore] FATAL: query=$((qi + 1)) exit=$exit_code - documented gap (D-04)"
      return 1
    fi

    if ! citation_text=$(render_citation_text "$raw_out"); then
      echo "FATAL: malformed Evidence JSON for query $((qi + 1)) - documented gap (D-04)" >&2
      append_evidence "[explore] FATAL: query=$((qi + 1)) malformed Evidence JSON - documented gap (D-04)"
      return 1
    fi

    bytes=$(printf '%s' "$citation_text" | count_bytes)
    chars=$(printf '%s' "$citation_text" | count_chars)
    n_citations=$(echo "$raw_out" | jq '.citations | length? // 0' 2>/dev/null || echo 0)

    EXPLORE_QUERY_BYTES[$qi]=$bytes
    EXPLORE_QUERY_CHARS[$qi]=$chars
    echo "[explore] query=$((qi + 1)) citations=$n_citations bytes=$bytes chars=$chars"
    append_evidence "[explore] query=$((qi + 1)) citations=$n_citations bytes=$bytes chars=$chars"
  done
}

# run_full(repo): runs both sides over the same query set, computes the
# per-query delta + median byte-savings percentage, and applies the D-03
# net-savings gate to the aggregate byte totals (D-03's "shows net savings >
# 0" is an aggregate/total check across the whole query set; the median
# per-query percentage is reported alongside it as an additional statistic,
# not the gate's input - the gate signature takes byte totals, not a
# percentage).
run_full() {
  local repo="$1"
  local qi native_b explore_b native_c explore_c delta_b delta_c est_delta pct
  local total_native=0 total_explore=0
  local -a pct_list=()

  run_native "$repo"
  if ! run_explore "$repo"; then
    return 1
  fi

  append_evidence "=== per-query delta ($(date -u +%FT%TZ)) ==="
  for qi in "${!QUERIES[@]}"; do
    native_b="${NATIVE_QUERY_BYTES[$qi]}"
    explore_b="${EXPLORE_QUERY_BYTES[$qi]}"
    native_c="${NATIVE_QUERY_CHARS[$qi]}"
    explore_c="${EXPLORE_QUERY_CHARS[$qi]}"
    delta_b=$((native_b - explore_b))
    delta_c=$((native_c - explore_c))
    est_delta=$(( $(est_tokens "$native_c") - $(est_tokens "$explore_c") ))

    if [[ "$native_b" -gt 0 ]]; then
      pct=$(( delta_b * 100 / native_b ))
    else
      pct=0
    fi
    pct_list+=("$pct")

    total_native=$((total_native + native_b))
    total_explore=$((total_explore + explore_b))

    local line="[delta] query=$((qi + 1)) native_bytes=$native_b explore_bytes=$explore_b byte_delta=$delta_b char_delta=$delta_c token_delta_est=$est_delta savings_pct=${pct}%"
    echo "$line"
    append_evidence "$line"
  done

  local median_pct
  median_pct=$(median "${pct_list[@]}")
  echo "[median] byte-savings percentage across queries: ${median_pct}%"
  append_evidence "[median] byte-savings percentage across queries: ${median_pct}%"

  local verdict_line
  if net_savings_gate "$total_native" "$total_explore"; then
    verdict_line="[verdict] PASS: net savings > 0 (total_native=$total_native total_explore=$total_explore) (D-03)"
    echo "$verdict_line"
    append_evidence "$verdict_line"
    append_evidence "[scrub-check] this log never contains an endpoint host/IP, model alias, or binary path"
    return 0
  fi
  append_evidence "[scrub-check] this log never contains an endpoint host/IP, model alias, or binary path"
  return 1
}

# --- self-test fixtures (Task 3): offline Nyquist backstop for the
# operator-gated live --explore/--full runs. No network, no backend, no
# live binary. ---

# self_test_delta(): asserts count_bytes/count_chars on a fixed string
# return the known length, and est_tokens on a known char count returns the
# expected chars/4 integer.
self_test_delta() {
  local sample="Hello, World! This is a fixed test string."
  local expected actual_bytes actual_chars est

  expected=${#sample}
  actual_bytes=$(printf '%s' "$sample" | count_bytes)
  actual_chars=$(printf '%s' "$sample" | count_chars)

  if [[ "$actual_bytes" -ne "$expected" ]]; then
    echo "[self-test:delta] FAIL: count_bytes expected $expected got $actual_bytes" >&2
    return 1
  fi
  if [[ "$actual_chars" -ne "$expected" ]]; then
    echo "[self-test:delta] FAIL: count_chars expected $expected got $actual_chars" >&2
    return 1
  fi

  est=$(est_tokens 100)
  if [[ "$est" -ne 25 ]]; then
    echo "[self-test:delta] FAIL: est_tokens(100) expected 25 got $est" >&2
    return 1
  fi

  echo "[self-test:delta] OK: count_bytes/count_chars/est_tokens verified"
}

# self_test_gate() (D-03, both directions): a native>explore fixture must
# PASS; native==explore and native<explore fixtures must FAIL AND emit the
# loud documented-finding line - proving a regression cannot pass silently.
self_test_gate() {
  local failures=0 out

  if ! net_savings_gate 1000 500 >/dev/null 2>&1; then
    echo "[self-test:gate] FAIL: expected PASS for native>explore" >&2
    failures=1
  fi

  out=$(net_savings_gate 500 500 2>&1) && {
    echo "[self-test:gate] FAIL: expected FAIL for native==explore" >&2
    failures=1
  }
  if ! echo "$out" | grep -qi "documented finding"; then
    echo "[self-test:gate] FAIL: native==explore case did not emit a documented-finding line" >&2
    failures=1
  fi

  out=$(net_savings_gate 500 600 2>&1) && {
    echo "[self-test:gate] FAIL: expected FAIL for native<explore" >&2
    failures=1
  }
  if ! echo "$out" | grep -qi "documented finding"; then
    echo "[self-test:gate] FAIL: native<explore case did not emit a documented-finding line" >&2
    failures=1
  fi

  if [[ "$failures" -eq 0 ]]; then
    echo "[self-test:gate] OK: PASS/FAIL directions verified with a documented-finding line on regression"
    return 0
  fi
  return 1
}

# self_test_render(): feeds canned Evidence JSON fixtures through the same
# render_citation_text() run_explore uses and asserts the output matches
# renderCitations() verbatim - both the populated-citations case and the
# exact empty-citations note string.
self_test_render() {
  local fixture expected actual empty_fixture empty_expected empty_actual

  fixture='{"citations":[{"path":"src/a.ts","start_line":10,"end_line":20},{"path":"src/b.ts","start_line":1,"end_line":5}],"stats":{"turns":2,"tool_calls":3}}'
  expected=$'src/a.ts:10-20\nsrc/b.ts:1-5'
  actual=$(render_citation_text "$fixture")
  if [[ "$actual" != "$expected" ]]; then
    echo "[self-test:render] FAIL: citation text mismatch (expected [$expected] got [$actual])" >&2
    return 1
  fi

  empty_fixture='{"citations":[],"stats":{"turns":4,"tool_calls":7}}'
  empty_expected="(no citations found; turns=4, tool_calls=7)"
  empty_actual=$(render_citation_text "$empty_fixture")
  if [[ "$empty_actual" != "$empty_expected" ]]; then
    echo "[self-test:render] FAIL: empty-citations text mismatch (expected [$empty_expected] got [$empty_actual])" >&2
    return 1
  fi

  echo "[self-test:render] OK: citation-text shape matches renderCitations verbatim"
}

# run_self_test(): runs all self-test concerns and returns non-zero if any
# failed - the automated Nyquist backstop for the operator-gated live run.
run_self_test() {
  local failures=0
  self_test_delta || failures=1
  self_test_gate || failures=1
  self_test_render || failures=1

  if [[ "$failures" -ne 0 ]]; then
    echo "[self-test] FAILED" >&2
    return 1
  fi
  echo "[self-test] PASSED"
}

main() {
  local stage="" repo_override=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --self-test|--native|--explore|--full)
        stage="$1"
        shift
        ;;
      --repo)
        repo_override="${2:-}"
        if [[ -z "$repo_override" ]]; then
          echo "FATAL: --repo requires a path argument" >&2
          exit 2
        fi
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        usage >&2
        exit 2
        ;;
    esac
  done

  if [[ -z "$stage" ]]; then
    usage >&2
    exit 2
  fi

  local repo="${repo_override:-$CAIRN_EXPLORE_REPO_ROOT}"
  log_repo_presence "$repo_override"

  case "$stage" in
    --self-test)
      run_self_test
      ;;
    --native)
      run_native "$repo"
      ;;
    --explore)
      run_explore "$repo"
      ;;
    --full)
      run_full "$repo"
      ;;
  esac
}

main "$@"
