import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createContinuityLab, serverEntry } from './memory-continuity-lab.mjs';
import * as ordinary from '../dist/ordinary-memory-store.js';

process.umask(0o077);
const lab = createContinuityLab(), target = { scope: 'project', path: join(lab.projects.alpha, '.agentfs', 'project.db') };
const flags = { CAIRN_MEMORY_CONTEXT: '1' }, query = { scope: 'project', query: 'office tunnel', top_k: 2 };
let provider, providerClient, providerTransport;
try {
  mkdirSync(join(target.path, '..'), { recursive: true, mode: 0o700 });
  const init = await ordinary.planContextStoreInit(target); await ordinary.applyContextStoreInit({ ...target, confirm: init.digest });
  const writer = await ordinary.openOrdinaryMemoryStore(target.path, 'project');
  try { await writer.kv.set('facts/a', 'Office tunnel path alpha.'); await writer.kv.set('facts/b', 'Office tunnel path bravo.'); } finally { await writer.close(); }
  const off = await lab.connect('alpha', flags), on = await lab.connect('alpha', { ...flags, CAIRN_MEMORY_FEEDBACK_RANKING: '1' });
  const featureOff = await lab.connect('alpha', { CAIRN_MEMORY_FEEDBACK_RANKING: '1' });
  assert.equal((await featureOff.client.listTools()).tools.some(row => row.name === 'memory_context_search' || row.name === 'memory_feedback_record'), false,
    'ranking flag cannot enable context tools');
  await featureOff.close();
  const before = await off.call('memory_context_search', query);
  assert.equal(before.results[0].key, 'facts/a');
  assert.deepEqual(await on.call('memory_context_search', query), before, 'no-feedback path must remain byte-equivalent');
  for (let i = 0; i < 3; i++) {
    const task = createHash('sha256').update(`ranking-task-${i}`).digest('hex');
    const observed = await on.call('memory_context_search', { ...query, task_digest: task });
    await on.call('memory_feedback_record', { task_digest: task, receipt: observed.results.find(row => row.key === 'facts/b').receipt, outcome: 'useful' });
    if (i < 2) assert.deepEqual(await on.call('memory_context_search', query), before, 'under minimum task count must remain unchanged');
  }
  assert.deepEqual(await off.call('memory_context_search', query), before, 'collection/kill switch cannot change baseline');
  const ranked = await on.call('memory_context_search', query);
  assert.deepEqual(ranked.results.map(row => row.key), ['facts/b', 'facts/a']);
  assert.equal(ranked.results[0].feedback.delta, 0.02);
  assert.equal((await on.call('memory_context_search', { ...query, query_aliases: ['facts/a'] })).results[0].key, 'facts/a');
  assert.equal((await on.call('memory_search', { ...query, strategy: 'hybrid' })).results[0].key, 'facts/a');
  const negative = { scope: 'project', query: 'completely unrelated planets', top_k: 2 };
  assert.deepEqual(await on.call('memory_context_search', negative), await off.call('memory_context_search', negative));
  assert.ok(Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(ranked) }], structuredContent: ranked })) <= 32768);

  const calls = []; let mode = 'success';
  provider = createServer(async (request, response) => {
    const chunks = []; for await (const part of request) chunks.push(part);
    const body = JSON.parse(Buffer.concat(chunks)); calls.push(body);
    if (mode === 'error') { response.writeHead(503); response.end('private-provider-error'); return; }
    if (mode === 'timeout') return; // Let the client's real deadline abort the request.
    response.setHeader('Content-Type', 'application/json');
    if (mode === 'incomplete') { response.end(JSON.stringify({ results: [] })); return; }
    response.end(JSON.stringify({ results: body.documents.map((text, index) => ({ index, relevance_score: text.includes('bravo') ? 10 : 0 })) }));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${provider.address().port}/v1`;
  // Only the explicitly configured loopback mock may be contacted by this child.
  // Keep code static: fixture configuration is data, never JavaScript source.
  const guard = `const allowed=new URL(process.env.CAIRN_MEMORY_RERANK_URL);if(allowed.protocol!=='http:'||allowed.hostname!=='127.0.0.1')throw Error('ONLY_LOCAL_PROVIDER_FIXTURE');const original=globalThis.fetch;globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input.url??input);if(u.origin!==allowed.origin)throw Error('ONLY_LOCAL_PROVIDER_FIXTURE');return original(input,init);};`;
  providerTransport = new StdioClientTransport({ command: process.execPath, args: ['--import', `data:text/javascript,${encodeURIComponent(guard)}`, serverEntry],
    cwd: lab.projects.alpha, env: { ...lab.env, ...flags, CAIRN_MEMORY_FEEDBACK_RANKING: '1', CAIRN_MEMORY_RERANK: '1',
      CAIRN_MEMORY_RERANK_URL: url, CAIRN_MEMORY_RERANK_MODEL: 'fixture-only', CAIRN_MEMORY_RERANK_TIMEOUT_MS: '2000' }, stderr: 'pipe' });
  providerTransport.stderr?.resume(); providerClient = new Client({ name: 'feedback-local-provider', version: '1' }); await providerClient.connect(providerTransport);
  for (const selected of ['success', 'error', 'incomplete', 'timeout']) {
    mode = selected;
    const result = await providerClient.callTool({ name: 'memory_context_search', arguments: query });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.deepEqual(result.structuredContent.results.map(row => row.key), ['facts/b', 'facts/a'], 'bounded adjustment runs after provider order or complete provider fallback');
    if (selected === 'success') assert.equal(result.structuredContent.results[0].feedback, undefined, 'successful provider order is the baseline, not a feedback swap');
    else assert.equal(result.structuredContent.results[0].feedback.policy, 'feedback-adjacent-v1', 'failed provider falls back before feedback is applied');
    assert.equal(JSON.stringify(result).includes('private-provider-error'), false);
  }
  assert.equal(calls.length, 4); assert.equal(calls[0].documents.length, 2);
  await providerClient.close(); providerClient = undefined; await providerTransport.close(); providerTransport = undefined;
  await new Promise(resolve => provider.close(resolve)); provider = undefined;

  const corrupt = await ordinary.openOrdinaryMemoryStore(target.path, 'project');
  try { await corrupt.getDatabase().exec("UPDATE cairn_memory_feedback_v1 SET record_json='{}'"); } finally { await corrupt.close(); }
  assert.deepEqual(await on.call('memory_context_search', query), before, 'optional ranking damage must fall back without blocking retrieval');
  lab.assertOffline();
  console.log('PASS: actual MCP feedback opt-in, minimum tasks, kill switch, exact/negative/membership/byte invariants, loopback reranker/failure and damaged-ledger fallback');
} finally {
  await providerClient?.close().catch(() => {}); await providerTransport?.close().catch(() => {});
  if (provider) await new Promise(resolve => provider.close(resolve));
  await lab.close();
}
