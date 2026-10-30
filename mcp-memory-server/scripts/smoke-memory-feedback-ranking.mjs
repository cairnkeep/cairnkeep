import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as feedback from '../dist/memory-feedback.js';

assert.equal(typeof feedback.rankMemoryWithFeedback, 'function', 'FEEDBACK_RANK_RED: bounded ranking is not implemented');
const { rankMemoryWithFeedback: rank, memoryFeedbackSourceDigest: hash } = feedback;
const task = i => createHash('sha256').update(`task-${i}`).digest('hex');
const marker = { schema_version: 1, owner_domain: 'a'.repeat(64), scope: 'project',
  store_uuid: '00000000-0000-4000-8000-000000000001', restore_epoch: '00000000-0000-4000-8000-000000000002' };
function item(i, score = 0.5, extra = {}) {
  const key = `facts/item-${i}`;
  return { key, scope: 'project', value: `unchanged ${i}`, score,
    source: { ...marker, key, generation: 1, content_digest: task(i), context_revision: 0 }, ...extra };
}
function votes(entry, count = 3, outcome = 'useful') {
  return Array.from({ length: count }, (_, i) => ({ schema_version: 1, id: task(i + 1000), task_digest: task(i),
    source_digest: hash(entry.source), ledger_uuid: marker.store_uuid, ledger_epoch: marker.restore_epoch,
    created_at: '2026-01-01T00:00:00.000Z', outcome }));
}
const left = item(0), right = item(1), input = [left, right], eligible = new Map([[hash(right.source), votes(right)]]);
assert.strictEqual(rank(input, new Map(), { query: 'office tunnel' }), input);
assert.strictEqual(rank(input, eligible, { query: 'office tunnel', enabled: false }), input);
assert.deepEqual(rank(input, eligible, { query: 'office tunnel' }).map(row => row.key), [right.key, left.key]);
assert.equal(rank(input, eligible, { query: 'office tunnel' })[0].feedback.delta, 0.02);
const reordered = { ...right, source: Object.fromEntries(Object.entries(right.source).reverse()) };
assert.equal(rank([left, reordered], eligible, { query: 'office tunnel' })[0].key, right.key, 'source field insertion order is not identity');
assert.deepEqual(rank(input, eligible, { query: left.key }), input);
assert.deepEqual(rank(input, eligible, { query: 'office tunnel', aliases: [left.key] }), input);
assert.deepEqual(rank(input, new Map([[hash(right.source), votes(right, 2)]]), { query: 'office tunnel' }), input);
assert.deepEqual(rank(input, new Map([[hash(right.source), Array(1000).fill(votes(right, 1)[0])]]), { query: 'office tunnel' }), input);
const bad = votes(right).map(row => ({ ...row, task_digest: 'fabricated-not-a-digest' }));
assert.deepEqual(rank(input, new Map([[hash(right.source), bad]]), { query: 'office tunnel' }), input);
const foreign = item(1, 0.5, { source: { ...right.source, owner_domain: 'b'.repeat(64) } });
assert.deepEqual(rank([left, foreign], new Map([[hash(foreign.source), votes(foreign)]]), { query: 'office tunnel' }), [left, foreign]);
const anotherTier = item(1, 0.6);
assert.deepEqual(rank([left, anotherTier], new Map([[hash(anotherTier.source), votes(anotherTier)]]), { query: 'office tunnel' }), [left, anotherTier]);
const changed = { ...right, source: { ...right.source, generation: 2 } };
assert.deepEqual(rank([left, changed], eligible, { query: 'office tunnel' }), [left, changed]);
const ambiguous = [...votes(right), { ...votes(right)[0], outcome: 'wrong_context' }];
assert.deepEqual(rank(input, new Map([[hash(right.source), ambiguous]]), { query: 'office tunnel' }), input);

for (let seed = 0; seed < 100; seed++) {
  const original = Array.from({ length: 10 }, (_, i) => item(seed * 10 + i, Math.round((0.55 - i / 1000) * 1e6) / 1e6));
  const proof = JSON.stringify(original);
  const reported = new Map(original.map((entry, i) => [hash(entry.source), votes(entry, i % 3 ? 3 : 1000, i % 2 ? 'useful' : 'wrong_context')]));
  const ranked = rank(original, reported, { query: 'office tunnel' });
  assert.equal(JSON.stringify(original), proof, 'policy must not mutate baseline objects');
  assert.deepEqual(ranked.map(row => row.key).sort(), original.map(row => row.key).sort());
  for (const [position, entry] of ranked.entries()) {
    const previous = original.findIndex(row => row.key === entry.key);
    assert.ok(Math.abs(position - previous) <= 1);
    assert.equal(entry.value, original[previous].value); assert.equal(entry.score, original[previous].score);
    if (entry.feedback) { assert.ok(Math.abs(entry.feedback.delta) <= 0.02); assert.equal(entry.feedback.evidence, 'self-reported-usefulness'); }
  }
  assert.deepEqual(rank(ranked, reported, { query: 'office tunnel' }), ranked, 'never compound an already adjusted result');
}
console.log('PASS: feedback bounded same-store/tier adjacent swaps, exact/alias precedence, no admission, minimum distinct tasks, stale/gaming controls and no compounding');
