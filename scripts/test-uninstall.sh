#!/usr/bin/env bash
# test-uninstall.sh — install/uninstall/revert cycle for uninstall.sh.
#
# uninstall.sh removes and edits real user state (assets, settings.json hooks,
# MCP registration, the memory store), so it is tested in a fully isolated HOME
# with stubbed `claude`/`systemctl` — it never touches the real machine. Asserts
# the three properties that matter: dry-run changes nothing, uninstall removes
# what cairnkeep owns, and revert.sh restores it exactly.
set -uo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SB=$(mktemp -d)
trap 'rm -rf "$SB"' EXIT

fails=0
ok()   { printf '  [PASS] %s\n' "$1"; }
bad()  { printf '  [FAIL] %s\n' "$1"; fails=$((fails + 1)); }
check() { if [[ "$2" == "$3" ]]; then ok "$1 ($2)"; else bad "$1 (got '$2', want '$3')"; fi; }

# Isolated environment: fake HOME + stubbed system commands.
mkdir -p "$SB/home" "$SB/bin"
printf '#!/usr/bin/env bash\ntrue\n' >"$SB/bin/claude"
printf '#!/usr/bin/env bash\ntrue\n' >"$SB/bin/systemctl"
chmod +x "$SB/bin/"*
export HOME="$SB/home" XDG_CONFIG_HOME="$SB/home/.config" PATH="$SB/bin:$PATH"
LIVE="$SB/live"

echo "test-uninstall"

# --- install the operating layer -------------------------------------------
"$ROOT_DIR/scripts/sync-claude-assets.sh" --apply --live-root "$LIVE" >/dev/null 2>&1
md_installed=$(find "$LIVE" -type f -name '*.md' | wc -l | tr -d ' ')
check "assets installed" "$([[ $md_installed -gt 0 ]] && echo yes || echo no)" "yes"
check "hooks registered" "$(grep -c 'hooks/' "$LIVE/settings.json")" "4"
cp "$LIVE/settings.json" "$SB/settings.before.json"

# --- dry-run must change nothing -------------------------------------------
"$ROOT_DIR/scripts/uninstall.sh" --dry-run --live-root "$LIVE" >/dev/null 2>&1
check "dry-run leaves assets" "$(find "$LIVE" -type f -name '*.md' | wc -l | tr -d ' ')" "$md_installed"
check "dry-run makes no bundle" "$(ls -d "$SB/home/.cairnkeep-uninstall-"* 2>/dev/null | wc -l | tr -d ' ')" "0"

# --- real uninstall ---------------------------------------------------------
"$ROOT_DIR/scripts/uninstall.sh" --yes --live-root "$LIVE" >/dev/null 2>&1
check "assets removed" "$(find "$LIVE" -type f -name '*.md' | wc -l | tr -d ' ')" "0"
check "hooks de-registered" "$(grep -c 'hooks/' "$LIVE/settings.json" 2>/dev/null || true)" "0"
BK=$(ls -d "$SB/home/.cairnkeep-uninstall-"* 2>/dev/null | head -1)
check "revert.sh generated" "$([[ -n "$BK" && -f "$BK/revert.sh" ]] && echo yes || echo no)" "yes"

# --- revert restores everything --------------------------------------------
bash "$BK/revert.sh" >/dev/null 2>&1
check "assets restored" "$(find "$LIVE" -type f -name '*.md' | wc -l | tr -d ' ')" "$md_installed"
check "settings.json identical" "$(cmp -s "$SB/settings.before.json" "$LIVE/settings.json" && echo yes || echo no)" "yes"

# --- project scaffold + memory purge round-trip ----------------------------
PROJ="$SB/proj"; mkdir -p "$PROJ"; git -C "$PROJ" init -q
"$ROOT_DIR/scripts/bootstrap.sh" --untracked "$PROJ" >/dev/null 2>&1
EXCL="$PROJ/.git/info/exclude"
mkdir -p "$SB/home/.cairnkeep"; echo data >"$SB/home/.cairnkeep/db"
"$ROOT_DIR/scripts/uninstall.sh" --yes --purge-memory --live-root "$SB/home/.claude" "$PROJ" >/dev/null 2>&1
check "project .ai removed"      "$([[ -e "$PROJ/.ai" ]] && echo no || echo yes)" "yes"
check "exclude lines stripped"   "$(grep -cE '\.ai/|\.planning/' "$EXCL" 2>/dev/null || true)" "0"
check "memory store purged"      "$([[ -e "$SB/home/.cairnkeep" ]] && echo no || echo yes)" "yes"
BK2=$(ls -dt "$SB/home/.cairnkeep-uninstall-"* 2>/dev/null | head -1)
bash "$BK2/revert.sh" >/dev/null 2>&1
check "project scaffold restored" "$([[ -d "$PROJ/.ai" ]] && echo yes || echo no)" "yes"
check "memory store restored"     "$(cat "$SB/home/.cairnkeep/db" 2>/dev/null)" "data"

echo
if [[ "$fails" -gt 0 ]]; then echo "test-uninstall: $fails check(s) failed."; exit 1; fi
echo "test-uninstall: OK"
