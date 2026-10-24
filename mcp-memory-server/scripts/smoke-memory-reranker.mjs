import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { getMemoryRerankerConfig, memoryRerankCandidateCount, rerankMemoryResults } from '../dist/memory-reranker.js';

const entries = [
  { key: 'decisions/noise', value: 'Release ledger interface theme.' },
  { key: 'decisions/policy', value: 'Release ledger corrections append a new immutable entry.' },
  { key: 'decisions/other', value: 'Release ledger build artifact directory.' },
];
let mode = 'valid';
const seen = [];
const server = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks).toString()); seen.push({ body, headers: req.headers, path: req.url });
  if (mode === 'slow') await new Promise(yes => setTimeout(yes, 200));
  if (mode === 'redirect') { res.writeHead(302, { Location: '/other' }); res.end(); return; }
  if (mode === 'fail') { res.writeHead(503); res.end('private-upstream-detail'); return; }
  if (mode === 'oversized') { res.end('x'.repeat(70 * 1024)); return; }
  if (mode === 'announced') { res.setHeader('Content-Length', '999999'); res.end(); return; }
  let results = body.documents.map((_, index) => ({ index, relevance_score: index === 1 ? 3 : -index - 1 }));
  if (mode === 'partial') results.pop();
  if (mode === 'duplicate') results[1].index = 0;
  if (mode === 'index') results[1].index = 999;
  if (mode === 'score') results[1].relevance_score = 'high';
  if (mode === 'infinite') { res.end('{"results":[{"index":0,"relevance_score":1e999},{"index":1,"relevance_score":1},{"index":2,"relevance_score":0}]}'); return; }
  if (mode === 'ties') results.forEach(r => { r.relevance_score = 0; });
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ results }));
});
await new Promise(yes => server.listen(0, '127.0.0.1', yes));
const base = `http://127.0.0.1:${server.address().port}/v1`;
const env = { CAIRN_MEMORY_RERANK: '1', CAIRN_MEMORY_RERANK_URL: base, CAIRN_MEMORY_RERANK_MODEL: 'fixture-reranker', CAIRN_MEMORY_RERANK_TIMEOUT_MS: '1000' };
try {
  assert.equal(getMemoryRerankerConfig({ ...env, CAIRN_MEMORY_RERANK: '0' }), null);
  assert.equal(getMemoryRerankerConfig({ ...env, CAIRN_MEMORY_RERANK: undefined }), null);
  for (const url of ['file:///tmp/provider', 'ftp://example.test', 'https://user:secret@example.test', base + '?key=secret', base + '#fragment']) {
    assert.equal(getMemoryRerankerConfig({ ...env, CAIRN_MEMORY_RERANK_URL: url }), null);
  }
  for (const timeout of ['0', '99', '10001', 'not-a-number']) assert.equal(getMemoryRerankerConfig({ ...env, CAIRN_MEMORY_RERANK_TIMEOUT_MS: timeout }), null);
  assert.equal(getMemoryRerankerConfig({ ...env, CAIRN_MEMORY_RERANK_MODEL: '' }), null);
  assert.equal(getMemoryRerankerConfig({ ...env, CAIRN_MEMORY_RERANK_API_KEY: 'secret\r\ninjected' }), null);
  const config = getMemoryRerankerConfig(env); assert.ok(config);
  assert.equal(memoryRerankCandidateCount(8, null), 8);
  assert.equal(memoryRerankCandidateCount(8, config), 32);
  assert.equal(memoryRerankCandidateCount(50, config), 50);
  const disabled = await rerankMemoryResults(entries, 'release ledger', 1, null);
  assert.deepEqual(disabled.results, entries.slice(0, 1)); assert.equal(seen.length, 0);
  const ranked = await rerankMemoryResults(entries, 'release ledger', 1, config);
  assert.equal(ranked.status, 'reranked'); assert.equal(ranked.results[0], entries[1]);
  assert.equal(seen[0].path, '/v1/rerank'); assert.equal(seen[0].headers.authorization, undefined);
  assert.equal(seen[0].body.top_n, entries.length); assert.equal(seen[0].body.model, 'fixture-reranker');
  const pinned = await rerankMemoryResults(entries, 'release ledger', 2, config, e => e === entries[0]);
  assert.equal(pinned.results[0], entries[0], 'existing exact-hit tier wins over model score');
  mode = 'ties'; assert.deepEqual((await rerankMemoryResults(entries, 'q', 3, config)).results, entries);
  for (mode of ['partial', 'duplicate', 'index', 'score', 'infinite', 'oversized', 'announced', 'redirect', 'fail', 'slow']) {
    const count = seen.length;
    const result = await rerankMemoryResults(entries, 'release ledger', 1,
      mode === 'slow' ? { ...config, timeoutMs: 100 } : config);
    assert.equal(result.status, 'failed', mode); assert.deepEqual(result.results, entries.slice(0, 1), mode);
    assert.equal(seen.length, count + 1, 'no redirect or retry');
  }
  mode = 'valid';
  const secret = 'synthetic-reranker-secret';
  await rerankMemoryResults(entries, 'q', 1, getMemoryRerankerConfig({ ...env, CAIRN_MEMORY_RERANK_API_KEY: secret }));
  assert.equal(seen.at(-1).headers.authorization, 'Bearer ' + secret);
  const long = entries.map(e => ({ ...e, value: '😀'.repeat(10000) }));
  await rerankMemoryResults(long, 'q', 2, config);
  assert.ok(seen.at(-1).body.documents.every(s => Buffer.byteLength(s) <= 4096 && !s.includes('\uFFFD')));
  const count = seen.length;
  await rerankMemoryResults(entries, 'x'.repeat(4097), 1, config);
  await rerankMemoryResults([], 'q', 1, config);
  await rerankMemoryResults(entries.slice(0, 1), 'q', 1, config);
  assert.equal(seen.length, count, 'empty/trivial/oversized-query cases make no provider request');
  const execute = promisify(execFile);
  const probe = fileURLToPath(new URL('../../scripts/probe-memory-reranker.mjs', import.meta.url));
  const probeEnv = { ...process.env, ...env, CAIRN_MEMORY_RERANK_API_KEY: '' };
  const beforeProbe = seen.length;
  await execute(process.execPath, [probe], { env: { ...probeEnv, CAIRN_MEMORY_RERANK: '0' } });
  assert.equal(seen.length, beforeProbe, 'disabled diagnostics must not send requests');
  await execute(process.execPath, [probe], { env: probeEnv });
  assert.equal(seen.length, beforeProbe + 1, 'diagnostics must validate an actual ranking response');
  await assert.rejects(execute(process.execPath, [probe], { env: { ...probeEnv, CAIRN_MEMORY_RERANK_MODEL: '' } }), e => e.code === 2);
  mode = 'partial';
  await assert.rejects(execute(process.execPath, [probe], { env: probeEnv }), e => e.code === 3 && !e.stdout && !e.stderr);
  const beforeImport = seen.length;
  const { probeMemoryReranker } = await import('../../scripts/probe-memory-reranker.mjs');
  assert.equal(seen.length, beforeImport, 'native Windows imports do not run CLI probes implicitly');
  const keys = [...Object.keys(env), 'CAIRN_MEMORY_RERANK_API_KEY'];
  const saved = new Map(keys.map(k => [k, process.env[k]]));
  try {
    for (const k of keys) process.env[k] = probeEnv[k];
    assert.equal(await probeMemoryReranker(), 3, 'native Windows uses the same strict response validator');
    mode = 'valid'; assert.equal(await probeMemoryReranker(), 0);
    delete process.env.CAIRN_MEMORY_RERANK_MODEL; assert.equal(await probeMemoryReranker(), 2);
    process.env.CAIRN_MEMORY_RERANK = '0';
    const beforeDisabledProbe = seen.length; assert.equal(await probeMemoryReranker(), 0);
    assert.equal(seen.length, beforeDisabledProbe);
  } finally { for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  const beforeStudy = seen.length;
  await execute(process.execPath, [fileURLToPath(new URL('./run-memory-reranker-study.mjs', import.meta.url)), '--check', '--summary'], { env: probeEnv });
  assert.equal(seen.length, beforeStudy, 'study validation never calls configured providers without --live');
  console.log('PASS: opt-in reranker, strict bounded index contract, private key separation, ordering and exact fallback');
} finally { server.closeAllConnections(); await new Promise(yes => server.close(yes)); }
