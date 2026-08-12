#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: sync-pi-assets.sh [--check|--apply] [--live-root PATH]

Compare or sync the repo-managed Pi extension and prompt assets against the
live Pi agent configuration tree.

Options:
  --check            Verify managed live assets match the rendered repo copies (default)
  --apply            Install managed assets, then verify
  --live-root PATH   Override the Pi agent root (default: $PI_CODING_AGENT_DIR or ~/.pi/agent)
  -h, --help         Show this help text
EOF
}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SOURCE_ROOT="$ROOT_DIR/pi"
LIVE_ROOT="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
MODE="check"
ASSETS=(
  "extensions/cairnkeep-memory.ts"
  "extensions/cairnkeep-trajectory.ts"
  "prompts/graphify.md"
)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) MODE="check"; shift ;;
    --apply) MODE="apply"; shift ;;
    --live-root) LIVE_ROOT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

render_asset() {
  local rel="$1"
  if [[ "$rel" == extensions/*.ts ]]; then
    sed "s|@@INFRA_ROOT@@|$ROOT_DIR|g" "$SOURCE_ROOT/$rel"
  else
    cat "$SOURCE_ROOT/$rel"
  fi
}

ensure_sources() {
  local rel
  for rel in "${ASSETS[@]}"; do
    [[ -f "$SOURCE_ROOT/$rel" ]] || {
      echo "Missing repo-managed source asset: $SOURCE_ROOT/$rel" >&2
      return 2
    }
  done
}

check_assets() {
  local rel
  local failed=0
  for rel in "${ASSETS[@]}"; do
    if [[ ! -f "$LIVE_ROOT/$rel" ]]; then
      echo "Missing live Pi asset under $LIVE_ROOT: $rel" >&2
      failed=1
    elif ! cmp -s <(render_asset "$rel") "$LIVE_ROOT/$rel"; then
      echo "Out-of-sync live Pi asset under $LIVE_ROOT: $rel" >&2
      failed=1
    fi
  done
  return "$failed"
}

ensure_sources

if [[ "$MODE" == "apply" ]]; then
  updated=0
  unchanged=0
  for rel in "${ASSETS[@]}"; do
    mkdir -p "$(dirname "$LIVE_ROOT/$rel")"
    if [[ -f "$LIVE_ROOT/$rel" ]] && cmp -s <(render_asset "$rel") "$LIVE_ROOT/$rel"; then
      unchanged=$((unchanged + 1))
      continue
    fi
    rendered_tmp=$(mktemp)
    render_asset "$rel" > "$rendered_tmp"
    install -m 0644 "$rendered_tmp" "$LIVE_ROOT/$rel"
    rm -f "$rendered_tmp"
    updated=$((updated + 1))
  done
  printf 'Applied %s Pi asset(s); %s already matched.\n' "$updated" "$unchanged"
fi

if ! check_assets; then
  echo "Recovery: sync-pi-assets.sh --apply --live-root PATH" >&2
  exit 1
fi
printf 'Pi extension and graph prompt are in sync under %s\n' "$LIVE_ROOT"
