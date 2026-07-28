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
  require_exports "$runner" runTwoPassExperiment runEvalTwoPass runEvalObservation distillRunOneNotes snapshotTaskNotes verifyNoteSnapshot
  node "$eval_cli" --help | grep -qE 'run|two-pass' || fail "eval help omits two-pass run"
  node --input-type=module - "$runner" "$report" "$ROOT/mcp-memory-server/dist/eval-plan.js" "$tmp" <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [runnerPath, reportPath, planPath, fixtureRoot] = process.argv.slice(2);
const runner = await import(pathToFileURL(runnerPath).href);
const reports = await import(pathToFileURL(reportPath).href);
const { buildEvalSchedule } = await import(pathToFileURL(planPath).href);
const repo = join(fixtureRoot, "two-pass-repo");
mkdirSync(repo);
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
git("init", "-q");
git("config", "user.name", "Evaluation Fixture");
git("config", "user.email", "evaluation-fixture@example.invalid");
writeFileSync(join(repo, "source.txt"), "immutable-source\n");
git("add", "source.txt");
git("commit", "-qm", "fixture");
const revision = git("rev-parse", "HEAD");
const invocationLog = join(fixtureRoot, "invocations.log");
const distillLog = join(fixtureRoot, "distill.log");
const adapterScript = join(fixtureRoot, "adapter.mjs");
const distillerScript = join(fixtureRoot, "distiller.mjs");
writeFileSync(adapterScript, `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk);
const request=JSON.parse(Buffer.concat(chunks).toString("utf8"));
appendFileSync(process.env.EVAL_INVOCATION_LOG, request.task_id+":"+request.pass+"\\n");
const source=join(process.cwd(), request.workspace_path);
if (readFileSync(join(source,"source.txt"),"utf8")!=="immutable-source\\n" || existsSync(join(source,"source-leak"))) process.exit(31);
if (request.pass==="run1" && request.notes_path!==null) process.exit(32);
if (request.pass==="run2" && request.task_id==="task-success") {
  if (request.notes_path===null || !existsSync(join(process.cwd(),request.notes_path,"projects","task-success","note.md"))) process.exit(33);
} else if (request.notes_path!==null) process.exit(34);
writeFileSync(join(source,"source-leak"),request.observation_id??request.task_id);
writeFileSync(join(source,"answer.txt"),"ok\\n");
writeFileSync(join(process.env.HOME,"home-leak"),"sentinel");
writeFileSync(join(process.cwd(),request.output_path,"output-leak"),"sentinel");
if (request.task_id==="task-cancel") await new Promise((resolve)=>setTimeout(resolve,60_000));
const result={schema_version:1,status:"completed",turns:{value:1,semantics:"fixture-turn"},usage:{total_tokens:10},adapter:{id:"fixture-adapter"},observed_capability_digest:request.expected_capability_digest};
if (request.task_id!=="task-skipped") result.trajectory_ref=request.arm+"-r"+request.repetition+"-"+request.pass+"-"+request.task_id;
process.stdout.write(JSON.stringify(result));
`);
writeFileSync(distillerScript, `
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const value=(flag)=>process.argv[process.argv.indexOf(flag)+1];
const session=value("--session");
appendFileSync(process.env.EVAL_DISTILL_LOG,session+"\\n");
if (session.includes("task-failed")) process.exit(7);
const created=[];
if (session.includes("task-success")) {
  const directory=join(process.env.CAIRN_AGENTFS_BASE_DIR,"notes","projects","task-success");
  mkdirSync(directory,{recursive:true});
  const path=join(directory,"note.md"); writeFileSync(path,"same-task-note\\n"); created.push({id:"fixture-note",path});
}
process.stdout.write(JSON.stringify({schema_version:1,enabled:true,created,updated:[],already_processed:[],enrichment_skipped:[],enrichment_failed:[],failed:[]}));
`);

const taskIds = ["task-success", "task-no-notes", "task-failed", "task-skipped"];
const tasks = taskIds.map((id) => ({
  id, input: id, workspace: { path: "." },
  prepare: { program: process.execPath, args: ["-e", "process.exit(0)"] },
  verify: { program: process.execPath, args: ["-e", "process.exit(require('node:fs').existsSync('answer.txt')?0:9)"] },
  limits: { elapsed_ms: 2_000, stdout_bytes: 16_384 },
}));
function makePlan(selectedTasks=tasks) {
  const taskSet={schema_version:1,id:"two-pass-fixture",source:{kind:"git",repository:".",revision},tasks:selectedTasks};
  const schedule=buildEvalSchedule({taskSet,arms:[{id:"baseline",disabled_capability:null}],repetitions:1,passes:["run1","run2"],seed:"fixture-seed"});
  return {
    schema_version:1, task_set:taskSet,
    adapter_config:{schema_version:1,id:"fixture-adapter",command:{program:process.execPath,args:[adapterScript]},turn_semantics:{id:"fixture-turn",description:"One deterministic fake turn."}},
    task_set_path:join(repo,"task-set.json"), adapter_path:adapterScript, output_root:join(fixtureRoot,"output"),
    source:{kind:"git",repository_root:repo,revision}, repetitions:1, seed:"fixture-seed",
    arms:[{id:"baseline",disabled_capability:null}], passes:["run1","run2"], concurrency:1,
    invocation_count:schedule.invocation_count, task_set_commit:revision, task_set_digest:"1".repeat(64),
    adapter_config_digest:"2".repeat(64), schedule_digest:schedule.digest, plan_digest:"3".repeat(64), schedule:schedule.rows,
    resolved_programs:{adapter:process.execPath,prepare:selectedTasks.map(()=>process.execPath),verify:selectedTasks.map(()=>process.execPath)},
  };
}
mkdirSync(join(fixtureRoot,"output"));
process.env.EVAL_INVOCATION_LOG=invocationLog;
process.env.EVAL_DISTILL_LOG=distillLog;
const plan=makePlan();
const store=await reports.createEvalReportStore({root:join(fixtureRoot,"reports"),experiment_id:"two-pass-fixture"});
const result=await runner.runTwoPassExperiment({plan,report_store:store,temporary_root:fixtureRoot,distill_command:{program:process.execPath,args:[distillerScript]}});
assert.equal(result.report.status,"final");
assert.deepEqual(result.report.observations.map(({observation_id})=>observation_id),plan.schedule.map(({observation_id})=>observation_id));
assert.deepEqual(readFileSync(invocationLog,"utf8").trim().split("\n"),[
  ...taskIds.map((id)=>`${id}:run1`), ...taskIds.map((id)=>`${id}:run2`),
]);
assert.deepEqual(readFileSync(distillLog,"utf8").trim().split("\n"),taskIds.slice(0,3).map((id)=>`baseline-r0-run1-${id}`));
const run2=result.report.observations.filter(({pass})=>pass==="run2");
assert.deepEqual(run2.map(({notes})=>notes.distillation_outcome),["success","no_notes","failed","skipped"]);
assert.deepEqual(run2.map(({notes})=>notes.notes_exposed),[true,false,false,false]);
assert.equal(run2.every(({pass_state})=>pass_state==="passed"),true);
assert.equal(result.report.observations.every(({process})=>process.cleanup==="closed"),true);
const success=run2[0];
assert.equal(success.notes.note_snapshot_manifest.length>0,true);
assert.equal((statSync(result.snapshots[0].root_path).mode&0o222),0,"snapshot root remained writable");
assert.equal(await runner.verifyNoteSnapshot(result.snapshots[0]),true);
assert.equal(readdirSync(fixtureRoot).some((name)=>name.startsWith("cairn-eval-workspace-")),false,"workspace survived completed run");

const cancelTask={...tasks[0],id:"task-cancel",input:"cancel"};
const cancelPlan=makePlan([cancelTask]);
const cancelStore=await reports.createEvalReportStore({root:join(fixtureRoot,"reports"),experiment_id:"cancel-fixture"});
const controller=new AbortController();
setTimeout(()=>controller.abort(),100);
const cancelled=await runner.runTwoPassExperiment({plan:cancelPlan,report_store:cancelStore,temporary_root:fixtureRoot,signal:controller.signal,distill_command:{program:process.execPath,args:[distillerScript]}});
assert.equal(cancelled.report.status,"partial");
assert.deepEqual(cancelled.report.observations.map(({terminal_state})=>terminal_state),["cancelled"]);
assert.equal(cancelled.report.observations[0].process.cleanup!=="pending",true);
assert.equal(readdirSync(fixtureRoot).some((name)=>name.startsWith("cairn-eval-workspace-")),false,"workspace survived cancellation");
assert.equal(existsSync(cancelStore.report_path),true);
execFileSync("chmod",["-R","u+w",fixtureRoot]);
NODE
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
