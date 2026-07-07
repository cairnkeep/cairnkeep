#!/usr/bin/env bash
set -euo pipefail
shopt -s nullglob

usage() {
  cat <<'EOF'
Usage: sync-claude-assets.sh [--check|--apply] [--live-root PATH]

Compare or sync the repo-managed Claude Code assets (commands, agents) and the
security/wiki scaffold templates against the live Claude Code config tree.

Options:
  --check            Verify that the live assets match the repo copy (default)
  --apply            Copy the repo-managed assets into the live Claude tree, then verify
  --live-root PATH   Override the live Claude root (default: $CLAUDE_CONFIG_DIR or $HOME/.claude)
  -h, --help         Show this help text

Notes:
  - Claude assets source of truth lives under ./claude/ (commands/, agents/).
  - Installs claude/commands/*.md -> <live>/commands/ and claude/agents/*.md -> <live>/agents/.
  - Also installs templates/{security,wiki}-*.template -> <live>/templates/ so the
    /security-audit and /wiki-* commands can scaffold from $HOME/.claude/templates/.
  - Renders claude/hooks/*.sh -> <live>/hooks/ (substituting @@INFRA_ROOT@@) and
    idempotently registers the SessionStart wakeup hook in <live>/settings.json
    (backs up settings.json.bak first; matches by command so re-runs are no-ops).
  - New families are picked up automatically once added under ./claude/.
EOF
}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CLAUDE_SOURCE="$ROOT_DIR/claude"
TEMPLATE_SOURCE="$ROOT_DIR/templates"
LIVE_ROOT="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
MODE="check"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check) MODE="check"; shift ;;
    --apply) MODE="apply"; shift ;;
    --live-root) LIVE_ROOT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ ! -d "$CLAUDE_SOURCE" ]]; then
  echo "No repo-managed Claude assets found at $CLAUDE_SOURCE" >&2
  exit 1
fi

# Build the list of (source-abs, dest-abs) pairs.
SRCS=()
DSTS=()

# 1. claude/ tree -> <live>/...
while IFS= read -r rel; do
  SRCS+=("$CLAUDE_SOURCE/$rel")
  DSTS+=("$LIVE_ROOT/$rel")
done < <(cd "$CLAUDE_SOURCE" && find . -type f -name '*.md' | sed 's|^\./||' | sort)

# 2. security/wiki scaffold templates -> <live>/templates/
for tpl in "$TEMPLATE_SOURCE"/security-*.template "$TEMPLATE_SOURCE"/wiki-*.template; do
  [[ -f "$tpl" ]] || continue
  SRCS+=("$tpl")
  DSTS+=("$LIVE_ROOT/templates/$(basename "$tpl")")
done

if ((${#SRCS[@]} == 0)); then
  echo "No managed assets found to sync" >&2
  exit 1
fi

status=0
for i in "${!SRCS[@]}"; do
  src="${SRCS[$i]}"
  dst="${DSTS[$i]}"
  rel="${dst#"$LIVE_ROOT"/}"
  if [[ "$MODE" == "apply" ]]; then
    mkdir -p "$(dirname "$dst")"
    cp "$src" "$dst"
    echo "installed: $rel"
  else
    if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
      echo "ok: $rel"
    else
      echo "DRIFT: $rel"
      status=1
    fi
  fi
done

# Claude hooks: render @@INFRA_ROOT@@ and register each hook on its correct
# event in <live>/settings.json. This is the one place that touches the global
# user settings; it backs up first and matches by command so re-runs are no-ops.
HOOK_LIVE_DIR="$LIVE_ROOT/hooks"
SETTINGS_FILE="$LIVE_ROOT/settings.json"

# Map hook filename -> "event[:matcher][@timeout]". matcher only for
# PreToolUse-style events; an optional trailing "@timeout" (seconds) threads
# an explicit per-hook timeout into the settings.json registration entry so
# Claude Code's kill budget is documented, not assumed (Pitfall 1).
declare -A HOOK_EVENTS=(
  ["memory-wakeup.sh"]="SessionStart"
  ["memory-capture.sh"]="SessionEnd"
  ["memory-recall.sh"]="PreToolUse:Edit|Write|MultiEdit"
  ["context-explore-pretask.sh"]="UserPromptSubmit@25"
)

for hook_src in "$CLAUDE_SOURCE"/hooks/*.sh; do
  [[ -f "$hook_src" ]] || continue
  hook_name="$(basename "$hook_src")"
  hook_dst="$HOOK_LIVE_DIR/$hook_name"
  hook_cmd="bash \"$hook_dst\""
  event_spec="${HOOK_EVENTS[$hook_name]:-}"
  if [[ -z "$event_spec" ]]; then
    # Unknown hook: still render it, but do not auto-register (avoid stomping settings).
    if [[ "$MODE" == "apply" ]]; then
      mkdir -p "$HOOK_LIVE_DIR"
      sed "s|@@INFRA_ROOT@@|$ROOT_DIR|g" "$hook_src" > "$hook_dst"
      chmod +x "$hook_dst"
      echo "installed (unregistered): hooks/$hook_name"
    fi
    continue
  fi
  hook_timeout=""
  if [[ "$event_spec" == *"@"* ]]; then
    hook_timeout="${event_spec##*@}"
    event_spec="${event_spec%@*}"
  fi
  event="${event_spec%%:*}"
  matcher="${event_spec#*:}"
  [[ "$matcher" == "$event_spec" ]] && matcher=""
  if [[ "$MODE" == "apply" ]]; then
    mkdir -p "$HOOK_LIVE_DIR"
    sed "s|@@INFRA_ROOT@@|$ROOT_DIR|g" "$hook_src" > "$hook_dst"
    chmod +x "$hook_dst"
    echo "installed: hooks/$hook_name"
    node -e '
const fs = require("fs");
const [p, cmd, token, event, matcher, timeoutStr] = process.argv.slice(1);
let s = {};
if (fs.existsSync(p)) {
  try { s = JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { console.error("settings.json parse failed, leaving untouched"); process.exit(1); }
}
s.hooks = s.hooks || {};
s.hooks[event] = Array.isArray(s.hooks[event]) ? s.hooks[event] : [];
const already = s.hooks[event].some((entry) =>
  Array.isArray(entry.hooks) && entry.hooks.some((h) => typeof h.command === "string" && h.command.includes(token)));
if (already) { console.log(`ok: ${event} hook already registered`); process.exit(0); }
if (fs.existsSync(p)) fs.copyFileSync(p, p + ".bak");
const hookObj = { type: "command", command: cmd };
if (timeoutStr) hookObj.timeout = parseInt(timeoutStr, 10);
const entry = matcher
  ? { matcher, hooks: [hookObj] }
  : { hooks: [hookObj] };
s.hooks[event].push(entry);
fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
console.log(`registered: ${event} hook${matcher ? " (" + matcher + ")" : ""}${timeoutStr ? " (timeout=" + timeoutStr + "s)" : ""}`);
' "$SETTINGS_FILE" "$hook_cmd" "$hook_dst" "$event" "$matcher" "$hook_timeout" || status=1
  else
    if [[ -f "$hook_dst" ]] && grep -qF "$hook_name" "$SETTINGS_FILE" 2>/dev/null; then
      echo "ok: hooks/$hook_name"
    else
      echo "DRIFT: hooks/$hook_name"
      status=1
    fi
  fi
done


if [[ "$MODE" == "apply" ]]; then
  for i in "${!SRCS[@]}"; do
    if ! cmp -s "${SRCS[$i]}" "${DSTS[$i]}"; then
      echo "VERIFY FAILED: ${DSTS[$i]#"$LIVE_ROOT"/}" >&2
      status=1
    fi
  done
  [[ "$status" -eq 0 ]] && echo "All Claude assets installed and verified into $LIVE_ROOT."
fi

exit "$status"
