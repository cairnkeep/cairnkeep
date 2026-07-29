#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: sync-pi-assets.sh [--check|--apply] [--live-root PATH]

Compare or sync the repo-managed Pi extension assets against the live Pi agent
configuration tree.

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
ASSET="extensions/cairnkeep-trajectory.ts"

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
  sed "s|@@INFRA_ROOT@@|$ROOT_DIR|g" "$SOURCE_ROOT/$ASSET"
}

check_asset() {
  [[ -f "$SOURCE_ROOT/$ASSET" ]] || {
    echo "Missing repo-managed source asset: $SOURCE_ROOT/$ASSET" >&2
    return 2
  }
  [[ -f "$LIVE_ROOT/$ASSET" ]] || {
    echo "Missing live Pi extension under $LIVE_ROOT: $ASSET" >&2
    return 1
  }
  cmp -s <(render_asset) "$LIVE_ROOT/$ASSET" || {
    echo "Out-of-sync live Pi extension under $LIVE_ROOT: $ASSET" >&2
    return 1
  }
}

if [[ "$MODE" == "apply" ]]; then
  [[ -f "$SOURCE_ROOT/$ASSET" ]] || {
    echo "Missing repo-managed source asset: $SOURCE_ROOT/$ASSET" >&2
    exit 2
  }
  mkdir -p "$(dirname "$LIVE_ROOT/$ASSET")"
  if [[ -f "$LIVE_ROOT/$ASSET" ]] && cmp -s <(render_asset) "$LIVE_ROOT/$ASSET"; then
    echo "Applied 0 Pi extension asset(s); 1 already matched."
  else
    rendered_tmp=$(mktemp)
    render_asset > "$rendered_tmp"
    install -m 0644 "$rendered_tmp" "$LIVE_ROOT/$ASSET"
    rm -f "$rendered_tmp"
    echo "Applied 1 Pi extension asset(s); 0 already matched."
  fi
fi

check_asset
printf 'Pi extension assets are in sync under %s\n' "$LIVE_ROOT"
