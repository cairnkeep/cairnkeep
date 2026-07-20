#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

capture=$tmp/args
engine=$tmp/podman
repo=$tmp/repository
token=$tmp/token
env_file=$tmp/container.env
mkdir -p "$repo"
printf 'token\n' > "$token"
printf 'CAIRN_MEMORY_EMBEDDING_MODEL=example\n' > "$env_file"
chmod 600 "$token"

cat > "$engine" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" > "$CAIRN_CONTAINER_CAPTURE"
EOF
chmod 755 "$engine"

run_launcher() {
  CAIRN_CONTAINER_CAPTURE=$capture CONTAINER_ENGINE=$engine \
    "$ROOT/scripts/cairn-container" "$@"
}

has_arg() {
  grep -Fqx -- "$1" "$capture" || {
    echo "FAIL: missing container argument: $1" >&2
    exit 1
  }
}

lacks_arg() {
  if grep -Fqx -- "$1" "$capture"; then
    echo "FAIL: unexpected container argument: $1" >&2
    exit 1
  fi
}

run_launcher stdio --image example/server:1 --volume example-data
has_arg --userns=keep-id:uid=10001,gid=10001
has_arg --read-only
has_arg --cap-drop=all
has_arg example-data:/data:Z,U
has_arg example/server:1
has_arg stdio

run_launcher http --image example/server:1 --token-file "$token" --port 8123 \
  --allowed-hosts memory.example.com --env-file "$env_file"
has_arg --detach
has_arg 127.0.0.1:8123:7801
has_arg "$token:/run/secrets/http-token:ro,Z"
has_arg CAIRN_MEMORY_HTTP_ALLOWED_HOSTS=memory.example.com
has_arg CAIRN_MEMORY_HTTP_TOKEN_FILE=/run/secrets/http-token
has_arg "$env_file"

chmod 644 "$token"
if run_launcher http --token-file "$token" >"$tmp/out" 2>"$tmp/err"; then
  echo "FAIL: permissive token file was accepted" >&2
  exit 1
fi
grep -Fq "mode 400 or 600" "$tmp/err"
chmod 600 "$token"

run_launcher workspace --repo "$repo" --image example/workspace:1 \
  --workspace-volume example-workspace -- echo sandbox
has_arg "$repo:/source:ro,Z"
has_arg example-workspace:/workspace:Z,U
has_arg CAIRN_WORKSPACE_MODE=sandbox
lacks_arg "$repo:/workspace:rw,Z"
has_arg echo
has_arg sandbox

run_launcher workspace --repo "$repo" --mode shared --image example/workspace:1
has_arg "$repo:/workspace:rw,Z"
has_arg CAIRN_WORKSPACE_MODE=shared
lacks_arg "$repo:/source:ro,Z"
has_arg bash

echo "PASS: container launcher security and workspace contracts"
