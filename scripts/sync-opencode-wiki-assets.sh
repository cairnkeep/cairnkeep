#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: sync-opencode-wiki-assets.sh [--check|--apply] [--live-root PATH]

Compare or sync the repo-managed OpenCode wiki assets against the live
OpenCode config tree.

Options:
  --check            Verify that the managed live assets match the repo copy (default)
  --apply            Copy the repo-managed assets into the live OpenCode tree, then verify
  --live-root PATH   Override the live OpenCode root (default: $OPENCODE_CONFIG_DIR or $HOME/.config/opencode)
  -h, --help         Show this help text

Notes:
  - The repo-managed source of truth lives under ./opencode/
  - This script manages only the wiki-specific OpenCode assets
  - Extra live wiki assets are reported as warnings but are not deleted automatically
  - --apply also removes the legacy gsd-overrides wiki workflow/template files
EOF
}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SOURCE_ROOT="$ROOT_DIR/opencode"
LIVE_ROOT="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
MODE="check"

ASSETS=(
  "command/wiki-ingest.md"
  "command/wiki-query.md"
  "command/wiki-lint.md"
  "agents/wiki-ingester.md"
  "agents/wiki-query-analyst.md"
  "agents/wiki-lint-auditor.md"
  "workflows/wiki-ingest-workflow.md"
  "workflows/wiki-query-workflow.md"
  "workflows/wiki-lint-workflow.md"
  "templates/wiki-policy.md.template"
  "templates/wiki-index.md.template"
  "templates/wiki-log.md.template"
  "templates/wiki-source-summary.md.template"
  "templates/wiki-query-answer.md.template"
  "templates/wiki-lint-report.md.template"
  "templates/wiki-contradictions.md.template"
)

LEGACY_ASSETS=(
  "gsd-overrides/workflows/wiki-ingest.md"
  "gsd-overrides/workflows/wiki-query.md"
  "gsd-overrides/workflows/wiki-lint.md"
  "gsd-overrides/templates/wiki-policy.md.template"
  "gsd-overrides/templates/wiki-index.md.template"
  "gsd-overrides/templates/wiki-log.md.template"
  "gsd-overrides/templates/wiki-source-summary.md.template"
  "gsd-overrides/templates/wiki-query-answer.md.template"
  "gsd-overrides/templates/wiki-lint-report.md.template"
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
    (
      find "$root/command" -maxdepth 1 -type f \( -name 'gsd-wiki-*.md' -o -name 'wiki-*.md' \) -printf 'command/%f\n' 2>/dev/null || true
      find "$root/agents" -maxdepth 1 -type f \( -name 'gsd-wiki-*.md' -o -name 'wiki-*.md' \) -printf 'agents/%f\n' 2>/dev/null || true
      find "$root/workflows" -maxdepth 1 -type f -name 'wiki-*.md' -printf 'workflows/%f\n' 2>/dev/null || true
      find "$root/templates" -maxdepth 1 -type f -name 'wiki-*.template' -printf 'templates/%f\n' 2>/dev/null || true
      find "$root/gsd-overrides/workflows" -maxdepth 1 -type f -name 'wiki-*.md' -printf 'gsd-overrides/workflows/%f\n' 2>/dev/null || true
      find "$root/gsd-overrides/templates" -maxdepth 1 -type f -name 'wiki-*.template' -printf 'gsd-overrides/templates/%f\n' 2>/dev/null || true
    ) | sort -u
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

  mapfile -t extras < <(collect_extra_live_assets "$LIVE_ROOT")
  if ((${#extras[@]} == 0)); then
    return
  fi

  printf 'Warning: found unmanaged live wiki assets under %s:\n' "$LIVE_ROOT" >&2
  printf '  - %s\n' "${extras[@]}" >&2
}

report_legacy_live_assets() {
  local -a extras=()
  local rel

  for rel in "${LEGACY_ASSETS[@]}"; do
    if [[ -f "$LIVE_ROOT/$rel" ]]; then
      extras+=("$rel")
    fi
  done

  if ((${#extras[@]} == 0)); then
    return
  fi

  printf 'Warning: found legacy live wiki assets under %s:\n' "$LIVE_ROOT" >&2
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
  report_legacy_live_assets

  if ((${#missing_live[@]} == 0 && ${#mismatched[@]} == 0)); then
    printf 'Wiki assets are in sync: %s managed files match %s\n' "${#ASSETS[@]}" "$LIVE_ROOT"
    return 0
  fi

  if ((${#missing_live[@]} > 0)); then
    printf 'Missing live wiki assets under %s:\n' "$LIVE_ROOT" >&2
    printf '  - %s\n' "${missing_live[@]}" >&2
  fi

  if ((${#mismatched[@]} > 0)); then
    printf 'Out-of-sync live wiki assets under %s:\n' "$LIVE_ROOT" >&2
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

  printf 'Applied %s wiki asset(s); %s already matched; removed %s legacy asset(s).\n' "$updated" "$unchanged" "$removed_legacy"
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
