import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { serverEntry } from './memory-continuity-lab.mjs';
import { createHash } from 'node:crypto';
import { createContinuityLab } from './memory-continuity-lab.mjs';
import * as ordinary from '../dist/ordinary-memory-store.js';

process.umask(0o077);
const lab = createContinuityLab(), flag = { CAIRN_MEMORY_CONTEXT: '1' };
const task = createHash('sha256').update('test task').digest('hex');
const cli = fileURLToPath(new URL('../../bin/cairn', import.meta.url));
const run = args => spawnSync(process.execPath, [cli, 'memory-context', ...args], { cwd: lab.projects.alpha, env: lab.env,
  encoding: 'utf8', timeout: process.platform === 'win32' ? 120000 : 30000 });
const rejected = async (session, name, args) => assert.equal((await session.client.callTool({ name, arguments: args })).isError, true);
async function seed(project, key, value) {
  const target = { path: join(lab.projects[project], '.agentfs', 'project.db'), scope: 'project' };
  mkdirSync(join(target.path, '..'), { recursive: true, mode: 0o700 });
  const plan = await ordinary.planContextStoreInit(target); await ordinary.applyContextStoreInit({ ...target, confirm: plan.digest });
  const writer = await ordinary.openOrdinaryMemoryStore(target.path, 'project');
  try { await writer.kv.set(key, value); } finally { await writer.close(); }
}
async function httpSession(consent, action) {
  const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const token = 'disposable-feedback-http';
  const child = spawn(process.execPath, ['--import', pathToFileURL(join(lab.root, 'deny-network.mjs')).href, serverEntry], {
    cwd: lab.projects.neutral, env: { ...lab.env, ...flag, CAIRN_MEMORY_CONTEXT_HTTP: consent ? '1' : '0',
      MCP_HTTP_HOST: '127.0.0.1', MCP_HTTP_PORT: String(port), CAIRN_MEMORY_HTTP_TOKEN: token }, stdio: ['pipe', 'pipe', 'pipe'] });
  const clients = [];
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('HTTP fixture timeout')), 30000);
      child.once('exit', () => { clearTimeout(timer); reject(new Error('HTTP fixture exited')); });
      child.stderr.on('data', data => { if (data.toString().includes('listening on')) { clearTimeout(timer); resolve(); } });
    });
    const url = `http://127.0.0.1:${port}/mcp`;
    const connect = async project => {
      const client = new Client({ name: 'feedback-http', version: '1' }); clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: {
        Authorization: `Bearer ${token}`, ...(project ? { 'X-Cairn-Project': project } : {}), 'X-Cairn-Scopes': 'project',
      } } })); return client;
    };
    await action({ url, token, connect });
  } finally {
    for (const client of clients) await client.close().catch(() => {});
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGINT'); const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      try { await exited; } finally { clearTimeout(timer); }
    }
  }
}
try {
  await seed('alpha', 'network/tunnel', 'Aster relay provides the secure tunnel.');
  await seed('beta', 'network/tunnel', 'Other project secret tunnel.');
  const off = await lab.connect();
  assert.equal((await off.client.listTools()).tools.some(row => row.name === 'memory_context_search'), false); await off.close();
  const session = await lab.connect('alpha', flag);
  const catalog = (await session.client.listTools()).tools;
  assert.deepEqual(catalog.find(row => row.name === 'memory_context_search').annotations,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.deepEqual(catalog.find(row => row.name === 'memory_feedback_record').annotations,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  const args = { scope: 'project', query: 'network/tunnel', top_k: 5, task_digest: task };
  const result = await session.client.callTool({ name: 'memory_context_search', arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 32768);
  const row = result.structuredContent.results[0]; assert.ok(row.receipt); assert.equal(row.tracked, true);
  assert.equal(result.structuredContent.results.length, 1);
  const input = { receipt: row.receipt, task_digest: task, outcome: 'useful' };
  assert.equal((await session.call('memory_feedback_record', input)).recorded, true);
  assert.equal((await session.call('memory_feedback_record', input)).recorded, false);
  await rejected(session, 'memory_feedback_record', { ...input, outcome: 'stale' });
  const beta = await lab.connect('beta', flag); await rejected(beta, 'memory_feedback_record', input); await beta.close();
  const same = await lab.connect('alpha', flag); await rejected(same, 'memory_feedback_record', input); await same.close();
  await rejected(session, 'memory_context_search', { ...args, query: 'é'.repeat(4096) });
  await rejected(session, 'memory_context_search', { ...args, address_space: 'notes' });
  assert.equal((await session.call('memory_context_search', { scope: 'project', query: 'negative unrelated planets' })).count, 0);
  await session.call('memory_write', { scope: 'project', key: 'network/framing', value: 'x'.repeat(19000) });
  const bounded = await session.client.callTool({ name: 'memory_context_search', arguments: { scope: 'project', query: 'network/framing', task_digest: task } });
  assert.notEqual(bounded.isError, true); assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 32768);
  assert.equal(bounded.structuredContent.count, 0); assert.equal(bounded.structuredContent.truncated, true);
  const old = await session.call('memory_search', { scope: 'project', query: 'network/tunnel', strategy: 'hybrid', top_k: 5 });
  assert.equal(old.results.some(row => 'receipt' in row || 'source' in row), false);
  for (const [env, search, record] of [
    [{ ...flag, CAIRN_MCP_TOOL_PROFILE: 'read-only' }, true, false],
    [{ ...flag, CAIRN_MCP_TOOL_PROFILE: 'custom', CAIRN_MCP_ALLOWED_TOOLS: 'memory_feedback_record' }, false, true],
    [{ ...flag, CAIRN_CAPABILITY_CONTRACT: '1', CAIRN_CAPABILITY_MEMORY_WRITE: '0' }, true, false],
    [{ ...flag, CAIRN_CAPABILITY_CONTRACT: '1', CAIRN_CAPABILITY_MEMORY_SEARCH: '0' }, false, true],
  ]) {
    const scoped = await lab.connect('alpha', env), names = (await scoped.client.listTools()).tools.map(row => row.name);
    assert.equal(names.includes('memory_context_search'), search); assert.equal(names.includes('memory_feedback_record'), record); await scoped.close();
  }
  const legacy = await lab.connect('neutral', flag);
  await legacy.call('memory_write', { scope: 'project', key: 'network/tunnel', value: 'Legacy tunnel entry.' });
  const untracked = await legacy.call('memory_context_search', args);
  assert.equal(untracked.results[0].tracked, false); assert.equal(untracked.results[0].receipt, null);
  const providerCatalog = await lab.connect('alpha', { ...flag, CAIRN_MEMORY_RERANK: '1',
    CAIRN_MEMORY_RERANK_URL: 'http://127.0.0.1:1/v1', CAIRN_MEMORY_RERANK_MODEL: 'fixture-only' });
  assert.equal((await providerCatalog.client.listTools()).tools.find(row => row.name === 'memory_context_search').annotations.openWorldHint, true);
  await providerCatalog.close();
  const typed = await lab.connect('alpha', { ...flag, CAIRN_TYPED_MEMORY_NODES: '1' });
  await typed.call('memory_write', { scope: 'project', key: 'network/tagged', value: 'Tagged tunnel route.', tags: ['selected'] });
  assert.equal((await typed.call('memory_context_search', { scope: 'project', query: 'network/tagged', tags_all: ['absent'] })).count, 0);
  assert.equal((await typed.call('memory_context_search', { scope: 'project', query: 'network/tagged', tags_all: ['selected'] })).count, 1);
  await typed.close();
  const exported = run(['feedback', 'export', '--scope', 'project', '--json']);
  assert.equal(exported.status, 0, exported.stderr); const records = JSON.parse(exported.stdout).records; assert.equal(records.length, 1);
  assert.equal(exported.stdout.includes('network/tunnel'), false); assert.equal(exported.stdout.includes(row.receipt), false);
  const selection = join(lab.root, 'forget.json'); writeFileSync(selection, JSON.stringify({ schema_version: 1, ids: records.map(row => row.id) }), { mode: 0o600 });
  const plan = run(['feedback', 'forget', '--scope', 'project', '--input', selection, '--json']); assert.equal(plan.status, 0, plan.stderr);
  const apply = run(['feedback', 'forget', '--scope', 'project', '--input', selection, '--apply', '--confirm', JSON.parse(plan.stdout).digest, '--json']);
  assert.equal(apply.status, 0, apply.stderr); assert.equal(JSON.parse(apply.stdout).forgotten, 1);
  await legacy.close(); await session.close();
  for (const project of ['alpha', 'beta']) {
    const target = { path: join(lab.env.CAIRN_AGENTFS_BASE_DIR, 'projects', `${project}.db`), scope: 'project' };
    mkdirSync(join(target.path, '..'), { recursive: true, mode: 0o700 });
    const initial = await ordinary.planContextStoreInit(target); await ordinary.applyContextStoreInit({ ...target, confirm: initial.digest });
    const agent = await ordinary.openOrdinaryMemoryStore(target.path, 'project');
    try { await agent.kv.set('network/tunnel', `${project} remote tunnel`); } finally { await agent.close(); }
  }
  await httpSession(false, async ({ connect }) => {
    const client = await connect('alpha'); assert.equal((await client.listTools()).tools.some(row => row.name === 'memory_context_search'), false);
  });
  await httpSession(true, async ({ connect, url, token }) => {
    const alpha = await connect('alpha'), other = await connect('beta'), unbound = await connect();
    assert.equal((await unbound.listTools()).tools.some(row => row.name === 'memory_context_search'), false);
    const searched = await alpha.callTool({ name: 'memory_context_search', arguments: args });
    assert.notEqual(searched.isError, true, JSON.stringify(searched));
    assert.equal(searched.structuredContent.results[0].value, 'alpha remote tunnel');
    const receiptInput = { ...input, receipt: searched.structuredContent.results[0].receipt };
    assert.equal((await other.callTool({ name: 'memory_feedback_record', arguments: receiptInput })).isError, true);
    assert.notEqual((await alpha.callTool({ name: 'memory_feedback_record', arguments: receiptInput })).isError, true);
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const host = await new Promise((resolve, reject) => {
      const req = request(url, { headers: { Authorization: `Bearer ${token}`, Host: 'untrusted.example' } }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
      req.once('error', reject); req.end();
    }); assert.equal(host, 403);
  });
  lab.assertOffline();
  console.log('PASS: explicit feedback actual MCP/CLI, default-off, closed-world annotations, profile/capability/session/project isolation, legacy and negative controls');
} finally { await lab.close(); }
