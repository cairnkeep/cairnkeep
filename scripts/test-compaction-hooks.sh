#!/usr/bin/env bash
# Cross-harness compaction capture/recovery contract. The default invocation
# is the complete green integration path and remains safe for root test globs.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MODE="${1:-}"
EXPECTED_RED_EXIT=86
MISSING_CAPABILITY=85
RED_MARKER="PHASE17_RED:COMPACTION_HOOK_RECOVERY_MISSING"

case "$MODE" in
  ""|--expect-red|--claude-only|--opencode-only|--full) ;;
  *) echo "usage: $0 [--expect-red|--claude-only|--opencode-only|--full]" >&2; exit 2 ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $1" >&2; return 1; }

claude_fixture="$ROOT/mcp-memory-server/scripts/fixtures/compaction-claude-code-2.1.219.json"
claude_fixture_220="$ROOT/mcp-memory-server/scripts/fixtures/compaction-claude-code-2.1.220.json"
opencode_event_fixture="$ROOT/mcp-memory-server/scripts/fixtures/compaction-opencode-1.17.20-event.json"
opencode_messages_fixture="$ROOT/mcp-memory-server/scripts/fixtures/compaction-opencode-1.17.20-messages.json"
PARITY_RECOVERY=$'## Compaction recovery\nSource: project_fallback\nSession: canonical:prior\nRevision: 2\nCaptured: 2026-07-25T00:00:00.000Z\nAge: 172800 seconds\nHarness: canonical\nCompleteness: goals=missing, decisions=missing, todos=missing, errors=missing\nWarning: this state is stale; validate it against the current repository before relying on it.\n\n### Task Goals\n(none captured)\n\n### Decisions Made\n(none captured)\n\n### Open TODOs\n(none captured)\n\n### Critical Error Traces\n(none captured)\n'

render() {
  local source="$1"
  local destination="$2"
  local infra_root="${3:-$ROOT}"
  sed "s|@@INFRA_ROOT@@|$infra_root|g" "$source" > "$destination"
}

assert_marker_free() {
  local path="$1"
  ! grep -qF "$RED_MARKER" "$path" || fail "default baseline emitted the compaction RED marker"
}

run_existing_baseline() {
  local output="$tmp/existing-baseline.out"
  "$ROOT/scripts/test-trajectory-hooks.sh" >"$output" 2>&1
  grep -qF "PASS: Claude/OpenCode/Pi trajectory hooks and flag-off regression" "$output" \
    || fail "existing trajectory hook baseline did not pass"
  assert_marker_free "$output"
}

validate_fixtures() {
  node - "$claude_fixture" "$claude_fixture_220" "$opencode_event_fixture" "$opencode_messages_fixture" <<'NODE'
const fs = require("fs")
const [claudePath, claude220Path, eventPath, messagesPath] = process.argv.slice(2)
const claude = JSON.parse(fs.readFileSync(claudePath, "utf8"))
const claude220 = JSON.parse(fs.readFileSync(claude220Path, "utf8"))
const event = JSON.parse(fs.readFileSync(eventPath, "utf8"))
const envelope = JSON.parse(fs.readFileSync(messagesPath, "utf8"))
if (claude.hook_event_name !== "PostCompact" || typeof claude.compact_summary !== "string") process.exit(1)
if (claude220.hook_event_name !== "PostCompact" || typeof claude220.prompt_id !== "string") process.exit(1)
if (Object.keys(claude220).sort().join(",") !== ["compact_summary", "cwd", "hook_event_name", "prompt_id", "session_id", "transcript_path", "trigger"].sort().join(",")) process.exit(1)
if (event.type !== "session.compacted" || Object.keys(event.properties ?? {}).join(",") !== "sessionID") process.exit(1)
if (envelope.session?.id !== event.properties.sessionID || !Array.isArray(envelope.messages)) process.exit(1)
NODE
}

require_managed_sources() {
  local missing=0
  [[ -f "$ROOT/claude/hooks/compaction-capture.sh" ]] || missing=1
  grep -qF "compaction-capture.sh)" "$ROOT/scripts/sync-claude-assets.sh" || missing=1
  grep -qF 'session.compacted' "$ROOT/opencode/plugins/memory-capture.ts" || missing=1
  grep -qF 'CAIRN_COMPACTION_CAPTURE' "$ROOT/opencode/plugins/memory-wakeup.ts" || missing=1
  [[ "$missing" -eq 0 ]] || return "$MISSING_CAPABILITY"
}

make_fake_infra() {
  local fake_root="$1"
  mkdir -p "$fake_root/mcp-memory-server/dist"
  cat > "$fake_root/mcp-memory-server/dist/artifact-cli.js" <<'NODE'
import fs from "node:fs"
const args = process.argv.slice(2)
const command = args[0] ?? ""
const input = command.startsWith("capture-") ? await new Promise((resolve) => {
  let value = ""
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (chunk) => { value += chunk })
  process.stdin.on("end", () => resolve(value))
}) : ""
if (process.env.CAIRN_TEST_CALLS) {
  fs.appendFileSync(process.env.CAIRN_TEST_CALLS, `${JSON.stringify({ args, input })}\n`)
}
if (command === "recover" && process.env.CAIRN_TEST_RECOVERY) {
  process.stdout.write(process.env.CAIRN_TEST_RECOVERY)
}
NODE
}

write_fake_claude() {
  local fake_bin="$1"
  local version="$2"
  mkdir -p "$fake_bin"
  cat > "$fake_bin/claude" <<EOF
#!/usr/bin/env bash
printf '%s (Claude Code)\n' '$version'
EOF
  chmod +x "$fake_bin/claude"
}

assert_no_spy_calls() {
  local prefix="$1"
  [[ ! -e "$prefix.node" ]] || fail "$prefix started Node while compaction capture was disabled"
  [[ ! -e "$prefix.python" ]] || fail "$prefix parsed JSON while compaction capture was disabled"
  [[ ! -e "$prefix.curl" ]] || fail "$prefix attempted network access while compaction capture was disabled"
}

make_path_spies() {
  local spy_dir="$1"
  local prefix="$2"
  mkdir -p "$spy_dir"
  for executable in node python3 curl; do
    cat > "$spy_dir/$executable" <<EOF
#!/usr/bin/env bash
touch "$prefix.${executable%%3}"
exit 97
EOF
    chmod +x "$spy_dir/$executable"
  done
}

claude_disabled_contract() {
  local hook="$1"
  local wakeup="$2"
  local repo="$tmp/claude-disabled"
  local spies="$tmp/claude-disabled-spies"
  local prefix="$tmp/claude-disabled-call"
  mkdir -p "$repo"
  make_path_spies "$spies" "$prefix"
  local before after
  before=$(find "$repo" -type f -print | sort)
  (cd "$repo" && printf '%s\n' '{not-json' | \
    PATH="$spies:$PATH" CAIRN_ARTIFACT_STORE=1 "$hook") \
    >"$tmp/claude-disabled.out" 2>"$tmp/claude-disabled.err"
  after=$(find "$repo" -type f -print | sort)
  [[ "$before" == "$after" ]] || fail "disabled Claude capture changed project files"
  [[ ! -s "$tmp/claude-disabled.out" && ! -s "$tmp/claude-disabled.err" ]] \
    || fail "disabled Claude capture emitted output"
  assert_no_spy_calls "$prefix"

  (cd "$repo" && printf '%s\n' '{not-json' | \
    PATH="$spies:$PATH" CAIRN_ARTIFACT_STORE=1 "$wakeup") \
    >"$tmp/claude-wakeup-disabled.out" 2>"$tmp/claude-wakeup-disabled.err"
  [[ ! -s "$tmp/claude-wakeup-disabled.out" && ! -s "$tmp/claude-wakeup-disabled.err" ]] \
    || fail "disabled Claude recovery changed the empty-project baseline"
  assert_no_spy_calls "$prefix"
}

claude_enabled_contract() {
  local fake_root="$tmp/fake-infra-claude"
  local calls="$tmp/claude-calls.jsonl"
  local hook="$tmp/compaction-capture.sh"
  local wakeup="$tmp/memory-wakeup.sh"
  local repo="$tmp/claude-enabled"
  local fake_bin="$tmp/claude-enabled-bin"
  make_fake_infra "$fake_root"
  write_fake_claude "$fake_bin" "2.1.219"
  render "$ROOT/claude/hooks/compaction-capture.sh" "$hook" "$fake_root"
  render "$ROOT/claude/hooks/memory-wakeup.sh" "$wakeup" "$fake_root"
  chmod +x "$hook" "$wakeup"
  claude_disabled_contract "$hook" "$wakeup"
  mkdir -p "$repo/.agentfs"
  touch "$repo/.agentfs/artifacts.db"

  (cd "$repo" && PATH="$fake_bin:$PATH" CAIRN_COMPACTION_CAPTURE=1 CAIRN_TEST_CALLS="$calls" \
    timeout 3 "$hook" < "$claude_fixture") >"$tmp/claude-enabled.out" 2>"$tmp/claude-enabled.err"
  [[ ! -s "$tmp/claude-enabled.out" ]] || fail "enabled Claude capture emitted stdout"
  node - "$calls" "$claude_fixture" <<'NODE'
const fs = require("fs")
const calls = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map(JSON.parse)
const fixture = JSON.parse(fs.readFileSync(process.argv[3], "utf8"))
if (calls.length !== 1 || calls[0].args[0] !== "capture-claude") process.exit(1)
if (calls[0].args.slice(-2).join("=") !== "--harness-version=2.1.219") process.exit(1)
if (JSON.stringify(JSON.parse(calls[0].input)) !== JSON.stringify(fixture)) process.exit(1)
NODE

  rm -f "$calls"
  write_fake_claude "$fake_bin" "2.1.220"
  (cd "$repo" && PATH="$fake_bin:$PATH" CAIRN_COMPACTION_CAPTURE=1 CAIRN_TEST_CALLS="$calls" \
    timeout 3 "$hook" < "$claude_fixture_220") >"$tmp/claude-220.out" 2>"$tmp/claude-220.err"
  node - "$calls" "$claude_fixture_220" <<'NODE'
const fs = require("fs")
const calls = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map(JSON.parse)
const fixture = JSON.parse(fs.readFileSync(process.argv[3], "utf8"))
if (calls.length !== 1 || calls[0].args.slice(-2).join("=") !== "--harness-version=2.1.220") process.exit(1)
if (JSON.stringify(JSON.parse(calls[0].input)) !== JSON.stringify(fixture)) process.exit(1)
NODE

  rm -f "$calls"
  write_fake_claude "$fake_bin" "2.1.219"
  (cd "$repo" && PATH="$fake_bin:$PATH" CAIRN_COMPACTION_CAPTURE=1 CAIRN_ARTIFACT_STORE=1 \
    CAIRN_ARTIFACT_HTTP=1 CAIRN_TEST_CALLS="$calls" timeout 3 "$hook" < "$claude_fixture") \
    >"$tmp/claude-both-http.out" 2>"$tmp/claude-both-http.err"
  [[ $(wc -l < "$calls") -eq 1 ]] || fail "Claude both-flags/HTTP capture changed local call count"

  local current_recovery fallback_recovery stale_recovery
  current_recovery=$'Source: current_session\nSession: claude-code:claude-compaction-session-001\nRevision: 2\nTask Goals\n- current goal\nDecisions Made\n- current decision\nOpen TODOs\n- current todo\nCritical Error Traces\n- current error\n'
  fallback_recovery=$'Source: project_fallback\nSession: claude-code:prior\nRevision: 1\nTask Goals\n- fallback goal\nDecisions Made\n- fallback decision\nOpen TODOs\n- fallback todo\nCritical Error Traces\n- fallback error\n'
  stale_recovery="$PARITY_RECOVERY"
  for case_name in current fallback stale; do
    case "$case_name" in
      current) recovery="$current_recovery"; session_id="claude-compaction-session-001" ;;
      fallback) recovery="$fallback_recovery"; session_id="fresh-session" ;;
      stale) recovery="$stale_recovery"; session_id="fresh-stale-session" ;;
    esac
    (cd "$repo" && CAIRN_COMPACTION_CAPTURE=1 CAIRN_TEST_CALLS="$calls" CAIRN_TEST_RECOVERY="$recovery" \
      "$wakeup" <<<"{\"session_id\":\"$session_id\",\"source\":\"startup\"}") \
      >"$tmp/claude-$case_name-recovery.out" 2>"$tmp/claude-$case_name-recovery.err"
    grep -qF "## Compaction recovery" "$tmp/claude-$case_name-recovery.out" \
      || fail "Claude $case_name recovery heading is missing"
    grep -qF "Task Goals" "$tmp/claude-$case_name-recovery.out" \
      || fail "Claude $case_name recovery body is missing"
    ! grep -qiE 'raw_summary|compact_summary|Bearer|sk-' "$tmp/claude-$case_name-recovery.out" \
      || fail "Claude $case_name recovery injected raw summary data"
  done

  (cd "$repo" && CAIRN_COMPACTION_CAPTURE=1 CAIRN_TEST_CALLS="$calls" "$wakeup" <<<'{not-json') \
    >"$tmp/claude-malformed.out" 2>"$tmp/claude-malformed.err"
  [[ ! -s "$tmp/claude-malformed.err" ]] || fail "malformed Claude recovery did not fail open"
}

claude_sync_contract() {
  local live="$tmp/claude-live"
  "$ROOT/scripts/sync-claude-assets.sh" --apply --live-root "$live" >/dev/null
  "$ROOT/scripts/sync-claude-assets.sh" --apply --live-root "$live" >/dev/null
  [[ -x "$live/hooks/compaction-capture.sh" ]] || fail "installed PostCompact hook is not executable"
  local registrations
  registrations=$(node - "$live/settings.json" <<'NODE'
const fs = require("fs")
const settings = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
let count = 0
for (const entry of settings.hooks?.PostCompact ?? []) {
  if (entry.matcher !== undefined && entry.matcher !== "") process.exit(2)
  for (const hook of entry.hooks ?? []) {
    if (String(hook.command ?? "").includes("compaction-capture.sh")) count += 1
  }
}
process.stdout.write(String(count))
NODE
  )
  [[ "$registrations" -eq 1 ]] || fail "PostCompact registration is missing, matched, or duplicated"
}

write_opencode_harness() {
  cat > "$tmp/opencode-compaction-harness.mjs" <<'NODE'
import assert from "node:assert/strict"
import fs from "node:fs"
import { pathToFileURL } from "node:url"
const [capturePath, wakeupPath, eventPath, messagesPath, repo, mode] = process.argv.slice(2)
const event = JSON.parse(fs.readFileSync(eventPath, "utf8"))
const envelope = JSON.parse(fs.readFileSync(messagesPath, "utf8"))
const calls = []
const client = { session: {
  get: async (input) => { calls.push(["get", input]); return { data: envelope.session } },
  messages: async (input) => { calls.push(["messages", input]); return { data: envelope.messages } },
} }
const capture = await import(`${pathToFileURL(capturePath).href}?capture=${Date.now()}`)
const plugin = await capture.MemoryCapturePlugin({ client, directory: repo })
await plugin.event({ event })
if (mode === "disabled") {
  assert.deepEqual(calls, [])
  assert.equal(fs.existsSync(process.env.CAIRN_TEST_CALLS), false)
} else {
  assert.deepEqual(calls.map(([name]) => name), ["get", "messages"])
  const subprocess = fs.readFileSync(process.env.CAIRN_TEST_CALLS, "utf8").trim().split("\n").map(JSON.parse)
  assert.equal(subprocess.length, 1)
  assert.equal(subprocess[0].args[0], "capture-opencode")
  const payload = JSON.parse(subprocess[0].input)
  assert.equal(payload.event.type, "session.compacted")
  assert.equal(payload.session.id, envelope.session.id)
  assert.equal(payload.harness_version, "1.17.20")
  assert.deepEqual(payload.messages, envelope.messages)
}

const shellCalls = []
const dollar = (...args) => {
  shellCalls.push(args)
  return { quiet() { return this }, nothrow: async () => ({ stdout: "" }) }
}
const wakeup = await import(`${pathToFileURL(wakeupPath).href}?wakeup=${Date.now()}`)
const wakeupPlugin = await wakeup.MemoryWakeupPlugin({ $: dollar, directory: repo })
const output = { system: [] }
await wakeupPlugin["experimental.chat.system.transform"]({ sessionID: envelope.session.id }, output)
if (mode === "disabled") {
  assert.deepEqual(shellCalls, [])
  assert.deepEqual(output.system, [])
} else {
  assert.equal(output.system.some((value) => String(value).includes("Task Goals")), true)
  assert.equal(output.system.some((value) => /raw_summary|compact_summary|Bearer|sk-/i.test(String(value))), false)
  if (process.env.CAIRN_TEST_SYSTEM_OUTPUT) {
    fs.writeFileSync(process.env.CAIRN_TEST_SYSTEM_OUTPUT, JSON.stringify(output.system))
  }
}
NODE
}

opencode_contract() {
  local fake_root="$tmp/fake-infra-opencode"
  local calls="$tmp/opencode-calls.jsonl"
  local capture="$tmp/opencode-memory-capture.ts"
  local wakeup="$tmp/opencode-memory-wakeup.ts"
  local repo="$tmp/opencode-project"
  make_fake_infra "$fake_root"
  render "$ROOT/opencode/plugins/memory-capture.ts" "$capture" "$fake_root"
  render "$ROOT/opencode/plugins/memory-wakeup.ts" "$wakeup" "$fake_root"
  mkdir -p "$repo"
  write_opencode_harness

  CAIRN_ARTIFACT_STORE=1 CAIRN_TEST_CALLS="$calls" node --experimental-strip-types \
    "$tmp/opencode-compaction-harness.mjs" "$capture" "$wakeup" \
    "$opencode_event_fixture" "$opencode_messages_fixture" "$repo" disabled \
    >"$tmp/opencode-disabled.out" 2>"$tmp/opencode-disabled.err"
  [[ ! -s "$tmp/opencode-disabled.out" && ! -s "$tmp/opencode-disabled.err" ]] \
    || fail "disabled OpenCode compaction path emitted output"

  local recovery
  recovery="$PARITY_RECOVERY"
  rm -f "$calls"
  CAIRN_COMPACTION_CAPTURE=1 CAIRN_TEST_CALLS="$calls" CAIRN_TEST_RECOVERY="$recovery" \
    CAIRN_TEST_SYSTEM_OUTPUT="$tmp/opencode-system.json" \
    timeout 3 node --experimental-strip-types "$tmp/opencode-compaction-harness.mjs" \
    "$capture" "$wakeup" "$opencode_event_fixture" "$opencode_messages_fixture" "$repo" enabled \
    >"$tmp/opencode-enabled.out" 2>"$tmp/opencode-enabled.err"
  [[ ! -s "$tmp/opencode-enabled.out" && ! -s "$tmp/opencode-enabled.err" ]] \
    || fail "enabled OpenCode compaction path emitted output"

  rm -f "$calls"
  CAIRN_COMPACTION_CAPTURE=1 CAIRN_ARTIFACT_STORE=1 CAIRN_ARTIFACT_HTTP=1 \
    CAIRN_TEST_CALLS="$calls" CAIRN_TEST_RECOVERY="$recovery" \
    timeout 3 node --experimental-strip-types "$tmp/opencode-compaction-harness.mjs" \
    "$capture" "$wakeup" "$opencode_event_fixture" "$opencode_messages_fixture" "$repo" enabled \
    >"$tmp/opencode-both.out" 2>"$tmp/opencode-both.err"
  [[ -s "$calls" ]] || fail "OpenCode capture did not remain active with both flags"

  rm -f "$calls"
  CAIRN_ARTIFACT_HTTP=1 CAIRN_TEST_CALLS="$calls" node --experimental-strip-types \
    "$tmp/opencode-compaction-harness.mjs" "$capture" "$wakeup" \
    "$opencode_event_fixture" "$opencode_messages_fixture" "$repo" disabled \
    >"$tmp/opencode-http-only.out" 2>"$tmp/opencode-http-only.err"
  [[ ! -e "$calls" ]] || fail "HTTP consent alone activated OpenCode compaction work"

  local live="$tmp/opencode-live"
  "$ROOT/scripts/sync-opencode-plugin-assets.sh" --apply --live-root "$live" >/dev/null
  "$ROOT/scripts/sync-opencode-plugin-assets.sh" --apply --live-root "$live" >/dev/null
  [[ $(find "$live" -type f -name 'memory-capture.ts' | wc -l) -eq 1 ]] \
    || fail "OpenCode compaction capture plugin is duplicated"
  [[ $(find "$live" -type f -name 'memory-wakeup.ts' | wc -l) -eq 1 ]] \
    || fail "OpenCode compaction recovery plugin is duplicated"
}

assert_semantic_parity() {
  node - "$tmp/claude-stale-recovery.out" "$tmp/opencode-system.json" <<'NODE'
const fs = require("fs")
const claude = fs.readFileSync(process.argv[2], "utf8")
const opencode = JSON.parse(fs.readFileSync(process.argv[3], "utf8"))
const heading = "## Compaction recovery"
const claudeSection = claude.slice(claude.indexOf(heading)).trim()
const opencodeSection = opencode.find((value) => String(value).includes(heading))?.trim()
if (!claudeSection || claudeSection !== opencodeSection) process.exit(1)
const ordered = [
  "Source:", "Session:", "Revision:", "Captured:", "Age:", "Harness:", "Completeness:",
  "Warning:", "### Task Goals", "### Decisions Made", "### Open TODOs", "### Critical Error Traces",
]
let position = -1
for (const marker of ordered) {
  const next = claudeSection.indexOf(marker)
  if (next <= position) process.exit(2)
  position = next
}
if ((claudeSection.match(/\(none captured\)/g) ?? []).length !== 4) process.exit(3)
if (!/validate it against the current repository/i.test(claudeSection)) process.exit(4)
NODE
}

artifact_revision_contract() {
  local cli="$ROOT/mcp-memory-server/dist/artifact-cli.js"
  local claude_repo="$tmp/claude-revisions"
  local opencode_repo="$tmp/opencode-revisions"
  local real_hook="$tmp/real-compaction-capture.sh"
  local fake_bin="$tmp/claude-revisions-bin"
  mkdir -p "$claude_repo" "$opencode_repo"
  write_fake_claude "$fake_bin" "2.1.219"
  render "$ROOT/claude/hooks/compaction-capture.sh" "$real_hook"
  chmod +x "$real_hook"

  node - "$claude_fixture" "$tmp/claude-second.json" <<'NODE'
const fs = require("fs")
const fixture = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
fixture.compact_summary += "\n- TODO: Validate parity after the second revision."
fs.writeFileSync(process.argv[3], JSON.stringify(fixture))
NODE
  (cd "$claude_repo" && PATH="$fake_bin:$PATH" CAIRN_COMPACTION_CAPTURE=1 "$real_hook" < "$claude_fixture")
  (cd "$claude_repo" && PATH="$fake_bin:$PATH" CAIRN_COMPACTION_CAPTURE=1 "$real_hook" < "$tmp/claude-second.json")

  node - "$opencode_event_fixture" "$opencode_messages_fixture" \
    "$tmp/opencode-first.json" "$tmp/opencode-second.json" <<'NODE'
const fs = require("fs")
const event = JSON.parse(fs.readFileSync(process.argv[2], "utf8"))
const envelope = JSON.parse(fs.readFileSync(process.argv[3], "utf8"))
const first = { event, session: envelope.session, messages: envelope.messages, harness_version: "1.17.20" }
const second = structuredClone(first)
const summary = second.messages.find((message) => message.info?.id === "oc-summary-valid-new")
const text = summary?.parts?.find((part) => part.type === "text" && part.ignored !== true)
if (!text) process.exit(1)
text.text += "\n- TODO: Validate parity after the second revision."
fs.writeFileSync(process.argv[4], JSON.stringify(first))
fs.writeFileSync(process.argv[5], JSON.stringify(second))
NODE
  node "$cli" capture-opencode "$opencode_repo" < "$tmp/opencode-first.json"
  node "$cli" capture-opencode "$opencode_repo" < "$tmp/opencode-second.json"

  node - "$cli" "$claude_repo" "$opencode_repo" <<'NODE'
const fs = require("fs")
const { spawnSync } = require("child_process")
const [cli, claudeRepo, opencodeRepo] = process.argv.slice(2)
const cases = [
  { repo: claudeRepo, session: "claude-code:claude-compaction-session-001", secrets: ["claude-compaction-secret-001", "sk-claude-compaction-secret-002"] },
  { repo: opencodeRepo, session: "opencode:opencode-compaction-session-001", secrets: ["opencode-compaction-secret-001", "sk-opencode-compaction-secret-002"] },
]
const run = (repo, args) => {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: repo, encoding: "utf8" })
  if (result.status !== 0 || result.stderr) process.exit(1)
  return result.stdout
}
for (const value of cases) {
  const listedOutput = run(value.repo, ["list", "--kind", "compaction_summary", "--json"])
  const listed = JSON.parse(listedOutput)
  if (listed.artifacts.length !== 2) process.exit(2)
  const shown = listed.artifacts.map((artifact) => JSON.parse(run(value.repo, ["show", artifact.artifact_id, "--json"])))
  if (shown.some((artifact) => artifact.session_ref !== value.session)) process.exit(3)
  if (shown.map((artifact) => artifact.content.revision).sort().join(",") !== "1,2") process.exit(4)
  if (shown.some((artifact) => typeof artifact.content.raw_summary !== "string")) process.exit(5)
  const current = run(value.repo, ["recover", value.repo, "--session-ref", value.session])
  const fallback = run(value.repo, ["recover", value.repo, "--session-ref", `${value.session}-fresh`])
  if (!current.includes("Source: current_session") || !current.includes("Revision: 2")) process.exit(6)
  if (!fallback.includes("Source: project_fallback") || !fallback.includes("Revision: 2")) process.exit(7)
  const automatic = `${listedOutput}\n${current}\n${fallback}`
  if (/raw_summary|compact_summary/i.test(automatic)) process.exit(8)
  const storeBytes = ["artifacts.db", "artifacts.db-wal", "artifacts.db-shm"]
    .flatMap((name) => {
      const path = `${value.repo}/.agentfs/${name}`
      return fs.existsSync(path) ? [fs.readFileSync(path).toString("latin1")] : []
    }).join("\n")
  for (const secret of value.secrets) {
    if (storeBytes.includes(secret) || automatic.includes(secret) || JSON.stringify(shown).includes(secret)) process.exit(9)
  }
}
NODE
}

run_claude_contract() {
  require_managed_sources || return $?
  claude_enabled_contract
  claude_sync_contract
}

run_opencode_contract() {
  require_managed_sources || return $?
  opencode_contract
}

run_existing_baseline
validate_fixtures

if [[ "$MODE" == "--expect-red" ]]; then
  set +e
  require_managed_sources
  status=$?
  set -e
  if [[ "$status" -eq "$MISSING_CAPABILITY" ]]; then
    echo "$RED_MARKER"
    exit "$EXPECTED_RED_EXIT"
  fi
  [[ "$status" -eq 0 ]] || exit "$status"
  echo "FAIL: compaction hook/recovery integration unexpectedly exists; run a GREEN mode" >&2
  exit 1
fi

case "$MODE" in
  --claude-only) run_claude_contract ;;
  --opencode-only) run_opencode_contract ;;
  ""|--full)
    node "$ROOT/mcp-memory-server/scripts/smoke-compaction-capture.mjs" >/dev/null
    run_claude_contract
    run_opencode_contract
    assert_semantic_parity
    artifact_revision_contract
    ;;
esac

echo "PASS: compaction hook capture, recovery, disabled paths and sync contract"
