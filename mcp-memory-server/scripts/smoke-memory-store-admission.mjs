#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, readdirSync, copyFileSync, chmodSync, unlinkSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AgentFS } from 'agentfs-sdk';
import { createContinuityLab, serverEntry } from './memory-continuity-lab.mjs';
import { hardenPrivatePath } from '../dist/platform-security.js';

const lab = createContinuityLab();
const cli = fileURLToPath(new URL('../../bin/cairn', import.meta.url));
const path = join(lab.projects.alpha, '.agentfs', 'project.db');
const run = args => spawnSync(process.execPath, [cli, 'memory-context', ...args], { cwd: lab.projects.alpha, env: lab.env, encoding: 'utf8', timeout: 30_000 });
try {
  const planned = run(['init', '--scope', 'project', '--project', lab.projects.alpha, '--json']);
  assert.equal(planned.status, 0, 'fresh-store no-write plan must be a supported CLI operation');
  assert.equal(existsSync(path), false); assert.equal(existsSync(join(lab.projects.alpha, '.agentfs')), false);
  const plan = JSON.parse(planned.stdout); assert.match(plan.digest, /^[a-f0-9]{64}$/);
  assert.notEqual(run(['init', '--scope', 'project', '--project', lab.projects.alpha, '--apply', '--confirm', '0'.repeat(64), '--json']).status, 0);
  assert.equal(existsSync(join(lab.projects.alpha, '.agentfs')), false, 'wrong confirmation cannot create state');
  const applied = run(['init', '--scope', 'project', '--project', lab.projects.alpha, '--apply', '--confirm', plan.digest, '--json']);
  assert.equal(applied.status, 0, applied.stderr); assert.equal(existsSync(path), true);
  const store = await import('../dist/ordinary-memory-store.js');
  const format = await import('../dist/memory-store-format.js');
  const schema = await import('../dist/memory-context-schema.js');
  assert.equal(format.probeOrdinaryMemoryFormat(path).kind, 'context-v1');
  const digest = () => createHash('sha256').update(readFileSync(path)).digest('hex');
  const before = digest();
  assert.notEqual(run(['init', '--scope', 'project', '--project', lab.projects.alpha, '--apply', '--confirm', plan.digest, '--json']).status, 0);
  assert.equal(digest(), before);
  const status = run(['status', '--scope', 'project', '--project', lab.projects.alpha, '--json']);
  assert.equal(status.status, 0, status.stderr); assert.equal(JSON.parse(status.stdout).format, 'context-v1');
  assert.equal(digest(), before, 'observation must not initialize SDK schema or change durable bytes');

  for (const enabled of ['0', '1']) {
    const session = await lab.connect('alpha', { CAIRN_MEMORY_CONTEXT: enabled, CAIRN_TYPED_MEMORY_NODES: '1' });
    await session.call('memory_write', { scope: 'project', key: 'facts/fixture', value: 'A' });
    assert.equal((await session.call('memory_read', { scope: 'project', key: 'facts/fixture' })).results[0].value, 'A');
    await session.call('memory_supersede', { scope: 'project', key: 'facts/fixture', value: 'B' });
    assert.equal((await session.call('memory_read', { scope: 'project', key: 'facts/fixture' })).results[0].value, 'B');
    const history = await session.client.callTool({ name: 'memory_history', arguments: { scope: 'project', key: 'facts/fixture' } });
    assert.notEqual(history.isError, true, JSON.stringify(history));
    const envelope = { schema_version: 1, scope: 'project', nodes: [{ key: 'facts/imported', value: 'import fixture', node_type: 'knowledge', tags: [] }] };
    const importBefore = digest();
    await session.call('memory_import', { ...envelope, dry_run: true });
    assert.equal(digest(), importBefore, 'dry-run import must not initialize or mutate a context store');
    await session.call('memory_import', { ...envelope, conflict_policy: 'supersede' });
    await session.call('memory_list', { scope: 'project' });
    await session.call('memory_search', { scope: 'project', query: 'fixture' });
    await session.call('memory_delete', { scope: 'project', key: 'facts/fixture' });
    assert.deepEqual((await session.call('memory_read', { scope: 'project', key: 'facts/fixture' })).results, []);
    await session.close();
  }
  const reviewed = await import('../dist/reviewed-memory-store.js');
  await reviewed.applyReviewedMemory('project', 'fixture-review', 'decisions/reviewed', 'reviewed fixture', { cwd: lab.projects.alpha, typed: true });
  const wakeup = spawnSync(process.execPath, [serverEntry, 'wakeup'], { cwd: lab.projects.alpha, env: lab.env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(wakeup.status, 0); assert.match(wakeup.stdout, /reviewed fixture/);
  await reviewed.invalidateReviewedMemory('project', 'fixture-review', 'decisions/reviewed', 'fixture invalidation', { cwd: lab.projects.alpha, typed: true });
  const nodes = await import('../dist/node-store.js');
  const doctor = await nodes.doctorTypedNodeStore({ scope: 'project', baseDir: join(lab.projects.alpha, '.agentfs') });
  assert.equal(doctor.ok, true, JSON.stringify(doctor.issues));
  const view = await store.openOrdinaryMemoryView(path, 'project');
  try {
    const row = await view.getDatabase().prepare(`SELECT generation,present FROM ${schema.CONTEXT_REVISION_TABLE} WHERE key=?`).get('decisions/reviewed');
    assert.equal(row.present, 0); assert.ok(row.generation >= 2);
  } finally { await view.close(); }

  const beta = join(lab.projects.beta, '.agentfs', 'project.db');
  const betaPlan = await store.planContextStoreInit({ path: beta, scope: 'project' });
  const contenders = await Promise.allSettled([
    store.applyContextStoreInit({ path: beta, scope: 'project', confirm: betaPlan.digest }),
    store.applyContextStoreInit({ path: beta, scope: 'project', confirm: betaPlan.digest }),
  ]);
  assert.equal(contenders.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(format.probeOrdinaryMemoryFormat(beta).kind, 'context-v1');
  const zero = join(lab.root, 'zero.db'); writeFileSync(zero, '');
  await assert.rejects(store.planContextStoreInit({ path: zero, scope: 'identity' }), /EXISTING_STORE_UNSUPPORTED/);
  if (process.platform !== 'win32') {
    const link = join(lab.root, 'link.db'); symlinkSync(path, link);
    await assert.rejects(store.planContextStoreInit({ path: link, scope: 'identity' }));
    const dangling = join(lab.root, 'dangling.db'); symlinkSync(join(lab.root, 'absent'), dangling);
    await assert.rejects(store.planContextStoreInit({ path: dangling, scope: 'identity' }));
    chmodSync(path, 0o644);
    await assert.rejects(store.openOrdinaryMemoryView(path, 'project'), /MEMORY_FILE_UNSAFE/);
    chmodSync(path, 0o600);
    chmodSync(lab.projects.alpha, 0o775);
    await assert.rejects(store.openOrdinaryMemoryView(path, 'project'), /MEMORY_FILE_UNSAFE/);
    chmodSync(lab.projects.alpha, 0o700);
    const wal = `${beta}-wal`; symlinkSync(path, wal);
    await assert.rejects(store.openOrdinaryMemoryView(beta, 'project'), /MEMORY_FILE_UNSAFE/);
    unlinkSync(wal);
  }
  const copied = join(lab.root, 'copied.db'); copyFileSync(path, copied); hardenPrivatePath(copied);
  const copiedBefore = readFileSync(copied);
  await assert.rejects(store.openOrdinaryMemoryStore(copied, 'project'), /MEMORY_OWNER_MISMATCH/);
  assert.deepEqual(readFileSync(copied), copiedBefore);
  await assert.rejects(store.openOrdinaryMemoryView(path, 'identity'), /MEMORY_OWNER_MISMATCH/);
  const parity = await store.openOrdinaryMemoryStore(path, 'project');
  await parity.kv.set('Facts/MixedCase', 'visible');
  await parity.kv.set('facts/wild%card', 'percent');
  await parity.kv.set('facts/wild_card', 'underscore');
  const writableMixed = await parity.kv.list('facts/');
  const writablePercent = await parity.kv.list('facts/wild%');
  const writableUnderscore = await parity.kv.list('facts/wild_');
  await parity.close();
  const parityView = await store.openOrdinaryMemoryView(path, 'project');
  const ordered = entries => [...entries].sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
  try {
    assert.deepEqual(await parityView.kv.list('facts/'), ordered(writableMixed));
    assert.deepEqual(await parityView.kv.list('facts/wild%'), ordered(writablePercent));
    assert.deepEqual(await parityView.kv.list('facts/wild_'), ordered(writableUnderscore));
  } finally { await parityView.close(); }
  const beforeOldClient = digest();
  await assert.rejects(AgentFS.open({ id: 'project', path }));
  assert.equal(digest(), beforeOldClient, 'older SDK must refuse without modifying the context store');
  const unknown = join(lab.root, 'unknown.db');
  const unsupported = Buffer.from(readFileSync(path)); unsupported.writeUInt32BE(0x12345678, 68); writeFileSync(unknown, unsupported, { mode: 0o600 });
  await assert.rejects(store.openOrdinaryMemoryStore(unknown, 'project'), /MEMORY_FORMAT_UNSUPPORTED/);
  assert.deepEqual(readFileSync(unknown), unsupported);
  const missing = join(lab.root, 'missing-parent', 'identity.db');
  assert.equal(await store.openOrdinaryMemoryView(missing, 'identity'), null);
  assert.equal(existsSync(join(lab.root, 'missing-parent')), false);
  const staleParent = join(lab.root, 'stale-plan'); mkdirSync(staleParent, { mode: 0o700 });
  const stalePath = join(staleParent, 'identity.db');
  const stalePlan = await store.planContextStoreInit({ path: stalePath, scope: 'identity' });
  renameSync(staleParent, `${staleParent}-old`); mkdirSync(staleParent, { mode: 0o700 });
  await assert.rejects(store.applyContextStoreInit({ path: stalePath, scope: 'identity', confirm: stalePlan.digest }), /CONFIRMATION_MISMATCH/);
  assert.equal(existsSync(stalePath), false);
  const disabledNative = spawnSync(process.execPath, ['--no-experimental-sqlite', '--input-type=module', '-e', `
    const store = await import(process.argv[1]);
    const path = process.argv[2];
    const agent = await store.openOrdinaryMemoryStore(path, 'identity', {create:true});
    await agent.kv.set('facts/legacy','works'); await agent.close();
    const view = await store.openOrdinaryMemoryView(path,'identity');
    if(await view.kv.get('facts/legacy') !== 'works') throw new Error('legacy failure');
    await view.close();
  `, new URL('../dist/ordinary-memory-store.js', import.meta.url).href, join(lab.root, 'legacy-no-native.db')], { env: lab.env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(disabledNative.status, 0, disabledNative.stderr);
  const legacy = join(lab.root, 'legacy-no-native.db'); const legacyBefore = readFileSync(legacy);
  await assert.rejects(store.planContextStoreInit({ path: legacy, scope: 'identity' }), /EXISTING_STORE_UNSUPPORTED/);
  assert.deepEqual(readFileSync(legacy), legacyBefore);
  const unavailableNative = spawnSync(process.execPath, ['--no-experimental-sqlite', fileURLToPath(new URL('../dist/memory-context-cli.js', import.meta.url)),
    'status', '--scope', 'project', '--project', lab.projects.alpha, '--json'], { env: lab.env, encoding: 'utf8', timeout: 30_000 });
  assert.notEqual(unavailableNative.status, 0); assert.match(unavailableNative.stderr, /MEMORY_RUNTIME_UNSUPPORTED/);

  const { MemoryDatabase } = await import('../dist/memory-database.js');
  const broken = await MemoryDatabase.open(beta);
  try { await broken.exec('DROP TRIGGER cairn_memory_context_revision_update'); } finally { await broken.close(); }
  const damagedBefore = readFileSync(beta);
  await assert.rejects(store.openOrdinaryMemoryStore(beta, 'project'), /MEMORY_CONTEXT_DAMAGED/);
  await assert.rejects(nodes.doctorTypedNodeStore({ scope: 'project', baseDir: join(lab.projects.beta, '.agentfs'), repair: true }), /MEMORY_CONTEXT_DAMAGED/);
  assert.deepEqual(readFileSync(beta), damagedBefore, 'doctor cannot repair format infrastructure');
  const race = join(lab.root, 'race', 'identity.db');
  const racePlan = await store.planContextStoreInit({ path: race, scope: 'identity' });
  const raced = await Promise.allSettled([
    store.applyContextStoreInit({ path: race, scope: 'identity', confirm: racePlan.digest }),
    store.openOrdinaryMemoryStore(race, 'identity', { create: true }).then(async agent => { await agent.kv.set('facts/race', 'winner'); await agent.close(); }),
  ]);
  assert.equal(raced[1].status, 'fulfilled');
  assert.ok(['legacy', 'context-v1'].includes(format.probeOrdinaryMemoryFormat(race).kind));
  const raceView = await store.openOrdinaryMemoryView(race, 'identity');
  try { assert.equal(await raceView.kv.get('facts/race'), 'winner'); } finally { await raceView.close(); }

  // Actual authenticated HTTP routing uses server-side project paths, not cwd.
  const routed = join(lab.root, 'http-store', 'projects', 'alpha.db');
  const routedPlan = await store.planContextStoreInit({ path: routed, scope: 'project' });
  await store.applyContextStoreInit({ path: routed, scope: 'project', confirm: routedPlan.digest });
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(done => reservation.close(done));
  const server = spawn(process.execPath, [serverEntry], { cwd: lab.projects.neutral,
    env: { ...lab.env, CAIRN_AGENTFS_BASE_DIR: join(lab.root, 'http-store'), MCP_HTTP_PORT: String(port), MCP_HTTP_HOST: '127.0.0.1', CAIRN_MEMORY_HTTP_TOKEN: 'admission-fixture-token' }, stdio: ['ignore', 'ignore', 'pipe'] });
  const clients = [];
  try {
    await new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error('HTTP fixture startup timeout')), 10_000);
      server.stderr.on('data', bytes => { if (String(bytes).includes('listening on')) { clearTimeout(timer); done(); } });
      server.once('exit', () => { clearTimeout(timer); reject(new Error('HTTP fixture early exit')); });
    });
    for (const project of ['alpha', 'beta']) {
      const client = new Client({ name: 'admission-fixture', version: '1' }); clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: {
        Authorization: 'Bearer admission-fixture-token', 'X-Cairn-Project': project, 'X-Cairn-Scopes': 'project',
      } } }));
      const written = await client.callTool({ name: 'memory_write', arguments: { scope: 'project', key: 'facts/http', value: project } });
      assert.notEqual(written.isError, true);
      const read = await client.callTool({ name: 'memory_read', arguments: { scope: 'project', key: 'facts/http' } });
      assert.equal(read.structuredContent.results[0].value, project);
    }
    assert.equal(format.probeOrdinaryMemoryFormat(routed).kind, 'context-v1');
    assert.equal(format.probeOrdinaryMemoryFormat(join(lab.root, 'http-store', 'projects', 'beta.db')).kind, 'legacy');
    assert.equal(existsSync(join(lab.projects.neutral, '.agentfs')), false);
  } finally {
    for (const client of clients) await client.close();
    const exited = once(server, 'exit'); server.kill('SIGTERM'); await exited;
  }
  assert.equal(readdirSync(join(lab.projects.alpha, '.agentfs')).some(name => name.endsWith('.cairn-admission')), false);
  lab.assertOffline();
  console.log('PASS: fresh-only admission, no-overwrite, explicit confirmation, read-only status, actual MCP/review/wakeup/doctor routing and init races');
} finally { await lab.close(); }
