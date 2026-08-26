#!/usr/bin/env bash
# Phase 17 package/operator/reversibility contract. The default invocation
# exercises the complete shipped lifecycle; the historical RED gate is explicit.
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MODE="${1:-}"
EXPECTED_RED_EXIT=86
RED_MARKER="PHASE17_RED:ARTIFACT_PACKAGE_LIFECYCLE_MISSING"

case "$MODE" in
  ""|--expect-red) ;;
  *) echo "Usage: $0 [--expect-red]" >&2; exit 2 ;;
esac
[[ "$MODE" != "" || "$#" -eq 0 ]] || exit 2
[[ "$MODE" != "--expect-red" || "$#" -eq 1 ]] || exit 2

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
baseline_number=0
missing=0

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

mark_missing() {
  missing=$((missing + 1))
  echo "MISSING: $1" >&2
}

run_baseline_check() {
  baseline_number=$((baseline_number + 1))
  local output="$tmp/baseline-$baseline_number.out"
  if ! "$@" >"$output" 2>&1; then
    cat "$output" >&2
    fail "baseline failed: $*"
  fi
  if grep -qF 'PHASE17_RED:' "$output"; then
    cat "$output" >&2
    fail "baseline emitted a Phase 17 RED marker: $*"
  fi
  cat "$output"
}

run_shell_syntax_baseline() {
  local script
  while IFS= read -r script; do
    bash -n "$script" || return 1
  done < <(find "$ROOT/bin" "$ROOT/scripts" -type f -name '*.sh' | sort)
}

run_baseline() {
  run_baseline_check "$ROOT/scripts/test-package-install.sh"
  run_baseline_check "$ROOT/scripts/test-uninstall.sh"
  run_baseline_check "$ROOT/scripts/test-doctor.sh"
  run_baseline_check "$ROOT/scripts/test-cli-dispatch.sh"
  run_baseline_check "$ROOT/scripts/test-completion.sh"
  run_baseline_check "$ROOT/scripts/test-runtime-contract.sh"
  run_baseline_check run_shell_syntax_baseline
  run_baseline_check "$ROOT/scripts/test-portable-sh.sh"
  echo "PASS: Phase 17 package/operator pre-feature baseline"
}

require_term() {
  local path="$1"
  local term="$2"
  local label="$3"
  if ! grep -qiF "$term" "$path"; then
    mark_missing "$label"
  fi
}

require_pattern() {
  local path="$1"
  local pattern="$2"
  local label="$3"
  if ! grep -qiE "$pattern" "$path"; then
    mark_missing "$label"
  fi
}

inspect_package() {
  local listing="$tmp/pack.json"
  local paths="$tmp/pack-paths.txt"
  if ! (cd "$ROOT" && npm pack --dry-run --json --ignore-scripts) >"$listing" 2>"$tmp/pack.err"; then
    cat "$tmp/pack.err" >&2
    fail "npm pack dry-run failed"
  fi
  if ! node - "$listing" >"$paths" <<'NODE'
const fs = require("fs");
const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (!Array.isArray(input) || input.length !== 1 || !Array.isArray(input[0].files)) {
  throw new Error("unexpected npm pack JSON shape");
}
for (const entry of input[0].files) {
  if (!entry || typeof entry.path !== "string") throw new Error("invalid npm pack file entry");
  process.stdout.write(`${entry.path}\n`);
}
NODE
  then
    fail "npm pack dry-run JSON could not be parsed"
  fi

  local expected
  for expected in \
    schemas/artifact.schema.json \
    mcp-memory-server/dist/artifact-schema.js \
    mcp-memory-server/dist/artifact-store.js \
    mcp-memory-server/dist/compaction-normalize.js \
    mcp-memory-server/dist/artifact-cli.js \
    claude/hooks/compaction-capture.sh \
    opencode/plugins/memory-capture.ts \
    opencode/plugins/memory-wakeup.ts \
    mcp-memory-server/scripts/fixtures/compaction-claude-code-2.1.219.json \
    mcp-memory-server/scripts/fixtures/compaction-claude-code-2.1.220.json \
    mcp-memory-server/scripts/fixtures/compaction-opencode-1.17.20-event.json \
    mcp-memory-server/scripts/fixtures/compaction-opencode-1.17.20-messages.json
  do
    grep -qxF "$expected" "$paths" || mark_missing "npm package asset $expected"
  done

  if node - "$paths" <<'NODE'
const fs = require("fs");
const paths = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").filter(Boolean);
const forbidden = paths.filter((path) =>
  /(^|\/)\.agentfs\//.test(path)
  || /\.db(?:-wal|-shm)?$/i.test(path)
  || /(^|\/)runtime-evidence\//.test(path)
  || /(^|\/)(?:generated-)?artifacts?\/(?:projects|sessions|data)\//i.test(path)
);
if (forbidden.length > 0) {
  for (const path of forbidden) console.error(`forbidden packaged artifact data: ${path}`);
  process.exit(1);
}
NODE
  then
    :
  else
    fail "npm package contains a database, sidecar, or generated artifact data"
  fi
}

check_cli_and_completion() {
  local help="$tmp/cairn-help.out"
  "$ROOT/bin/cairn" help >"$help" 2>"$tmp/cairn-help.err" || fail "cairn help failed"
  require_term "$help" 'cairn artifact <list|show|delete|prune>' "artifact CLI help tree"

  if grep -qF 'cairn artifact <list|show|delete|prune>' "$help"; then
    if ! "$ROOT/bin/cairn" artifact --help >"$tmp/artifact-help.out" 2>"$tmp/artifact-help.err"; then
      cat "$tmp/artifact-help.err" >&2
      fail "advertised artifact CLI dispatch is broken"
    fi
  fi

  local shell output
  for shell in bash zsh fish; do
    output="$tmp/completion-$shell.out"
    "$ROOT/bin/cairn" completion "$shell" >"$output" || fail "$shell completion generation failed"
    require_pattern "$output" 'artifact.*list.*show.*delete.*prune' "$shell completion artifact list/show/delete/prune tree"
  done

  require_term "$ROOT/scripts/test-cli-dispatch.sh" 'artifact' "artifact CLI dispatch regression coverage"
  require_term "$ROOT/scripts/test-completion.sh" 'artifact' "artifact completion regression coverage"
}

check_doctor_contract() {
  require_term "$ROOT/scripts/doctor.sh" 'artifact_cli=' "doctor artifact CLI integration"
  require_term "$ROOT/scripts/doctor.sh" 'artifact store (not present' "doctor absent artifact state"
  require_term "$ROOT/scripts/doctor.sh" 'artifact store integrity' "doctor valid artifact state"
  require_term "$ROOT/scripts/doctor.sh" 'artifact store repaired' "doctor derived-state repair"
  require_pattern "$ROOT/scripts/doctor.sh" 'artifact.*could not be repaired safely|artifact.*authoritative.*corrupt' "doctor authoritative corruption failure"
  require_term "$ROOT/scripts/test-doctor.sh" 'artifacts.db' "doctor artifact database fixtures"
  require_pattern "$ROOT/scripts/test-doctor.sh" 'derived.*repair|repair.*derived' "doctor derived repair regression case"
  require_pattern "$ROOT/scripts/test-doctor.sh" 'authoritative.*(fail|corrupt)|corrupt.*authoritative' "doctor authoritative failure regression case"
}

check_env_contract() {
  local env_template="$ROOT/templates/env.example.template"
  local expected key
  for expected in \
    'CAIRN_COMPACTION_CAPTURE=1' \
    'CAIRN_ARTIFACT_STORE=1' \
    'CAIRN_ARTIFACT_HTTP=1' \
    'CAIRN_ARTIFACT_MAX_BYTES=1048576' \
    'CAIRN_ARTIFACT_SESSION_MAX_BYTES=16777216' \
    'CAIRN_ARTIFACT_STORE_MAX_BYTES=268435456' \
    'CAIRN_ARTIFACT_RETENTION_DAYS=30' \
    'CAIRN_COMPACTION_MAX_REVISIONS=8' \
    'CAIRN_ARTIFACT_GENERATED_FILE_SNAPSHOT_MAX_BYTES=262144'
  do
    grep -qxF "# $expected" "$env_template" || mark_missing "commented env default $expected"
    key=${expected%%=*}
    if grep -qE "^[[:space:]]*${key}=" "$env_template"; then
      fail "$key is enabled in the environment template"
    fi
  done
  require_pattern "$env_template" 'off by default|default-off|disabled by default' "artifact and compaction default-off env guidance"
}

check_uninstall_bytes() {
  local fixture_home="$tmp/uninstall-home"
  local fixture_bin="$tmp/uninstall-bin"
  local project="$tmp/uninstall-project"
  local live="$tmp/uninstall-live"
  local pi_live="$tmp/uninstall-pi-live"
  local original="$tmp/artifacts.original"
  local bundle backup_copy

  mkdir -p "$fixture_home" "$fixture_bin" "$project/.ai" "$project/.agentfs" "$live" "$pi_live"
  printf '#!/usr/bin/env bash\nexit 0\n' >"$fixture_bin/claude"
  printf '#!/usr/bin/env bash\nexit 0\n' >"$fixture_bin/systemctl"
  chmod +x "$fixture_bin/claude" "$fixture_bin/systemctl"
  git -C "$project" init -q || fail "uninstall fixture git init failed"
  printf 'artifact-v1\000durable\377bytes\n' >"$project/.agentfs/artifacts.db"
  cp "$project/.agentfs/artifacts.db" "$original"

  HOME="$fixture_home" XDG_CONFIG_HOME="$fixture_home/.config" PATH="$fixture_bin:$PATH" \
    "$ROOT/scripts/uninstall.sh" --dry-run --live-root "$live" --pi-live-root "$pi_live" "$project" \
    >"$tmp/uninstall-dry-run.out" 2>&1 || fail "artifact uninstall dry-run failed"
  cmp -s "$original" "$project/.agentfs/artifacts.db" || fail "uninstall dry-run mutated artifact bytes"
  if find "$fixture_home" -maxdepth 1 -name '.cairnkeep-uninstall-*' | grep -q .; then
    fail "uninstall dry-run created a backup bundle"
  fi

  HOME="$fixture_home" XDG_CONFIG_HOME="$fixture_home/.config" PATH="$fixture_bin:$PATH" \
    "$ROOT/scripts/uninstall.sh" --yes --live-root "$live" --pi-live-root "$pi_live" "$project" \
    >"$tmp/uninstall-keep.out" 2>&1 || fail "default artifact uninstall failed"
  cmp -s "$original" "$project/.agentfs/artifacts.db" || fail "default uninstall did not retain exact artifact bytes"

  HOME="$fixture_home" XDG_CONFIG_HOME="$fixture_home/.config" PATH="$fixture_bin:$PATH" \
    "$ROOT/scripts/uninstall.sh" --yes --purge-memory --live-root "$live" --pi-live-root "$pi_live" "$project" \
    >"$tmp/uninstall-purge.out" 2>&1 || fail "artifact purge uninstall failed"
  [[ ! -e "$project/.agentfs" ]] || fail "artifact purge left the project store in place"
  bundle=$(find "$fixture_home" -maxdepth 1 -type d -name '.cairnkeep-uninstall-*' | sort | tail -1)
  [[ -n "$bundle" && -x "$bundle/revert.sh" ]] || fail "artifact purge did not generate a revert script"
  backup_copy="$bundle/files/${project#/}/.agentfs/artifacts.db"
  cmp -s "$original" "$backup_copy" || fail "artifact purge backup did not preserve exact bytes"
  HOME="$fixture_home" XDG_CONFIG_HOME="$fixture_home/.config" PATH="$fixture_bin:$PATH" \
    bash "$bundle/revert.sh" >"$tmp/uninstall-revert.out" 2>&1 || fail "artifact revert failed"
  cmp -s "$original" "$project/.agentfs/artifacts.db" || fail "artifact revert did not restore exact bytes"
}

check_docs_contract() {
  local public_doc
  for public_doc in "$ROOT/docs/operating.md"; do
    require_term "$public_doc" 'CAIRN_COMPACTION_CAPTURE' "$(basename "$public_doc") compaction flag"
    require_term "$public_doc" 'CAIRN_ARTIFACT_STORE' "$(basename "$public_doc") artifact-store flag"
    require_term "$public_doc" 'CAIRN_ARTIFACT_HTTP' "$(basename "$public_doc") artifact HTTP flag"
    require_term "$public_doc" 'cairn artifact' "$(basename "$public_doc") artifact CLI"
    require_term "$public_doc" 'artifact_write' "$(basename "$public_doc") artifact_write tool"
    require_term "$public_doc" 'artifact_read' "$(basename "$public_doc") artifact_read tool"
    require_term "$public_doc" 'artifact_list' "$(basename "$public_doc") artifact_list tool"
    require_term "$public_doc" 'artifact_delete' "$(basename "$public_doc") artifact_delete tool"
    require_pattern "$public_doc" 'CAIRN_(COMPACTION_CAPTURE|ARTIFACT_STORE)[^.]{0,240}(off by default|default-off|disabled by default)|(off by default|default-off|disabled by default)[^.]{0,240}CAIRN_(COMPACTION_CAPTURE|ARTIFACT_STORE)' "$(basename "$public_doc") disabled behavior"
  done

  local storage="$ROOT/docs/storage.md"
  require_term "$storage" '.agentfs/artifacts.db' "storage local artifact location"
  require_term "$storage" 'server-side' "storage server-side remote location"
  require_term "$storage" 'X-Cairn-Project' "storage remote project identity"
  require_pattern "$storage" 'artifact.*(index|indexes)|index.*artifact' "storage artifact indexes"
  require_pattern "$storage" 'artifact.*retention|retention.*artifact' "storage artifact retention"
  require_pattern "$storage" 'artifact.*backup|backup.*artifact' "storage artifact backup"
  require_pattern "$storage" 'artifact.*migration|migration.*artifact|no migration' "storage artifact migration"

  local privacy="$ROOT/docs/privacy-and-data-flow.md"
  require_term "$privacy" 'PostCompact' "privacy Claude local compaction flow"
  require_term "$privacy" 'session.compacted' "privacy OpenCode local compaction flow"
  require_pattern "$privacy" 'artifact.*stdio|stdio.*artifact' "privacy local stdio artifact flow"
  require_term "$privacy" 'CAIRN_ARTIFACT_HTTP' "privacy explicit HTTP artifact flow"
  require_pattern "$privacy" 'redact[^.]{0,160}(before|then)[^.]{0,160}(digest|index|write)' "privacy redaction-before-derived-data order"
  require_pattern "$privacy" 'artifact[^.]{0,220}no default egress|no default egress[^.]{0,220}artifact' "privacy no-default-egress statement"
  require_pattern "$privacy" 'artifact[^.]{0,220}(no telemetry|telemetry.*none|without telemetry)|(no telemetry|telemetry.*none|without telemetry)[^.]{0,220}artifact' "privacy no-telemetry statement"
  require_pattern "$privacy" 'raw[^.]{0,100}(on demand|on-demand)|on-demand[^.]{0,100}raw' "privacy raw-summary-on-demand-only recovery"
}

check_dependency_delta() {
  local first_phase_commit last_phase_commit phase_base
  first_phase_commit=$(git -C "$ROOT" log --reverse --format='%H' --grep='^test(17-01):' HEAD | head -1)
  [[ -n "$first_phase_commit" ]] || fail "cannot resolve the first Phase 17 source commit"
  last_phase_commit=$(git -C "$ROOT" log --format='%H %s' HEAD \
    | awk '$2 ~ /^[a-z]+\(17-[0-9]+\):$/ { print $1; exit }')
  [[ -n "$last_phase_commit" ]] || fail "cannot resolve the last Phase 17 source commit"
  phase_base=$(git -C "$ROOT" rev-parse "$first_phase_commit^") || fail "cannot resolve the pre-Phase 17 base"

  if ! node - "$ROOT" "$phase_base" "$last_phase_commit" <<'NODE'
const { execFileSync } = require("child_process");
const [root, base, terminal] = process.argv.slice(2);
const loadAt = (commit, path) => JSON.parse(execFileSync(
  "git",
  ["-C", root, "show", `${commit}:${path}`],
  { encoding: "utf8" },
));
const normalize = (value) => Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
const selected = (value, includeVersion) => ({
  ...(includeVersion ? { version: value.version } : {}),
  dependencies: normalize(value.dependencies ?? {}),
  devDependencies: normalize(value.devDependencies ?? {}),
  optionalDependencies: normalize(value.optionalDependencies ?? {}),
  peerDependencies: normalize(value.peerDependencies ?? {}),
});
for (const [path, includeVersion] of [["package.json", true], ["mcp-memory-server/package.json", false]]) {
  const before = selected(loadAt(base, path), includeVersion);
  const after = selected(loadAt(terminal, path), includeVersion);
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    console.error(`dependency or version delta from pre-phase base: ${path}`);
    process.exit(1);
  }
}
NODE
  then
    fail "package dependency/version declarations changed during Phase 17"
  fi
  git -C "$ROOT" diff --quiet "$phase_base" "$last_phase_commit" -- package-lock.json mcp-memory-server/package-lock.json \
    || fail "lockfile changed during Phase 17"
}

check_runtime_evidence() {
  local evidence_dir="$ROOT/.planning/phases/17-compaction-capture-and-artifact-store/runtime-evidence"
  local validation="$ROOT/.planning/phases/17-compaction-capture-and-artifact-store/17-VALIDATION.md"
  local version log
  for version in 22 24 26; do
    log="$evidence_dir/node$version.log"
    if [[ ! -s "$log" ]]; then
      mark_missing "actual Node $version runtime evidence"
    else
      grep -qE 'PASS|passed|test:smoke' "$log" || fail "Node $version evidence does not record a passing changed suite"
    fi
    require_pattern "$validation" "Node $version observed GREEN at commit [0-9a-f]{7,40}" "Node $version tested-commit validation wording"
  done
  log="$evidence_dir/bash32.log"
  if [[ ! -s "$log" ]]; then
    mark_missing "actual Bash 3.2 runtime evidence"
  else
    grep -qF 'smoke-bash32: OK' "$log" || fail "Bash 3.2 evidence does not record a passing smoke run"
  fi
}

run_baseline
inspect_package
check_cli_and_completion
check_doctor_contract
check_env_contract
check_uninstall_bytes
check_docs_contract
check_dependency_delta

if [[ "$missing" -gt 0 ]]; then
  if [[ "$MODE" == "--expect-red" ]]; then
    printf '%s\n' "$RED_MARKER" >&2
    exit "$EXPECTED_RED_EXIT"
  fi
  fail "Phase 17 package/operator lifecycle contract is incomplete"
fi

if [[ "$MODE" != "--expect-red" ]]; then
  echo "PASS: Phase 17 package/operator lifecycle contract"
  exit 0
fi

check_runtime_evidence
if [[ "$missing" -gt 0 ]]; then
  printf '%s\n' "$RED_MARKER" >&2
  exit "$EXPECTED_RED_EXIT"
fi

echo "Phase 17 package/operator lifecycle is already complete; expected RED is stale" >&2
exit 1
