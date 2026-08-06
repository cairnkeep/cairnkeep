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
tree_hash() { find "$1" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1; }
tree_identity() {
  node - "$1" <<'NODE'
const { createHash } = require("crypto")
const { lstatSync, readdirSync, readFileSync } = require("fs")
const { join, relative } = require("path")

const root = process.argv[2]
const entries = []
const visit = (path) => {
  const stat = lstatSync(path)
  const label = relative(root, path) || "."
  const mode = (stat.mode & 0o777).toString(8).padStart(3, "0")
  if (stat.isDirectory()) {
    entries.push(`d\t${mode}\t${label}`)
    for (const name of readdirSync(path).sort()) visit(join(path, name))
    return
  }
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex")
  entries.push(`f\t${mode}\t${label}\t${digest}`)
}
visit(root)
process.stdout.write(createHash("sha256").update(`${entries.join("\n")}\n`).digest("hex"))
NODE
}
managed_hook_count() {
  node -e '
const fs = require("fs")
const settings = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
const names = process.argv.slice(2)
let count = 0
for (const entries of Object.values(settings.hooks ?? {})) {
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const hook of Array.isArray(entry.hooks) ? entry.hooks : []) {
      if (typeof hook.command === "string" && names.some((name) => hook.command.includes(name))) count += 1
    }
  }
}
process.stdout.write(String(count))
' "$1" memory-wakeup.sh memory-capture.sh compaction-capture.sh memory-recall.sh context-explore-pretask.sh
}

capability_hook_count() {
  node -e '
const fs = require("fs")
const settings = JSON.parse(fs.readFileSync(process.argv[1], "utf8"))
let count = 0
for (const entries of Object.values(settings.hooks ?? {})) {
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const hook of Array.isArray(entry.hooks) ? entry.hooks : []) {
      if (typeof hook.command === "string" && /capability-command-(start|finish)\.sh/.test(hook.command)) count += 1
    }
  }
}
process.stdout.write(String(count))
' "$1"
}

# Isolated environment: fake HOME + stubbed system commands.
mkdir -p "$SB/home" "$SB/bin"
printf '#!/usr/bin/env bash\ntrue\n' >"$SB/bin/claude"
printf '#!/usr/bin/env bash\ntrue\n' >"$SB/bin/systemctl"
chmod +x "$SB/bin/"*
export HOME="$SB/home" XDG_CONFIG_HOME="$SB/home/.config" PATH="$SB/bin:$PATH"
LIVE="$SB/live"
PI_LIVE="$SB/pi-live"
KIMI_LIVE="$SB/kimi-live"

echo "test-uninstall"

# --- install the operating layer -------------------------------------------
"$ROOT_DIR/scripts/sync-claude-assets.sh" --apply --live-root "$LIVE" >/dev/null 2>&1
"$ROOT_DIR/scripts/sync-pi-assets.sh" --apply --live-root "$PI_LIVE" >/dev/null 2>&1
"$ROOT_DIR/scripts/sync-kimi-assets.sh" --apply --live-root "$KIMI_LIVE" >/dev/null 2>&1
md_installed=$(find "$LIVE" -type f -name '*.md' | wc -l | tr -d ' ')
check "assets installed" "$([[ $md_installed -gt 0 ]] && echo yes || echo no)" "yes"
check "managed hooks registered" "$(managed_hook_count "$LIVE/settings.json")" "5"
node - "$LIVE/settings.json" <<'NODE'
const fs = require("fs")
const path = process.argv[2]
const settings = JSON.parse(fs.readFileSync(path, "utf8"))
settings.hooks ??= {}
settings.hooks.PostToolUse ??= []
settings.hooks.PostToolUse.push({
  matcher: "Read",
  hooks: [{ type: "command", command: "bash /external/hooks/keep-me.sh" }],
})
fs.writeFileSync(path, JSON.stringify(settings, null, 2) + "\n")
NODE
cp "$LIVE/settings.json" "$SB/settings.before.json"
cp "$PI_LIVE/extensions/cairnkeep-trajectory.ts" "$SB/pi.before.ts"
cp "$PI_LIVE/prompts/graphify.md" "$SB/pi-graph.before.md"
cp "$KIMI_LIVE/skills/graphify/SKILL.md" "$SB/kimi-graph.before.md"
mkdir -p "$SB/home/.cairnkeep/notes/projects/example/hindsight"
printf 'durable note bytes\n' >"$SB/home/.cairnkeep/notes/projects/example/hindsight/failure.md"
mkdir -p "$SB/home/.cairnkeep/notes/.cairnkeep/history/project-notes/knowledge/example" \
  "$SB/home/.cairnkeep/notes/.cairnkeep/transactions/prepared/backups"
printf 'typed sqlite bytes\n' >"$SB/home/.cairnkeep/identity.db"
printf 'typed history bytes\n' >"$SB/home/.cairnkeep/notes/.cairnkeep/history/project-notes/knowledge/example/1.json"
printf 'prepared journal bytes\n' >"$SB/home/.cairnkeep/notes/.cairnkeep/transactions/prepared/journal-v1.json"
printf 'backup bytes\n' >"$SB/home/.cairnkeep/notes/.cairnkeep/transactions/prepared/backups/0.bin"
note_before=$(sha256sum "$SB/home/.cairnkeep/notes/projects/example/hindsight/failure.md" | cut -d' ' -f1)
store_before=$(tree_hash "$SB/home/.cairnkeep")
PROJECT_DATA="$SB/project-data"
ADJACENT_PROJECT="$SB/adjacent-project"
mkdir -p "$PROJECT_DATA/.ai" \
  "$PROJECT_DATA/.agentfs/eval/experiments/complete/snapshots/task-one" \
  "$PROJECT_DATA/.agentfs/eval/experiments/partial" \
  "$ADJACENT_PROJECT/.agentfs/eval/experiments/adjacent"
printf '%s\n' '{"schema_version":1,"capabilities":{"wiki":false},"logging":{"callbacks":true}}' >"$PROJECT_DATA/.ai/capabilities.json"
chmod 600 "$PROJECT_DATA/.ai/capabilities.json"
printf 'operator-owned ai bytes\000must-survive\377\n' >"$PROJECT_DATA/.ai/operator-state.bin"
printf 'artifact-v1\000durable\377bytes\n' >"$PROJECT_DATA/.agentfs/artifacts.db"
printf 'session-and-callback-v1\000durable\377bytes\n' >"$PROJECT_DATA/.agentfs/trajectory.db"
printf 'callback-wal-v1\000durable\377bytes\n' >"$PROJECT_DATA/.agentfs/trajectory.db-wal"
printf 'unrelated-memory-v1\000durable\377bytes\n' >"$PROJECT_DATA/.agentfs/project.db"
printf 'complete-report-v1\000private\377bytes\n' >"$PROJECT_DATA/.agentfs/eval/experiments/complete/report.json"
printf 'partial-report-v1\000private\377bytes\n' >"$PROJECT_DATA/.agentfs/eval/experiments/partial/report.json"
printf 'note-snapshot-v1\000private\377bytes\n' >"$PROJECT_DATA/.agentfs/eval/experiments/complete/snapshots/task-one/note.md"
printf 'adjacent-eval-v1\000must-survive\377bytes\n' >"$ADJACENT_PROJECT/.agentfs/eval/experiments/adjacent/report.json"
chmod 700 "$PROJECT_DATA/.agentfs" "$PROJECT_DATA/.agentfs/eval" \
  "$PROJECT_DATA/.agentfs/eval/experiments" \
  "$PROJECT_DATA/.agentfs/eval/experiments/complete" \
  "$PROJECT_DATA/.agentfs/eval/experiments/complete/snapshots" \
  "$PROJECT_DATA/.agentfs/eval/experiments/complete/snapshots/task-one" \
  "$PROJECT_DATA/.agentfs/eval/experiments/partial"
chmod 600 "$PROJECT_DATA/.agentfs/project.db" \
  "$PROJECT_DATA/.agentfs/eval/experiments/complete/report.json" \
  "$PROJECT_DATA/.agentfs/eval/experiments/partial/report.json"
chmod 400 "$PROJECT_DATA/.agentfs/eval/experiments/complete/snapshots/task-one/note.md"
chmod 700 "$ADJACENT_PROJECT/.agentfs" "$ADJACENT_PROJECT/.agentfs/eval" \
  "$ADJACENT_PROJECT/.agentfs/eval/experiments" \
  "$ADJACENT_PROJECT/.agentfs/eval/experiments/adjacent"
chmod 600 "$ADJACENT_PROJECT/.agentfs/eval/experiments/adjacent/report.json"
cp "$PROJECT_DATA/.ai/capabilities.json" "$SB/capabilities.before.json"
cp "$PROJECT_DATA/.ai/operator-state.bin" "$SB/operator-state.before.bin"
cp "$PROJECT_DATA/.agentfs/artifacts.db" "$SB/artifacts.before.db"
cp "$PROJECT_DATA/.agentfs/trajectory.db" "$SB/trajectory.before.db"
cp "$PROJECT_DATA/.agentfs/trajectory.db-wal" "$SB/trajectory.before.db-wal"
agentfs_before=$(tree_identity "$PROJECT_DATA/.agentfs")
eval_before=$(tree_identity "$PROJECT_DATA/.agentfs/eval")
adjacent_before=$(tree_identity "$ADJACENT_PROJECT/.agentfs")

# Normal and master-off sync are the same inert installation. Replaying an
# explicit overlay request with the master off must not change any legacy byte,
# registration, process state, block state, or measurement state.
CLAUDE_INERT="$SB/claude-inert"
OPENCODE_INERT="$SB/opencode-inert"
env -u CAIRN_CAPABILITY_CONTRACT \
  "$ROOT_DIR/scripts/sync-claude-assets.sh" --apply --live-root "$CLAUDE_INERT" >/dev/null
env -u CAIRN_CAPABILITY_CONTRACT \
  "$ROOT_DIR/scripts/sync-opencode-wiki-assets.sh" --apply --live-root "$OPENCODE_INERT" >/dev/null
env -u CAIRN_CAPABILITY_CONTRACT \
  "$ROOT_DIR/scripts/sync-opencode-graphify-assets.sh" --apply --live-root "$OPENCODE_INERT" >/dev/null
env -u CAIRN_CAPABILITY_CONTRACT \
  "$ROOT_DIR/scripts/sync-opencode-security-assets.sh" --apply --live-root "$OPENCODE_INERT" >/dev/null
cp -a "$CLAUDE_INERT" "$SB/claude-inert.before"
cp -a "$OPENCODE_INERT" "$SB/opencode-inert.before"
CAIRN_CAPABILITY_CONTRACT=0 \
  "$ROOT_DIR/scripts/sync-claude-assets.sh" --apply --capability-overlay --live-root "$CLAUDE_INERT" >/dev/null
CAIRN_CAPABILITY_CONTRACT=0 \
  "$ROOT_DIR/scripts/sync-opencode-wiki-assets.sh" --apply --capability-overlay --live-root "$OPENCODE_INERT" >/dev/null
CAIRN_CAPABILITY_CONTRACT=0 \
  "$ROOT_DIR/scripts/sync-opencode-graphify-assets.sh" --apply --capability-overlay --live-root "$OPENCODE_INERT" >/dev/null
CAIRN_CAPABILITY_CONTRACT=0 \
  "$ROOT_DIR/scripts/sync-opencode-security-assets.sh" --apply --capability-overlay --live-root "$OPENCODE_INERT" >/dev/null
check "master-off Claude sync is exact normal identity" "$(diff -qr "$SB/claude-inert.before" "$CLAUDE_INERT" >/dev/null && echo yes || echo no)" "yes"
check "master-off OpenCode sync is exact normal identity" "$(diff -qr "$SB/opencode-inert.before" "$OPENCODE_INERT" >/dev/null && echo yes || echo no)" "yes"
check "inert Claude sync has no native hooks" "$([[ -e "$CLAUDE_INERT/hooks/capability-command-start.sh" || -e "$CLAUDE_INERT/hooks/capability-command-finish.sh" ]] && echo no || echo yes)" "yes"
check "inert OpenCode sync has no native plugin" "$([[ -e "$OPENCODE_INERT/plugins/capability-command.ts" ]] && echo no || echo yes)" "yes"
check "inert sync creates no measurement state" "$([[ -e "$SB/inert-state" ]] && echo no || echo yes)" "yes"

# Enabled sync owns one isolated project overlay containing legacy operating
# assets plus the native hook/plugin registrations. The whole overlay is a
# reversible managed unit; normal roots above are never cleanup targets.
CLAUDE_OVERLAY="$PROJECT_DATA/.ai/capability-contract/claude"
OPENCODE_OVERLAY="$PROJECT_DATA/.ai/capability-contract/opencode"
CAIRN_CAPABILITY_CONTRACT=1 \
  "$ROOT_DIR/scripts/sync-claude-assets.sh" --apply --capability-overlay --live-root "$CLAUDE_OVERLAY" >/dev/null
CAIRN_CAPABILITY_CONTRACT=1 \
  "$ROOT_DIR/scripts/sync-opencode-wiki-assets.sh" --apply --capability-overlay --live-root "$OPENCODE_OVERLAY" >/dev/null
CAIRN_CAPABILITY_CONTRACT=1 \
  "$ROOT_DIR/scripts/sync-opencode-graphify-assets.sh" --apply --capability-overlay --live-root "$OPENCODE_OVERLAY" >/dev/null
CAIRN_CAPABILITY_CONTRACT=1 \
  "$ROOT_DIR/scripts/sync-opencode-security-assets.sh" --apply --capability-overlay --live-root "$OPENCODE_OVERLAY" >/dev/null
check "enabled overlay registers five Claude hook events" "$(capability_hook_count "$CLAUDE_OVERLAY/settings.json")" "5"
check "enabled overlay registers one OpenCode plugin" "$([[ -f "$OPENCODE_OVERLAY/plugins/capability-command.ts" ]] && echo yes || echo no)" "yes"
check "enabled overlay contains no retired prompt owner" "$([[ -d "$CLAUDE_OVERLAY/capability-contract/commands" || -d "$OPENCODE_OVERLAY/capability-contract/command" || -d "$OPENCODE_OVERLAY/capability-contract/workflows" ]] && echo no || echo yes)" "yes"
overlay_before=$(tree_hash "$PROJECT_DATA/.ai/capability-contract")
project_before=$(tree_hash "$PROJECT_DATA")

# --- dry-run must change nothing -------------------------------------------
"$ROOT_DIR/scripts/uninstall.sh" --dry-run --live-root "$LIVE" --pi-live-root "$PI_LIVE" --kimi-live-root "$KIMI_LIVE" "$PROJECT_DATA" >/dev/null 2>&1
check "dry-run leaves assets" "$(find "$LIVE" -type f -name '*.md' | wc -l | tr -d ' ')" "$md_installed"
check "dry-run makes no bundle" "$(ls -d "$SB/home/.cairnkeep-uninstall-"* 2>/dev/null | wc -l | tr -d ' ')" "0"
check "dry-run leaves Pi extension" "$([[ -f "$PI_LIVE/extensions/cairnkeep-trajectory.ts" ]] && echo yes || echo no)" "yes"
check "dry-run leaves Pi graph prompt" "$([[ -f "$PI_LIVE/prompts/graphify.md" ]] && echo yes || echo no)" "yes"
check "dry-run leaves Kimi graph Skill" "$([[ -f "$KIMI_LIVE/skills/graphify/SKILL.md" ]] && echo yes || echo no)" "yes"
check "dry-run leaves settings identical" "$(cmp -s "$SB/settings.before.json" "$LIVE/settings.json" && echo yes || echo no)" "yes"
check "dry-run leaves artifact bytes exact" "$(cmp -s "$SB/artifacts.before.db" "$PROJECT_DATA/.agentfs/artifacts.db" && echo yes || echo no)" "yes"
check "dry-run leaves eval tree, bytes, and modes exact" "$(tree_identity "$PROJECT_DATA/.agentfs/eval")" "$eval_before"
check "dry-run leaves unrelated project memory exact" "$(tree_identity "$PROJECT_DATA/.agentfs")" "$agentfs_before"
check "dry-run leaves adjacent project exact" "$(tree_identity "$ADJACENT_PROJECT/.agentfs")" "$adjacent_before"
check "dry-run leaves project state byte-identical" "$(tree_hash "$PROJECT_DATA")" "$project_before"

# --- real uninstall ---------------------------------------------------------
"$ROOT_DIR/scripts/uninstall.sh" --yes --live-root "$LIVE" --pi-live-root "$PI_LIVE" --kimi-live-root "$KIMI_LIVE" "$PROJECT_DATA" >/dev/null 2>&1
check "assets removed" "$(find "$LIVE" -type f -name '*.md' | wc -l | tr -d ' ')" "0"
check "managed hooks de-registered" "$(managed_hook_count "$LIVE/settings.json")" "0"
check "unrelated hook preserved" "$(grep -cF 'keep-me.sh' "$LIVE/settings.json" 2>/dev/null || true)" "1"
check "Pi extension removed" "$([[ -e "$PI_LIVE/extensions/cairnkeep-trajectory.ts" ]] && echo no || echo yes)" "yes"
check "Pi graph prompt removed" "$([[ -e "$PI_LIVE/prompts/graphify.md" ]] && echo no || echo yes)" "yes"
check "Kimi graph Skill removed" "$([[ -e "$KIMI_LIVE/skills/graphify/SKILL.md" ]] && echo no || echo yes)" "yes"
check "default uninstall keeps notes" "$(sha256sum "$SB/home/.cairnkeep/notes/projects/example/hindsight/failure.md" | cut -d' ' -f1)" "$note_before"
check "default uninstall keeps all typed and journal bytes" "$(tree_hash "$SB/home/.cairnkeep")" "$store_before"
check "default uninstall keeps artifact bytes exact" "$(cmp -s "$SB/artifacts.before.db" "$PROJECT_DATA/.agentfs/artifacts.db" && echo yes || echo no)" "yes"
check "default uninstall removes managed capability config" "$([[ -e "$PROJECT_DATA/.ai/capabilities.json" ]] && echo no || echo yes)" "yes"
check "default uninstall removes managed capability overlay" "$([[ -e "$PROJECT_DATA/.ai/capability-contract" ]] && echo no || echo yes)" "yes"
check "default uninstall leaves normal Claude installation exact" "$(diff -qr "$SB/claude-inert.before" "$CLAUDE_INERT" >/dev/null && echo yes || echo no)" "yes"
check "default uninstall leaves normal OpenCode installation exact" "$(diff -qr "$SB/opencode-inert.before" "$OPENCODE_INERT" >/dev/null && echo yes || echo no)" "yes"
check "default uninstall keeps unrelated .ai bytes exact" "$(cmp -s "$SB/operator-state.before.bin" "$PROJECT_DATA/.ai/operator-state.bin" && echo yes || echo no)" "yes"
check "default uninstall keeps callback DB exact" "$(cmp -s "$SB/trajectory.before.db" "$PROJECT_DATA/.agentfs/trajectory.db" && echo yes || echo no)" "yes"
check "default uninstall keeps callback WAL exact" "$(cmp -s "$SB/trajectory.before.db-wal" "$PROJECT_DATA/.agentfs/trajectory.db-wal" && echo yes || echo no)" "yes"
check "default uninstall keeps complete and partial eval reports, snapshots, modes, and layout exact" "$(tree_identity "$PROJECT_DATA/.agentfs/eval")" "$eval_before"
check "default uninstall keeps unrelated project memory exact" "$(tree_identity "$PROJECT_DATA/.agentfs")" "$agentfs_before"
check "default uninstall leaves adjacent project exact" "$(tree_identity "$ADJACENT_PROJECT/.agentfs")" "$adjacent_before"
BK=$(ls -d "$SB/home/.cairnkeep-uninstall-"* 2>/dev/null | head -1)
check "revert.sh generated" "$([[ -n "$BK" && -f "$BK/revert.sh" ]] && echo yes || echo no)" "yes"
check "capability config backup is exact" "$(cmp -s "$SB/capabilities.before.json" "$BK/files/${PROJECT_DATA#/}/.ai/capabilities.json" && echo yes || echo no)" "yes"

# --- revert restores everything --------------------------------------------
bash "$BK/revert.sh" >/dev/null 2>&1
check "assets restored" "$(find "$LIVE" -type f -name '*.md' | wc -l | tr -d ' ')" "$md_installed"
check "settings.json identical" "$(cmp -s "$SB/settings.before.json" "$LIVE/settings.json" && echo yes || echo no)" "yes"
check "Pi extension restored" "$(cmp -s "$SB/pi.before.ts" "$PI_LIVE/extensions/cairnkeep-trajectory.ts" && echo yes || echo no)" "yes"
check "Pi graph prompt restored" "$(cmp -s "$SB/pi-graph.before.md" "$PI_LIVE/prompts/graphify.md" && echo yes || echo no)" "yes"
check "Kimi graph Skill restored" "$(cmp -s "$SB/kimi-graph.before.md" "$KIMI_LIVE/skills/graphify/SKILL.md" && echo yes || echo no)" "yes"
check "capability config bytes restored" "$(cmp -s "$SB/capabilities.before.json" "$PROJECT_DATA/.ai/capabilities.json" && echo yes || echo no)" "yes"
check "capability overlay bytes restored" "$(tree_hash "$PROJECT_DATA/.ai/capability-contract")" "$overlay_before"
check "capability hook registrations restored" "$(capability_hook_count "$CLAUDE_OVERLAY/settings.json")" "5"
check "capability plugin restored" "$([[ -f "$OPENCODE_OVERLAY/plugins/capability-command.ts" ]] && echo yes || echo no)" "yes"
check "capability config mode restored" "$(stat -c '%a' "$PROJECT_DATA/.ai/capabilities.json" 2>/dev/null || stat -f '%Lp' "$PROJECT_DATA/.ai/capabilities.json")" "600"
check "unrelated .ai bytes remain exact after revert" "$(cmp -s "$SB/operator-state.before.bin" "$PROJECT_DATA/.ai/operator-state.bin" && echo yes || echo no)" "yes"
check "default-uninstall revert leaves retained eval exact" "$(tree_identity "$PROJECT_DATA/.agentfs/eval")" "$eval_before"

# --- project artifact purge is backup-first and exactly reversible ---------
ARTIFACT_HOME="$SB/artifact-home"
mkdir -p "$ARTIFACT_HOME"
HOME="$ARTIFACT_HOME" XDG_CONFIG_HOME="$ARTIFACT_HOME/.config" \
  "$ROOT_DIR/scripts/uninstall.sh" --yes --purge-memory --live-root "$SB/unused-live" --pi-live-root "$SB/unused-pi" "$PROJECT_DATA" >/dev/null 2>&1
check "artifact purge removes project store" "$([[ -e "$PROJECT_DATA/.agentfs" ]] && echo no || echo yes)" "yes"
ARTIFACT_BK=$(ls -dt "$ARTIFACT_HOME/.cairnkeep-uninstall-"* 2>/dev/null | head -1)
check "artifact purge backup is exact" "$(cmp -s "$SB/artifacts.before.db" "$ARTIFACT_BK/files/${PROJECT_DATA#/}/.agentfs/artifacts.db" && echo yes || echo no)" "yes"
check "callback purge backup is exact" "$(cmp -s "$SB/trajectory.before.db" "$ARTIFACT_BK/files/${PROJECT_DATA#/}/.agentfs/trajectory.db" && echo yes || echo no)" "yes"
check "callback WAL purge backup is exact" "$(cmp -s "$SB/trajectory.before.db-wal" "$ARTIFACT_BK/files/${PROJECT_DATA#/}/.agentfs/trajectory.db-wal" && echo yes || echo no)" "yes"
check "purge backup contains exact eval tree, bytes, and modes" "$(tree_identity "$ARTIFACT_BK/files/${PROJECT_DATA#/}/.agentfs/eval")" "$eval_before"
check "purge backup contains exact unrelated project memory" "$(tree_identity "$ARTIFACT_BK/files/${PROJECT_DATA#/}/.agentfs")" "$agentfs_before"
check "selected-project purge leaves adjacent project exact" "$(tree_identity "$ADJACENT_PROJECT/.agentfs")" "$adjacent_before"
HOME="$ARTIFACT_HOME" XDG_CONFIG_HOME="$ARTIFACT_HOME/.config" bash "$ARTIFACT_BK/revert.sh" >/dev/null 2>&1
check "artifact revert restores exact bytes" "$(cmp -s "$SB/artifacts.before.db" "$PROJECT_DATA/.agentfs/artifacts.db" && echo yes || echo no)" "yes"
check "callback revert restores exact bytes" "$(cmp -s "$SB/trajectory.before.db" "$PROJECT_DATA/.agentfs/trajectory.db" && echo yes || echo no)" "yes"
check "callback WAL revert restores exact bytes" "$(cmp -s "$SB/trajectory.before.db-wal" "$PROJECT_DATA/.agentfs/trajectory.db-wal" && echo yes || echo no)" "yes"
check "purge revert restores exact eval tree, bytes, and modes" "$(tree_identity "$PROJECT_DATA/.agentfs/eval")" "$eval_before"
check "purge revert restores exact unrelated project memory" "$(tree_identity "$PROJECT_DATA/.agentfs")" "$agentfs_before"
check "purge revert leaves adjacent project exact" "$(tree_identity "$ADJACENT_PROJECT/.agentfs")" "$adjacent_before"

# --- project scaffold + memory purge round-trip ----------------------------
PROJ="$SB/proj"; mkdir -p "$PROJ"; git -C "$PROJ" init -q
"$ROOT_DIR/scripts/bootstrap.sh" --untracked "$PROJ" >/dev/null 2>&1
EXCL="$PROJ/.git/info/exclude"
mkdir -p "$SB/home/.cairnkeep/notes/projects/example/hindsight"; echo data >"$SB/home/.cairnkeep/db"
printf 'purge and restore exact note bytes\n' >"$SB/home/.cairnkeep/notes/projects/example/hindsight/failure.md"
purge_note_before=$(sha256sum "$SB/home/.cairnkeep/notes/projects/example/hindsight/failure.md" | cut -d' ' -f1)
purge_store_before=$(tree_hash "$SB/home/.cairnkeep")
"$ROOT_DIR/scripts/uninstall.sh" --yes --purge-memory --live-root "$SB/home/.claude" "$PROJ" >/dev/null 2>&1
check "project .ai removed"      "$([[ -e "$PROJ/.ai" ]] && echo no || echo yes)" "yes"
check "project .agentfs removed" "$([[ -e "$PROJ/.agentfs" ]] && echo no || echo yes)" "yes"
check "exclude lines stripped"   "$(grep -cE '\.ai/|\.planning/|\.agentfs/' "$EXCL" 2>/dev/null || true)" "0"
check "memory store purged"      "$([[ -e "$SB/home/.cairnkeep" ]] && echo no || echo yes)" "yes"
BK2=$(ls -dt "$SB/home/.cairnkeep-uninstall-"* 2>/dev/null | head -1)
bash "$BK2/revert.sh" >/dev/null 2>&1
check "project scaffold restored" "$([[ -d "$PROJ/.ai" ]] && echo yes || echo no)" "yes"
check "project ignore restored"   "$([[ -f "$PROJ/.agentfs/.gitignore" ]] && echo yes || echo no)" "yes"
check "memory store restored"     "$(cat "$SB/home/.cairnkeep/db" 2>/dev/null)" "data"
check "note store restored exactly" "$(sha256sum "$SB/home/.cairnkeep/notes/projects/example/hindsight/failure.md" | cut -d' ' -f1)" "$purge_note_before"
check "typed and journal state restored exactly" "$(tree_hash "$SB/home/.cairnkeep")" "$purge_store_before"

# --- context-pack data requires its own explicit purge consent ---------------
PACK_HOME="$SB/pack-home"
PACK_STORE="$PACK_HOME/.cairnkeep/packs"
mkdir -p "$PACK_STORE/objects/example" "$PACK_HOME/.cairnkeep/memory"
printf 'immutable pack\n' >"$PACK_STORE/objects/example/marker"
printf 'memory\n' >"$PACK_HOME/.cairnkeep/memory/marker"
pack_output=$(HOME="$PACK_HOME" XDG_CONFIG_HOME="$PACK_HOME/.config" \
  CAIRN_AGENTFS_BASE_DIR="$PACK_HOME/.cairnkeep" CAIRN_PACK_BASE_DIR="$PACK_STORE" \
  "$ROOT_DIR/scripts/uninstall.sh" --yes --live-root "$SB/pack-live" --pi-live-root "$SB/pack-pi" --kimi-live-root "$SB/pack-kimi" 2>&1)
check "ordinary uninstall reports retained context packs" "$(grep -q 'kept context packs' <<<"$pack_output" && echo yes || echo no)" "yes"
check "ordinary uninstall retains context packs" "$([[ -f "$PACK_STORE/objects/example/marker" ]] && echo yes || echo no)" "yes"
HOME="$PACK_HOME" XDG_CONFIG_HOME="$PACK_HOME/.config" \
  CAIRN_AGENTFS_BASE_DIR="$PACK_HOME/.cairnkeep" CAIRN_PACK_BASE_DIR="$PACK_STORE" \
  "$ROOT_DIR/scripts/uninstall.sh" --yes --purge-memory --live-root "$SB/pack-live" --pi-live-root "$SB/pack-pi" --kimi-live-root "$SB/pack-kimi" >/dev/null 2>&1
check "memory purge retains context packs" "$([[ -f "$PACK_STORE/objects/example/marker" ]] && echo yes || echo no)" "yes"
check "memory purge removes non-pack memory" "$([[ -e "$PACK_HOME/.cairnkeep/memory" ]] && echo no || echo yes)" "yes"
HOME="$PACK_HOME" XDG_CONFIG_HOME="$PACK_HOME/.config" \
  CAIRN_AGENTFS_BASE_DIR="$PACK_HOME/.cairnkeep" CAIRN_PACK_BASE_DIR="$PACK_STORE" \
  "$ROOT_DIR/scripts/uninstall.sh" --yes --purge-packs --live-root "$SB/pack-live" --pi-live-root "$SB/pack-pi" --kimi-live-root "$SB/pack-kimi" >/dev/null 2>&1
check "explicit pack purge removes context packs" "$([[ -e "$PACK_STORE" ]] && echo no || echo yes)" "yes"

echo
if [[ "$fails" -gt 0 ]]; then echo "test-uninstall: $fails check(s) failed."; exit 1; fi
echo "test-uninstall: OK"
