import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { rankHybridMemory } from '../dist/memory-retrieval.js';
import { getEmbeddingConfig, embedTexts, cosineSimilarity } from '../dist/embeddings.js';
import { getMemoryRerankerConfig, memoryRerankCandidateCount, rerankMemoryResults } from '../dist/memory-reranker.js';

const args = process.argv.slice(2);
const live = args.includes('--live'), summary = args.includes('--summary');
const outputIndex = args.indexOf('--output');
const output = outputIndex < 0 ? undefined : args[outputIndex + 1];
const recognized = new Set(['--live', '--check', '--summary', '--output']);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--output') { assert.ok(args[++i], '--output requires a new file'); continue; }
  assert.ok(recognized.has(args[i]), 'unknown study option');
}
assert.ok(!(live && args.includes('--check')), '--check cannot enable live providers');
const hash = b => createHash('sha256').update(b).digest('hex');
const bytes = readFileSync(new URL('./fixtures/memory-reranker-study-v1.json', import.meta.url));
const fixtureDigest = hash(bytes);
assert.equal(fixtureDigest, 'f6a5d2de8d2846dd5a8de764096d92255716592805e8abfdc771181eac23beb1', 'frozen dataset changed; review a new version instead of silently tuning labels');
const document = z.object({ key: z.string().min(1), value: z.string().min(1), grade: z.number().int().min(0).max(3),
  scope: z.string().optional(), current: z.boolean().optional() }).strict();
const fixture = z.object({ schema_version: z.literal(1), description: z.string(), cases: z.array(z.object({
  id: z.string().min(1), query: z.string().min(1).max(4096), scope: z.string().min(1),
  aliases: z.array(z.string()).max(8).optional(), documents: z.array(document).min(1).max(50),
}).strict()).length(20) }).strict().parse(JSON.parse(bytes));
assert.equal(new Set(fixture.cases.map(c => c.id)).size, 20);
const reranker = live ? getMemoryRerankerConfig() : null;
const embedding = live ? getEmbeddingConfig() : null;
if (live) { assert.ok(reranker, 'live study requires explicit reranker opt-in/URL/model'); assert.ok(embedding, 'live study requires explicit existing embedding configuration'); }
const results = [];
function metrics(entries, relevant) {
  const selected = entries.slice(0, 3), hit = selected.findIndex(e => e.grade > 0);
  const dcg = selected.reduce((s, e, i) => s + (2 ** e.grade - 1) / Math.log2(i + 2), 0);
  const ideal = [...relevant].sort((a, b) => b.grade - a.grade).slice(0, 3)
    .reduce((s, e, i) => s + (2 ** e.grade - 1) / Math.log2(i + 2), 0);
  return { p1: selected[0]?.grade > 0 ? 1 : 0, mrr3: hit < 0 ? 0 : 1 / (hit + 1),
    ndcg3: ideal ? dcg / ideal : 0, recall3: relevant.length ? selected.filter(e => e.grade > 0).length / relevant.length : 0 };
}
for (const test of fixture.cases) {
  const visible = test.documents.map(d => ({ ...d, scope: d.scope ?? test.scope }))
    .filter(d => d.scope === test.scope && d.current !== false);
  const relevant = [...new Map(visible.filter(d => d.grade > 0).map(d => [JSON.stringify([d.key, d.value]), d])).values()];
  let semanticScores, embeddingMs = 0;
  if (live && visible.length) {
    const started = performance.now();
    const vectors = await embedTexts(embedding, [...visible.map(d => `${d.key}\n${d.value}`), test.query]);
    assert.equal(vectors.length, visible.length + 1); const q = vectors.at(-1);
    assert.ok(q?.length && q.every(Number.isFinite));
    assert.ok(vectors.every(v => v.length === q.length && v.every(Number.isFinite)));
    semanticScores = new Map(visible.map((d, i) => [d, cosineSimilarity(q, vectors[i])]));
    embeddingMs = performance.now() - started;
  }
  const common = { minScore: 0, aliases: test.aliases, semanticScores };
  const baseline = rankHybridMemory(visible, test.query, { ...common, topK: 3 }).results;
  const pool = rankHybridMemory(visible, test.query, { ...common, topK: memoryRerankCandidateCount(3, reranker) }).results;
  const start = performance.now();
  const ranked = await rerankMemoryResults(pool, test.query, 3, reranker,
    e => [test.query, ...(test.aliases ?? [])].some(q => e.key.normalize('NFKC').toLowerCase() === q.normalize('NFKC').toLowerCase().trim()));
  const elapsedMs = performance.now() - start;
  if (!live) assert.deepEqual(ranked.results, baseline, 'offline/default arm must stay byte-equivalent');
  const forbidden = ranked.results.filter(e => e.scope !== test.scope || e.current === false).length;
  assert.equal(forbidden, 0);
  results.push({ id: test.id, positive: relevant.length > 0, admitted: pool.length, status: ranked.status,
    baseline: metrics(baseline, relevant), reranked: metrics(ranked.results, relevant),
    false_positives: relevant.length ? 0 : ranked.results.length, forbidden,
    baseline_keys: baseline.map(e => e.key), reranked_keys: ranked.results.map(e => e.key),
    embedding_ms: Math.round(embeddingMs), rerank_ms: Math.round(elapsedMs) });
}
const positives = results.filter(r => r.positive);
const aggregate = arm => Object.fromEntries(['p1', 'mrr3', 'ndcg3', 'recall3'].map(k => [k,
  Number((positives.reduce((s, r) => s + r[arm][k], 0) / positives.length).toFixed(6))]));
const times = results.filter(r => r.status === 'reranked').map(r => r.rerank_ms).sort((a, b) => a - b);
const percentile = p => times.length ? times[Math.min(times.length - 1, Math.ceil(p * times.length) - 1)] : null;
const report = { schema_version: 1, scope: 'synthetic continuity-ranking comparison; not an independent holdout, human study or agent-quality gain',
  live, fixture_digest: fixtureDigest, implementation_digest: hash(readFileSync(new URL('../dist/memory-reranker.js', import.meta.url))),
  source_revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8' }).trim(),
  model_digest: reranker ? hash(reranker.model) : null, embedding_model_digest: embedding ? hash(embedding.model) : null,
  cases: results.length, positive_cases: positives.length, negative_cases: results.length - positives.length,
  baseline: aggregate('baseline'), reranked: aggregate('reranked'),
  improvements: positives.filter(r => r.reranked.mrr3 > r.baseline.mrr3).length,
  regressions: positives.filter(r => r.reranked.mrr3 < r.baseline.mrr3).length,
  false_positives: results.reduce((s, r) => s + r.false_positives, 0), forbidden_results: results.reduce((s, r) => s + r.forbidden, 0),
  provider_failures: results.filter(r => r.status === 'failed').length,
  rerank_p50_ms: percentile(0.5), rerank_p95_ms: percentile(0.95), results };
assert.equal(report.false_positives, 0); assert.equal(report.forbidden_results, 0);
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify(summary ? { ...report, results: undefined } : report, null, 2));
