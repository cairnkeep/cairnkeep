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
const plan = buildShardPlan(5);
const measured = JSON.parse(readFileSync(join(root, 'mcp-memory-server/scripts/fixtures/windows-smoke-timings.json'), 'utf8'));
assert.equal(measured.schema_version,1);
const memoryMeasured = JSON.parse(readFileSync(join(root, 'mcp-memory-server/scripts/fixtures/windows-memory-smoke-timings.json'), 'utf8'));
assert.equal(memoryMeasured.schema_version,1);
assert.ok(memoryMeasured.source_jobs.length > 0);
assert.equal(memoryMeasured.source_job_outcomes.length, memoryMeasured.source_jobs.length);
assert.ok(memoryMeasured.source_job_outcomes.every(outcome => ['success', 'timed-out'].includes(outcome)));
assert.ok(memoryMeasured.inherited_measurements.names.every(name => smokeChecks.some(row => row.name === name)));
assert.ok(Number.isSafeInteger(memoryMeasured.inherited_measurements.source_run));
assert.match(memoryMeasured.inherited_measurements.source_commit, /^[a-f0-9]{40}$/);
const provisional = memoryMeasured.provisional?.budgets ?? {};
assert.ok(typeof memoryMeasured.provisional?.reason === 'string');
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
assert.ok(plan.every(({ checks }) => checks.some(({ name }) => teamContracts.includes(name))),
  'native ACL-heavy team contracts must be distributed across all Windows shards');
const weights = plan.map(({ weight }) => weight);
assert.ok(Math.max(...weights) - Math.min(...weights) <= 5,
  `native Windows shards are imbalanced: ${weights.join(", ")}`);

const pkg = JSON.parse(readFileSync(join(root, "mcp-memory-server", "package.json"), "utf8"));
assert.match(pkg.scripts["test:smoke"], /run-smoke-suite\.mjs/);
const workflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
assert.match(workflow, /name: native-windows \(\$\{\{ matrix\.label \}\}\)/);
for (const shard of ["1/5", "2/5", "3/5", "4/5", "5/5"]) assert.ok(workflow.includes(`shard: "${shard}"`));
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
  { node: '22', label: '22', shard: '1/5' }, { node: '24', label: '24', shard: '2/5' },
  { node: '26', label: '26', shard: '3/5' }, { node: '24', label: '24-extended', shard: '4/5' },
  { node: '24', label: '24-additional', shard: '5/5' },
], 'preserve required native check names and runtime coverage while adding capacity');
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
console.log(`PASS: ${smokeChecks.length} memory-server contracts split once across balanced Windows shards (${weights.join(", ")})`);
NODE
