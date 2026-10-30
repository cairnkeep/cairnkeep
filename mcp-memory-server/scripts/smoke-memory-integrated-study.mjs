// A real combined replay is required; a bundle of separate studies is not one.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const fixtureBytes = readFileSync(new URL('./fixtures/memory-integrated-workflows-v1.json', import.meta.url));
const fixture = JSON.parse(fixtureBytes);
const child = spawnSync(process.execPath, [fileURLToPath(new URL('./run-memory-continuity-study.mjs', import.meta.url)),
  '--features', 'freshness,links,maps,feedback', '--check', '--summary'],
{ encoding: 'utf8', timeout: 1800000, maxBuffer: 4 * 1024 * 1024 });
assert.equal(child.status, 0, `INTEGRATED_WORKFLOW_RED: combined replay must execute, not just bundle separate reports. ${child.stderr}`);
const report = JSON.parse(child.stdout), joint = report.integrated;
assert.equal(report.study, 'native-memory-integrated-continuity');
assert.equal(joint.executed, true);
assert.equal(joint.workflow_fixture_digest, createHash('sha256').update(fixtureBytes).digest('hex'));
assert.equal(joint.corpus_digest, fixture.corpus_sha256);
assert.equal(joint.policy_digest, fixture.feedback_policy_sha256);
assert.deepEqual(joint.sequence, fixture.sequence);
assert.deepEqual(joint.controls.map(row => row.id).sort(), fixture.required_controls.toSorted());
assert.ok(joint.controls.every(row => row.passed));
assert.equal(joint.recommended_ranking_enabled, false);
assert.equal(joint.markdown_independent, true);
assert.equal(joint.development_feedback_records, 15);
assert.equal(joint.query_ablations.length, 52);
assert.ok(joint.metrics.every(row => row.held_out_cases === 8 && row.negative_false_positives === 0));
assert.ok(joint.metrics.every(row => row.stale_returns === 1 && row.freshness_warnings === 1), 'warn without silently changing factual truth or admission');
assert.ok(joint.operator_curation.plan_apply_calls > 0);
assert.ok(joint.workflows.length >= 2);
for (const workflow of joint.workflows) {
  assert.ok(workflow.calls.length >= fixture.sequence.length);
  assert.equal(workflow.total_bytes, workflow.calls.reduce((n, row) => n + row.bytes, 0));
  assert.ok(workflow.calls.every(row => row.bytes > 0 && row.elapsed_ms >= 0));
  assert.deepEqual(workflow.keys, fixture.linked_keys);
  assert.deepEqual(workflow.markdown.keys, fixture.linked_keys);
  assert.equal(workflow.markdown.total_bytes, workflow.markdown.calls.reduce((n, row) => n + row.bytes, 0));
}
assert.equal(joint.restore.old_feedback_rows_retained, true);
assert.equal(joint.restore.old_feedback_eligible, false);
assert.equal(joint.restore.old_graph_active, false);
assert.equal(joint.restore.epoch_changed, true);
assert.equal(joint.restore.store_identity_preserved, true);
assert.equal(joint.aba.receipt_current_before, true);
assert.equal(joint.aba.current_receipt_rejected, true);
assert.equal(joint.aba.original_content_restored, true);
assert.equal(report.network_attempts, 0);
assert.equal(report.unauthorized_returns, 0);
assert.equal(report.unsupported_edges, 0);
console.log('PASS: actual joint continuity replay, independent Markdown policy, explicit costs, development-only votes and managed restore invalidation');
