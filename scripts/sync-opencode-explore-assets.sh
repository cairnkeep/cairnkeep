#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: sync-opencode-explore-assets.sh [--check|--apply] [--live-root PATH]

Compare or sync the repo-managed OpenCode explore assets against the live
OpenCode config tree.

Options:
  --check            Verify that the managed live assets match the repo copy (default)
  --apply            Copy the repo-managed assets into the live OpenCode tree, then verify
  --live-root PATH   Override the live OpenCode root (default: $OPENCODE_CONFIG_DIR or $HOME/.config/opencode)
  -h, --help         Show this help text

Notes:
  - The repo-managed source of truth lives under ./opencode/
  - This script manages only the explore-command OpenCode asset
  - Extra live explore assets are reported as warnings but are not deleted automatically
EOF
}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SOURCE_ROOT="$ROOT_DIR/opencode"
LIVE_ROOT="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
MODE="check"

ASSETS=(
  "command/context-explore.md"
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

collect_extra_live_assets() {
  local root="$1"
  local -A managed=()
  local rel

  for rel in "${ASSETS[@]}"; do
    managed["$rel"]=1
  done

  while IFS= read -r rel; do
    [[ -n "$rel" ]] || continue
    if [[ -z "${managed[$rel]:-}" ]]; then
      printf '%s\n' "$rel"
    fi
  done < <(
    find "$root/command" -maxdepth 1 -type f -name 'context-explore*.md' -printf 'command/%f\n' 2>/dev/null | sort -u || true
  )
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

report_extra_live_assets() {
  local -a extras=()

  if [[ ! -d "$LIVE_ROOT" ]]; then
    return
  fi

  # read loop, not `mapfile`: mapfile is bash 4+, absent from macOS bash 3.2.
  local line
  while IFS= read -r line; do
    extras+=("$line")
  done < <(collect_extra_live_assets "$LIVE_ROOT")
  if ((${#extras[@]} == 0)); then
    return
  fi

  printf 'Warning: found unmanaged live explore assets under %s:\n' "$LIVE_ROOT" >&2
  printf '  - %s\n' "${extras[@]}" >&2
}

run_check() {
  local rel
  local src
  local dst
  local -a missing_live=()
  local -a mismatched=()

  ensure_source_assets_exist

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

  report_extra_live_assets

  if ((${#missing_live[@]} == 0 && ${#mismatched[@]} == 0)); then
    printf 'Explore assets are in sync: %s managed files match %s\n' "${#ASSETS[@]}" "$LIVE_ROOT"
    return 0
  fi

  if ((${#missing_live[@]} > 0)); then
    printf 'Missing live explore assets under %s:\n' "$LIVE_ROOT" >&2
    printf '  - %s\n' "${missing_live[@]}" >&2
  fi

  if ((${#mismatched[@]} > 0)); then
    printf 'Out-of-sync live explore assets under %s:\n' "$LIVE_ROOT" >&2
    printf '  - %s\n' "${mismatched[@]}" >&2
  fi

  return 1
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

  printf 'Applied %s explore asset(s); %s already matched.\n' "$updated" "$unchanged"
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
