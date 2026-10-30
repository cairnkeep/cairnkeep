#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
node --input-type=module - "$ROOT" <<'NODE'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

const root = process.argv[2];
const { buildShardPlan, smokeChecks } = await import(
  pathToFileURL(join(root, "mcp-memory-server", "scripts", "run-smoke-suite.mjs")));
const plan = buildShardPlan(10);
const measured = JSON.parse(readFileSync(join(root, 'mcp-memory-server/scripts/fixtures/windows-smoke-timings.json'), 'utf8'));
assert.equal(measured.schema_version,1);
const memoryMeasured = JSON.parse(readFileSync(join(root, 'mcp-memory-server/scripts/fixtures/windows-memory-smoke-timings.json'), 'utf8'));
assert.equal(memoryMeasured.schema_version,1);
assert.ok(memoryMeasured.source_jobs.length > 0);
assert.equal(memoryMeasured.source_job_outcomes.length, memoryMeasured.source_jobs.length);
assert.ok(memoryMeasured.source_job_outcomes.every(outcome => ['success', 'timed-out', 'cancelled'].includes(outcome)));
const completed = memoryMeasured.completed_group_evidence;
assert.ok(Array.isArray(completed) && completed.length > 0);
assert.equal(new Set(completed.map(row => row.name)).size, completed.length);
for (const row of completed) {
  assert.equal(row.status, 0, 'only completed successful groups may supply measurements');
  assert.ok(memoryMeasured.source_jobs.includes(row.job_id));
  assert.ok(Number.isSafeInteger(row.duration_ms) && row.duration_ms >= 0);
  assert.equal(memoryMeasured.measurements[row.name], Math.max(1, Math.ceil(row.duration_ms / 1000)));
}
assert.ok(memoryMeasured.inherited_measurements.names.every(name => smokeChecks.some(row => row.name === name)));
const measuredNames = [...completed.map(row => row.name), ...memoryMeasured.inherited_measurements.names];
assert.equal(new Set(measuredNames).size, measuredNames.length, 'each measurement has exactly one declared source');
assert.deepEqual(measuredNames.sort(), Object.keys(memoryMeasured.measurements).sort());
if (memoryMeasured.inherited_measurements.names.length) {
  assert.ok(Number.isSafeInteger(memoryMeasured.inherited_measurements.source_run));
  assert.match(memoryMeasured.inherited_measurements.source_commit, /^[a-f0-9]{40}$/);
} else assert.deepEqual(Object.keys(memoryMeasured.inherited_measurements), ['names'], 'no fabricated inherited timing source');
const provisional = memoryMeasured.provisional?.budgets ?? {};
assert.ok(typeof memoryMeasured.provisional?.reason === 'string');
for (const row of memoryMeasured.unfinished_groups ?? []) {
  assert.equal(row.passed, false, 'interrupted groups are never recorded as passes');
  assert.ok(Object.hasOwn(provisional, row.name));
  assert.ok(!Object.hasOwn(memoryMeasured.measurements, row.name), 'an interrupted group is not a measurement');
}
assert.equal(Object.keys({ ...memoryMeasured.measurements, ...provisional }).length, smokeChecks.length);
for (const [name,seconds] of Object.entries({ ...measured.measurements, ...memoryMeasured.measurements })) {
  assert.equal(smokeChecks.find(row=>row.name===name)?.weight,provisional[name] ?? seconds,`measured/provisional weight drift: ${name}`);
}
for (const [name, seconds] of Object.entries(provisional)) {
  assert.ok(Number.isSafeInteger(seconds) && seconds > 0);
  assert.equal(smokeChecks.find(row => row.name === name)?.weight, seconds, `provisional budget drift: ${name}`);
}
const flattened = plan.flatMap(({ checks }) => checks.map(({ name }) => name));
assert.equal(flattened.length, smokeChecks.length);
assert.equal(new Set(flattened).size, smokeChecks.length);
assert.deepEqual([...flattened].sort(), smokeChecks.map(({ name }) => name).sort());
assert.ok(plan.every(({ checks }) => checks.length > 0));
const teamContracts = ['team', 'team-review', 'team-http', 'team-mcp', 'team-restore', 'team-cli', 'team-onboarding', 'team-operations'];
for (const name of teamContracts) assert.ok(flattened.includes(name), `missing team contract: ${name}`);
for (const name of ['memory-context-integration', 'memory-integrated-study', 'memory-integrated-ranking-study', 'memory-feedback-study']) assert.ok(flattened.includes(name), `INTEGRATED_CATALOG_RED: missing ${name}`);
assert.deepEqual(smokeChecks.filter(row => ['memory-integrated-study', 'memory-integrated-ranking-study'].includes(row.name)).flatMap(row => row.commands), [
  ['scripts/smoke-memory-integrated-study.mjs', '--arm', 'collection-only'],
  ['scripts/smoke-memory-integrated-study.mjs', '--arm', 'bounded-ranking'],
], 'both native arms must execute complete shared-state controls, never drop an arm');
assert.deepEqual(smokeChecks.filter(row => ['memory-feedback-ranking', 'memory-feedback-study'].includes(row.name)).flatMap(row => row.commands), [
  ['scripts/smoke-memory-feedback-ranking.mjs'], ['scripts/smoke-memory-feedback-ranking-mcp.mjs'],
  ['scripts/run-memory-feedback-study.mjs', '--check', '--summary'],
], 'split the oversized group without omitting or duplicating any feedback command');
assert.ok(plan.filter(({ checks }) => checks.some(({ name }) => teamContracts.includes(name))).length >= 7,
  'native ACL-heavy team contracts must be distributed rather than clustered');
assert.ok(plan.slice(0, 3).every(({ checks }) => checks.some(({ name }) => teamContracts.includes(name))),
  'preserve team ACL coverage in every required Node runtime lane');
const weights = plan.map(({ weight }) => weight);
const flexibleWeights = plan.filter(({ checks }) => !checks.some(row => row.weight >= 1000)).map(row => row.weight);
assert.ok(Math.max(...flexibleWeights) - Math.min(...flexibleWeights) <= 5,
  `SHARD_CAPACITY_RED: native Windows shards are imbalanced: ${weights.join(", ")}`);
assert.ok(Math.max(...weights) <= 1500, 'leave setup and installed-package headroom inside the unchanged 30-minute native job');

const pkg = JSON.parse(readFileSync(join(root, "mcp-memory-server", "package.json"), "utf8"));
assert.match(pkg.scripts["test:smoke"], /run-smoke-suite\.mjs/);
const workflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
assert.match(workflow, /name: native-windows \(\$\{\{ matrix\.label \}\}\)/);
for (let index = 1; index <= 10; index++) assert.ok(workflow.includes(`shard: "${index}/10"`));
assert.match(workflow, /run-smoke-suite\.mjs --shard \$\{\{ matrix\.shard \}\}/);
assert.doesNotMatch(workflow.match(/  native-windows:[\s\S]*?\n  repository:/)?.[0] ?? "",
  /npm --prefix mcp-memory-server test/);
const native = workflow.match(/  native-windows:[\s\S]*?\n  repository:/)?.[0] ?? "";
const focused = native.indexOf("run: node mcp-memory-server/scripts/smoke-bounded-input-reads.mjs");
assert.ok(focused > native.indexOf("npm --prefix mcp-memory-server run build"));
assert.ok(focused < native.indexOf("- name: Native Windows CLI contracts"));
assert.ok(focused < native.indexOf("- name: Sharded memory-server contracts"));
const jobs = parse(workflow).jobs;
assert.deepEqual(jobs['native-windows'].strategy.matrix.include, [
  { node: '22', label: '22', shard: '1/10' }, { node: '24', label: '24', shard: '2/10' },
  { node: '26', label: '26', shard: '3/10' }, { node: '24', label: '24-extended', shard: '4/10' },
  { node: '24', label: '24-additional', shard: '5/10' },
  { node: '24', label: '24-context', shard: '6/10' }, { node: '24', label: '24-feedback', shard: '7/10' },
  { node: '24', label: '24-integrated', shard: '8/10' },
  { node: '24', label: '24-replay', shard: '9/10' },
  { node: '24', label: '24-integrated-ranking', shard: '10/10' },
], 'preserve required native check names and runtime coverage while adding capacity');
assert.equal(jobs['native-windows']['timeout-minutes'], 30);
assert.ok(jobs['memory-server'].steps.some(step => step.run === 'node scripts/run-memory-continuity-study.mjs --all --check --summary'),
  'every Linux runtime must also execute the complete two-arm replay');
assert.equal(jobs['native-windows'].strategy['fail-fast'], false, 'one native failure must not cancel independent evidence');
const tracked = jobs['tracked-platform'];
assert.deepEqual(tracked.strategy.matrix.os, ['windows-latest', 'macos-latest']);
assert.deepEqual(tracked.strategy.matrix.node, ['22', '24', '26']);
assert.equal(tracked.strategy['fail-fast'], false);
for (const script of ['smoke-memory-runtime-admission.mjs', 'smoke-memory-file-admission.mjs', 'smoke-memory-database.mjs', 'smoke-memory-store-admission.mjs', 'smoke-memory-store-restore.mjs']) {
  assert.ok(tracked.steps.some(step => step.run === `node mcp-memory-server/scripts/${script}`), 'each native control must fail independently');
}
assert.ok(jobs['release-candidate'].needs.includes('tracked-platform'));
assert.equal(tracked.steps.filter(step => /^Installed tracked worker/.test(step.name ?? '')).length, 2);
for (const job of [jobs['native-windows'], tracked]) {
  const warm = job.steps.find(step => step.name === 'Warm Windows ACL runtime');
  assert.equal(warm['timeout-minutes'], 1);
  assert.match(warm.run, /powershell\.exe -NoLogo -NoProfile -NonInteractive/);
  assert.match(warm.run, /DirectorySecurity/);
  assert.doesNotMatch(warm.run, /Set-Acl|icacls|SetAccessRule|SetOwner/);
}
assert.equal(tracked.steps.find(step => step.name === 'Warm Windows ACL runtime').if, "runner.os == 'Windows'");
assert.ok(jobs['release-candidate'].needs.includes('native-windows'));
const releasing = readFileSync(join(root, 'docs/releasing.md'), 'utf8');
assert.match(releasing, /across ten lanes/);
assert.match(releasing, /Interrupted groups are never recorded as passes/);
console.log(`PASS: ${smokeChecks.length} memory-server contracts split once across balanced Windows shards (${weights.join(", ")})`);
NODE
