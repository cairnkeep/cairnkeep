#!/usr/bin/env bash
set -euo pipefail

# No-private-references guard (SC-03; DEC-no-private-references,
# DEC-no-ai-authorship, DEC-commit-scanning -- PROJECT.md Constraints).
#
# Three stages, every one fail-loud (non-zero exit on ANY hit, never a
# silent pass):
#   1. Generic denylist (committed, always runs) -- git grep the tracked
#      tree for AI-authorship attribution markers (D-06).
#   2. Specific denylist (env-gated, fail-closed per D-06) -- literal
#      private terms (employer name, private repo names) from an
#      uncommitted, operator-maintained file referenced by
#      CAIRN_GUARD_DENYLIST. Fixed-string match (git grep -F), per Open
#      Question #2 in 11-RESEARCH.md.
#   3. Commit-message scan (D-07) -- `git log --format=%B` never passes
#      through `git grep` (which only sees tracked file content), so commit
#      bodies are scanned separately against Stage 1's generic pattern.
#
# Stage 1's generic pattern deliberately targets AI-authorship ATTRIBUTION
# (commit trailers, "generated with/by" boilerplate, the anthropic.com
# email domain) rather than a bare "claude code"/"anthropic" substring --
# this project legitimately names "Claude Code" throughout as a supported
# harness (PROJECT.md, docs/operating.md), so a bare-substring match would
# flag the project's own identity, not a real violation.
#
# Self-excludes this script and the phase-11 detector-documentation files
# that quote the patterns (11-RESEARCH.md, 11-PATTERNS.md) from Stage 1
# ONLY -- they document the detector, they are not violations. Stage 2's
# specific-literal scan still covers those files (they contain no employer/
# private-repo literals).

usage() {
  cat <<'EOF'
Usage: verify-no-private-references.sh
       verify-no-private-references.sh -h|--help

Scans the tracked tree + full commit-message log for AI-authorship
attribution markers (Stage 1 + Stage 3), and, if CAIRN_GUARD_DENYLIST is
set, a specific private-term list (Stage 2). Exits non-zero on ANY hit, or
on a fail-closed misconfiguration (D-06). Runs all three stages and reports
every hit before exiting, so a single run surfaces the full finding set.

Environment:
  CAIRN_GUARD_DENYLIST   Path to an uncommitted, operator-maintained file:
                          one literal private/vendor term per line
                          (fixed-string match, not regex). Never committed
                          -- kept outside the repo or gitignored. If set,
                          the file must be readable or the script fails
                          closed. Unset -> generic-only scan (Stages 1+3).
                          Only presence ("set: yes/no") is ever logged --
                          never the path or the file's contents (D-06).
EOF
}

SELF_PATH="scripts/verify-no-private-references.sh"
DETECTOR_DOCS=(
  ".planning/phases/11-self-consistency-public-positioning/11-RESEARCH.md"
  ".planning/phases/11-self-consistency-public-positioning/11-PATTERNS.md"
)

# Generic, committed AI-authorship pattern (D-06 Stage 1 + Stage 3).
GENERIC_PATTERN='(co-authored-by:[[:space:]]*claude|noreply@anthropic\.com|generated (with|by) claude|written by (an|a)? ?ai\b)'

log_denylist_presence() {
  local is_set="no"
  [[ -n "${CAIRN_GUARD_DENYLIST:-}" ]] && is_set="yes"
  echo "[env] CAIRN_GUARD_DENYLIST set: $is_set" >&2
}

# stage1_generic_tree_scan(): git grep (tracked tree only, includes
# .planning/) for the generic pattern, excluding this script and the
# phase-11 detector docs that quote it.
stage1_generic_tree_scan() {
  local pathspecs=(. ":!${SELF_PATH}")
  local doc
  for doc in "${DETECTOR_DOCS[@]}"; do
    pathspecs+=(":!${doc}")
  done

  if git grep -niE "$GENERIC_PATTERN" -- "${pathspecs[@]}"; then
    echo "FATAL: Stage 1 -- generic AI-authorship pattern found in tracked tree" >&2
    return 1
  fi
  return 0
}

# stage2_specific_denylist_scan(): fail-closed env-gated specific-term scan
# (D-06). Unset -> no-op success. Set-but-unreadable -> fail closed.
stage2_specific_denylist_scan() {
  if [[ -z "${CAIRN_GUARD_DENYLIST:-}" ]]; then
    return 0
  fi
  if [[ ! -r "$CAIRN_GUARD_DENYLIST" ]]; then
    echo "FATAL: Stage 2 -- CAIRN_GUARD_DENYLIST is set but not readable (fail-closed, D-06)" >&2
    return 1
  fi
  if git grep -niF -f "$CAIRN_GUARD_DENYLIST" -- .; then
    echo "FATAL: Stage 2 -- a term from CAIRN_GUARD_DENYLIST was found in the tracked tree" >&2
    return 1
  fi
  return 0
}

# stage3_commit_message_scan(): git grep never sees commit bodies -- scan
# the full `git log --format=%B` history separately (D-07).
stage3_commit_message_scan() {
  if git log --format=%B | grep -niE "$GENERIC_PATTERN"; then
    echo "FATAL: Stage 3 -- generic AI-authorship pattern found in commit-message history" >&2
    return 1
  fi
  return 0
}

main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
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

  log_denylist_presence

  local failed=0
  stage1_generic_tree_scan || failed=1
  stage2_specific_denylist_scan || failed=1
  stage3_commit_message_scan || failed=1

  if [[ "$failed" -ne 0 ]]; then
    echo "FATAL: no-private-references guard found one or more violations (see above)" >&2
    exit 1
  fi

  echo "[guard] OK: no private/vendor/AI-authorship references found in tracked tree or commit-message history"
}

main "$@"
