import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const base = mkdtempSync(join(tmpdir(), 'cairn-reranker-mcp-'));
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([n]) => !/^(CAIRN_|OPENAI_|OPENROUTER_|ANTHROPIC_|AGENT_MEMORY_CONFIG)/.test(n)));
const clients = [], requests = [];
let mode = 'valid';
const provider = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
  if (mode === 'fail') { res.writeHead(503); res.end('provider-private-sentinel'); return; }
  if (mode === 'redirect') { res.writeHead(302, { Location: '/must-not-follow' }); res.end(); return; }
  const results = body.documents.map((text, index) => ({ index, relevance_score: text.includes('immutable corrections') ? 10 : -1 }));
  if (mode === 'partial') results.pop();
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ results }));
});
await new Promise(yes => provider.listen(0, '127.0.0.1', yes));
const endpoint = `http://127.0.0.1:${provider.address().port}/v1`;
async function connect(name, enabled) {
  const cwd = join(base, name); mkdirSync(cwd);
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/index.js')], cwd,
    env: { ...cleanEnv, CAIRN_AGENTFS_BASE_DIR: join(base, 'store'), CAIRN_TYPED_MEMORY_NODES: '1',
      CAIRN_MEMORY_RERANK: enabled ? '1' : '0', CAIRN_MEMORY_RERANK_URL: endpoint, CAIRN_MEMORY_RERANK_MODEL: 'fixture-reranker' }, stderr: 'pipe' });
  const client = new Client({ name: 'reranker-' + name, version: '1' }, { capabilities: {} });
  clients.push({ client, transport }); await client.connect(transport); return client;
}
async function tool(client, name, arguments_) {
  const value = await client.callTool({ name, arguments: arguments_ });
  assert.notEqual(value.isError, true, JSON.stringify(value)); return value.structuredContent;
}
async function closeClient(client) {
  const entry = clients.find(row => row.client === client);
  await entry.client.close(); await entry.transport.close(); entry.closed = true;
}
const search = (client, extra = {}) => tool(client, 'memory_search', { scope: 'identity', query: 'release ledger', top_k: 1, ...extra });
try {
  const off = await connect('off', false);
  await tool(off, 'memory_write', { scope: 'identity', key: 'decisions/a-theme', value: 'Release ledger STALE_SENTINEL must not leave history.', tags: ['eligible'] });
  await tool(off, 'memory_supersede', { scope: 'identity', key: 'decisions/a-theme', value: 'Release ledger interface theme.', reason: 'synthetic correction', tags: ['eligible'] });
  await tool(off, 'memory_write', { scope: 'identity', key: 'decisions/z-policy', value: 'Release ledger policy uses immutable corrections.', tags: ['eligible'] });
  await tool(off, 'memory_write', { scope: 'work', key: 'decisions/wrong-scope', value: 'Release ledger SCOPE_SENTINEL must not cross scopes.' });
  const baseline = await search(off);
  assert.equal(requests.length, 0, 'disabled profile makes no reranking calls');
  assert.equal(baseline.results[0].key, 'decisions/a-theme');
  const hybrid = { strategy: 'hybrid', explain: true };
  const hybridBaseline = await search(off, hybrid);
  const catalog = (await off.listTools()).tools;
  await closeClient(off);
  const on = await connect('on', true);
  assert.deepEqual((await on.listTools()).tools, catalog.map(t => t.name === 'memory_search'
    ? { ...t, annotations: { ...t.annotations, openWorldHint: true } } : t),
    'only opted-in outbound search receives an open-world hint; schemas/order remain unchanged');
  const reranked = await search(on);
  assert.equal(requests.length, 1, 'opt-in reaches real provider through MCP');
  assert.equal(reranked.results[0].key, 'decisions/z-policy');
  assert.ok(requests[0].documents.length > 1, 'rerank before final top_k truncation');
  assert.equal(JSON.stringify(requests).includes('SCOPE_SENTINEL'), false);
  assert.equal(JSON.stringify(requests).includes('STALE_SENTINEL'), false);
  for (mode of ['fail', 'partial', 'redirect']) {
    const count = requests.length;
    assert.deepEqual(await search(on), baseline, 'complete legacy fallback payload stays identical');
    assert.equal(requests.length, count + 1, 'no redirects or retries');
  }
  assert.deepEqual(await search(on, hybrid), hybridBaseline, 'complete hybrid fallback payload stays identical');
  mode = 'valid';
  assert.equal((await search(on, { strategy: 'hybrid', query_aliases: ['decisions/a-theme'] })).results[0].key,
    'decisions/a-theme', 'explicit alias exact-key priority survives learned ranking');
  await tool(on, 'memory_write', { scope: 'identity', key: 'decisions/zz-filtered', value: 'Release ledger FILTER_SENTINEL excluded by tags.', tags: ['excluded'] });
  await search(on, { tags_all: ['eligible'] });
  assert.equal(JSON.stringify(requests.at(-1)).includes('FILTER_SENTINEL'), false, 'typed hard filters run before provider disclosure');
  const noHits = await search(on, { strategy: 'hybrid', query: 'unrelated terminology' });
  assert.equal(noHits.count, 0, 'reranking cannot grant admission');
  const before = requests.length;
  await search(on, { strategy: 'hybrid', query: 'STALE_SENTINEL' });
  assert.equal(requests.length, before, 'rejected identifier/history creates no provider request');
  assert.equal(JSON.stringify(reranked).includes('provider-private-sentinel'), false);
  await closeClient(on);
  const reader = await connect('new-cwd', true);
  assert.equal((await search(reader)).results[0].key, 'decisions/z-policy', 'new client and cwd use same scoped ranking');
  console.log('PASS: real MCP opt-in reranking, conservative annotations, scope/history isolation, admission and exact fallback');
} finally {
  for (const { client, transport, closed } of clients) if (!closed) { await client.close(); await transport.close(); }
  provider.closeAllConnections(); await new Promise(yes => provider.close(yes));
  rmSync(base, { recursive: true, force: true });
}
