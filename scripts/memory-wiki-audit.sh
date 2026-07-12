#!/usr/bin/env bash
# memory-wiki-audit.sh — periodic invalidation scanner for the memory + wiki layers.
#
# Scans every project under PARA_ROOT that has a .planning/wiki/ for:
#   1. stale wiki source pages (Last reviewed older than STALE_DAYS)
#   2. open hard contradictions in CONTRADICTIONS.md
#   3. orphan source pages not linked from index.md
#   4. unreviewed memory candidates staged longer than STALE_DAYS
#
# Output: a consolidated markdown report on stdout (and optionally to REPORT_PATH).
# Designed for a systemd timer or cron. Pure bash/grep — no model round-trip, so
# it is reliable and cheap. The model-driven deep lint (/wiki-lint) still needs
# to run inside a session; this is the deterministic backstop that runs on a
# schedule and tells you where to focus.
#
# Usage: memory-wiki-audit.sh [--para-root PATH] [--stale-days N] [--report PATH]
#   --para-root PATH   root to scan (default: $HOME/PARA)
#   --stale-days N     staleness threshold in days (default: 30)
#   --report PATH      also write the report to this file
set -euo pipefail

PARA_ROOT="${HOME}/PARA"
STALE_DAYS=30
REPORT_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --para-root) PARA_ROOT="$2"; shift 2 ;;
    --stale-days) STALE_DAYS="$2"; shift 2 ;;
    --report) REPORT_PATH="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

cutoff_epoch="$(date -u -d "$STALE_DAYS days ago" +%s 2>/dev/null || date -u -v-${STALE_DAYS}d +%s 2>/dev/null || echo 0)"

stale_total=0
hard_open_total=0
orphan_total=0
staged_stale_total=0
sections=()

# Find every project with a wiki.
while IFS= read -r wiki_dir; do
  proj_dir="$(dirname "$(dirname "$wiki_dir")")"
  proj_name="$(basename "$proj_dir")"
  proj_findings=()

  # 1. Stale source pages (Last reviewed older than cutoff).
  stale_pages=()
  if [[ -d "$wiki_dir/sources" ]]; then
    while IFS= read -r page; do
      [[ -n "$page" ]] || continue
      lr="$(grep -m1 -iE '^[-*] \*?\*?Last reviewed\*?\*?:' "$page" 2>/dev/null | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' || true)"
      if [[ -n "$lr" ]]; then
        lr_epoch="$(date -u -d "$lr" +%s 2>/dev/null || echo 9999999999)"
        if (( lr_epoch < cutoff_epoch )); then
          stale_pages+=("$(basename "$page") (reviewed $lr)")
        fi
      fi
    done < <(find "$wiki_dir/sources" -maxdepth 1 -name '*.md' -type f 2>/dev/null)
  fi
  if (( ${#stale_pages[@]} > 0 )); then
    proj_findings+=("- stale source pages (${#stale_pages[@]}): ${stale_pages[*]}")
    stale_total=$((stale_total + ${#stale_pages[@]}))
  fi

  # 2. Open hard contradictions.
  contras="$wiki_dir/CONTRADICTIONS.md"
  hard_open=0
  if [[ -f "$contras" ]]; then
    # Count open entries tagged hard in the Open section.
    open_block="$(sed -n '/wiki:contradictions:open:start/,/wiki:contradictions:open:end/p' "$contras" 2>/dev/null || true)"
    hard_open="$(printf '%s' "$open_block" | grep -ciE 'severity: hard|hard contradiction' 2>/dev/null || true)"
    hard_open="$(printf '%s' "${hard_open:-0}" | tr -dc '0-9')"
    hard_open="${hard_open:-0}"
  fi
  if (( hard_open > 0 )); then
    proj_findings+=("- open HARD contradictions: $hard_open")
    hard_open_total=$((hard_open_total + hard_open))
  fi

  # 3. Orphan source pages (in sources/ but not named in index.md).
  orphans=()
  if [[ -f "$wiki_dir/index.md" ]] && [[ -d "$wiki_dir/sources" ]]; then
    while IFS= read -r page; do
      [[ -n "$page" ]] || continue
      base="$(basename "$page")"
      grep -qF "$base" "$wiki_dir/index.md" 2>/dev/null || orphans+=("$base")
    done < <(find "$wiki_dir/sources" -maxdepth 1 -name '*.md' -type f 2>/dev/null)
  fi
  if (( ${#orphans[@]} > 0 )); then
    proj_findings+=("- orphan source pages (${#orphans[@]}): ${orphans[*]}")
    orphan_total=$((orphan_total + ${#orphans[@]}))
  fi

  # 4. Unreviewed staged memory candidates older than threshold.
  staging="$proj_dir/.planning/memory-staging"
  staged_stale=0
  if [[ -d "$staging" ]]; then
    while IFS= read -r sf; do
      [[ -n "$sf" ]] || continue
      sf_epoch="$(stat -c %Y "$sf" 2>/dev/null || stat -f %m "$sf" 2>/dev/null || echo 9999999999)"
      if (( sf_epoch < cutoff_epoch )); then
        staged_stale=$((staged_stale + 1))
      fi
    done < <(find "$staging" -maxdepth 1 -name '*.json' -type f 2>/dev/null)
  fi
  if (( staged_stale > 0 )); then
    proj_findings+=("- unreviewed staged memory candidates (>$STALE_DAYS days): $staged_stale")
    staged_stale_total=$((staged_stale_total + staged_stale))
  fi

  if (( ${#proj_findings[@]} > 0 )); then
    sections+=("### $proj_name" "" "${proj_findings[@]}" "")
  fi
done < <(find "$PARA_ROOT" -maxdepth 4 -type d -name wiki -path '*/.planning/wiki' 2>/dev/null)

# Build report once, output to stdout (and REPORT_PATH if set).
report_body="$(
  {
    echo "# Memory + Wiki Audit Report"
    echo
    echo "- Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "- Scope: $PARA_ROOT (staleness threshold: $STALE_DAYS days)"
    echo "- Stale source pages: $stale_total"
    echo "- Open hard contradictions: $hard_open_total"
    echo "- Orphan source pages: $orphan_total"
    echo "- Unreviewed staged candidates: $staged_stale_total"
    echo
    if (( ${#sections[@]} > 0 )); then
      echo "## Findings by project"
      echo
      printf '%s\n' "${sections[@]}"
    else
      echo "## No findings"
      echo
      echo "All scanned projects are within thresholds."
    fi
  }
)"

printf '%s\n' "$report_body"

if [[ -n "$REPORT_PATH" ]]; then
  mkdir -p "$(dirname "$REPORT_PATH")"
  printf '%s\n' "$report_body" > "$REPORT_PATH"
fi

# Exit non-zero if there are actionable findings (useful for cron alerting).
if (( stale_total + hard_open_total + orphan_total + staged_stale_total > 0 )); then
  exit 3
fi
exit 0
