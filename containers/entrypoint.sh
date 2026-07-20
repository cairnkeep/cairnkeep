#!/bin/sh
set -eu

load_secret() {
  name=$1
  eval "file=\${${name}_FILE:-}"
  eval "value=\${${name}:-}"

  if [ -n "$file" ] && [ -n "$value" ]; then
    echo "cairnkeep: set either $name or ${name}_FILE, not both" >&2
    exit 64
  fi
  if [ -n "$file" ]; then
    if [ ! -f "$file" ] || [ ! -r "$file" ]; then
      echo "cairnkeep: secret file for $name is not readable" >&2
      exit 66
    fi
    value=$(cat "$file")
    export "$name=$value"
  fi
}

load_secret CAIRN_MEMORY_HTTP_TOKEN
load_secret CAIRN_LLM_API_KEY
load_secret ANYTHINGLLM_API_KEY

mode=${1:-stdio}
shift || true

case "$mode" in
  stdio)
    unset MCP_HTTP_HOST MCP_HTTP_PORT
    cd "${CAIRN_SERVER_WORKDIR:-/data/project}"
    exec cairn memory-server "$@"
    ;;
  http)
    if [ -z "${CAIRN_MEMORY_HTTP_TOKEN:-}" ]; then
      echo "cairnkeep: HTTP mode requires CAIRN_MEMORY_HTTP_TOKEN or CAIRN_MEMORY_HTTP_TOKEN_FILE" >&2
      exit 64
    fi
    export MCP_HTTP_HOST=${MCP_HTTP_HOST:-0.0.0.0}
    export MCP_HTTP_PORT=${MCP_HTTP_PORT:-7801}
    allowed_hosts=${CAIRN_MEMORY_HTTP_ALLOWED_HOSTS:-}
    export CAIRN_MEMORY_HTTP_ALLOWED_HOSTS="${allowed_hosts:+$allowed_hosts,}localhost:${MCP_HTTP_PORT},127.0.0.1:${MCP_HTTP_PORT}"
    cd "${CAIRN_SERVER_WORKDIR:-/data/project}"
    exec cairn memory-server "$@"
    ;;
  cairn)
    exec cairn "$@"
    ;;
  *)
    exec "$mode" "$@"
    ;;
esac
