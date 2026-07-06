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

# run_native/run_explore/run_full: stubbed here so main()'s dispatch and the
# --help/config wiring can be verified independently; Task 2 fills in the
# real measurement logic.
run_native() {
  echo "FATAL: run_native not yet implemented (Task 2)" >&2
  return 1
}

run_explore() {
  echo "FATAL: run_explore not yet implemented (Task 2)" >&2
  return 1
}

run_full() {
  echo "FATAL: run_full not yet implemented (Task 2)" >&2
  return 1
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
      echo "FATAL: --self-test not yet implemented (Task 3)" >&2
      exit 1
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
