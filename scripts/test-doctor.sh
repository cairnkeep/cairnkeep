#!/usr/bin/env bash
# Smoke test for `cairn doctor`: unconfigured deps SKIP (exit 0); a configured
# but unreachable endpoint FAILs (exit non-zero).
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

doctor="$ROOT/scripts/doctor.sh"
# Clean the inherited env so the test controls what is "configured".
unset CAIRN_LLM_API_URL CAIRN_MEMORY_EMBEDDING_URL CAIRN_GIT_PROVIDER CAIRN_AGENTFS_BASE_DIR

# 1. Nothing configured → only SKIP/PASS/WARN, exit 0.
proj="$tmp/clean"; mkdir -p "$proj"
( cd "$proj" && "$doctor" ) >"$tmp/out1" 2>&1 || fail "doctor exited non-zero with nothing configured:\n$(cat "$tmp/out1")"
grep -q "\[SKIP\]" "$tmp/out1" || fail "expected SKIP lines when nothing is configured"

# 2. An unsupported runtime is diagnosed before the server probe.
mkdir -p "$tmp/old-node"
cat > "$tmp/old-node/node" <<'EOF'
#!/usr/bin/env bash
case "${1:-}" in
  -p) echo 20 ;;
  --version) echo v20.19.0 ;;
  *) exit 1 ;;
esac
EOF
chmod 755 "$tmp/old-node/node"
if ( cd "$proj" && PATH="$tmp/old-node:$PATH" "$doctor" ) >"$tmp/out-old-node" 2>&1; then
  fail "doctor should exit non-zero for an unsupported Node.js runtime:\n$(cat "$tmp/out-old-node")"
fi
grep -q "Node.js v20.19.0 is unsupported" "$tmp/out-old-node" ||
  fail "expected a clear unsupported-Node.js diagnostic"

# 3. A configured but unreachable endpoint → FAIL + non-zero exit.
if command -v curl >/dev/null 2>&1; then
  proj2="$tmp/broken"; mkdir -p "$proj2/.ai"
  echo 'CAIRN_LLM_API_URL=http://127.0.0.1:1' > "$proj2/.ai/.env"
  if ( cd "$proj2" && "$doctor" ) >"$tmp/out2" 2>&1; then
    fail "doctor should exit non-zero for an unreachable configured endpoint:\n$(cat "$tmp/out2")"
  fi
  grep -q "\[FAIL\] LLM endpoint unreachable" "$tmp/out2" || fail "expected a FAIL line for the unreachable endpoint"
else
  echo "  (curl absent — skipped the unreachable-endpoint case)"
fi

echo "PASS: cairn doctor (skip unconfigured, fail configured-unreachable)"
