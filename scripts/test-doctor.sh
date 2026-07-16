#!/usr/bin/env bash
# Smoke test for `cairn doctor`: unconfigured deps SKIP (exit 0); a configured
# but unreachable endpoint FAILs (exit non-zero).
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
server_pid=""
cleanup() {
  [[ -n "$server_pid" ]] && kill "$server_pid" 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT
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

# 4. The embedding check performs a real authenticated model request.
if command -v curl >/dev/null 2>&1; then
  cat > "$tmp/embedding-server.mjs" <<'EOF'
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const server = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
    const valid = request.url === "/v1/embeddings"
      && request.headers.authorization === "Bearer test-key"
      && body.model === "test-embedding";
    response.writeHead(valid ? 200 : 404, { "Content-Type": "application/json" });
    response.end(JSON.stringify(valid
      ? { data: [{ index: 0, embedding: [1, 0] }] }
      : { error: "invalid request" }));
  });
});
server.listen(0, "127.0.0.1", () => {
  writeFileSync(process.argv[2], String(server.address().port));
});
EOF
  node "$tmp/embedding-server.mjs" "$tmp/embedding-port" &
  server_pid=$!
  for _ in $(seq 1 50); do [[ -s "$tmp/embedding-port" ]] && break; sleep 0.1; done
  [[ -s "$tmp/embedding-port" ]] || fail "embedding test server did not start"
  port=$(cat "$tmp/embedding-port")

  proj3="$tmp/embedding-ok"; mkdir -p "$proj3/.ai"
  cat > "$proj3/.ai/.env" <<EOF
CAIRN_MEMORY_EMBEDDING_URL=http://127.0.0.1:$port/v1
CAIRN_MEMORY_EMBEDDING_MODEL=test-embedding
CAIRN_LLM_API_KEY=test-key
EOF
  ( cd "$proj3" && "$doctor" ) >"$tmp/out3" 2>&1 ||
    fail "doctor rejected a working embedding endpoint:\n$(cat "$tmp/out3")"
  grep -q "\[PASS\] embedding endpoint accepted model test-embedding" "$tmp/out3" ||
    fail "expected a functional embedding PASS line"

  proj4="$tmp/embedding-wrong-model"; mkdir -p "$proj4/.ai"
  cat > "$proj4/.ai/.env" <<EOF
CAIRN_MEMORY_EMBEDDING_URL=http://127.0.0.1:$port/v1
CAIRN_MEMORY_EMBEDDING_MODEL=missing-model
CAIRN_LLM_API_KEY=test-key
EOF
  if ( cd "$proj4" && "$doctor" ) >"$tmp/out4" 2>&1; then
    fail "doctor should reject a missing embedding model:\n$(cat "$tmp/out4")"
  fi
  grep -q "\[FAIL\] embedding request failed for model missing-model" "$tmp/out4" ||
    fail "expected a functional embedding FAIL line"
fi

echo "PASS: cairn doctor (skip unconfigured, fail unreachable, probe embeddings)"
