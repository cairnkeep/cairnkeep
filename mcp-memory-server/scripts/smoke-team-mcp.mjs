import assert from 'node:assert/strict';
import { hardenPrivatePath } from '../dist/platform-security.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { openTeamStore, teamDigest } from '../dist/team-store.js';
import { createTeamHttpServer } from '../dist/team-http.js';
import { createTeamMcpServer, TEAM_TOOL_CATALOG } from '../dist/team-mcp.js';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const base = mkdtempSync(join(tmpdir(), 'cairn-team-mcp-'));
hardenPrivatePath(base);
delete process.env.CAIRN_TEAM;
await assert.rejects(createTeamMcpServer({ url: 'invalid', organization: 'demo-org', token: () => '' }), /disabled/);
process.env.CAIRN_TEAM = '1'; process.env.CAIRN_TEAM_HTTP = '1';
let store, server;
const connections = [];
let providerRequests = 0;
const provider = createServer((request, response) => {
  providerRequests++;
  request.resume();
  response.writeHead(503, { 'Content-Type': 'application/json' });
  response.end('{"error":"synthetic-provider-trap"}');
});
try {
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const providerUrl = `http://127.0.0.1:${provider.address().port}/v1`;
  assert.equal((await fetch(`${providerUrl}/control`)).status, 503);
  assert.equal(providerRequests, 1, 'the provider trap must actually be reachable');
  const providerEnv = {
    CAIRN_LLM_API_KEY: 'synthetic-embedding-key',
    CAIRN_MEMORY_EMBEDDING_URL: providerUrl,
    CAIRN_MEMORY_EMBEDDING_MODEL: 'synthetic-embedding-model',
    CAIRN_MEMORY_RERANK: '1',
    CAIRN_MEMORY_RERANK_URL: providerUrl,
    CAIRN_MEMORY_RERANK_MODEL: 'synthetic-reranker',
    CAIRN_MEMORY_RERANK_API_KEY: 'synthetic-reranking-key',
  };
  // Cover the service and the separate bridge process, including startup.
  Object.assign(process.env, providerEnv);
  store = await openTeamStore(join(base, 'team'), { create: true, organization: 'demo-org' });
  server = createTeamHttpServer(store);
  for (const project of ['alpha', 'beta']) {
    await store.admin({ operation: 'project-create', project });
    await store.admin({ operation: 'member-set', project, subject: 'alice', roles: ['reader', 'contributor'] });
    await store.admin({ operation: 'member-set', project, subject: 'bob', roles: ['reviewer'] });
  }
  const issue = subject => store.issue({ subject, credential_class: subject === 'alice' ? 'workload' : 'human', expires_at: new Date(Date.now() + 3600000).toISOString() });
  const alice = await issue('alice'), bob = await issue('bob');
  const tokenFile = join(base, 'alice.token'); writeFileSync(tokenFile, `${alice.token}\n`, { mode: 0o600 });
  hardenPrivatePath(tokenFile);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(CAIRN_|OPENROUTER_|OPENAI_|ANTHROPIC_)/.test(name)));
  Object.assign(env, { CAIRN_TEAM: '1', CAIRN_TEAM_URL: `http://127.0.0.1:${server.address().port}`, CAIRN_TEAM_ORGANIZATION: 'demo-org', CAIRN_TEAM_TOKEN_FILE: tokenFile });
  async function connect(extra = {}, cwd = base) {
    const client = new Client({ name: 'team-synthetic-harness', version: '1' }, { capabilities: {} });
    const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/team-cli.js'), 'mcp'], cwd, env: { ...env, ...extra } });
    connections.push({ client, transport }); await client.connect(transport); return client;
  }
  const client = await connect();
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(x => x.name), Object.keys(TEAM_TOOL_CATALOG));
  for (const tool of tools) {
    assert.ok(tool.title);
    for (const key of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) assert.equal(typeof tool.annotations[key], 'boolean');
    assert.equal(tool.annotations.readOnlyHint, tool.name !== 'team_memory_propose');
  }
  assert.equal(tools.some(x => /review|credential|member/.test(x.name)), false);
  const value = 'Share only the reviewed gateway decision.';
  const proposed = await client.callTool({ name: 'team_memory_propose', arguments: { project: 'alpha', request_id: randomUUID(), key: 'decisions/gateway', value, source_scope: 'selected-local', source_digest: teamDigest('fixture'), confirm: teamDigest(value), base_revision: null, expires_at: new Date(Date.now() + 3600000).toISOString() } });
  assert.equal(proposed.isError, undefined);
  const candidate = proposed.structuredContent.result;
  await store.execute(bob.token, { organization: 'demo-org', project: 'alpha', operation: 'review', proposal_id: candidate.id, confirm: candidate.digest, decision: 'approve' });
  const read = await client.callTool({ name: 'team_memory_read', arguments: { project: 'alpha', key: 'decisions/gateway' } });
  assert.equal(read.structuredContent.result.value, value);
  assert.equal((await client.callTool({ name: 'team_memory_read', arguments: { project: 'beta', key: 'decisions/gateway' } })).structuredContent.result, null);
  const other = await connect({}, tmpdir());
  assert.deepEqual((await other.callTool({ name: 'team_memory_read', arguments: { project: 'alpha', key: 'decisions/gateway' } })).structuredContent.result, read.structuredContent.result, 'different harness working folder preserves exact project context');
  const withProviders = await connect(providerEnv);
  const search = await withProviders.callTool({ name: 'team_memory_search', arguments: { project: 'alpha', query: 'gateway' } });
  assert.deepEqual(search.structuredContent.result, [read.structuredContent.result]);
  assert.deepEqual((await withProviders.callTool({ name: 'team_memory_search', arguments: { project: 'beta', query: 'gateway' } })).structuredContent.result, []);
  assert.equal((await withProviders.callTool({ name: 'team_memory_search', arguments: { project: 'unrelated', query: 'gateway' } })).isError, true);
  assert.equal(providerRequests, 1, 'team retrieval must never send context or denied queries to personal-memory providers');
  const readonly = await connect({ CAIRN_MCP_TOOL_PROFILE: 'read-only' });
  assert.equal((await readonly.listTools()).tools.some(x => x.name === 'team_memory_propose'), false);
  const custom = await connect({ CAIRN_TEAM_MCP_TOOL_PROFILE: 'custom', CAIRN_TEAM_MCP_ALLOWED_TOOLS: 'team_memory_read' });
  assert.deepEqual((await custom.listTools()).tools.map(x => x.name), ['team_memory_read']);
  const capabilities = await connect({ CAIRN_CAPABILITY_CONTRACT: '1', CAIRN_CAPABILITY_MEMORY_WRITE: '0', CAIRN_CAPABILITY_MEMORY_SEARCH: '0' });
  assert.equal((await capabilities.listTools()).tools.some(x => ['team_memory_propose', 'team_memory_search'].includes(x.name)), false);
  await store.admin({ operation: 'credential-revoke', credential: alice.id });
  assert.equal((await client.callTool({ name: 'team_memory_read', arguments: { project: 'alpha', key: 'decisions/gateway' } })).isError, true);
  console.log('ok: actual stdio MCP, tool classifications, human-only review boundary, profiles/capabilities, cwd/harness continuity, provider isolation and live revocation');
} finally {
  for (const { client, transport } of connections) { await client.close().catch(() => {}); await transport.close().catch(() => {}); }
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await new Promise(resolve => { provider.close(resolve); provider.closeAllConnections(); });
  await store?.close(); rmSync(base, { recursive: true, force: true });
}
