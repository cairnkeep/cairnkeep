#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: sync-opencode-security-assets.sh [--check|--apply] [--live-root PATH]

Compare or sync the repo-managed OpenCode security-audit assets against the live
OpenCode config tree.

Options:
  --check            Verify that the managed live assets match the repo copy (default)
  --apply            Copy the repo-managed assets into the live OpenCode tree, then verify
  --live-root PATH   Override the live OpenCode root (default: $OPENCODE_CONFIG_DIR or $HOME/.config/opencode)
  -h, --help         Show this help text

Notes:
  - The repo-managed source of truth lives under ./opencode/
  - This script manages only the security-audit OpenCode assets
  - --apply also removes the legacy gsd-overrides security-audit workflow/template files
EOF
}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SOURCE_ROOT="$ROOT_DIR/opencode"
LIVE_ROOT="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
MODE="check"

ASSETS=(
  "command/security-audit.md"
  "agents/security-target-selector.md"
  "agents/security-investigator.md"
  "agents/security-validator.md"
  "workflows/security-audit-workflow.md"
  "templates/security-policy.md.template"
  "templates/security-report.md.template"
  "templates/security-finding-register.yaml.template"
  "templates/security-issue.md.template"
)

LEGACY_ASSETS=(
  "gsd-overrides/workflows/security-audit.md"
  "gsd-overrides/templates/security-policy.md.template"
  "gsd-overrides/templates/security-report.md.template"
  "gsd-overrides/templates/security-finding-register.yaml.template"
  "gsd-overrides/templates/security-issue.md.template"
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

report_legacy_live_assets() {
  local rel
  local -a legacy_found=()

  for rel in "${LEGACY_ASSETS[@]}"; do
    if [[ -f "$LIVE_ROOT/$rel" ]]; then
      legacy_found+=("$rel")
    fi
  done

  if ((${#legacy_found[@]} == 0)); then
    return
  fi

  printf 'Warning: found legacy live security-audit assets under %s:\n' "$LIVE_ROOT" >&2
  printf '  - %s\n' "${legacy_found[@]}" >&2
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

  report_legacy_live_assets

  if ((${#missing_live[@]} == 0 && ${#mismatched[@]} == 0)); then
    printf 'Security-audit assets are in sync: %s managed files match %s\n' "${#ASSETS[@]}" "$LIVE_ROOT"
    return 0
  fi

  if ((${#missing_live[@]} > 0)); then
    printf 'Missing live security-audit assets under %s:\n' "$LIVE_ROOT" >&2
    printf '  - %s\n' "${missing_live[@]}" >&2
  fi

  if ((${#mismatched[@]} > 0)); then
    printf 'Out-of-sync live security-audit assets under %s:\n' "$LIVE_ROOT" >&2
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
  local removed_legacy=0

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

  for rel in "${LEGACY_ASSETS[@]}"; do
    dst="$LIVE_ROOT/$rel"
    if [[ -f "$dst" ]]; then
      rm -f "$dst"
      removed_legacy=$((removed_legacy + 1))
    fi
  done

  printf 'Applied %s security-audit asset(s); %s already matched; removed %s legacy asset(s).\n' "$updated" "$unchanged" "$removed_legacy"
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
