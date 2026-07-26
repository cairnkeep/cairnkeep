#!/usr/bin/env bash
# cairn doctor — post-bootstrap health check.
#
# Reports pass/warn/skip/fail for the pieces cairnkeep needs, reading only what
# is already configured in ./.ai/.env (or the current environment). Unconfigured
# optional dependencies are SKIPPED, never failed. The required memory server
# is checked with a real MCP initialize exchange. Exits non-zero if that probe
# fails or a configured dependency is unreachable.
set -uo pipefail

CAIRN_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
REPAIR_TRAJECTORY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repair) REPAIR_TRAJECTORY=1; shift ;;
    -h|--help) echo "Usage: cairn doctor [--repair]"; exit 0 ;;
    *) echo "Unknown doctor option: $1" >&2; echo "Usage: cairn doctor [--repair]" >&2; exit 2 ;;
  esac
done

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

embedding_works() {
  local payload
  payload=$(node -e 'process.stdout.write(JSON.stringify({ model: process.argv[1], input: ["cairnkeep health check"] }))' \
    "$CAIRN_MEMORY_EMBEDDING_MODEL") || return 1
  curl -fsS -m 10 -o /dev/null \
    -H "Authorization: Bearer $CAIRN_LLM_API_KEY" \
    -H "Content-Type: application/json" \
    --data "$payload" \
    "${CAIRN_MEMORY_EMBEDDING_URL%/}/embeddings" >/dev/null 2>&1
}

echo "cairn doctor"

# 1. Required memory server: prove that the shipped build and dependencies can
#    complete an MCP stdio handshake, rather than only checking for one file.
server="$CAIRN_ROOT/mcp-memory-server/dist/index.js"
probe="$CAIRN_ROOT/scripts/probe-memory-server.mjs"
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js not found (Node.js 22 or newer is required)"
elif ! node_major=$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null) ||
     [[ ! "$node_major" =~ ^[0-9]+$ ]]; then
  fail "could not determine the Node.js version (Node.js 22 or newer is required)"
elif [[ "$node_major" -lt 22 ]]; then
  fail "Node.js $(node --version 2>/dev/null || printf unknown) is unsupported (Node.js 22 or newer is required)"
elif [[ ! -f "$server" ]]; then
  fail "memory server not built — run: (cd \"$CAIRN_ROOT/mcp-memory-server\" && npm install && npm run build)"
elif node "$probe" "$server" >/dev/null 2>&1; then
  pass "bundled local memory server responds over MCP stdio"
else
  fail "memory server failed its MCP stdio probe — reinstall cairnkeep or rebuild mcp-memory-server"
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
  elif [[ -z "${CAIRN_LLM_API_KEY:-}" || -z "${CAIRN_MEMORY_EMBEDDING_MODEL:-}" ]]; then
    fail "embedding configuration incomplete (CAIRN_LLM_API_KEY and CAIRN_MEMORY_EMBEDDING_MODEL are required)"
  elif embedding_works; then
    pass "embedding endpoint accepted model ${CAIRN_MEMORY_EMBEDDING_MODEL} (${CAIRN_MEMORY_EMBEDDING_URL})"
  else
    fail "embedding request failed for model ${CAIRN_MEMORY_EMBEDDING_MODEL} (${CAIRN_MEMORY_EMBEDDING_URL})"
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

# 6. Optional backup dependency. Runtime memory and imports do not need it,
#    but exports use sqlite3's .backup command for a consistent WAL snapshot.
if command -v sqlite3 >/dev/null 2>&1; then
  pass "sqlite3 available (memory export enabled)"
else
  warn "sqlite3 not found — memory export unavailable (runtime and import unaffected)"
fi

# 7. Project-local trajectory store. Absence is healthy because capture is
#    opt-in. Existing stores must pass SQLite, schema and index checks. Repair
#    is explicit and only reconstructs metadata/indexes from valid full records.
trajectory_cli="$CAIRN_ROOT/mcp-memory-server/dist/trajectory-cli.js"
if [[ ! -f "$trajectory_cli" ]]; then
  fail "trajectory diagnostics unavailable — rebuild mcp-memory-server"
else
  trajectory_args=(doctor --json)
  [[ $REPAIR_TRAJECTORY -eq 1 ]] && trajectory_args+=(--repair)
  trajectory_json=$(node "$trajectory_cli" "${trajectory_args[@]}" 2>/dev/null)
  trajectory_status=$?
  trajectory_state=$(node -e '
try {
  const value = JSON.parse(process.argv[1])
  if (!value.exists) process.stdout.write("absent")
  else if (value.ok && value.repaired) process.stdout.write("repaired")
  else if (value.ok) process.stdout.write("ok")
  else process.stdout.write("broken")
} catch { process.stdout.write("invalid") }
' "$trajectory_json" 2>/dev/null)
  case "$trajectory_state" in
    absent) skip "trajectory store (not present — capture is opt-in)" ;;
    repaired) pass "trajectory store repaired (metadata/indexes rebuilt; full records preserved)" ;;
    ok) pass "trajectory store integrity, schema and indexes are valid" ;;
    *)
      if [[ $REPAIR_TRAJECTORY -eq 1 ]]; then
        fail "trajectory store could not be repaired safely; preserve .agentfs/trajectory.db and inspect it manually"
      else
        fail "trajectory store metadata/schema/index check failed — run: cairn doctor --repair"
      fi
      ;;
  esac
  [[ $trajectory_status -eq 0 || "$trajectory_state" == "broken" ]] || true
fi

echo
if [[ "$fails" -gt 0 ]]; then
  echo "cairn doctor: $fails configured dependency check(s) failed."
  exit 1
fi
echo "cairn doctor: OK (configured dependencies healthy)."
