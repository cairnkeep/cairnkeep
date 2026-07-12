#!/usr/bin/env bash
# cairn doctor — post-bootstrap health check.
#
# Reports pass/warn/skip/fail for the pieces cairnkeep needs, reading only what
# is already configured in ./.ai/.env (or the current environment). Unconfigured
# optional dependencies are SKIPPED, never failed. Exits non-zero only if a
# CONFIGURED dependency is unreachable, so a green run means "the things you
# turned on actually work".
set -uo pipefail

CAIRN_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# Load the project's .ai/.env if present (does not override already-set env).
if [[ -f "$PWD/.ai/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$PWD/.ai/.env"
  set +a
fi

fails=0
pass() { printf '  [PASS] %s\n' "$1"; }
warn() { printf '  [WARN] %s\n' "$1"; }
skip() { printf '  [SKIP] %s\n' "$1"; }
fail() { printf '  [FAIL] %s\n' "$1"; fails=$((fails + 1)); }

# curl returns 0 once the endpoint answers at all (any HTTP status counts as
# reachable); a connect/timeout failure returns non-zero.
reachable() { curl -sS -m 5 -o /dev/null "$1" >/dev/null 2>&1; }

echo "cairn doctor"

# 1. Memory server built (local prerequisite; actionable warning, not a failure).
if [[ -f "$CAIRN_ROOT/mcp-memory-server/dist/index.js" ]]; then
  pass "memory server built (mcp-memory-server/dist/index.js)"
else
  warn "memory server not built — run: (cd \"$CAIRN_ROOT/mcp-memory-server\" && npm install && npm run build)"
fi

# 2. LLM extraction endpoint (optional; unset → substring-only memory search).
if [[ -n "${CAIRN_LLM_API_URL:-}" ]]; then
  if ! command -v curl >/dev/null 2>&1; then
    skip "LLM endpoint: curl not installed, cannot probe ${CAIRN_LLM_API_URL}"
  elif reachable "$CAIRN_LLM_API_URL"; then
    pass "LLM endpoint reachable (${CAIRN_LLM_API_URL})"
  else
    fail "LLM endpoint unreachable (${CAIRN_LLM_API_URL})"
  fi
else
  skip "LLM endpoint (CAIRN_LLM_API_URL unset — memory search degrades to substring)"
fi

# 3. Embedding endpoint (optional).
if [[ -n "${CAIRN_MEMORY_EMBEDDING_URL:-}" ]]; then
  if ! command -v curl >/dev/null 2>&1; then
    skip "embedding endpoint: curl not installed, cannot probe ${CAIRN_MEMORY_EMBEDDING_URL}"
  elif reachable "$CAIRN_MEMORY_EMBEDDING_URL"; then
    pass "embedding endpoint reachable (${CAIRN_MEMORY_EMBEDDING_URL})"
  else
    fail "embedding endpoint unreachable (${CAIRN_MEMORY_EMBEDDING_URL})"
  fi
else
  skip "embedding endpoint (CAIRN_MEMORY_EMBEDDING_URL unset)"
fi

# 4. Git provider (collaboration commands). Report configuration only — auth is
#    provider- and host-specific and lives in the wrapper, not the core.
case "${CAIRN_GIT_PROVIDER:-}" in
  "" | none) skip "git provider (CAIRN_GIT_PROVIDER unset/none — collaboration commands off)" ;;
  github | gitlab | codeberg | forgejo) pass "git provider configured: ${CAIRN_GIT_PROVIDER}" ;;
  *) warn "git provider '${CAIRN_GIT_PROVIDER}' is not one of github|gitlab|codeberg|forgejo|none" ;;
esac

# 5. Memory store location (created on first write; report + writability).
store_dir="${CAIRN_AGENTFS_BASE_DIR:-$HOME/.cairnkeep}"
store_dir="${store_dir/#\~/$HOME}"
if [[ -d "$store_dir" ]]; then
  if [[ -w "$store_dir" ]]; then pass "memory store: $store_dir (exists, writable)"
  else fail "memory store not writable: $store_dir"; fi
else
  parent=$(dirname "$store_dir")
  if [[ -w "$parent" ]]; then pass "memory store: $store_dir (will be created on first write)"
  else fail "memory store parent not writable: $parent"; fi
fi

echo
if [[ "$fails" -gt 0 ]]; then
  echo "cairn doctor: $fails configured dependency check(s) failed."
  exit 1
fi
echo "cairn doctor: OK (configured dependencies healthy)."
