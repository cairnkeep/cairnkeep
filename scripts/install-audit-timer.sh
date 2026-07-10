#!/usr/bin/env bash
# install-audit-timer.sh — opt-in scheduler for memory-wiki-audit.sh.
#
# Renders a systemd user service + timer from templates/ and enables the timer,
# so the deterministic memory/wiki invalidation audit runs on a schedule. A cron
# alternative is printed for hosts without systemd.
#
# Usage: install-audit-timer.sh [--para-root PATH] [--on-calendar SPEC]
#                               [--report PATH] [--render-only DIR]
#   --para-root PATH    root the audit scans (default: $HOME/PARA)
#   --on-calendar SPEC  systemd OnCalendar schedule (default: daily)
#   --report PATH       where the audit writes its report
#   --render-only DIR   render the unit files into DIR and exit (no systemctl)
set -euo pipefail

CAIRN_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TPL="$CAIRN_ROOT/templates"
AUDIT_SCRIPT="$CAIRN_ROOT/scripts/memory-wiki-audit.sh"

PARA_ROOT="${HOME}/PARA"
ON_CALENDAR="daily"
REPORT_PATH="${HOME}/.cairnkeep/memory-wiki-audit.report.md"
RENDER_ONLY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --para-root) PARA_ROOT="$2"; shift 2 ;;
    --on-calendar) ON_CALENDAR="$2"; shift 2 ;;
    --report) REPORT_PATH="$2"; shift 2 ;;
    --render-only) RENDER_ONLY="$2"; shift 2 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

render() {
  sed -e "s|@@AUDIT_SCRIPT@@|${AUDIT_SCRIPT}|g" \
      -e "s|@@PARA_ROOT@@|${PARA_ROOT}|g" \
      -e "s|@@REPORT_PATH@@|${REPORT_PATH}|g" \
      -e "s|@@ON_CALENDAR@@|${ON_CALENDAR}|g" \
      "$1"
}

cron_line="@daily ${AUDIT_SCRIPT} --para-root ${PARA_ROOT} --report ${REPORT_PATH}"

if [[ -n "$RENDER_ONLY" ]]; then
  mkdir -p "$RENDER_ONLY"
  render "$TPL/memory-wiki-audit.service.template" > "$RENDER_ONLY/memory-wiki-audit.service"
  render "$TPL/memory-wiki-audit.timer.template"   > "$RENDER_ONLY/memory-wiki-audit.timer"
  echo "rendered unit files into $RENDER_ONLY"
  exit 0
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl not found. Use --render-only DIR, or schedule via cron:" >&2
  echo "  $cron_line" >&2
  exit 1
fi

UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mkdir -p "$UNIT_DIR"
mkdir -p "$(dirname "$REPORT_PATH")"
render "$TPL/memory-wiki-audit.service.template" > "$UNIT_DIR/memory-wiki-audit.service"
render "$TPL/memory-wiki-audit.timer.template"   > "$UNIT_DIR/memory-wiki-audit.timer"
systemctl --user daemon-reload
systemctl --user enable --now memory-wiki-audit.timer
echo "installed + enabled memory-wiki-audit.timer (OnCalendar=${ON_CALENDAR})"
echo "cron alternative: ${cron_line}"
