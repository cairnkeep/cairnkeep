import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const base = mkdtempSync(join(tmpdir(), 'cairn-memory-retrieval-'));
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(CAIRN_|OPENAI_|OPENROUTER_|ANTHROPIC_|AGENT_MEMORY_CONFIG)/.test(name)));
const clients = [];
const embeddingInputs = [];
let providerMode = 'valid';
const provider = createServer(async (request, response) => {
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  embeddingInputs.push(...body.input);
  if (providerMode === 'fail') { response.writeHead(503); response.end('private-provider-error-must-not-be-returned'); return; }
  const data = providerMode === 'incomplete' ? [] : body.input.map((_, index) => ({ index,
    embedding: providerMode === 'invalid' ? [0, 0] : providerMode === 'dimension' ? [1, 0, 0] : providerMode === 'malformed' ? ['not-a-number', 0] : [1, 0],
  }));
  response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ data }));
});
await new Promise(yes => provider.listen(0, '127.0.0.1', yes));
async function connect(name, extra = {}) {
  const cwd = join(base, name); mkdirSync(cwd);
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/index.js')], cwd,
    env: { ...cleanEnv, CAIRN_AGENTFS_BASE_DIR: join(base, 'store'), CAIRN_TYPED_MEMORY_NODES: '1', ...extra }, stderr: 'pipe' });
  const client = new Client({ name: `retrieval-${name}`, version: '1' }, { capabilities: {} });
  clients.push({ client, transport }); await client.connect(transport); return client;
}
async function tool(client, name, input) {
  const result = await client.callTool({ name, arguments: input });
  assert.notEqual(result.isError, true, JSON.stringify(result)); return result.structuredContent;
}
const search = (client, query, extra = {}) => tool(client, 'memory_search', { scope: 'identity', query, strategy: 'hybrid', explain: true, ...extra });
try {
  const client = await connect('first');
  await tool(client, 'memory_write', { scope: 'identity', key: 'decisions/office-tunnel', value: 'Office tunnel access uses old-gateway-41.' });
  await tool(client, 'memory_supersede', { scope: 'identity', key: 'decisions/office-tunnel', value: 'Office tunnel access uses current-gateway-42. Aliases: relaybox.', reason: 'approved fixture configuration changed' });
  await tool(client, 'memory_write', { scope: 'work', key: 'decisions/private-fixture', value: 'Office tunnel access must never cross scope filters.' });
  const legacy = await tool(client, 'memory_search', { scope: 'identity', query: 'Office tunnel', top_k: 2 });
  assert.equal(legacy.mode, 'substring'); assert.equal(legacy.retrieval, undefined);
  const result = await search(client, 'office tunnel access');
  assert.equal(result.mode, 'hybrid', 'hybrid mode must be implemented rather than silently stripping new options');
  assert.equal(result.results[0].match.reasons.includes('lexical-coverage'), true);
  assert.equal(result.retrieval.embedding_status, 'unconfigured');
  assert.equal((await search(client, 'old-gateway-41')).count, 0, 'superseded history is not current retrieval');
  assert.equal((await search(client, 'current-gateway-43')).count, 0);
  assert.equal((await search(client, 'remote connection', { query_aliases: ['office tunnel access'] })).count, 1);
  assert.equal((await search(client, 'office tunnel access', { tags_all: ['absent'] })).count, 0);
  const unsupported = await client.callTool({ name: 'memory_search', arguments: { scope: 'identity', query: 'office', strategy: 'legacy', explain: true } });
  assert.equal(unsupported.isError, true);
  assert.deepEqual(await tool(client, 'memory_search', { scope: 'identity', query: 'Office tunnel', top_k: 2 }), legacy, 'explicit hybrid calls do not change legacy default behavior');
  // A direct local AgentFS process owns the native database handle. Exercise
  // sequential handoff; concurrent clients belong on one shared HTTP server.
  await client.close();
  const fresh = await connect('second');
  assert.deepEqual((await search(fresh, 'office tunnel access')).results, result.results, 'new process/cwd preserves reviewed live context');
  await fresh.close();
  const providerEnv = { CAIRN_LLM_API_KEY: 'synthetic-retrieval-key', CAIRN_MEMORY_EMBEDDING_URL: `http://127.0.0.1:${provider.address().port}`, CAIRN_MEMORY_EMBEDDING_MODEL: 'fixture-vector-model' };
  const semantic = await connect('semantic', providerEnv);
  assert.equal((await search(semantic, 'sourdough bread')).count, 0, 'even a perfect mocked cosine needs explicit semantic-only consent');
  assert.equal((await search(semantic, 'remote connectivity', { min_score: 0.8 })).count, 1);
  assert.equal(embeddingInputs.some(text => text.includes('must never cross scope')), false, 'scope filter runs before embedding');
  assert.equal(embeddingInputs.some(text => text.includes('old-gateway-41')), false, 'history is never sent for current retrieval');
  providerMode = 'fail';
  const fallback = await search(semantic, 'office access tunnel');
  assert.equal(fallback.count, 1); assert.equal(fallback.retrieval.embedding_status, 'failed');
  assert.equal(JSON.stringify(fallback).includes('private-provider-error'), false);
  providerMode = 'invalid';
  const invalid = await search(semantic, 'office access tunnel');
  assert.equal(invalid.count, 1); assert.equal(invalid.retrieval.embedding_status, 'failed', 'invalid vectors fail back to lexical retrieval');
  for (const mode of ['incomplete', 'dimension', 'malformed']) {
    providerMode = mode;
    const degraded = await search(semantic, 'office access tunnel');
    assert.equal(degraded.count, 1); assert.equal(degraded.retrieval.embedding_status, 'failed');
  }
  const before = embeddingInputs.length;
  for (const extra of [{ query: 'x'.repeat(4097) }, { query_aliases: ['é'.repeat(200)] }, { query_aliases: Array(9).fill('alias') }]) {
    const rejected = await semantic.callTool({ name: 'memory_search', arguments: { scope: 'identity', query: 'office', strategy: 'hybrid', ...extra } });
    assert.equal(rejected.isError, true);
  }
  assert.equal(embeddingInputs.length, before, 'oversized/invalid requests fail before provider calls');
  console.log('PASS: real MCP hybrid schema, fresh-client continuity, live/history isolation, bounded aliases, filtered embeddings and private provider fallback');
} finally {
  for (const { client, transport } of clients) { await client.close().catch(() => {}); await transport.close().catch(() => {}); }
  await new Promise(yes => { provider.close(yes); provider.closeAllConnections(); });
  rmSync(base, { recursive: true, force: true });
}
