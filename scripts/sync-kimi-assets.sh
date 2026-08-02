#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: sync-kimi-assets.sh [--check|--apply] [--live-root PATH]

Compare or sync Cairnkeep's thin graph Skill against the live Kimi Code tree.

Options:
  --check            Verify managed live assets match the repo copies (default)
  --apply            Install managed assets, then verify
  --live-root PATH   Override the Kimi Code root (default: $KIMI_CODE_HOME or ~/.kimi-code)
  -h, --help         Show this help text
EOF
}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SOURCE_ROOT="$ROOT_DIR/kimi"
LIVE_ROOT="${KIMI_CODE_HOME:-$HOME/.kimi-code}"
MODE="check"
ASSETS=("skills/graphify/SKILL.md")

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) MODE="check"; shift ;;
    --apply) MODE="apply"; shift ;;
    --live-root) LIVE_ROOT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

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
      echo "Missing live Kimi asset under $LIVE_ROOT: $rel" >&2
      failed=1
    elif ! cmp -s "$SOURCE_ROOT/$rel" "$LIVE_ROOT/$rel"; then
      echo "Out-of-sync live Kimi asset under $LIVE_ROOT: $rel" >&2
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
    if [[ -f "$LIVE_ROOT/$rel" ]] && cmp -s "$SOURCE_ROOT/$rel" "$LIVE_ROOT/$rel"; then
      unchanged=$((unchanged + 1))
    else
      install -m 0644 "$SOURCE_ROOT/$rel" "$LIVE_ROOT/$rel"
      updated=$((updated + 1))
    fi
  done
  printf 'Applied %s Kimi asset(s); %s already matched.\n' "$updated" "$unchanged"
fi

check_assets
printf 'Kimi graph Skill is in sync under %s\n' "$LIVE_ROOT"
