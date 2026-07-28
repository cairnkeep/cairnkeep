#!/usr/bin/env bash
# Phase 19 evaluation lifecycle RED and later GREEN mode contract.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
MODE="${1:-composed}"
[[ $# -gt 0 ]] && shift

usage() {
  cat <<'USAGE'
Usage: test-phase19-eval-lifecycle.sh [expected-red|workspace|two-pass|ablation|report|retention|claims|fake|cancellation|package]
       test-phase19-eval-lifecycle.sh
USAGE
}

fail() { echo "FAIL: $1" >&2; exit 1; }

case "$MODE" in
  composed|expected-red|workspace|two-pass|ablation|report|retention|claims|fake|cancellation|package)
    [[ $# -eq 0 ]] || { usage >&2; exit 2; }
    ;;
  *) usage >&2; exit 2 ;;
esac

# Selector validation intentionally precedes all fixture mutation.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
runner="$ROOT/mcp-memory-server/dist/eval-runner.js"
workspace="$ROOT/mcp-memory-server/dist/eval-workspace.js"
report="$ROOT/mcp-memory-server/dist/eval-report.js"
statistics="$ROOT/mcp-memory-server/dist/eval-statistics.js"
eval_cli="$ROOT/mcp-memory-server/dist/eval-cli.js"

baseline() {
  bash -n "$ROOT/scripts/test-phase19-eval-lifecycle.sh" "$ROOT/scripts/test-eval-cli.sh"
  node --check "$ROOT/scripts/verify-phase19-runtime-evidence.mjs"
  [[ ! -e "$tmp/project" && ! -e "$tmp/output" && ! -e "$tmp/network" ]] || fail "baseline began with dirty sentinels"
  env -u CAIRN_EVAL node -e 'process.exit(0)'
  [[ ! -e "$tmp/project" && ! -e "$tmp/output" && ! -e "$tmp/network" ]] || fail "disabled baseline created a side effect"
  echo "PASS: Phase 19 lifecycle Wave 0 baseline"
}

require_exports() {
  local module=$1
  shift
  node --input-type=module - "$module" "$@" <<'NODE'
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
const [modulePath, ...names] = process.argv.slice(2);
const value = await import(pathToFileURL(modulePath).href);
for (const name of names) assert.equal(typeof value[name], "function", `missing export ${name}`);
NODE
}

run_workspace() {
  require_exports "$workspace" createEvalWorkspace runTaskPreparation runTaskVerifier cleanupEvalWorkspace
  node --input-type=module - "$workspace" "$tmp" <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [modulePath, fixtureRoot] = process.argv.slice(2);
const api = await import(pathToFileURL(modulePath).href);
const repo = join(fixtureRoot, "workspace-repo");
mkdirSync(repo);
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
git("init", "-q");
git("config", "user.name", "Evaluation Fixture");
git("config", "user.email", "evaluation-fixture@example.invalid");
writeFileSync(join(repo, "source.txt"), "clean-source\n");
git("add", "source.txt");
git("commit", "-qm", "fixture");
const revision = git("rev-parse", "HEAD");
const task = {
  id: "task-alpha",
  input: "fixture",
  workspace: { path: "." },
  prepare: { program: process.execPath, args: ["-e", "require('node:fs').writeFileSync('prepared.txt','prepared')"] },
  verify: { program: process.execPath, args: ["-e", "process.exit(require('node:fs').readFileSync('source.txt','utf8')==='clean-source\\n'?0:9)"] },
  limits: { elapsed_ms: 2_000, stdout_bytes: 1_024 },
};
const plan = {
  schema_version: 1,
  task_set: { schema_version: 1, id: "fixture", source: { kind: "git", repository: ".", revision }, tasks: [task] },
  source: { kind: "git", repository_root: repo, revision },
  resolved_programs: { prepare: [process.execPath], verify: [process.execPath], adapter: process.execPath },
};
const row = (id) => ({ observation_id: id, task_id: task.id });
const first = await api.createEvalWorkspace({ plan, row: row("row-one"), temporary_root: fixtureRoot });
assert.equal(readFileSync(join(first.source_path, "source.txt"), "utf8"), "clean-source\n");
for (const directory of [first.parent_path, first.notes_path, first.output_path, first.home_path, first.temp_path]) {
  assert.equal(statSync(directory).mode & 0o777, 0o700, `${directory} is not private`);
}
writeFileSync(join(first.source_path, "source-leak"), "sentinel");
writeFileSync(join(first.notes_path, "note-leak"), "sentinel");
writeFileSync(join(first.output_path, "output-leak"), "sentinel");
writeFileSync(join(first.home_path, "state-leak"), "sentinel");
const firstCleanup = await api.cleanupEvalWorkspace(first);
assert.equal(firstCleanup.status, "closed");
assert.equal(existsSync(first.parent_path), false);

const second = await api.createEvalWorkspace({ plan, row: row("row-two"), temporary_root: fixtureRoot });
assert.notEqual(second.parent_path, first.parent_path);
for (const candidate of [
  join(second.source_path, "source-leak"), join(second.notes_path, "note-leak"),
  join(second.output_path, "output-leak"), join(second.home_path, "state-leak"),
]) assert.equal(existsSync(candidate), false, `row leakage reached ${candidate}`);
assert.equal(readFileSync(join(second.source_path, "source.txt"), "utf8"), "clean-source\n");
const preparation = await api.runTaskPreparation(second);
assert.equal(preparation.exit_code, 0);
assert.equal(existsSync(join(second.workspace_path, "prepared.txt")), true);
assert.equal((await api.runTaskVerifier(second, { adapter_completed: false })).pass_state, "unknown");
assert.equal((await api.runTaskVerifier(second, { adapter_completed: true })).pass_state, "passed");
second.task.verify.args = ["-e", "process.exit(3)"];
const failed = await api.runTaskVerifier(second, { adapter_completed: true });
assert.deepEqual([failed.pass_state, failed.terminal_state], ["failed", "verifier_failed"]);
second.verify_program = join(fixtureRoot, "missing-verifier");
const unknown = await api.runTaskVerifier(second, { adapter_completed: true });
assert.deepEqual([unknown.pass_state, unknown.verifier_state, unknown.reason], ["unknown", "error", "verifier_spawn_error"]);
assert.equal((await api.cleanupEvalWorkspace(second)).status, "closed");
assert.equal(git("worktree", "list", "--porcelain").includes(first.source_path), false);
assert.equal(git("worktree", "list", "--porcelain").includes(second.source_path), false);
NODE
  echo "PASS: Phase 19 fresh workspace and independent verifier contract"
}

run_two_pass() {
  require_exports "$runner" runEvalTwoPass
  node "$eval_cli" --help | grep -qE 'run|two-pass' || fail "eval help omits two-pass run"
  echo "PASS: Phase 19 same-task two-pass and immutable note-snapshot contract"
}

run_ablation() {
  require_exports "$runner" runEvalAblation
  node "$eval_cli" --help | grep -q 'ablate' || fail "eval help omits ablation"
  echo "PASS: Phase 19 explicit eight-on versus one-off four-cell ablation contract"
}

run_report() {
  require_exports "$report" readEvalReport renderEvalReport
  node "$eval_cli" --help | grep -q 'report' || fail "eval help omits report"
  echo "PASS: Phase 19 canonical JSON and derived report contract"
}

run_retention() {
  node "$eval_cli" --help | grep -q 'prune' || fail "eval help omits prune"
  node "$eval_cli" --help | grep -q 'delete' || fail "eval help omits delete"
  echo "PASS: Phase 19 contained dry-run retention contract"
}

run_claims() {
  require_exports "$report" renderEvalReport
  for forbidden in 'statistically significant' 'causes improvement' 'quality gain'; do
    if grep -R -F "$forbidden" "$ROOT/examples/eval" "$ROOT/mcp-memory-server/src/eval-report.ts" 2>/dev/null; then
      fail "generated evaluation surface contains unsupported claim wording"
    fi
  done
  echo "PASS: Phase 19 inconclusive and evidence-bounded claim contract"
}

run_fake() {
  [[ -f "$ROOT/scripts/fake-eval-adapter.mjs" ]] || fail "offline fake adapter is absent"
  [[ -f "$ROOT/examples/eval/task-set.json" ]] || fail "offline committed task set is absent"
  grep -q 'offline-framework' "$ROOT/scripts/fake-eval-adapter.mjs" || fail "fake adapter lacks permanent offline scope"
  echo "PASS: Phase 19 deterministic offline fake population contract"
}

run_cancellation() {
  require_exports "$runner" runEvalTwoPass
  require_exports "$report" checkpointEvalReport
  grep -q 'cancelled' "$ROOT/mcp-memory-server/src/eval-schema.ts" || fail "cancelled terminal state is absent"
  echo "PASS: Phase 19 cancellation and partial-report contract"
}

run_package() {
  "$ROOT/scripts/test-package-install.sh"
  echo "PASS: Phase 19 installed evaluation asset contract"
}

run_composed() {
  baseline
  # Wave 0 remains default-green. Once production exists, no-argument execution
  # automatically becomes the complete composed contract.
  [[ -f "$runner" ]] || return 0
  run_workspace
  run_two_pass
  run_ablation
  run_report
  run_retention
  run_claims
  run_fake
  run_cancellation
  run_package
}

case "$MODE" in
  expected-red)
    baseline >/dev/null
    set +e
    node --input-type=module - "$runner" >"$tmp/red.out" 2>"$tmp/red.err" <<'NODE'
import { pathToFileURL } from "node:url";
await import(pathToFileURL(process.argv[2]).href);
NODE
    status=$?
    set -e
    if [[ "$status" -ne 0 ]] && grep -qF '/dist/eval-runner.js' "$tmp/red.err" && grep -qF 'ERR_MODULE_NOT_FOUND' "$tmp/red.err"; then
      echo 'PHASE19_RED:EVAL_LIFECYCLE_MISSING'
      exit 0
    fi
    cat "$tmp/red.out" "$tmp/red.err" >&2
    fail "expected only the missing eval-runner module"
    ;;
  workspace) run_workspace ;;
  two-pass) run_two_pass ;;
  ablation) run_ablation ;;
  report) run_report ;;
  retention) run_retention ;;
  claims) run_claims ;;
  fake) run_fake ;;
  cancellation) run_cancellation ;;
  package) run_package ;;
  composed) run_composed ;;
esac
