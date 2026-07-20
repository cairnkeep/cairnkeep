#!/usr/bin/env bash
set -euo pipefail

if [[ "${CAIRN_TEST_CONTAINERS:-0}" != 1 ]]; then
  echo "SKIP: container integration (set CAIRN_TEST_CONTAINERS=1 to run)"
  exit 0
fi

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENGINE=${CONTAINER_ENGINE:-}
if [[ -z "$ENGINE" ]]; then
  if command -v podman >/dev/null 2>&1; then ENGINE=podman
  elif command -v docker >/dev/null 2>&1; then ENGINE=docker
  else echo "FAIL: Podman or Docker is required" >&2; exit 1
  fi
fi
command -v "$ENGINE" >/dev/null 2>&1 || { echo "FAIL: container engine not found: $ENGINE" >&2; exit 1; }

suffix=$$
server_image="localhost/cairnkeep-test-server:$suffix"
workspace_image="localhost/cairnkeep-test-workspace:$suffix"
volume="cairnkeep-test-data-$suffix"
sandbox_volume="cairnkeep-test-workspace-$suffix"
name="cairnkeep-test-$suffix"
tmp=$(mktemp -d)

cleanup() {
  "$ENGINE" rm -f "$name" >/dev/null 2>&1 || true
  "$ENGINE" volume rm -f "$volume" "$sandbox_volume" >/dev/null 2>&1 || true
  "$ENGINE" image rm -f "$server_image" "$workspace_image" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

cd "$ROOT"
"$ENGINE" build --target server -t "$server_image" -f Containerfile .
"$ENGINE" build --target workspace -t "$workspace_image" -f Containerfile .

image_user=$("$ENGINE" image inspect --format '{{.Config.User}}' "$server_image")
[[ "$image_user" == "10001:10001" ]] || {
  echo "FAIL: server image must run as 10001:10001, got $image_user" >&2
  exit 1
}

"$ENGINE" volume create "$volume" >/dev/null
node scripts/probe-memory-server.mjs --command \
  "$ENGINE" run --rm -i --volume "$volume:/data" "$server_image" stdio

if "$ENGINE" run --rm "$server_image" http >/dev/null 2>&1; then
  echo "FAIL: HTTP mode started without a token" >&2
  exit 1
fi

token=container-smoke-token
printf '%s' "$token" > "$tmp/http-token"
# Docker bind mounts preserve the host UID; world-read is acceptable for this
# non-secret fixture. The real Podman launcher requires mode 400 or 600.
chmod 644 "$tmp/http-token"
port=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')

start_http() {
  "$ENGINE" run --detach --name "$name" \
    --read-only --cap-drop=all --security-opt=no-new-privileges \
    --tmpfs /tmp:rw,noexec,nosuid,size=64m,mode=1777 \
    --publish "127.0.0.1:${port}:7801" \
    --volume "$volume:/data" \
    --volume "$tmp/http-token:/run/secrets/http-token:ro" \
    --env MCP_HTTP_HOST=0.0.0.0 \
    --env MCP_HTTP_PORT=7801 \
    --env "CAIRN_MEMORY_HTTP_ALLOWED_HOSTS=127.0.0.1:${port}" \
    --env CAIRN_MEMORY_HTTP_TOKEN_FILE=/run/secrets/http-token \
    "$server_image" http >/dev/null

  for _ in $(seq 1 50); do
    if node scripts/probe-container-memory.mjs read "http://127.0.0.1:${port}/mcp" "$token" \
      >"$tmp/read.out" 2>"$tmp/read.err"; then
      return 0
    fi
    if ! "$ENGINE" inspect "$name" >/dev/null 2>&1; then break; fi
    sleep 0.2
  done
  return 1
}

# First boot: wait for MCP, then write the canary.
"$ENGINE" run --detach --name "$name" \
  --read-only --cap-drop=all --security-opt=no-new-privileges \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m,mode=1777 \
  --publish "127.0.0.1:${port}:7801" \
  --volume "$volume:/data" \
  --volume "$tmp/http-token:/run/secrets/http-token:ro" \
  --env MCP_HTTP_HOST=0.0.0.0 \
  --env MCP_HTTP_PORT=7801 \
  --env "CAIRN_MEMORY_HTTP_ALLOWED_HOSTS=127.0.0.1:${port}" \
  --env CAIRN_MEMORY_HTTP_TOKEN_FILE=/run/secrets/http-token \
  "$server_image" http >/dev/null
written=0
for _ in $(seq 1 50); do
  if node scripts/probe-container-memory.mjs write "http://127.0.0.1:${port}/mcp" "$token" \
    >"$tmp/write.out" 2>"$tmp/write.err"; then
    written=1
    break
  fi
  sleep 0.2
done
[[ "$written" == 1 ]] || {
  cat "$tmp/write.err" >&2
  echo "FAIL: container HTTP server did not become ready" >&2
  exit 1
}
cat "$tmp/write.out"
"$ENGINE" exec "$name" node /usr/local/lib/cairnkeep/container-healthcheck.mjs
"$ENGINE" rm -f "$name" >/dev/null

# Replacement boot with the same volume must recover the canary.
start_http || {
  cat "$tmp/read.err" >&2
  echo "FAIL: persisted memory was not readable after replacement" >&2
  exit 1
}
cat "$tmp/read.out"
"$ENGINE" rm -f "$name" >/dev/null

mkdir -p "$tmp/repo"
printf 'source\n' > "$tmp/repo/source.txt"

# Shared mode deliberately writes through to the selected host repository.
if [[ "$ENGINE" == podman ]]; then
  "$ENGINE" run --rm --userns=keep-id:uid=10001,gid=10001 \
    --volume "$tmp/repo:/workspace:Z" \
    --env CAIRN_WORKSPACE_MODE=shared \
    "$workspace_image" sh -c 'printf shared > shared.txt'
else
  chmod 755 "$tmp" "$tmp/repo"
  chmod 666 "$tmp/repo/source.txt"
  "$ENGINE" run --rm \
    --volume "$tmp/repo:/workspace" \
    --env CAIRN_WORKSPACE_MODE=shared \
    "$workspace_image" sh -c 'printf shared > shared.txt'
fi
[[ $(cat "$tmp/repo/shared.txt") == shared ]] || {
  echo "FAIL: shared workspace did not write through" >&2
  exit 1
}

# Prepare a writable named volume for the image's unprivileged runtime user.
"$ENGINE" volume create "$sandbox_volume" >/dev/null
if [[ "$ENGINE" == podman ]]; then
  "$ENGINE" run --rm --userns=keep-id:uid=10001,gid=10001 \
    --volume "$tmp/repo:/source:ro,Z" \
    --volume "$sandbox_volume:/workspace:Z,U" \
    --env CAIRN_WORKSPACE_MODE=sandbox \
    "$workspace_image" sh -c 'printf sandbox > sandbox.txt'
else
  "$ENGINE" run --rm --user root --entrypoint sh \
    --volume "$sandbox_volume:/workspace" "$workspace_image" \
    -c 'chown 10001:10001 /workspace'
  "$ENGINE" run --rm \
    --volume "$tmp/repo:/source:ro" \
    --volume "$sandbox_volume:/workspace" \
    --env CAIRN_WORKSPACE_MODE=sandbox \
    "$workspace_image" sh -c 'printf sandbox > sandbox.txt'
fi
[[ ! -e "$tmp/repo/sandbox.txt" ]] || {
  echo "FAIL: sandbox mode modified the host repository" >&2
  exit 1
}
if [[ "$ENGINE" == podman ]]; then
  "$ENGINE" run --rm --userns=keep-id:uid=10001,gid=10001 \
    --volume "$tmp/repo:/source:ro,Z" \
    --volume "$sandbox_volume:/workspace:Z,U" \
    --env CAIRN_WORKSPACE_MODE=sandbox \
    "$workspace_image" sh -c 'test "$(cat sandbox.txt)" = sandbox'
else
  "$ENGINE" run --rm \
    --volume "$tmp/repo:/source:ro" \
    --volume "$sandbox_volume:/workspace" \
    --env CAIRN_WORKSPACE_MODE=sandbox \
    "$workspace_image" sh -c 'test "$(cat sandbox.txt)" = sandbox'
fi

echo "PASS: container stdio, guarded HTTP, persistence, shared, and sandbox modes"
