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
  require_exports "$runner" buildAblationArms runCapabilityAblation
  node --input-type=module - "$runner" "$report" "$ROOT/mcp-memory-server/dist/eval-plan.js" "$ROOT/mcp-memory-server/dist/capability-schema.js" "$tmp" <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [runnerPath, reportPath, planPath, capabilityPath, fixtureRoot] = process.argv.slice(2);
const runner = await import(pathToFileURL(runnerPath).href);
const reports = await import(pathToFileURL(reportPath).href);
const { buildEvalSchedule } = await import(pathToFileURL(planPath).href);
const { CAPABILITY_IDS } = await import(pathToFileURL(capabilityPath).href);
const repo = join(fixtureRoot, "ablation-repo");
mkdirSync(repo);
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
git("init", "-q");
git("config", "user.name", "Evaluation Fixture");
git("config", "user.email", "evaluation-fixture@example.invalid");
writeFileSync(join(repo, "source.txt"), "immutable-source\n");
git("add", "source.txt");
git("commit", "-qm", "fixture");
const revision = git("rev-parse", "HEAD");
const adapterScript = join(fixtureRoot, "ablation-adapter.mjs");
const distillerScript = join(fixtureRoot, "ablation-distiller.mjs");
const invocationLog = join(fixtureRoot, "ablation-invocations.log");
const distillLog = join(fixtureRoot, "ablation-distill.log");
writeFileSync(adapterScript, `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const chunks=[]; for await (const chunk of process.stdin) chunks.push(chunk);
const request=JSON.parse(Buffer.concat(chunks).toString("utf8"));
const ids=${JSON.stringify(CAPABILITY_IDS)};
const name=(id)=>"CAIRN_CAPABILITY_"+id.toUpperCase().replaceAll(".","_");
const disabled=ids.filter((id)=>process.env[name(id)]!=="1");
if (process.env.CAIRN_CAPABILITY_CONTRACT!=="1") process.exit(41);
if ((request.arm==="baseline"&&disabled.length!==0)||(request.arm==="treatment"&&disabled.length!==1)) process.exit(42);
if (existsSync(join(process.env.HOME,"leak"))) process.exit(43);
writeFileSync(join(process.env.HOME,"leak"),"sentinel");
if (request.pass==="run2") {
  if (disabled[0]==="notes.distill") {
    if (request.notes_path!==null) process.exit(44);
  } else {
    const expected=disabled[0]??"baseline";
    if (request.notes_path===null||readFileSync(join(process.cwd(),request.notes_path,"note.md"),"utf8")!==expected+"\\n") process.exit(45);
  }
}
appendFileSync(process.env.EVAL_ABLATION_LOG,[process.pid,request.arm,request.repetition,request.pass,request.task_id,request.seed,disabled[0]??"baseline"].join(":")+"\\n");
writeFileSync(join(process.cwd(),request.workspace_path,"answer.txt"),"ok\\n");
process.stdout.write(JSON.stringify({schema_version:1,status:"completed",turns:{value:1,semantics:"fixture-turn"},usage:{total_tokens:10},adapter:{id:"fixture-adapter"},observed_capability_digest:process.env.EVAL_FORCE_BAD_DIGEST==="1"?"0".repeat(64):request.expected_capability_digest,trajectory_ref:request.arm+"-r"+request.repetition+"-"+request.pass+"-"+request.task_id}));
`);
writeFileSync(distillerScript, `
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const ids=${JSON.stringify(CAPABILITY_IDS)};
const name=(id)=>"CAIRN_CAPABILITY_"+id.toUpperCase().replaceAll(".","_");
const disabled=ids.find((id)=>process.env[name(id)]!=="1")??"baseline";
appendFileSync(process.env.EVAL_DISTILL_LOG,disabled+"\\n");
const directory=join(process.env.CAIRN_AGENTFS_BASE_DIR,"notes"); mkdirSync(directory,{recursive:true});
const path=join(directory,"note.md"); writeFileSync(path,disabled+"\\n");
process.stdout.write(JSON.stringify({schema_version:1,enabled:true,created:[{id:"fixture-note",path}],updated:[],already_processed:[],enrichment_skipped:[],enrichment_failed:[],failed:[]}));
`);
const task={id:"task-alpha",input:"fixture",workspace:{path:"."},prepare:{program:process.execPath,args:["-e","process.exit(0)"]},verify:{program:process.execPath,args:["-e","process.exit(require('node:fs').existsSync('answer.txt')?0:9)"]},limits:{elapsed_ms:2_000,stdout_bytes:16_384}};
const taskSet={schema_version:1,id:"ablation-fixture",source:{kind:"git",repository:".",revision},tasks:[task]};
function makePlan(disabled, outputRoot) {
  const arms=runner.buildAblationArms(disabled).map(({id,disabled_capability})=>({id,disabled_capability}));
  const schedule=buildEvalSchedule({taskSet,arms,repetitions:1,passes:["run1","run2"],seed:"fixture-seed"});
  return {schema_version:1,task_set:taskSet,adapter_config:{schema_version:1,id:"fixture-adapter",command:{program:process.execPath,args:[adapterScript]},turn_semantics:{id:"fixture-turn",description:"One deterministic turn."}},task_set_path:join(repo,"task-set.json"),adapter_path:adapterScript,output_root:outputRoot,source:{kind:"git",repository_root:repo,revision},repetitions:1,seed:"fixture-seed",arms,passes:["run1","run2"],concurrency:1,invocation_count:schedule.invocation_count,task_set_commit:revision,task_set_digest:"1".repeat(64),adapter_config_digest:"2".repeat(64),schedule_digest:schedule.digest,plan_digest:"3".repeat(64),schedule:schedule.rows,resolved_programs:{adapter:process.execPath,prepare:[process.execPath],verify:[process.execPath]}};
}
process.env.EVAL_ABLATION_LOG=invocationLog;
process.env.EVAL_DISTILL_LOG=distillLog;
for (const disabled of CAPABILITY_IDS) {
  const arms=runner.buildAblationArms(disabled);
  assert.deepEqual(arms.map(({id})=>id),["baseline","treatment"]);
  assert.deepEqual(arms[0].expected_capabilities.map(({enabled})=>enabled),Array(8).fill(true));
  assert.equal(arms[1].expected_capabilities.filter(({enabled})=>!enabled).length,1);
  assert.equal(arms[1].expected_capabilities.find(({id})=>id===disabled).enabled,false);
  assert.notEqual(arms[0].expected_configuration_digest,arms[1].expected_configuration_digest);
  const plan=makePlan(disabled,join(fixtureRoot,`output-${disabled.replaceAll(".","-")}`));
  const store=await reports.createEvalReportStore({root:plan.output_root,experiment_id:`ablate-${disabled.replaceAll(".","-")}`});
  const result=await runner.runCapabilityAblation({plan,disabled_capability:disabled,report_store:store,temporary_root:fixtureRoot,distill_command:{program:process.execPath,args:[distillerScript]}});
  assert.equal(result.report.status,"final");
  assert.equal(result.report.observations.length,4);
  assert.deepEqual(result.report.observations.map(({observation_id})=>observation_id),plan.schedule.map(({observation_id})=>observation_id));
  assert.equal(new Set(result.report.observations.map(({four_cell_id})=>four_cell_id)).size,1);
  assert.equal(new Set(result.report.observations.map(({seed})=>seed)).size,1);
  assert.equal(result.report.observations.every(({capability_status,capability_digest_match})=>capability_status==="valid"&&capability_digest_match===true),true);
  assert.equal(result.report.observations.every(({expected_capabilities,observed_capabilities})=>JSON.stringify(expected_capabilities)===JSON.stringify(observed_capabilities)),true);
  const treatmentRun2=result.report.observations.find(({arm,pass})=>arm==="treatment"&&pass==="run2");
  assert.ok(treatmentRun2);
  assert.equal(treatmentRun2.notes.notes_exposed,disabled!=="notes.distill");
}
const lines=readFileSync(invocationLog,"utf8").trim().split("\n");
assert.equal(lines.length,CAPABILITY_IDS.length*4);
assert.equal(new Set(lines.map((line)=>line.split(":")[0])).size,lines.length,"an adapter owner process was reused");
assert.equal(readFileSync(distillLog,"utf8").trim().split("\n").length,CAPABILITY_IDS.length*2-1,"notes.distill treatment was distilled");

process.env.EVAL_FORCE_BAD_DIGEST="1";
const mismatchPlan=makePlan("memory.write",join(fixtureRoot,"mismatch-output"));
const mismatch=await runner.runCapabilityAblation({plan:mismatchPlan,disabled_capability:"memory.write",temporary_root:fixtureRoot,distill_command:{program:process.execPath,args:[distillerScript]}});
assert.equal(mismatch.report.observations.every(({capability_status,capability_digest_match,missing_reasons})=>capability_status==="mismatch"&&capability_digest_match===false&&missing_reasons.includes("capability_mismatch")),true);
NODE
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
  [[ -f "$ROOT/examples/eval/bundled-fake.json" ]] || fail "offline bundled binding is absent"
  [[ -f "$ROOT/examples/eval/adapter.json" ]] || fail "offline adapter configuration is absent"
  grep -q 'offline-framework' "$ROOT/scripts/fake-eval-adapter.mjs" || fail "fake adapter lacks permanent offline scope"
  if grep -E '^import ' "$ROOT/scripts/fake-eval-adapter.mjs" | grep -v 'from "node:' >/dev/null; then
    fail "fake adapter imports a non-standard-library module"
  fi
  node --input-type=module - "$runner" "$ROOT/mcp-memory-server/dist/eval-plan.js" "$ROOT/mcp-memory-server/dist/eval-schema.js" "$ROOT/examples/eval/task-set.json" "$ROOT/examples/eval/adapter.json" "$tmp" <<'NODE'
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [runnerPath, planPath, schemaPath, taskSetPath, adapterPath, fixtureRoot] = process.argv.slice(2);
const runner = await import(pathToFileURL(runnerPath).href);
const { loadEvalPlan } = await import(pathToFileURL(planPath).href);
const { canonicalDigest } = await import(pathToFileURL(schemaPath).href);
const outputRoot=join(fixtureRoot,"offline-output");
const options={taskSetPath,adapterPath,outputRoot,repetitions:1,seed:"offline-fixture-seed",cwd:process.cwd()};
const plan=loadEvalPlan(options);
const taskSet=JSON.parse(readFileSync(taskSetPath,"utf8"));
assert.equal(plan.source.kind,"bundled_fake");
assert.equal(plan.task_set_digest,canonicalDigest(taskSet));
assert.equal(plan.invocation_count,taskSet.tasks.length*2);
const result=await runner.runTwoPassExperiment({plan,experiment_id:"offline-fixture",temporary_root:fixtureRoot});
assert.equal(result.report.status,"final");
assert.equal(result.report.task_set_digest,canonicalDigest(taskSet));
assert.equal(result.report.evidence.task_set_digest,canonicalDigest(taskSet));
assert.equal(result.report.evidence.evidence_scope,"offline-framework");
assert.equal(result.report.observations.length,taskSet.tasks.length*2);
const byTask=(id)=>result.report.observations.filter(({task_id})=>task_id===id);
assert.equal(byTask("offline-pass-note").every(({terminal_state,pass_state})=>terminal_state==="completed"&&pass_state==="passed"),true);
assert.equal(byTask("offline-verifier-fail").every(({terminal_state,pass_state})=>terminal_state==="verifier_failed"&&pass_state==="failed"),true);
assert.equal(byTask("offline-missing-tokens").every(({result})=>result&&!Object.hasOwn(result,"usage")),true);
assert.equal(byTask("offline-no-notes")[0].notes.distillation_outcome,"no_notes");
assert.equal(byTask("offline-no-notes")[1].notes.distillation_outcome,"no_notes");
assert.equal(byTask("offline-distillation-failure").every(({notes})=>notes.distillation_outcome==="failed"),true);
assert.equal(byTask("offline-skipped-notes").every(({notes})=>notes.distillation_outcome==="skipped"),true);
assert.deepEqual(byTask("offline-pass-note").map(({notes})=>notes.notes_exposed),[false,true]);
assert.equal(byTask("offline-timeout").every(({terminal_state})=>terminal_state==="timeout"),true);
assert.equal(byTask("offline-adapter-error").every(({terminal_state})=>terminal_state==="adapter_error"),true);
assert.equal(byTask("offline-invalid-result").every(({terminal_state})=>terminal_state==="invalid_result"),true);
assert.equal(byTask("offline-cancellation-control").every(({terminal_state})=>terminal_state==="completed"),true);
assert.equal(result.snapshots.every((snapshot)=>snapshot.task_id==="offline-pass-note"),true);

const bindingPath=join(taskSetPath,"..","bundled-fake.json");
const originalTask=readFileSync(taskSetPath);
const originalBinding=readFileSync(bindingPath);
function rejected(label,mutate) {
  try { mutate(); assert.throws(()=>loadEvalPlan(options),undefined,label); }
  finally { writeFileSync(taskSetPath,originalTask); writeFileSync(bindingPath,originalBinding); }
}
rejected("task-set bytes",()=>writeFileSync(taskSetPath,Buffer.concat([originalTask,Buffer.from(" ")])));
rejected("inline fixture",()=>{const value=JSON.parse(originalTask);value.source.files[0].content+="tamper";writeFileSync(taskSetPath,JSON.stringify(value)+"\n");});
for (const field of ["identifier","package_version","task_set_digest"]) rejected(field,()=>{const value=JSON.parse(originalBinding);value[field]=field==="task_set_digest"?"0".repeat(64):"tampered";writeFileSync(bindingPath,JSON.stringify(value)+"\n");});
chmodSync(fixtureRoot,0o700);
try { chmodSync(join(fixtureRoot,"offline-output","offline-fixture","snapshots"),0o700); } catch {}
for (const snapshot of result.snapshots) {
  chmodSync(snapshot.root_path,0o700);
  for (const entry of snapshot.manifest) chmodSync(join(snapshot.root_path,...entry.path.split("/")),0o600);
}
execFileSync("chmod",["-R","u+w",outputRoot]);
NODE
  echo "PASS: Phase 19 deterministic offline fake population contract"
}

run_cancellation() {
  require_exports "$runner" runEvalTwoPass
  require_exports "$report" checkpointEvalReport
  grep -q 'cancelled' "$ROOT/mcp-memory-server/src/eval-schema.ts" || fail "cancelled terminal state is absent"
  local task_set="$ROOT/examples/eval/task-set.json"
  local adapter="$ROOT/examples/eval/adapter.json"
  local rejected_root="$tmp/rejected-output"
  set +e
  CAIRN_EVAL=1 node "$eval_cli" run --task-set "$task_set" --adapter "$adapter" --output "$rejected_root" --json >"$tmp/rejected.json" 2>"$tmp/rejected.err"
  local rejected_status=$?
  set -e
  [[ "$rejected_status" -eq 2 ]] || fail "run without --yes did not fail with usage status"
  [[ ! -e "$rejected_root" ]] || fail "run without --yes created output"

  local complete_root="$tmp/complete-output"
  CAIRN_EVAL=1 node "$eval_cli" run --task-set "$task_set" --adapter "$adapter" --output "$complete_root" --yes --json >"$tmp/complete.json" 2>"$tmp/complete.err"
  node - "$tmp/complete.json" <<'NODE'
const { existsSync, readFileSync } = require("node:fs");
const value=JSON.parse(readFileSync(process.argv[2],"utf8"));
if (value.operation!=="run" || value.invocation_count!==20 || value.status!=="final" || !existsSync(value.report_path)) process.exit(1);
const report=JSON.parse(readFileSync(value.report_path,"utf8"));
if (report.observations.length!==20 || report.schedule.some((row,index)=>row.observation_id!==report.observations[index].observation_id)) process.exit(1);
NODE
  chmod -R u+w "$complete_root"

  local cancel_root="$tmp/cancel-output"
  local child_pid_file="$tmp/adapter.pid"
  CAIRN_EVAL=1 CAIRN_FAKE_CANCEL_ALL=1 CAIRN_FAKE_PID_FILE="$child_pid_file" \
    node "$eval_cli" run --task-set "$task_set" --adapter "$adapter" --output "$cancel_root" --yes --json \
    >"$tmp/cancel.json" 2>"$tmp/cancel.err" &
  local cli_pid=$!
  local attempt=0
  while [[ ! -s "$child_pid_file" && "$attempt" -lt 100 ]]; do
    sleep 0.05
    attempt=$((attempt + 1))
  done
  [[ -s "$child_pid_file" ]] || { kill -TERM "$cli_pid" 2>/dev/null || true; fail "cancellation fixture child did not start"; }
  local child_pid
  child_pid=$(cat "$child_pid_file")
  kill -INT "$cli_pid"
  set +e
  wait "$cli_pid"
  local cancel_status=$?
  set -e
  [[ "$cancel_status" -eq 130 ]] || fail "SIGINT run exited with $cancel_status instead of 130"
  if kill -0 "$child_pid" 2>/dev/null; then fail "cancelled adapter child survived CLI exit"; fi
  node - "$tmp/cancel.json" <<'NODE'
const { existsSync, readFileSync } = require("node:fs");
const value=JSON.parse(readFileSync(process.argv[2],"utf8"));
if (value.operation!=="run" || value.status!=="partial" || !existsSync(value.report_path)) process.exit(1);
const report=JSON.parse(readFileSync(value.report_path,"utf8"));
if (report.status!=="partial" || report.observations.length!==1) process.exit(1);
const row=report.observations[0];
if (row.terminal_state!=="cancelled" || row.process.cleanup==="pending") process.exit(1);
NODE
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
  run_fake
  run_cancellation
  if grep -q 'runEvalAblation' "$ROOT/mcp-memory-server/src/eval-runner.ts"; then run_ablation; fi
  if grep -q 'renderEvalReport' "$ROOT/mcp-memory-server/src/eval-report.ts"; then
    run_report
    run_claims
  fi
  if grep -q 'command === "prune"' "$ROOT/mcp-memory-server/src/eval-cli.ts"; then run_retention; fi
  if grep -q '"examples/eval/"' "$ROOT/package.json"; then run_package; fi
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
