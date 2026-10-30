// All context tools share the existing transport/profile/capability boundary.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createContinuityLab, serverEntry } from './memory-continuity-lab.mjs';
import * as ordinary from '../dist/ordinary-memory-store.js';
import { planFreshnessChange, applyFreshnessChange } from '../dist/memory-context-store.js';
import { planMemoryEntityChange, applyMemoryEntityChange } from '../dist/memory-connections.js';

process.umask(0o077);
const lab = createContinuityLab(), task = createHash('sha256').update('integrated-transport-fixture').digest('hex');
const key = 'decisions/fixture', entity = 'route-fixture';
const names = ['memory_inspect', 'memory_related', 'memory_map', 'memory_context_search', 'memory_feedback_record'];
const reads = names.slice(0, 4), flags = { CAIRN_MEMORY_CONTEXT: '1' };
const inputs = { memory_inspect: { scope: 'project', key }, memory_related: { scope: 'project', entity },
  memory_map: { scope: 'project', max_bytes: 8192 }, memory_context_search: { scope: 'project', query: key, task_digest: task },
  memory_feedback_record: { receipt: 'not-an-issued-receipt', task_digest: task, outcome: 'useful' } };
async function seed(path, value, curate = true) {
  const target = { path, scope: 'project' }, initial = await ordinary.planContextStoreInit(target);
  await ordinary.applyContextStoreInit({ ...target, confirm: initial.digest });
  const writer = await ordinary.openOrdinaryMemoryStore(path, 'project');
  try { await writer.kv.set(key, value); } finally { await writer.close(); }
  if (!curate) return;
  const freshness = { ...target, key, input: { schema_version: 1, source_refs: ['opaque:transport-fixture'],
    verified_at: '1999-01-01T00:00:00Z', review_after: '2000-01-01T00:00:00Z' } };
  const plan = await planFreshnessChange(freshness); await applyFreshnessChange({ ...freshness, confirm: plan.digest });
  const input = { schema_version: 1, id: '10000000-0000-4000-8000-000000000001', title: 'Fixture route',
    aliases: [entity], anchor_key: key, claims: [] };
  const graph = await planMemoryEntityChange({ ...target, input, operation: 'set' });
  await applyMemoryEntityChange({ ...target, input, operation: 'set', confirm: graph.digest });
}
async function catalog(client) {
  try { return (await client.listTools()).tools; }
  catch (error) { if (error.code === -32601) return []; throw error; }
}
async function denied(client, name) {
  let result;
  try { result = await client.callTool({ name, arguments: inputs[name] }); }
  catch (error) { assert.equal(error.code, -32601); return; }
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /not found|unknown tool|not registered/i, 'hidden tools must be unregistered, not merely fail argument validation');
}
async function call(client, name, input = inputs[name]) {
  const result = await client.callTool({ name, arguments: input });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= (name === 'memory_map' ? 8192 : 32768));
  return result.structuredContent;
}
async function verify(client, allowed) {
  const tools = await catalog(client);
  assert.deepEqual(tools.filter(tool => names.includes(tool.name)).map(tool => tool.name).sort(), allowed.toSorted());
  for (const tool of tools) {
    assert.ok(tool.title);
    for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) assert.equal(typeof tool.annotations[hint], 'boolean');
  }
  for (const name of names) {
    if (!allowed.includes(name)) { await denied(client, name); continue; }
    const metadata = tools.find(tool => tool.name === name);
    assert.equal(metadata.annotations.openWorldHint, false);
    assert.equal(metadata.annotations.readOnlyHint, name !== 'memory_feedback_record');
    if (name !== 'memory_feedback_record') await call(client, name);
  }
}
const cases = [
  { id: 'off', env: { CAIRN_MEMORY_CONTEXT: '0' }, allowed: [] },
  { id: 'ranking-alone', env: { CAIRN_MEMORY_CONTEXT: '0', CAIRN_MEMORY_FEEDBACK_RANKING: '1' }, allowed: [] },
  { id: 'full', env: flags, allowed: names },
  { id: 'read-only', env: { ...flags, CAIRN_MCP_TOOL_PROFILE: 'read-only' }, allowed: reads },
  { id: 'custom-map', env: { ...flags, CAIRN_MCP_TOOL_PROFILE: 'custom', CAIRN_MCP_ALLOWED_TOOLS: 'memory_map' }, allowed: ['memory_map'] },
  { id: 'custom-cannot-enable', env: { CAIRN_MEMORY_CONTEXT: '0', CAIRN_MCP_TOOL_PROFILE: 'custom', CAIRN_MCP_ALLOWED_TOOLS: names.join(',') }, allowed: [] },
  { id: 'no-search', env: { ...flags, CAIRN_CAPABILITY_CONTRACT: '1', CAIRN_CAPABILITY_MEMORY_SEARCH: '0' }, allowed: ['memory_feedback_record'] },
  { id: 'no-write', env: { ...flags, CAIRN_CAPABILITY_CONTRACT: '1', CAIRN_CAPABILITY_MEMORY_WRITE: '0' }, allowed: reads },
];
async function http(extra, action) {
  const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const token = 'disposable-integrated-http-token';
  const child = spawn(process.execPath, ['--import', pathToFileURL(join(lab.root, 'deny-network.mjs')).href, serverEntry], {
    cwd: lab.projects.neutral, env: { ...lab.env, CAIRN_MEMORY_CONTEXT_HTTP: '1', ...extra,
      MCP_HTTP_HOST: '127.0.0.1', MCP_HTTP_PORT: String(port), CAIRN_MEMORY_HTTP_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'] });
  const clients = [];
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('integrated HTTP startup timeout')), 30000);
      child.once('exit', () => { clearTimeout(timer); reject(new Error('integrated HTTP server exited')); });
      child.stderr.on('data', bytes => { if (bytes.toString().includes('listening on')) { clearTimeout(timer); resolve(); } });
    });
    const url = `http://127.0.0.1:${port}/mcp`;
    const connect = async (project, label = 'transport-fixture-a') => {
      const client = new Client({ name: label, version: '1' }); clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: {
        Authorization: `Bearer ${token}`, 'X-Cairn-Scopes': 'project', ...(project ? { 'X-Cairn-Project': project } : {}),
      } } })); return client;
    };
    await action({ connect, url, token });
  } finally {
    for (const client of clients) await client.close().catch(() => {});
    if (child.exitCode === null && child.signalCode === null) {
      const ended = once(child, 'exit'); child.kill('SIGINT'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      try { await ended; } finally { clearTimeout(timer); }
    }
  }
}
try {
  await seed(join(lab.projects.alpha, '.agentfs', 'project.db'), 'local fixture, not HTTP');
  let baseline;
  for (const item of cases) {
    const session = await lab.connect('alpha', item.env, `integrated-${item.id}`);
    await verify(session.client, item.allowed);
    if (item.id === 'off') baseline = await catalog(session.client);
    if (item.id === 'ranking-alone') assert.deepEqual(await catalog(session.client), baseline);
    if (item.id === 'full') {
      const searched = await call(session.client, 'memory_context_search');
      assert.equal(searched.results[0].value, 'local fixture, not HTTP');
      await call(session.client, 'memory_feedback_record', { ...inputs.memory_feedback_record, receipt: searched.results[0].receipt });
      assert.equal((await call(session.client, 'memory_inspect')).candidates[0].status, 'needs_review');
    }
    await session.close();
  }
  // Remote project IDs route to a different physical path than local stdio.
  await seed(join(lab.env.CAIRN_AGENTFS_BASE_DIR, 'projects', 'alpha.db'), 'alpha remote route');
  await seed(join(lab.env.CAIRN_AGENTFS_BASE_DIR, 'projects', 'beta.db'), 'beta remote sentinel', false);
  await http({ ...flags, CAIRN_MEMORY_CONTEXT_HTTP: '0' }, async ({ connect }) => verify(await connect('alpha'), []));
  for (const item of cases) await http(item.env, async ({ connect, url, token }) => {
    const alpha = await connect('alpha'); await verify(alpha, item.allowed);
    if (item.id !== 'full') return;
    const other = await connect('beta'), second = await connect('alpha', 'transport-fixture-b'), unbound = await connect();
    await verify(unbound, []);
    const searched = await call(alpha, 'memory_context_search');
    const receipt = { ...inputs.memory_feedback_record, receipt: searched.results[0].receipt };
    assert.equal(searched.results[0].value, 'alpha remote route');
    assert.equal((await call(other, 'memory_context_search')).results[0].value, 'beta remote sentinel');
    assert.equal((await call(other, 'memory_related')).nodes.length, 0);
    assert.equal((await other.callTool({ name: 'memory_feedback_record', arguments: receipt })).isError, true);
    assert.equal((await second.callTool({ name: 'memory_feedback_record', arguments: receipt })).isError, true);
    assert.equal((await call(second, 'memory_context_search')).results[0].value, 'alpha remote route');
    await call(alpha, 'memory_feedback_record', receipt);
    assert.equal((await call(alpha, 'memory_inspect')).candidates[0].status, 'needs_review');
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const badHost = await new Promise((resolve, reject) => {
      const req = request(url, { headers: { Authorization: `Bearer ${token}`, Host: 'untrusted.example' } }, res => {
        res.resume(); res.once('end', () => resolve(res.statusCode)); }); req.once('error', reject); req.end();
    }); assert.equal(badHost, 403);
    const invalid = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream', 'X-Cairn-Project': '../escape' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1,
      method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'invalid', version: '1' } } }) });
    assert.equal(invalid.status, 400);
  });
  lab.assertOffline();
  console.log('PASS: all-five-tool stdio/HTTP consent, exact profiles, capability intersections, direct-name denial, project/session/cwd handoff and Host/CORS/auth; deliberate loopback traffic, zero server external-network attempts');
} finally { await lab.close(); }
