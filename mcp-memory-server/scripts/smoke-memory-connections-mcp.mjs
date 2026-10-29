import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createContinuityLab, serverEntry } from './memory-continuity-lab.mjs';
import * as ordinary from '../dist/ordinary-memory-store.js';
import * as feature from '../dist/memory-connections.js';

const lab = createContinuityLab(), id = randomUUID(), path = join(lab.projects.alpha, '.agentfs', 'project.db');
const cli = fileURLToPath(new URL('../../bin/cairn', import.meta.url));
const run = args => spawnSync(process.execPath, [cli, 'memory-context', ...args], { cwd: lab.projects.alpha,
  env: lab.env, encoding: 'utf8', timeout: process.platform === 'win32' ? 120000 : 30000 });
const parsed = result => { assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); };
const call = async (client, args) => {
  const result = await client.callTool({ name: 'memory_related', arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 32768); return result.structuredContent;
};
const denied = async (client, args) => {
  try { assert.equal((await client.callTool({ name: 'memory_related', arguments: args })).isError, true); }
  catch (error) { if (error.code !== -32601) throw error; }
};
async function seed(file, entityId, title) {
  const target = { path: file, scope: 'project' }, initial = await ordinary.planContextStoreInit(target);
  await ordinary.applyContextStoreInit({ ...target, confirm: initial.digest });
  const agent = await ordinary.openOrdinaryMemoryStore(file, 'project');
  try { await agent.kv.set('facts/anchor', title); } finally { await agent.close(); }
  const input = { schema_version: 1, id: entityId, title, aliases: ['endpoint'], anchor_key: 'facts/anchor', claims: [] };
  const plan = await feature.planMemoryEntityChange({ ...target, input });
  await feature.applyMemoryEntityChange({ ...target, input, confirm: plan.digest });
}
async function httpSession(extra, action) {
  const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const token = 'connections-disposable-http-token';
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
      const client = new Client({ name: 'connections-http', version: '1' }); clients.push(client); await client.connect(transport); return client;
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
  await seed(path, id, 'Local endpoint');
  const input = join(lab.root, 'entity.json');
  writeFileSync(input, JSON.stringify({ schema_version: 1, id, title: 'Renamed endpoint', aliases: ['old-name'], anchor_key: 'facts/anchor', claims: [] }), { mode: 0o600 });
  const args = ['entity', 'set', '--scope', 'project', '--input', input, '--json'];
  const before = readFileSync(path), plan = parsed(run(args));
  assert.deepEqual(readFileSync(path), before);
  assert.notEqual(run([...args, '--apply', '--confirm', '0'.repeat(64)]).status, 0);
  parsed(run([...args, '--apply', '--confirm', plan.digest]));
  assert.notEqual(run([...args, '--apply', '--confirm', plan.digest]).status, 0);
  assert.equal(parsed(run(['related', '--scope', 'project', '--entity', 'old-name', '--json'])).nodes[0].id, id);
  assert.notEqual(run(['related', '--scope', 'project', '--entity', id, '--depth', '3']).status, 0);
  assert.notEqual(run(['status', '--scope', 'project', '--entity', id]).status, 0);
  const doctor = run(['doctor', '--scope', 'project', '--json']);
  assert.equal(doctor.status, 0, doctor.stderr); assert.equal(JSON.parse(doctor.stdout).connections.entities, 1);
  assert.equal(doctor.stdout.includes('Renamed endpoint'), false);
  const agent = await ordinary.openOrdinaryMemoryStore(path, 'project');
  try { await agent.kv.set('facts/first', 'old endpoint'); await agent.kv.set('facts/second', 'new endpoint'); }
  finally { await agent.close(); }
  writeFileSync(input, JSON.stringify({ schema_version: 1, id, title: 'Renamed endpoint', aliases: ['old-name'], anchor_key: 'facts/anchor', claims: [
    { key: 'facts/first', attribute: 'endpoint', value: 'old' }, { key: 'facts/second', attribute: 'endpoint', value: 'new' },
  ] }));
  const claimPlan = parsed(run(args)); parsed(run([...args, '--apply', '--confirm', claimPlan.digest]));
  const linkInput = join(lab.root, 'link.json'), linkId = randomUUID();
  writeFileSync(linkInput, JSON.stringify({ schema_version: 1, id: linkId, from: id, to: id, predicate: 'references', evidence_keys: ['facts/anchor'] }), { mode: 0o600 });
  const linkArgs = ['link', 'set', '--scope', 'project', '--input', linkInput, '--json'];
  const linkPlan = parsed(run(linkArgs)); parsed(run([...linkArgs, '--apply', '--confirm', linkPlan.digest]));
  assert.equal(parsed(run(['related', '--scope', 'project', '--entity', id, '--json'])).edges.length, 1);
  writeFileSync(linkInput, JSON.stringify({ schema_version: 1, id: linkId }));
  const removeArgs = ['link', 'remove', '--scope', 'project', '--input', linkInput, '--json'];
  const removePlan = parsed(run(removeArgs)); parsed(run([...removeArgs, '--apply', '--confirm', removePlan.digest]));
  assert.equal(parsed(run(['doctor', '--scope', 'project', '--json'])).connections.tombstones, 1);
  writeFileSync(input, '{'); assert.notEqual(run(args).status, 0);
  writeFileSync(input, ' '.repeat(65537)); assert.notEqual(run(args).status, 0);
  for (const [env, expected] of [
    [{}, false], [{ CAIRN_MEMORY_CONTEXT: '1' }, true],
    [{ CAIRN_MEMORY_CONTEXT: '1', CAIRN_MCP_TOOL_PROFILE: 'read-only' }, true],
    [{ CAIRN_MEMORY_CONTEXT: '1', CAIRN_MCP_TOOL_PROFILE: 'custom', CAIRN_MCP_ALLOWED_TOOLS: 'memory_related' }, true],
    [{ CAIRN_MEMORY_CONTEXT: '0', CAIRN_MCP_TOOL_PROFILE: 'custom', CAIRN_MCP_ALLOWED_TOOLS: 'memory_related' }, false],
    [{ CAIRN_MEMORY_CONTEXT: '1', CAIRN_CAPABILITY_CONTRACT: '1', CAIRN_CAPABILITY_MEMORY_SEARCH: '0' }, false],
  ]) {
    const session = await lab.connect('alpha', env);
    try {
      let tools;
      try { tools = (await session.client.listTools()).tools; } catch (error) { if (error.code !== -32601) throw error; tools = []; }
      const tool = tools.find(row => row.name === 'memory_related'); assert.equal(Boolean(tool), expected);
      if (!expected) { await denied(session.client, { scope: 'project', entity: id }); continue; }
      assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
      assert.equal((await call(session.client, { scope: 'project', entity: 'old-name' })).nodes[0].id, id);
      assert.equal((await call(session.client, { scope: 'project', entity: id })).possible_conflicts, true);
      if (tools.some(row => row.name === 'memory_inspect')) {
        const inspected = await session.client.callTool({ name: 'memory_inspect', arguments: { scope: 'project', key: 'facts/second' } });
        assert.notEqual(inspected.isError, true, JSON.stringify(inspected));
        assert.equal(inspected.structuredContent.possible_conflicts, true);
        assert.equal(inspected.structuredContent.candidates[0].claim_conflicts[0].claims.length, 2);
      }
      for (const invalid of [{ scope: 'all', entity: id }, { scope: '../escape', entity: id }, { scope: 'project', entity: id, path },
        { scope: 'project', entity: id, depth: 3 }, { scope: 'project', entity: id, projectId: 'beta' }]) await denied(session.client, invalid);
      if (env.CAIRN_MCP_TOOL_PROFILE === 'read-only') assert.ok(tools.every(row => row.annotations.readOnlyHint));
    } finally { await session.close(); }
  }
  const beta = await lab.connect('beta', { CAIRN_MEMORY_CONTEXT: '1' });
  try { assert.deepEqual((await call(beta.client, { scope: 'project', entity: id })).nodes, []); } finally { await beta.close(); }
  const directory = join(lab.env.CAIRN_AGENTFS_BASE_DIR, 'projects'); mkdirSync(directory, { recursive: true, mode: 0o700 });
  await seed(join(directory, 'alpha.db'), id, 'HTTP alpha'); await seed(join(directory, 'beta.db'), randomUUID(), 'HTTP beta');
  await httpSession({}, async ({ connect }) => { await denied(await connect('alpha'), { scope: 'project', entity: id }); });
  await httpSession({ CAIRN_MEMORY_CONTEXT_HTTP: '1' }, async ({ connect, url, token }) => {
    const alpha = await connect('alpha'), other = await connect('beta'), unbound = await connect();
    assert.equal((await call(alpha, { scope: 'project', entity: id })).nodes[0].title, 'HTTP alpha');
    assert.deepEqual((await call(other, { scope: 'project', entity: id })).nodes, []);
    await denied(unbound, { scope: 'project', entity: id });
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const host = await new Promise((resolve, reject) => {
      const req = request(url, { headers: { Authorization: `Bearer ${token}`, Host: 'untrusted.example' } }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
      req.once('error', reject); req.end();
    });
    assert.equal(host, 403);
  });
  const damaged = await ordinary.openOrdinaryMemoryStore(path, 'project');
  try { await damaged.getDatabase().exec('DROP TABLE cairn_memory_context_links_v1'); } finally { await damaged.close(); }
  const damagedDoctor = run(['doctor', '--scope', 'project', '--json']);
  assert.notEqual(damagedDoctor.status, 0); assert.match(damagedDoctor.stderr, /MEMORY_CONTEXT_DAMAGED/);
  assert.equal(damagedDoctor.stderr.includes('Renamed endpoint'), false);
  lab.assertOffline();
  console.log('PASS: graph CLI confirmation, closed-world annotations, feature/profile/capability intersection, HTTP consent/auth/Host/CORS and project isolation');
} finally { await lab.close(); }
