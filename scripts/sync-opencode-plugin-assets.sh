#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: sync-opencode-plugin-assets.sh [--check|--apply] [--live-root PATH]

Compare or sync the repo-managed OpenCode plugin assets against the live
OpenCode config tree.

Options:
  --check            Verify that the managed live assets match the repo copies (default)
  --apply            Copy the repo-managed assets into the live OpenCode tree, then verify
  --live-root PATH   Override the live OpenCode root (default: $OPENCODE_CONFIG_DIR or $HOME/.config/opencode)
  -h, --help         Show this help text

Notes:
  - The repo-managed source of truth lives under ./opencode/plugins/
  - OpenCode auto-discovers plugins/*.ts, so applying here activates them on the next session
EOF
}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SOURCE_ROOT="$ROOT_DIR/opencode"
LIVE_ROOT="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
MODE="check"

ASSETS=(
  "plugins/memory-wakeup.ts"
  "plugins/memory-capture.ts"
  "plugins/memory-recall.ts"
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

render_asset() {
  local src="$1"
  sed "s|@@INFRA_ROOT@@|$ROOT_DIR|g" "$src"
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
    src="$SOURCE_ROOT/$rel"
    dst="$LIVE_ROOT/$rel"

    if [[ ! -f "$dst" ]]; then
      missing_live+=("$rel")
      continue
    fi

    if ! cmp -s <(render_asset "$src") "$dst"; then
      mismatched+=("$rel")
    fi
  done

  if ((${#missing_live[@]} == 0 && ${#mismatched[@]} == 0)); then
    return 0
  fi

  if ((${#missing_live[@]} > 0)); then
    printf 'Missing live OpenCode plugin assets under %s:\n' "$LIVE_ROOT" >&2
    printf '  - %s\n' "${missing_live[@]}" >&2
  fi

  if ((${#mismatched[@]} > 0)); then
    printf 'Out-of-sync live OpenCode plugin assets under %s:\n' "$LIVE_ROOT" >&2
    printf '  - %s\n' "${mismatched[@]}" >&2
  fi

  return 1
}

run_check() {
  ensure_source_assets_exist
  check_asset_sync
  printf 'OpenCode plugin assets are in sync under %s\n' "$LIVE_ROOT"
}

run_apply() {
  local rel
  local src
  local dst
  local rendered_tmp
  local updated=0
  local unchanged=0

  ensure_source_assets_exist

  for rel in "${ASSETS[@]}"; do
    src="$SOURCE_ROOT/$rel"
    dst="$LIVE_ROOT/$rel"

    mkdir -p "$(dirname "$dst")"
    if [[ -f "$dst" ]] && cmp -s <(render_asset "$src") "$dst"; then
      unchanged=$((unchanged + 1))
      continue
    fi

    rendered_tmp=$(mktemp)
    render_asset "$src" > "$rendered_tmp"
    install -m 0644 "$rendered_tmp" "$dst"
    rm -f "$rendered_tmp"
    updated=$((updated + 1))
  done

  printf 'Applied %s OpenCode plugin asset(s); %s already matched.\n' "$updated" "$unchanged"
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
