#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: sync-opencode-graphify-assets.sh [--check|--apply] [--capability-overlay] [--live-root PATH]

Compare or sync the repo-managed Graphify OpenCode command asset against the
live OpenCode config tree.

Options:
  --check            Verify that the managed live asset matches the repo copy (default)
  --apply            Copy the repo-managed asset into the live OpenCode tree, then verify
  --capability-overlay
                     Select the guarded command overlay for a contract-enabled isolated root
  --live-root PATH   Override the live OpenCode root (default: $OPENCODE_CONFIG_DIR or $HOME/.config/opencode)
  -h, --help         Show this help text

Notes:
  - The repo-managed source of truth lives under ./opencode/
  - This script manages only the /graphify command asset
  - Plugin installation is delegated to sync-opencode-plugin-assets.sh;
    --capability-overlay selects its native plugin only when the master switch is on
  - The command asset always retains its legacy owner and bytes
EOF
}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SOURCE_ROOT="$ROOT_DIR/opencode"
LIVE_ROOT="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
MODE="check"
CAPABILITY_OVERLAY=0

ASSETS=(
  "command/graphify.md"
)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      MODE="check"
      shift
      ;;
    --apply)
      MODE="apply"
      shift
      ;;
    --capability-overlay)
      CAPABILITY_OVERLAY=1
      shift
      ;;
    --live-root)
      LIVE_ROOT="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

source_for() {
  local rel="$1"
  printf '%s\n' "$SOURCE_ROOT/$rel"
}

ensure_source_assets_exist() {
  local rel
  local missing=0

  for rel in "${ASSETS[@]}"; do
    if [[ ! -f "$SOURCE_ROOT/$rel" ]]; then
      echo "Missing repo-managed source asset: $SOURCE_ROOT/$rel" >&2
      missing=1
    fi
  done

  if [[ $missing -ne 0 ]]; then
    exit 2
  fi
}

check_asset_sync() {
  local rel
  local src
  local dst
  local -a missing_live=()
  local -a mismatched=()

  for rel in "${ASSETS[@]}"; do
    src=$(source_for "$rel")
    dst="$LIVE_ROOT/$rel"

    if [[ ! -f "$dst" ]]; then
      missing_live+=("$rel")
      continue
    fi

    if ! cmp -s "$src" "$dst"; then
      mismatched+=("$rel")
    fi
  done

  if ((${#missing_live[@]} == 0 && ${#mismatched[@]} == 0)); then
    return 0
  fi

  if ((${#missing_live[@]} > 0)); then
    printf 'Missing live Graphify assets under %s:\n' "$LIVE_ROOT" >&2
    printf '  - %s\n' "${missing_live[@]}" >&2
  fi

  if ((${#mismatched[@]} > 0)); then
    printf 'Out-of-sync live Graphify assets under %s:\n' "$LIVE_ROOT" >&2
    printf '  - %s\n' "${mismatched[@]}" >&2
  fi

  return 1
}

run_check() {
  ensure_source_assets_exist
  check_asset_sync
  printf 'Graphify command asset is in sync under %s\n' "$LIVE_ROOT"
}

run_apply() {
  local rel
  local src
  local dst
  local updated=0
  local unchanged=0

  ensure_source_assets_exist

  for rel in "${ASSETS[@]}"; do
    src=$(source_for "$rel")
    dst="$LIVE_ROOT/$rel"

    mkdir -p "$(dirname "$dst")"
    if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
      unchanged=$((unchanged + 1))
      continue
    fi

    install -m 0644 "$src" "$dst"
    updated=$((updated + 1))
  done

  printf 'Applied %s Graphify asset(s); %s already matched.\n' "$updated" "$unchanged"
  run_check
}

case "$MODE" in
  check)
    run_check
    ;;
  apply)
    run_apply
    ;;
esac

plugin_args=("--$MODE" "--live-root" "$LIVE_ROOT")
if [[ "$CAPABILITY_OVERLAY" -eq 1 ]]; then
  plugin_args+=("--capability-overlay")
fi
"$ROOT_DIR/scripts/sync-opencode-plugin-assets.sh" "${plugin_args[@]}"
