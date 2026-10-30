import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as ordinary from '../dist/ordinary-memory-store.js';
import { inspectMemoryCandidate } from '../dist/memory-context-store.js';
import { MemoryDatabase } from '../dist/memory-database.js';

assert.ok(existsSync(new URL('../dist/memory-feedback.js', import.meta.url)), 'FEEDBACK_RED: authenticated explicit feedback is not implemented');
const { MemoryFeedbackSession, listMemoryFeedback, planForgetMemoryFeedback, forgetMemoryFeedback, memoryFeedbackStatus } = await import('../dist/memory-feedback.js');
process.umask(0o077);
const root = mkdtempSync(join(tmpdir(), 'cairn-feedback-'));
const digest = value => createHash('sha256').update(value).digest('hex');
const ledger = { path: join(root, 'alpha', 'project.db'), scope: 'project' };
const beta = { path: join(root, 'beta', 'project.db'), scope: 'project' };
const shared = { path: join(root, 'identity.db'), scope: 'identity' };
const nowValue = Date.parse('2026-01-01T00:00:00.000Z');
let time = nowValue;
const now = () => new Date(time);
const key = 'devices/private-navigation';
const text = 'private source value must never persist in feedback';
async function seed(target) {
  mkdirSync(join(target.path, '..'), { recursive: true, mode: 0o700 });
  const plan = await ordinary.planContextStoreInit(target);
  await ordinary.applyContextStoreInit({ ...target, confirm: plan.digest });
  const writer = await ordinary.openOrdinaryMemoryStore(target.path, target.scope);
  try { await writer.kv.set(key, text); } finally { await writer.close(); }
}
const targetFor = scope => scope === 'identity' ? shared : ledger;
const session = () => new MemoryFeedbackSession(ledger, targetFor, now);
const fails = async (operation, code) => assert.rejects(operation, error => error.code === code);
try {
  await seed(ledger); await seed(beta); await seed(shared);
  const current = await inspectMemoryCandidate({ ...ledger, key });
  const source = current.source, task = digest('opaque-task');
  const service = session();
  assert.equal((await memoryFeedbackStatus(ledger)).count, 0);
  const token = await service.issue(source, task);
  assert.equal((await memoryFeedbackStatus(ledger)).initialized, false, 'issuing receipt must not create a ledger table');
  assert.equal(token.includes(key), false);
  await fails(() => service.record({ receipt: token + 'x', task_digest: task, outcome: 'useful' }), 'MEMORY_FEEDBACK_RECEIPT_INVALID');
  await fails(() => session().record({ receipt: token, task_digest: task, outcome: 'useful' }), 'MEMORY_FEEDBACK_RECEIPT_INVALID');
  await fails(() => new MemoryFeedbackSession(beta, targetFor, now).record({ receipt: token, task_digest: task, outcome: 'useful' }), 'MEMORY_FEEDBACK_RECEIPT_INVALID');
  await fails(() => service.record({ receipt: token, task_digest: digest('different-task'), outcome: 'useful' }), 'MEMORY_FEEDBACK_RECEIPT_INVALID');
  await fails(() => service.record({ receipt: token, task_digest: task, outcome: 'useful', query: 'must reject' }), 'MEMORY_FEEDBACK_INPUT_INVALID');
  assert.equal((await memoryFeedbackStatus(ledger)).count, 0);
  const originalPrepare = MemoryDatabase.prototype.prepare;
  let injected = false;
  MemoryDatabase.prototype.prepare = function(sql) {
    const statement = originalPrepare.call(this, sql);
    if (!sql.startsWith('INSERT INTO cairn_memory_feedback_v1')) return statement;
    const run = statement.run;
    statement.run = async (...args) => {
      await run(...args); injected = true; throw Object.assign(new Error('fault injection'), { code: 'MEMORY_FEEDBACK_INJECTED' });
    };
    return statement;
  };
  try {
    await fails(() => service.record({ receipt: token, task_digest: task, outcome: 'useful' }), 'MEMORY_FEEDBACK_INJECTED');
  } finally { MemoryDatabase.prototype.prepare = originalPrepare; }
  assert.equal(injected, true, 'fault injection must reach the actual insert');
  assert.equal((await memoryFeedbackStatus(ledger)).initialized, false, 'DDL and record must roll back together');
  const recorded = await service.record({ receipt: token, task_digest: task, outcome: 'useful' });
  assert.equal(recorded.recorded, true);
  assert.equal([...((await service.eligible([source])).values())][0].length, 1);
  time = nowValue + 30 * 86400000;
  assert.equal((await service.eligible([source])).size, 0, 'retention boundary invalidates eligibility, not history');
  assert.equal((await memoryFeedbackStatus(ledger)).count, 1);
  time = nowValue;
  assert.equal((await service.record({ receipt: token, task_digest: task, outcome: 'useful' })).recorded, false);
  const sameTask = await service.issue(source, task);
  assert.equal((await service.record({ receipt: sameTask, task_digest: task, outcome: 'useful' })).recorded, false, 'new receipt cannot double-vote same task/result');
  await fails(() => service.record({ receipt: token, task_digest: task, outcome: 'stale' }), 'MEMORY_FEEDBACK_CONFLICT');
  const stored = JSON.stringify(await listMemoryFeedback(ledger));
  for (const secret of [text, key, token, 'opaque-task', 'query', 'prompt']) assert.equal(stored.includes(secret), false, `retained forbidden field ${secret}`);
  assert.equal(JSON.parse(stored).records.length, 1);
  time = nowValue - 1;
  await fails(() => service.record({ receipt: token, task_digest: task, outcome: 'useful' }), 'MEMORY_FEEDBACK_RECEIPT_INVALID');
  time = nowValue + 86400000;
  await fails(() => service.record({ receipt: token, task_digest: task, outcome: 'useful' }), 'MEMORY_FEEDBACK_RECEIPT_INVALID');
  time = nowValue;
  const writer = await ordinary.openOrdinaryMemoryStore(ledger.path, 'project');
  try { await writer.kv.set(key, 'changed'); await writer.kv.set(key, text); } finally { await writer.close(); }
  await fails(() => service.record({ receipt: token, task_digest: task, outcome: 'useful' }), 'MEMORY_FEEDBACK_SOURCE_STALE');
  const fresh = (await inspectMemoryCandidate({ ...ledger, key })).source;
  assert.equal((await service.eligible([fresh])).size, 0, 'ABA must invalidate old vote');
  const sharedSource = (await inspectMemoryCandidate({ ...shared, key })).source;
  const sharedToken = await service.issue(sharedSource, digest('shared-task'));
  await service.record({ receipt: sharedToken, task_digest: digest('shared-task'), outcome: 'wrong_context' });
  assert.equal((await memoryFeedbackStatus(shared)).initialized, false, 'shared source must not gain a feedback ledger');
  assert.equal((await memoryFeedbackStatus(ledger)).count, 2);
  const ids = (await listMemoryFeedback(ledger)).records.map(row => row.id);
  const input = { schema_version: 1, ids: [ids[0]] };
  const plan = await planForgetMemoryFeedback(ledger, input);
  const unselectedTask = digest('unselected-task'), unselectedReceipt = await service.issue(fresh, unselectedTask);
  const unselected = await service.record({ receipt: unselectedReceipt, task_digest: unselectedTask, outcome: 'useful' });
  await fails(() => forgetMemoryFeedback(ledger, input, '0'.repeat(64)), 'MEMORY_FEEDBACK_STALE_PLAN');
  assert.equal((await forgetMemoryFeedback(ledger, input, plan.digest)).forgotten, 1);
  await fails(() => forgetMemoryFeedback(ledger, input, plan.digest), 'MEMORY_FEEDBACK_STALE_PLAN');
  assert.equal((await memoryFeedbackStatus(ledger)).count, 2);
  assert.equal((await listMemoryFeedback(ledger)).records.some(row => row.id === unselected.id), true, 'interleaved unselected vote must survive exact forget');
  // Managed restore changes both source and ledger epoch without changing session secret.
  const beforeRestore = await service.issue(fresh, digest('before-restore'));
  const snapshot = join(root, 'snapshot.db');
  await ordinary.backupMemoryContextStore({ ...ledger, output: snapshot });
  // Retain the entire idle store directory, including SQLite auxiliary files.
  // Recovery must never bypass absent-target sidecar admission.
  renameSync(join(ledger.path, '..'), join(root, 'retired-ledger'));
  mkdirSync(join(ledger.path, '..'), { mode: 0o700 });
  const recovery = await ordinary.planContextStoreRestore({ ...ledger, input: snapshot });
  await ordinary.applyContextStoreRestore({ ...ledger, input: snapshot, confirm: recovery.digest });
  await fails(() => service.record({ receipt: beforeRestore, task_digest: digest('before-restore'), outcome: 'useful' }), 'MEMORY_FEEDBACK_SOURCE_STALE');
  const afterRestore = (await inspectMemoryCandidate({ ...ledger, key })).source;
  assert.equal((await service.eligible([afterRestore, sharedSource])).size, 0);
  assert.equal((await memoryFeedbackStatus(ledger)).count, 2, 'restore retains history but invalidates eligibility');
  const retained = (await listMemoryFeedback(ledger)).records[0];
  const capacityWriter = await ordinary.openOrdinaryMemoryStore(ledger.path, 'project');
  try {
    await capacityWriter.getDatabase().prepare(`WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<9998)
      INSERT INTO cairn_memory_feedback_v1(id,record_json) SELECT printf('%064x',i),json_set(?,'$.id',printf('%064x',i)) FROM n`).run(JSON.stringify(retained));
  } finally { await capacityWriter.close(); }
  const overCapacity = await service.issue(afterRestore, digest('over-capacity'));
  await fails(() => service.record({ receipt: overCapacity, task_digest: digest('over-capacity'), outcome: 'useful' }), 'MEMORY_FEEDBACK_CAPACITY');
  assert.equal((await memoryFeedbackStatus(ledger)).count, 10000, 'capacity refusal must not silently purge');
  const free = { schema_version: 1, ids: ['2'.padStart(64, '0')] };
  const freePlan = await planForgetMemoryFeedback(ledger, free); await forgetMemoryFeedback(ledger, free, freePlan.digest);
  const competing = session(), taskA = digest('capacity-race-a'), taskB = digest('capacity-race-b');
  const tokenA = await service.issue(afterRestore, taskA), tokenB = await competing.issue(afterRestore, taskB);
  const raced = await Promise.allSettled([
    service.record({ receipt: tokenA, task_digest: taskA, outcome: 'useful' }),
    competing.record({ receipt: tokenB, task_digest: taskB, outcome: 'useful' }),
  ]);
  assert.equal(raced.filter(row => row.status === 'fulfilled' && row.value.recorded).length, 1, 'one remaining slot permits exactly one concurrent winner');
  assert.equal((await memoryFeedbackStatus(ledger)).count, 10000);
  const deleteWriter = await ordinary.openOrdinaryMemoryStore(ledger.path, 'project');
  try { await deleteWriter.kv.delete(key); } finally { await deleteWriter.close(); }
  await fails(() => service.record({ receipt: overCapacity, task_digest: digest('over-capacity'), outcome: 'useful' }), 'MEMORY_FEEDBACK_SOURCE_STALE');
  assert.equal((await memoryFeedbackStatus(ledger)).count, 10000);
  const corruptWriter = await ordinary.openOrdinaryMemoryStore(ledger.path, 'project');
  try {
    await corruptWriter.getDatabase().prepare('UPDATE cairn_memory_feedback_v1 SET record_json=CAST(x\'80\' AS TEXT) WHERE id=?').run('1'.padStart(64, '0'));
  } finally { await corruptWriter.close(); }
  await fails(() => memoryFeedbackStatus(ledger), 'MEMORY_CONTEXT_DAMAGED');
  const missing = { path: join(root, 'absent.db'), scope: 'project' };
  assert.equal((await memoryFeedbackStatus(missing)).count, 0); assert.equal(existsSync(missing.path), false);
  console.log('PASS: authenticated minimized feedback, session/project/task/expiry/ABA controls, shared-source project ledger, exact forget and no-write reads');
} finally { rmSync(root, { recursive: true, force: true }); }
