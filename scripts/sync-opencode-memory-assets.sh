#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: sync-opencode-memory-assets.sh [--check|--apply] [--live-root PATH]

Compare or sync the repo-managed OpenCode memory and review assets against the
live OpenCode config tree.

Options:
  --check            Verify that the managed live assets match the repo copy (default)
  --apply            Copy the repo-managed assets into the live OpenCode tree, then verify
  --live-root PATH   Override the live OpenCode root (default: $OPENCODE_CONFIG_DIR or $HOME/.config/opencode)
  -h, --help         Show this help text

Notes:
  - The repo-managed source of truth lives under ./opencode/
  - This script manages the memory-sync / memory-review / code-review commands,
    the code-reviewer agent, and the memory-review workflow. The memory-wakeup
    plugin is handled by sync-opencode-plugin-assets.sh.
EOF
}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SOURCE_ROOT="$ROOT_DIR/opencode"
LIVE_ROOT="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
MODE="check"

ASSETS=(
  "command/memory-sync.md"
  "command/memory-review.md"
  "command/code-review.md"
  "agents/code-reviewer.md"
  "workflows/memory-review-workflow.md"
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
    src="$SOURCE_ROOT/$rel"
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
    printf 'Missing live memory/review assets under %s:\n' "$LIVE_ROOT" >&2
    printf '  - %s\n' "${missing_live[@]}" >&2
  fi

  if ((${#mismatched[@]} > 0)); then
    printf 'Out-of-sync live memory/review assets under %s:\n' "$LIVE_ROOT" >&2
    printf '  - %s\n' "${mismatched[@]}" >&2
  fi

  return 1
}

run_check() {
  ensure_source_assets_exist
  check_asset_sync
  printf 'Memory/review assets are in sync: %s managed files match %s\n' "${#ASSETS[@]}" "$LIVE_ROOT"
}

run_apply() {
  local rel
  local src
  local dst
  local updated=0
  local unchanged=0

  ensure_source_assets_exist

  for rel in "${ASSETS[@]}"; do
    src="$SOURCE_ROOT/$rel"
    dst="$LIVE_ROOT/$rel"

    mkdir -p "$(dirname "$dst")"
    if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
      unchanged=$((unchanged + 1))
      continue
    fi

    install -m 0644 "$src" "$dst"
    updated=$((updated + 1))
  done

  printf 'Applied %s memory/review asset(s); %s already matched.\n' "$updated" "$unchanged"
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
