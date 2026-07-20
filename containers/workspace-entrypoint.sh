#!/bin/sh
set -eu

mode=${CAIRN_WORKSPACE_MODE:-shared}
case "$mode" in
  shared)
    ;;
  sandbox)
    if [ ! -d /source ]; then
      echo "cairnkeep: sandbox mode requires a read-only repository mounted at /source" >&2
      exit 66
    fi
    if [ ! -e /workspace/.cairnkeep-sandbox-ready ]; then
      if find /workspace -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
        echo "cairnkeep: refusing to initialize a non-empty unmarked workspace volume" >&2
        exit 65
      fi
      cp -a /source/. /workspace/
      : > /workspace/.cairnkeep-sandbox-ready
    fi
    ;;
  *)
    echo "cairnkeep: CAIRN_WORKSPACE_MODE must be shared or sandbox" >&2
    exit 64
    ;;
esac

cd /workspace
exec /usr/local/bin/cairn-container-entrypoint "$@"
