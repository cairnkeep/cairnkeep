import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createContinuityLab, serverEntry } from './memory-continuity-lab.mjs';
import * as ordinary from '../dist/ordinary-memory-store.js';

process.umask(0o077);
const lab = createContinuityLab(), path = join(lab.projects.alpha, '.agentfs', 'project.db');
const cli = fileURLToPath(new URL('../../bin/cairn', import.meta.url));
const run = args => spawnSync(process.execPath, [cli, 'memory-context', ...args], { cwd: lab.projects.alpha,
  env: lab.env, encoding: 'utf8', timeout: process.platform === 'win32' ? 120000 : 30000 });
async function seed(file, key, value) {
  const target = { path: file, scope: 'project' }, initial = await ordinary.planContextStoreInit(target);
  await ordinary.applyContextStoreInit({ ...target, confirm: initial.digest });
  const agent = await ordinary.openOrdinaryMemoryStore(file, 'project');
  try { await agent.kv.set(key, value); } finally { await agent.close(); }
}
const call = async (client, args = { scope: 'project' }) => {
  const result = await client.callTool({ name: 'memory_map', arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= (args.max_bytes ?? 4096));
  return result.structuredContent;
};
const denied = async (client, args = { scope: 'project' }) => {
  try { assert.equal((await client.callTool({ name: 'memory_map', arguments: args })).isError, true); }
  catch (error) { if (error.code !== -32601) throw error; }
};
async function httpSession(extra, action) {
  const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const token = 'maps-disposable-http-token';
  const child = spawn(process.execPath, ['--import', pathToFileURL(join(lab.root, 'deny-network.mjs')).href, serverEntry], {
    cwd: lab.projects.neutral, env: { ...lab.env, MCP_HTTP_HOST: '127.0.0.1', MCP_HTTP_PORT: String(port),
      CAIRN_MEMORY_HTTP_TOKEN: token, CAIRN_MEMORY_CONTEXT: '1', ...extra }, stdio: ['pipe', 'pipe', 'pipe'] });
  const clients = [];
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('HTTP startup timeout')), 30000);
      child.once('exit', () => { clearTimeout(timer); reject(new Error('HTTP fixture exited')); });
      child.stderr.on('data', chunk => { if (chunk.toString().includes('listening on')) { clearTimeout(timer); resolve(); } });
    });
    const url = `http://127.0.0.1:${port}/mcp`;
    const connect = async project => {
      const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: {
        Authorization: `Bearer ${token}`, ...(project ? { 'X-Cairn-Project': project } : {}), 'X-Cairn-Scopes': 'project',
      } } });
      const client = new Client({ name: 'maps-http', version: '1' }); clients.push(client); await client.connect(transport); return client;
    };
    await action({ connect, url, token });
  } finally {
    for (const client of clients) await client.close().catch(() => {});
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGINT');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      try { await exited; } finally { clearTimeout(timer); }
    }
  }
}
try {
  await seed(path, 'devices/local', 'source value never copied to map');
  const observed = run(['map', '--scope', 'project', '--max-bytes', '1024', '--limit', '1', '--json']);
  assert.equal(observed.status, 0, observed.stderr);
  assert.equal(JSON.parse(observed.stdout).exact_reads_required, true);
  for (const args of [['map', '--scope', 'project', '--max-bytes', '8193'], ['map', '--scope', 'project', '--limit', '51'],
    ['map', '--scope', 'project', '--apply', '--confirm', '0'.repeat(64)], ['map', '--scope', 'project', '--entity', 'anything'],
    ['inspect', '--scope', 'project', '--key', 'devices/local', '--max-bytes', '4096']]) assert.notEqual(run(args).status, 0);
  for (const [env, expected] of [
    [{}, false], [{ CAIRN_MEMORY_CONTEXT: '1' }, true],
    [{ CAIRN_MEMORY_CONTEXT: '1', CAIRN_MCP_TOOL_PROFILE: 'read-only' }, true],
    [{ CAIRN_MEMORY_CONTEXT: '1', CAIRN_MCP_TOOL_PROFILE: 'custom', CAIRN_MCP_ALLOWED_TOOLS: 'memory_map' }, true],
    [{ CAIRN_MEMORY_CONTEXT: '0', CAIRN_MCP_TOOL_PROFILE: 'custom', CAIRN_MCP_ALLOWED_TOOLS: 'memory_map' }, false],
    [{ CAIRN_MEMORY_CONTEXT: '1', CAIRN_CAPABILITY_CONTRACT: '1', CAIRN_CAPABILITY_MEMORY_SEARCH: '0' }, false],
  ]) {
    const session = await lab.connect('alpha', env);
    try {
      let tools;
      try { tools = (await session.client.listTools()).tools; } catch (error) { if (error.code !== -32601) throw error; tools = []; }
      const tool = tools.find(row => row.name === 'memory_map'); assert.equal(Boolean(tool), expected);
      if (!expected) { await denied(session.client); continue; }
      assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      const map = await call(session.client);
      assert.equal(map.partitions[0].entries[0].prefix, 'devices');
      assert.equal(JSON.stringify(map).includes('source value never copied'), false);
      await call(session.client, { scope: 'all', max_bytes: 8192 });
      for (const invalid of [{ scope: '../escape' }, { scope: 'project', path }, { scope: 'project', max_bytes: 8193 },
        { scope: 'project', limit: 51 }, { scope: 'project', projectId: 'beta' }]) await denied(session.client, invalid);
    } finally { await session.close(); }
  }
  const beta = await lab.connect('beta', { CAIRN_MEMORY_CONTEXT: '1' });
  try { assert.deepEqual((await call(beta.client)).partitions[0].entries, []); } finally { await beta.close(); }
  const directory = join(lab.env.CAIRN_AGENTFS_BASE_DIR, 'projects'); mkdirSync(directory, { recursive: true, mode: 0o700 });
  await seed(join(directory, 'alpha.db'), 'alpha/navigation', 'HTTP alpha');
  await seed(join(directory, 'beta.db'), 'beta/navigation', 'HTTP beta');
  await httpSession({}, async ({ connect }) => { await denied(await connect('alpha')); });
  await httpSession({ CAIRN_MEMORY_CONTEXT_HTTP: '1' }, async ({ connect, url, token }) => {
    const alpha = await connect('alpha'), other = await connect('beta'), unbound = await connect();
    assert.equal((await call(alpha)).partitions[0].entries[0].prefix, 'alpha');
    assert.equal((await call(other)).partitions[0].entries[0].prefix, 'beta');
    const all = await call(alpha, { scope: 'all' });
    assert.equal(JSON.stringify(all).includes('beta/navigation'), false);
    await denied(unbound);
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const host = await new Promise((resolve, reject) => {
      const req = request(url, { headers: { Authorization: `Bearer ${token}`, Host: 'untrusted.example' } }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
      req.once('error', reject); req.end();
    });
    assert.equal(host, 403);
  });
  lab.assertOffline();
  console.log('PASS: map CLI, default-off discovery, annotations, profiles/capabilities, separate HTTP consent/auth/Host/CORS and project isolation');
} finally { await lab.close(); }
