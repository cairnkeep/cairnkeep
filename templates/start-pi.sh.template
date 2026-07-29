#!/usr/bin/env bash
# Cairnkeep launcher for Pi. Loads this repo's private .ai/.env, runs the same
# optional pre/post seams as the other launchers, and otherwise passes every
# argument to Pi unchanged. Pi has no generic settings-file layering flag, so
# CAIRN_EXTRA_SETTINGS is intentionally not translated into a CLI option.
set -euo pipefail
ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
if [[ -f "$ROOT_DIR/.ai/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT_DIR/.ai/.env"
  set +a
fi
if [[ -f "$ROOT_DIR/.ai/pre-launch.sh" ]]; then
  # shellcheck disable=SC1091
  . "$ROOT_DIR/.ai/pre-launch.sh"
fi
cd "$ROOT_DIR"

if [[ -f "$ROOT_DIR/.ai/post-exit.sh" ]]; then
  set +e
  pi "$@"
  CAIRN_EXIT_STATUS=$?
  set -e
  export CAIRN_EXIT_STATUS
  # shellcheck disable=SC1091
  . "$ROOT_DIR/.ai/post-exit.sh" || true
  exit "$CAIRN_EXIT_STATUS"
fi
exec pi "$@"
