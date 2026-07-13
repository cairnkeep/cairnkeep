#!/usr/bin/env bash
# cairn uninstall — reverse what cairnkeep installed/modified on this machine.
#
# Backup-first and revertible: every file it removes or edits is copied into a
# timestamped bundle ($HOME/.cairnkeep-uninstall-<ts>/) with a generated
# revert.sh, so `bash <bundle>/revert.sh` puts the machine back. Removes only
# things cairnkeep owns; the durable memory store ($HOME/.cairnkeep) is DATA and
# is left alone unless you pass --purge-memory (then it too is backed up first).
#
# Undoes: the operating layer (`cairn sync --apply` — commands, agents,
# templates, hooks + their settings.json registrations), the MCP registration
# (`claude mcp add cairn-memory`), the opt-in audit timer, and — for any project
# paths you pass — the `cairn bootstrap` scaffold. The npm package itself is
# npm's to remove; the final step is printed, not run (it would delete this
# script mid-execution).
set -uo pipefail

CAIRN_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CLAUDE_SOURCE="$CAIRN_ROOT/claude"
TPL="$CAIRN_ROOT/templates"

LIVE_ROOT="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
STORE_DIR="${CAIRN_AGENTFS_BASE_DIR:-$HOME/.cairnkeep}"
STORE_DIR="${STORE_DIR/#\~/$HOME}"
DRY_RUN=0
ASSUME_YES=0
PURGE_MEMORY=0
PROJECTS=()

# The hooks cairnkeep registers (basename is the settings.json match token).
HOOK_NAMES=(memory-wakeup.sh memory-capture.sh memory-recall.sh context-explore-pretask.sh)

usage() {
  cat <<'EOF'
Usage: uninstall.sh [--dry-run] [--yes] [--purge-memory] [--live-root PATH] [PROJECT ...]

Reverse cairnkeep's install. Everything removed/edited is backed up into
$HOME/.cairnkeep-uninstall-<ts>/ with a revert.sh before any change.

  --dry-run        Print what would happen; touch nothing.
  --yes            Do not prompt for confirmation.
  --purge-memory   Also remove the durable memory store ($HOME/.cairnkeep or
                   $CAIRN_AGENTFS_BASE_DIR). Backed up first, but this is your
                   accumulated memory — off by default.
  --live-root PATH Claude root to clean (default: $CLAUDE_CONFIG_DIR or ~/.claude).
  PROJECT ...      Also revert `cairn bootstrap` in these project dirs
                   (.ai/, .planning/, and any .git/info/exclude entries).
  -h, --help       Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    --purge-memory) PURGE_MEMORY=1; shift ;;
    --live-root) LIVE_ROOT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) PROJECTS+=("$1"); shift ;;
  esac
done

# ---- backup bundle -----------------------------------------------------------
# Timestamp comes from the runtime clock on the user's machine.
BACKUP_DIR="$HOME/.cairnkeep-uninstall-$(date +%Y%m%d-%H%M%S)"
MANIFEST="$BACKUP_DIR/manifest.tsv"
NOTES="$BACKUP_DIR/NOTES.txt"

ensure_bundle() {
  [[ $DRY_RUN -eq 1 ]] && return 0
  [[ -d "$BACKUP_DIR" ]] && return 0
  mkdir -p "$BACKUP_DIR/files"
  : >"$MANIFEST"
  : >"$NOTES"
}

# back_up ABS — copy an existing path into the bundle, mirrored by absolute path,
# and record it in the manifest so revert.sh can restore it. Safe on dirs (cp -a).
back_up() {
  local abs="$1" rel
  [[ -e "$abs" ]] || return 0
  ensure_bundle
  [[ $DRY_RUN -eq 1 ]] && return 0
  rel="files/${abs#/}"
  mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
  cp -a "$abs" "$BACKUP_DIR/$rel"
  printf '%s\t%s\n' "$abs" "$rel" >>"$MANIFEST"
}

# remove_path ABS — back up then delete (file or dir).
remove_path() {
  local abs="$1"
  [[ -e "$abs" ]] || return 0
  if [[ $DRY_RUN -eq 1 ]]; then echo "  would remove: $abs"; return 0; fi
  back_up "$abs"
  rm -rf "$abs"
  echo "  removed: $abs"
}

note() { [[ $DRY_RUN -eq 1 ]] || { ensure_bundle; printf '%s\n' "$1" >>"$NOTES"; }; }

# ---- what will be removed ----------------------------------------------------
# Asset dests: derived exactly as sync-claude-assets.sh installs them, so the two
# never drift. claude/**/*.md -> <live>/..., security|wiki templates, hooks.
asset_dests() {
  local rel tpl h
  while IFS= read -r rel; do echo "$LIVE_ROOT/$rel"; done \
    < <(cd "$CLAUDE_SOURCE" 2>/dev/null && find . -type f -name '*.md' | sed 's|^\./||' | sort)
  for tpl in "$TPL"/security-*.template "$TPL"/wiki-*.template; do
    [[ -f "$tpl" ]] && echo "$LIVE_ROOT/templates/$(basename "$tpl")"
  done
  for h in "$CLAUDE_SOURCE"/hooks/*.sh; do
    [[ -f "$h" ]] && echo "$LIVE_ROOT/hooks/$(basename "$h")"
  done
}

echo "cairn uninstall"
[[ $DRY_RUN -eq 1 ]] && echo "(dry run — nothing will change)"
echo "  live root:    $LIVE_ROOT"
echo "  memory store: $STORE_DIR ($([[ $PURGE_MEMORY -eq 1 ]] && echo 'WILL be purged' || echo 'kept'))"
[[ ${#PROJECTS[@]} -gt 0 ]] && echo "  projects:     ${PROJECTS[*]}"

if [[ $DRY_RUN -eq 0 && $ASSUME_YES -eq 0 ]]; then
  printf 'Proceed? [y/N] '
  read -r ans
  [[ "$ans" == [yY] || "$ans" == [yY][eE][sS] ]] || { echo "aborted."; exit 0; }
fi

# 1. Operating-layer asset files.
echo "Operating layer (assets):"
while IFS= read -r dst; do remove_path "$dst"; done < <(asset_dests)

# 2. settings.json hook registrations (back up whole file, then de-register).
SETTINGS="$LIVE_ROOT/settings.json"
if [[ -f "$SETTINGS" ]]; then
  echo "Hook registrations (settings.json):"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  would de-register: ${HOOK_NAMES[*]}"
  elif command -v node >/dev/null 2>&1; then
    back_up "$SETTINGS"
    node -e '
const fs = require("fs");
const [p, ...names] = process.argv.slice(1);
let s; try { s = JSON.parse(fs.readFileSync(p, "utf8")); }
catch (e) { console.error("  settings.json parse failed, leaving untouched"); process.exit(1); }
if (!s.hooks) process.exit(0);
let removed = 0;
for (const ev of Object.keys(s.hooks)) {
  if (!Array.isArray(s.hooks[ev])) continue;
  s.hooks[ev] = s.hooks[ev].filter((entry) => {
    if (!Array.isArray(entry.hooks)) return true;
    const before = entry.hooks.length;
    entry.hooks = entry.hooks.filter((h) =>
      !(typeof h.command === "string" && names.some((n) => h.command.includes(n))));
    removed += before - entry.hooks.length;
    return entry.hooks.length > 0;
  });
  if (s.hooks[ev].length === 0) delete s.hooks[ev];
}
if (Object.keys(s.hooks).length === 0) delete s.hooks;
fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
console.log("  de-registered " + removed + " hook(s)");
' "$SETTINGS" "${HOOK_NAMES[@]}" || echo "  (settings.json left untouched)"
  else
    echo "  node not found — cannot edit settings.json; remove hook entries manually."
  fi
fi

# 3. MCP registration (best-effort; a command, not a file — noted for revert).
echo "MCP registration (cairn-memory):"
if command -v claude >/dev/null 2>&1; then
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  would run: claude mcp remove cairn-memory -s user"
  else
    claude mcp remove cairn-memory -s user 2>/dev/null && echo "  removed cairn-memory" \
      || echo "  cairn-memory not registered (or already gone)"
    note "Re-add MCP server: claude mcp add cairn-memory -s user -- cairn memory-server"
  fi
else
  echo "  claude CLI not found — if registered, run: claude mcp remove cairn-memory -s user"
fi

# 4. Audit timer (opt-in; disable + remove unit files).
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
if [[ -f "$UNIT_DIR/memory-wiki-audit.timer" || -f "$UNIT_DIR/memory-wiki-audit.service" ]]; then
  echo "Audit timer:"
  if [[ $DRY_RUN -eq 1 ]]; then
    echo "  would disable + remove memory-wiki-audit.{timer,service}"
  else
    command -v systemctl >/dev/null 2>&1 && systemctl --user disable --now memory-wiki-audit.timer 2>/dev/null || true
    remove_path "$UNIT_DIR/memory-wiki-audit.timer"
    remove_path "$UNIT_DIR/memory-wiki-audit.service"
    command -v systemctl >/dev/null 2>&1 && systemctl --user daemon-reload 2>/dev/null || true
    note "Re-enable timer: cairn audit-timer"
  fi
fi

# 5. Memory store (DATA — only with --purge-memory).
if [[ $PURGE_MEMORY -eq 1 ]]; then
  echo "Memory store:"
  remove_path "$STORE_DIR"
fi

# 6. Per-project bootstrap scaffold.
for proj in "${PROJECTS[@]:-}"; do
  [[ -n "$proj" && -d "$proj" ]] || continue
  proj=$(cd "$proj" && pwd)
  echo "Project scaffold: $proj"
  remove_path "$proj/.ai"
  remove_path "$proj/.planning"
  # Strip the .git/info/exclude lines contributor-mode bootstrap added.
  if excl=$(cd "$proj" && git rev-parse --git-path info/exclude 2>/dev/null); then
    [[ "$excl" == /* ]] || excl="$proj/$excl"
    prefix=$(cd "$proj" && git rev-parse --show-prefix 2>/dev/null)
    if [[ -f "$excl" ]] && grep -qxF "/${prefix}.ai/" "$excl" 2>/dev/null; then
      if [[ $DRY_RUN -eq 1 ]]; then
        echo "  would strip .ai/ + .planning/ from ${excl}"
      else
        back_up "$excl"
        grep -vxF -e "/${prefix}.ai/" -e "/${prefix}.planning/" "$excl" >"$excl.tmp" && mv "$excl.tmp" "$excl"
        echo "  stripped exclude entries from ${excl}"
      fi
    fi
  fi
done

# ---- generate revert.sh ------------------------------------------------------
if [[ $DRY_RUN -eq 0 && -f "$MANIFEST" ]]; then
  cat >"$BACKUP_DIR/revert.sh" <<'REVERT'
#!/usr/bin/env bash
# Restore everything cairn uninstall removed/edited from this bundle.
set -euo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
while IFS=$'\t' read -r abs rel; do
  [[ -n "$abs" ]] || continue
  mkdir -p "$(dirname "$abs")"
  rm -rf "$abs"
  cp -a "$here/$rel" "$abs"
  echo "restored: $abs"
done <"$here/manifest.tsv"
echo
echo "Files restored. Command-based steps (if they applied) — see NOTES.txt:"
[[ -f "$here/NOTES.txt" ]] && cat "$here/NOTES.txt"
REVERT
  chmod +x "$BACKUP_DIR/revert.sh"
fi

echo
if [[ $DRY_RUN -eq 1 ]]; then
  echo "Dry run complete — no changes made."
else
  echo "Done. Backup + revert.sh: $BACKUP_DIR"
  echo "  revert with: bash \"$BACKUP_DIR/revert.sh\""
fi
echo "Final step (npm's to do, not this script's): npm uninstall -g @cairnkeep/cli"
