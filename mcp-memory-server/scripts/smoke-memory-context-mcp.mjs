import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, openSync, closeSync, fstatSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AgentFS } from 'agentfs-sdk';
import { hardenPrivatePath } from '../dist/platform-security.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createContinuityLab, serverEntry } from './memory-continuity-lab.mjs';
import * as ordinary from '../dist/ordinary-memory-store.js';

const lab = createContinuityLab();
const cli = fileURLToPath(new URL('../../bin/cairn', import.meta.url));
const path = join(lab.projects.alpha, '.agentfs', 'project.db');
const key = 'facts/device';
const target = { path, scope: 'project', key };
const run = args => spawnSync(process.execPath, [cli, 'memory-context', ...args], {
  cwd: lab.projects.alpha, env: lab.env, encoding: 'utf8', timeout: process.platform === 'win32' ? 120000 : 30000,
});
const parsed = result => { assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); };
const toolList = async client => {
  try { return (await client.listTools()).tools; }
  catch (error) { if (error.code === -32601) return []; throw error; }
};
const denied = async (client, args) => {
  try { assert.equal((await client.callTool({ name: 'memory_inspect', arguments: args })).isError, true); }
  catch (error) { if (error.code !== -32601) throw error; }
};
const call = async (client, args) => {
  const result = await client.callTool({ name: 'memory_inspect', arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 32768, 'complete MCP result exceeds32KiB');
  return result.structuredContent;
};
async function seed(file, scope, value) {
  const initial = await ordinary.planContextStoreInit({ path: file, scope });
  await ordinary.applyContextStoreInit({ path: file, scope, confirm: initial.digest });
  const agent = await ordinary.openOrdinaryMemoryStore(file, scope);
  try { await agent.kv.set(key, value); } finally { await agent.close(); }
}
async function httpSession(extra, action) {
  const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const token = 'freshness-local-http-fixture';
  const child = spawn(process.execPath, ['--import', pathToFileURL(join(lab.root, 'deny-network.mjs')).href, serverEntry], { cwd: lab.projects.neutral,
    env: { ...lab.env, MCP_HTTP_HOST: '127.0.0.1', MCP_HTTP_PORT: String(port), CAIRN_MEMORY_HTTP_TOKEN: token,
      CAIRN_MEMORY_CONTEXT: '1', ...extra }, stdio: ['pipe', 'pipe', 'pipe'] });
  const clients = [];
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('HTTP startup timeout')), 30000);
      child.once('exit', () => { clearTimeout(timer); reject(new Error('HTTP fixture exited')); });
      child.stderr.on('data', chunk => { if (chunk.toString().includes('listening on')) { clearTimeout(timer); resolve(); } });
    });
    const url = `http://127.0.0.1:${port}/mcp`;
    const connect = async project => {
      const headers = { Authorization: `Bearer ${token}`, ...(project ? { 'X-Cairn-Project': project } : {}), 'X-Cairn-Scopes': 'project' };
      const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
      const client = new Client({ name: 'freshness-http', version: '1' }); clients.push(client);
      await client.connect(transport); return client;
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
  const off = await lab.connect(); const baseline = (await off.client.listTools()).tools; await off.close();
  const enabled = await lab.connect('alpha', { CAIRN_MEMORY_CONTEXT: '1' });
  const catalog = (await enabled.client.listTools()).tools;
  const tool = catalog.find(tool => tool.name === 'memory_inspect');
  assert.ok(tool, 'FRESHNESS_MCP_RED: gated read-only inspection is missing');
  assert.deepEqual(catalog.filter(tool => !['memory_inspect', 'memory_related', 'memory_map'].includes(tool.name)), baseline, 'existing schemas/order changed when enabled');
  assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.deepEqual((await call(enabled.client, { scope: 'project', key })).candidates, []);
  assert.equal(existsSync(path), false, 'inspection may not initialize a missing store');
  const escapedKey = await enabled.client.callTool({ name: 'memory_inspect', arguments: { scope: 'project', key: '\u0000'.repeat(4096) } });
  assert.equal(escapedKey.isError, true, 'escaped empty response frame must be bounded before store access');
  assert.ok(Buffer.byteLength(JSON.stringify(escapedKey)) <= 32768);
  assert.equal(existsSync(path), false);
  // Missing and preexisting-empty stores are independent fixtures. Create the
  // latter exclusively and observe its held inode, not a re-resolved pathname.
  const emptyDirectory = join(lab.projects.beta, '.agentfs');
  mkdirSync(emptyDirectory, { recursive: true, mode: 0o700 }); hardenPrivatePath(emptyDirectory);
  const emptyPath = join(emptyDirectory, 'project.db');
  const emptyDescriptor = openSync(emptyPath, 'wx', 0o600);
  let emptySession;
  try {
    hardenPrivatePath(emptyPath);
    emptySession = await lab.connect('beta', { CAIRN_MEMORY_CONTEXT: '1' });
    try {
      assert.deepEqual((await call(emptySession.client, { scope: 'project', key })).candidates, []);
    } catch (error) {
      // Disposable fixture diagnostics only; production MCP errors remain
      // categorical and never expose storage paths or raw driver failures.
      const numeric = fstatSync(emptyDescriptor), exact = fstatSync(emptyDescriptor, { bigint: true });
      console.error('EMPTY_STORE_IDENTITY', { dev: exact.dev.toString(), ino: exact.ino.toString(), safe_numeric_ino: Number.isSafeInteger(numeric.ino) });
      const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
        const {inspectMemoryCandidate}=await import(process.argv[1]);
        console.log(JSON.stringify(await inspectMemoryCandidate({path:process.argv[2],scope:'project',key:process.argv[3]})));
      `, new URL('../dist/memory-context-store.js', import.meta.url).href, emptyPath, key], {
        cwd: lab.projects.beta, env: lab.env, encoding: 'utf8', maxBuffer: 8192, timeout: process.platform === 'win32' ? 120000 : 30000,
      });
      console.error('EMPTY_STORE_DIRECT_PROBE', { status: probe.status, error: probe.error?.code, stdout: probe.stdout, stderr: probe.stderr });
      throw error;
    }
    assert.equal(fstatSync(emptyDescriptor).size, 0, 'MCP observation must not initialize empty legacy schema');
  } finally { closeSync(emptyDescriptor); await emptySession?.close(); }
  await seed(path, 'project', 'project value');
  const escapedExisting = await enabled.client.callTool({ name: 'memory_inspect', arguments: { scope: 'project', key: '\u0000'.repeat(4096) } });
  assert.equal(escapedExisting.isError, true);
  assert.ok(Buffer.byteLength(JSON.stringify(escapedExisting)) <= 32768);
  assert.equal((await call(enabled.client, { scope: 'project', key })).candidates[0].status, 'unknown');
  const input = join(lab.root, 'freshness.json');
  const metadata = { schema_version: 1, source_refs: ['opaque:fixture'], verified_at: '2000-01-01T00:00:00Z', review_after: '2999-01-01T00:00:00Z' };
  writeFileSync(input, JSON.stringify(metadata), { mode: 0o600 });
  const args = ['set-freshness', '--scope', 'project', '--project', lab.projects.alpha, '--key', key, '--input', input, '--json'];
  const before = readFileSync(path), plan = parsed(run(args));
  assert.deepEqual(readFileSync(path), before, 'CLI plan must be no-write');
  assert.notEqual(run([...args, '--apply', '--confirm', '0'.repeat(64)]).status, 0);
  parsed(run([...args, '--apply', '--confirm', plan.digest]));
  const inspected = parsed(run(['inspect', '--scope', 'project', '--key', key, '--json']));
  assert.equal(inspected.candidates[0].status, 'current');
  assert.equal((await call(enabled.client, { scope: 'project', key })).candidates[0].status, 'current');
  assert.notEqual(run([...args, '--apply', '--confirm', plan.digest]).status, 0);
  const doctor = run(['doctor', '--scope', 'project', '--json']);
  assert.equal(doctor.status, 0, doctor.stderr); assert.equal(doctor.stdout.includes('project value'), false);
  assert.equal(doctor.stdout.includes('opaque:fixture'), false); assert.equal(JSON.parse(doctor.stdout).freshness.initialized, true);
  writeFileSync(input, JSON.stringify({ ...metadata, verified_at: '2999-01-01T00:00:00Z' }));
  assert.notEqual(run(args).status, 0);
  writeFileSync(input, ' '.repeat(65537)); assert.notEqual(run(args).status, 0);
  for (const invalid of [{ scope: '../escape', key }, { scope: 'project', key: '__history__/secret' }, { scope: 'project', key, path }, { scope: 'project', key, projectId: 'beta' }]) {
    assert.equal((await enabled.client.callTool({ name: 'memory_inspect', arguments: invalid })).isError, true);
  }
  const identityPath = join(lab.env.CAIRN_AGENTFS_BASE_DIR, 'identity.db');
  await seed(identityPath, 'identity', 'identity value');
  const conflict = await call(enabled.client, { scope: 'all', key });
  assert.equal(conflict.candidates.length, 2); assert.equal(conflict.possible_conflicts, true);
  assert.equal((await call(enabled.client, { scope: 'project', key })).possible_conflicts, false);
  const legacyTemplate = join(lab.root, 'legacy-template.db');
  const legacyAgent = await AgentFS.open({ path: legacyTemplate });
  await legacyAgent.kv.set(key, 'legacy fixture');
  await legacyAgent.getDatabase().exec('PRAGMA wal_checkpoint(TRUNCATE)');
  await legacyAgent.close();
  const configured = Array.from({ length: 17 }, (_, index) => `visible-${index}`);
  for (const scope of [...configured, 'hidden-fixture']) {
    const file = join(lab.env.CAIRN_AGENTFS_BASE_DIR, `${scope}.db`); copyFileSync(legacyTemplate, file); hardenPrivatePath(file);
  }
  const configFile = join(lab.projects.alpha, '.agent', 'memory.json'), configBefore = readFileSync(configFile);
  const legacyBefore = readFileSync(join(lab.env.CAIRN_AGENTFS_BASE_DIR, 'visible-0.db'));
  try {
    writeFileSync(configFile, JSON.stringify({ scopes: configured }));
    const bounded = await call(enabled.client, { scope: 'all', key });
    assert.equal(bounded.candidates.length, 16); assert.equal(bounded.truncated, true);
    assert.equal(bounded.possible_conflicts, false);
    assert.equal(JSON.stringify(bounded).includes('hidden-fixture'), false);
    assert.ok(bounded.candidates.every(candidate => !candidate.tracked && candidate.status === 'unknown'));
    assert.deepEqual(readFileSync(join(lab.env.CAIRN_AGENTFS_BASE_DIR, 'visible-0.db')), legacyBefore, 'legacy inspection must not change durable schema/data');
    const writeAfterInspection = await enabled.client.callTool({ name: 'memory_write', arguments: { scope: configured[0], key, value: 'ordinary write after inspection' } });
    assert.notEqual(writeAfterInspection.isError, true, 'legacy inspection must not poison subsequent ordinary MCP writes');
    const readAfterWrite = await enabled.client.callTool({ name: 'memory_read', arguments: { scope: configured[0], key } });
    assert.notEqual(readAfterWrite.isError, true);
    assert.ok(JSON.stringify(readAfterWrite).includes('ordinary write after inspection'));
  } finally { writeFileSync(configFile, configBefore); }
  const huge = await ordinary.openOrdinaryMemoryStore(path, 'project');
  try { await huge.kv.set('facts/huge', '界'.repeat(20000)); await huge.kv.set('facts/boundary', 'x'); } finally { await huge.close(); }
  assert.equal((await call(enabled.client, { scope: 'project', key: 'facts/huge' })).truncated, true);
  const framing = await enabled.client.callTool({ name: 'memory_inspect', arguments: { scope: 'project', key: 'facts/boundary' } });
  const fitting = 1 + Math.floor((32768 - Buffer.byteLength(JSON.stringify(framing))) / 2);
  for (const size of [fitting, fitting + 1]) {
    const writer = await ordinary.openOrdinaryMemoryStore(path, 'project');
    try { await writer.kv.set('facts/boundary', 'x'.repeat(size)); } finally { await writer.close(); }
    const boundary = await call(enabled.client, { scope: 'project', key: 'facts/boundary' });
    assert.equal(boundary.candidates.length, size === fitting ? 1 : 0, 'complete result byte boundary must include framing and both booleans');
  }
  await enabled.close();
  for (const [env, expected] of [
    [{ CAIRN_MEMORY_CONTEXT: '1', CAIRN_MCP_TOOL_PROFILE: 'read-only' }, true],
    [{ CAIRN_MEMORY_CONTEXT: '1', CAIRN_MCP_TOOL_PROFILE: 'custom', CAIRN_MCP_ALLOWED_TOOLS: 'memory_inspect' }, true],
    [{ CAIRN_MEMORY_CONTEXT: '0', CAIRN_MCP_TOOL_PROFILE: 'custom', CAIRN_MCP_ALLOWED_TOOLS: 'memory_inspect' }, false],
    [{ CAIRN_MEMORY_CONTEXT: '1', CAIRN_MCP_TOOL_PROFILE: 'custom', CAIRN_MCP_ALLOWED_TOOLS: 'memory_read' }, false],
    [{ CAIRN_MEMORY_CONTEXT: '1', CAIRN_CAPABILITY_CONTRACT: '1', CAIRN_CAPABILITY_MEMORY_SEARCH: '0' }, false],
  ]) {
    const session = await lab.connect('alpha', env);
    const tools = await toolList(session.client);
    assert.equal(tools.some(tool => tool.name === 'memory_inspect'), expected);
    if (env.CAIRN_MCP_TOOL_PROFILE === 'read-only') assert.ok(tools.every(tool => tool.annotations.readOnlyHint));
    if (expected) await call(session.client, { scope: 'project', key });
    else await denied(session.client, { scope: 'project', key });
    await session.close();
  }
  const projects = join(lab.env.CAIRN_AGENTFS_BASE_DIR, 'projects'); mkdirSync(projects, { recursive: true, mode: 0o700 });
  await seed(join(projects, 'alpha.db'), 'project', 'remote alpha');
  await seed(join(projects, 'beta.db'), 'project', 'remote beta');
  await httpSession({}, async ({ connect }) => {
    const client = await connect('alpha');
    assert.equal((await client.listTools()).tools.some(tool => tool.name === 'memory_inspect'), false);
    assert.equal((await client.callTool({ name: 'memory_inspect', arguments: { scope: 'project', key } })).isError, true);
  });
  await httpSession({ CAIRN_MEMORY_CONTEXT: '0', CAIRN_MEMORY_CONTEXT_HTTP: '1' }, async ({ connect }) => {
    assert.equal((await toolList(await connect('alpha'))).some(tool => tool.name === 'memory_inspect'), false);
  });
  await httpSession({ CAIRN_MEMORY_CONTEXT_HTTP: '1' }, async ({ connect, url, token }) => {
    const alpha = await connect('alpha'), beta = await connect('beta'), legacy = await connect();
    assert.equal((await call(alpha, { scope: 'project', key })).candidates[0].value, 'remote alpha');
    assert.equal((await call(beta, { scope: 'project', key })).candidates[0].value, 'remote beta');
    assert.equal((await legacy.listTools()).tools.some(tool => tool.name === 'memory_inspect'), false, 'unbound HTTP must not expose context');
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://untrusted.example' } })).status, 403);
    const badHost = await new Promise((resolve, reject) => {
      const req = request(url, { headers: { Authorization: `Bearer ${token}`, Host: 'untrusted.example' } }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
      req.once('error', reject); req.end();
    });
    assert.equal(badHost, 403);
    const forged = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'X-Cairn-Project': '../escape' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'invalid', version: '1' } } }) });
    assert.equal(forged.status, 400);
  });
  const damaged = await ordinary.openOrdinaryMemoryStore(path, 'project');
  try { await damaged.getDatabase().exec('DROP TABLE cairn_memory_context_facts_v1'); } finally { await damaged.close(); }
  const damageBefore = readFileSync(path);
  const damagedSession = await lab.connect('alpha', { CAIRN_MEMORY_CONTEXT: '1' });
  const failure = await damagedSession.client.callTool({ name: 'memory_inspect', arguments: { scope: 'project', key } });
  assert.equal(failure.isError, true); assert.match(JSON.stringify(failure), /MEMORY_CONTEXT_DAMAGED/);
  await damagedSession.close();
  assert.notEqual(run(['doctor', '--scope', 'project', '--json']).status, 0);
  assert.deepEqual(readFileSync(path), damageBefore, 'diagnosis cannot repair assertion infrastructure');
  lab.assertOffline();
  console.log('PASS: explicit freshness CLI, no-write doctor, unchanged legacy contracts, bounded MCP observations, profiles/capabilities and separately consented authenticated project HTTP');
} finally { await lab.close(); }
