#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AgentFS } from 'agentfs-sdk';
import { Worker } from 'node:worker_threads';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { hardenPrivatePath } from '../dist/platform-security.js';
import { createTypedNode, getTypedNode, supersedeTypedNode, planMemoryImport, commitMemoryImport } from '../dist/node-store.js';

// Before implementation, exercise the actual existing backend to expose the
// missing transaction ownership behavior rather than stopping on an import error.
let implementation;
try { implementation = await import('../dist/memory-database.js'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const root = mkdtempSync(join(tmpdir(), 'cairn-memory-database-'));
hardenPrivatePath(root);
const opened = [], children = new Set();
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(CAIRN_|MCP_|NODE_OPTIONS|NODE_PATH|AGENT_MEMORY_CONFIG)/.test(key) && !/(?:API_KEY|TOKEN|SECRET)/.test(key)));
async function message(child, key) {
  const timer = setTimeout(() => { child.kill(); }, 10_000);
  try {
    return await Promise.race([
      once(child, 'message').then(([value]) => { assert.equal(value[key], true); return value; }),
      once(child, 'exit').then(([code]) => { throw new Error(`fixture exited:${code}`); }),
    ]);
  } finally { clearTimeout(timer); }
}
function child(mode, path) {
  const process = fork(fileURLToPath(new URL('./fixtures/memory-database-process.mjs', import.meta.url)), [mode, path], { env: cleanEnv, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  process.stderr.resume(); children.add(process); process.once('exit', () => children.delete(process)); return process;
}
async function make(name, options = {}) {
  if (!implementation) {
    const agent = await AgentFS.open({ path: join(root, name + '.db') });
    opened.push({ close: () => agent.close() }); return { agent, db: agent.getDatabase() };
  }
  const db = await implementation.openMemoryDatabase(join(root, name + '.db'), { create: true, ...options });
  opened.push(db);
  return { db, agent: await implementation.attachMemoryAgent(db) };
}
try {
  const { agent, db } = await make('ownership');
  await agent.kv.set('facts/unicode', { text: 'caffè 中文', flags: [true, null] });
  assert.deepEqual(await agent.kv.get('facts/unicode'), { text: 'caffè 中文', flags: [true, null] });
  let entered, release;
  const staged = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const aborted = db.transaction(async () => {
    await agent.kv.set('facts/inside', 'discard'); entered(); await hold; throw new Error('FIXTURE_ABORT');
  }).immediate();
  const abortedResult = assert.rejects(aborted, /FIXTURE_ABORT/);
  await staged;
  const outside = agent.kv.set('facts/outside', 'persist');
  await delay(20); release(); await abortedResult; await outside;
  assert.equal(await agent.kv.get('facts/inside'), undefined);
  assert.equal(await agent.kv.get('facts/outside'), 'persist', 'unrelated writes must never join another operation rollback');
  assert.ok(implementation, 'worker-backed adapter is required');

  await agent.fs.mkdir('/fixtures');
  const bytes = Buffer.from([0, 1, 2, 128, 255]);
  await agent.fs.writeFile('/fixtures/binary', bytes);
  assert.deepEqual(await agent.fs.readFile('/fixtures/binary'), bytes);
  await assert.rejects(agent.fs.writeFile('/fixtures/too-big', Buffer.alloc(8 * 1024 * 1024 + 1)), { code: 'MEMORY_REQUEST_LIMIT' });
  const tool = await agent.tools.start('fixture', { ok: true });
  await agent.tools.success(tool, { done: true }); assert.equal((await agent.tools.get(tool)).status, 'success');
  await createTypedNode({ agent, scope: 'project', key: 'facts/typed', value: 'A', node_type: 'knowledge' });
  await supersedeTypedNode({ agent, scope: 'project', key: 'facts/typed', value: 'B' });
  assert.equal((await getTypedNode(agent, 'project', 'facts/typed')).value, 'B');
  const batch = await planMemoryImport(agent, { schema_version: 1, scope: 'project', address_space: 'memory',
    conflict_policy: 'supersede', dry_run: false, import_id: 'fixture-import', nodes: [{ key: 'facts/imported', value: 'fixture', node_type: 'memory', tags: [] }] });
  assert.equal((await commitMemoryImport(agent, batch)).committed, true);
  assert.equal((await commitMemoryImport(agent, batch)).replayed, true);
  let late;
  await db.transaction(async () => {
    late = new Promise(resolve => setTimeout(async () => {
      try { await agent.kv.set('facts/late', 'bad'); resolve(false); }
      catch (error) { resolve(error.code === 'MEMORY_STALE_OWNER'); }
    }, 20));
  })();
  assert.equal(await late, true);
  await assert.rejects(db.exec('BEGIN'), { code: 'MEMORY_UNOWNED_TRANSACTION' });
  await assert.rejects(db.transaction(() => db.transaction(async () => {})())(), { code: 'MEMORY_NESTED_TRANSACTION' });
  await assert.rejects(db.prepare('SELECT ?').get('x'.repeat(8 * 1024 * 1024 + 1)), { code: 'MEMORY_REQUEST_LIMIT' });
  await assert.rejects(db.prepare('SELECT 1').get({ invalid: true }), { code: 'MEMORY_INVALID_BINDING' });

  const short = await make('deadline', { limits: { operationMs: 500 } });
  const timed = short.db.transaction(async () => { await short.agent.kv.set('facts/timeout', 'bad'); await delay(800); })();
  await assert.rejects(timed, { code: 'MEMORY_OPERATION_TIMEOUT' });
  await assert.rejects(short.db.prepare('SELECT 1').get(), { code: 'MEMORY_DATABASE_UNUSABLE' });

  const unclosed = await make('unclosed');
  await assert.rejects(unclosed.db.exclusive(async () => {
    await unclosed.db.exec('BEGIN'); await unclosed.agent.kv.set('facts/unclosed', 'bad');
  }), { code: 'MEMORY_UNCLOSED_TRANSACTION' });
  await unclosed.db.close();
  const afterUnclosed = await implementation.openMemoryDatabase(unclosed.db.name, { readOnly: true }); opened.push(afterUnclosed);
  assert.equal(await afterUnclosed.prepare('SELECT value FROM kv_store WHERE key=?').get('facts/unclosed'), undefined);

  const format = await import('../dist/memory-store-format.js');
  const schema = await import('../dist/memory-context-schema.js');
  const identity = { owner_domain: 'a'.repeat(64), scope: 'project' };
  const tracked = await make('tracked');
  await format.initializeMemoryContextFormat(tracked.db, identity);
  await tracked.agent.kv.set('facts/revision', 'A');
  const original = await format.readMemorySourceRef(tracked.db, identity, 'facts/revision');
  await tracked.agent.kv.set('facts/revision', 'B'); await tracked.agent.kv.set('facts/revision', 'A');
  const aba = await format.readMemorySourceRef(tracked.db, identity, 'facts/revision');
  assert.equal(aba.content_digest, original.content_digest); assert.equal(aba.generation, original.generation + 2);
  await tracked.agent.kv.delete('facts/revision'); await tracked.agent.kv.set('facts/revision', 'A');
  assert.equal((await format.readMemorySourceRef(tracked.db, identity, 'facts/revision')).generation, original.generation + 4);
  await tracked.agent.kv.set('__history__/hidden', 'hidden');
  assert.equal((await tracked.db.prepare(`SELECT COUNT(*) AS n FROM ${schema.CONTEXT_REVISION_TABLE} WHERE key=?`).get('__history__/hidden')).n, 0);
  await assert.rejects(format.readMemorySourceRef(tracked.db, identity, '__history__/hidden'), { code: 'MEMORY_INVALID_SOURCE' });
  await assert.rejects(tracked.db.prepare('UPDATE kv_store SET key=? WHERE key=?').run('facts/renamed', 'facts/revision'), { code: 'MEMORY_KEY_RENAME' });
  const beforeAbort = await format.readMemorySourceRef(tracked.db, identity, 'facts/revision');
  await assert.rejects(tracked.db.transaction(async () => { await tracked.agent.kv.set('facts/revision', 'bad'); throw Error('ABORT'); }).immediate(), /ABORT/);
  assert.deepEqual(await format.readMemorySourceRef(tracked.db, identity, 'facts/revision'), beforeAbort);
  await tracked.db.prepare(`UPDATE ${schema.CONTEXT_REVISION_TABLE} SET generation=? WHERE key=?`).run(Number.MAX_SAFE_INTEGER, 'facts/revision');
  await assert.rejects(tracked.agent.kv.set('facts/revision', 'overflow'), { code: 'MEMORY_GENERATION_EXHAUSTED' });
  assert.equal(await tracked.agent.kv.get('facts/revision'), 'A');
  await assert.rejects(format.validateMemoryContextFormat(tracked.db, { ...identity, owner_domain: 'b'.repeat(64) }), { code: 'MEMORY_OWNER_MISMATCH' });

  await tracked.agent.kv.set('facts/counter', 0);
  await tracked.db.close();
  assert.equal(format.probeOrdinaryMemoryFormat(tracked.db.name).kind, 'context-v1');
  const left = child('increment', tracked.db.name), right = child('increment', tracked.db.name);
  await Promise.all([message(left, 'ready'), message(right, 'ready')]);
  const stopped = Promise.all([once(left, 'exit'), once(right, 'exit')]); left.send('start'); right.send('start');
  assert.deepEqual((await stopped).map(([code]) => code), [0, 0]);
  const concurrent = await implementation.openMemoryDatabase(tracked.db.name); opened.push(concurrent);
  const concurrentAgent = await implementation.attachMemoryAgent(concurrent);
  assert.equal(await concurrentAgent.kv.get('facts/counter'), 80);
  assert.equal((await format.readMemorySourceRef(concurrent, identity, 'facts/counter')).generation, 81);
  await concurrentAgent.kv.set('facts/staged', 'committed');
  const committed = await format.readMemorySourceRef(concurrent, identity, 'facts/staged'); await concurrent.close();
  const doomed = child('crash', tracked.db.name); await message(doomed, 'staged');
  const exited = once(doomed, 'exit'); doomed.kill('SIGKILL'); await exited;
  const recovered = await implementation.openMemoryDatabase(tracked.db.name, { readOnly: true }); opened.push(recovered);
  assert.deepEqual(await format.readMemorySourceRef(recovered, identity, 'facts/staged'), committed);
  await assert.rejects(implementation.attachMemoryAgent(recovered), { code: 'MEMORY_READ_ONLY_SDK_UNSUPPORTED' });
  await assert.rejects(recovered.prepare('UPDATE kv_store SET value=?').run('bad'), { code: 'MEMORY_READ_ONLY' });

  const bounded = await implementation.openMemoryDatabase(tracked.db.name, { limits: { queueEntries: 2, replyBytes: 1024 } }); opened.push(bounded);
  let unhold, queued;
  const enteredQueue = new Promise(resolve => { queued = resolve; });
  const active = bounded.exclusive(async () => { queued(); await new Promise(resolve => { unhold = resolve; }); });
  await enteredQueue;
  const accepted = bounded.prepare('SELECT 1 AS n').get();
  await assert.rejects(bounded.prepare('SELECT 2').get(), { code: 'MEMORY_QUEUE_LIMIT' });
  unhold(); await active; assert.equal((await accepted).n, 1);
  await assert.rejects(bounded.prepare('WITH RECURSIVE seq(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM seq WHERE n<1000) SELECT n,? AS value FROM seq').all('x'.repeat(100)), { code: 'MEMORY_REPLY_LIMIT' });
  assert.equal((await bounded.prepare('SELECT 42 AS n').get()).n, 42);
  bounded.interrupt(); await bounded.close();
  await assert.rejects(bounded.prepare('SELECT 1').get(), { code: 'MEMORY_DATABASE_UNUSABLE' });

  const fixtureUrl = new URL('./fixtures/memory-database-worker.mjs', import.meta.url);
  for (const [mode, code] of [['stall', 'MEMORY_STARTUP_TIMEOUT'], ['bad-ready', 'MEMORY_WORKER_PROTOCOL']]) {
    await assert.rejects(implementation.openMemoryDatabase(tracked.db.name, { limits: { startupMs: 150 },
      workerFactory: (_url, options) => new Worker(fixtureUrl, { ...options, workerData: { mode } }),
    }), { code });
  }
  const malformed = await implementation.openMemoryDatabase(tracked.db.name, {
    workerFactory: (_url, options) => new Worker(fixtureUrl, { ...options, workerData: { mode: 'bad-response' } }),
  }); opened.push(malformed);
  await assert.rejects(malformed.prepare('SELECT 1').get(), { code: 'MEMORY_WORKER_PROTOCOL' });
  await assert.rejects(malformed.prepare('SELECT 1').get(), { code: 'MEMORY_DATABASE_UNUSABLE' });

  let dropCommit = false, commitId;
  const uncertain = await make('uncertain', { workerFactory: (url, options) => {
    const worker = new Worker(url, options), on = worker.on.bind(worker), post = worker.postMessage.bind(worker);
    worker.postMessage = request => { if (dropCommit && request.sql === 'COMMIT') commitId = request.id; post(request); };
    worker.on = (event, listener) => on(event, event === 'message' ? value => {
      if (commitId !== undefined && value.id === commitId) { void worker.terminate(); return; }
      listener(value);
    } : listener);
    return worker;
  } });
  dropCommit = true;
  await assert.rejects(uncertain.db.transaction(async () => { await uncertain.agent.kv.set('facts/ack', 'committed'); }).immediate(), { code: 'MEMORY_COMMIT_UNCERTAIN' });
  await uncertain.db.close();
  const confirmed = await implementation.openMemoryDatabase(uncertain.db.name, { readOnly: true }); opened.push(confirmed);
  assert.equal(JSON.parse((await confirmed.prepare('SELECT value FROM kv_store WHERE key=?').get('facts/ack')).value), 'committed', 'lost acknowledgement is not rollback');

  const holder = child('hold', tracked.db.name); await message(holder, 'staged');
  const contended = await implementation.openMemoryDatabase(tracked.db.name, { busyTimeoutMs: 200 }); opened.push(contended);
  const start = performance.now(); let tick;
  const timer = delay(10).then(() => { tick = performance.now() - start; });
  await assert.rejects(contended.transaction(async () => {}).immediate(), { code: 'MEMORY_SQLITE_BUSY' });
  await timer; assert.ok(tick < 150, 'SQLite busy wait must not stall caller loop');
  const holderExit = once(holder, 'exit'); holder.send('release'); assert.equal((await holderExit)[0], 0);
  const killable = await make('worker-death');
  let hasStaged;
  const stagedDeath = new Promise(resolve => { hasStaged = resolve; });
  const interrupted = killable.db.transaction(async () => {
    await killable.agent.kv.set('facts/death', 'discard'); hasStaged(); await new Promise(() => {});
  })();
  const deathResult = assert.rejects(interrupted, { code: 'MEMORY_WORKER_EXIT' });
  await stagedDeath; killable.db.interrupt(); await deathResult; await killable.db.close();
  const afterDeath = await implementation.openMemoryDatabase(killable.db.name, { readOnly: true }); opened.push(afterDeath);
  assert.equal(await afterDeath.prepare('SELECT value FROM kv_store WHERE key=?').get('facts/death'), undefined);
  for (const version of ['22.0.0', '22.15.9', '20.19.0', 'invalid']) assert.throws(() => implementation.assertContextRuntime(version), { code: 'MEMORY_RUNTIME_UNSUPPORTED' });
  for (const version of ['22.16.0', '22.23.1', '24.0.0', '26.0.0']) implementation.assertContextRuntime(version);
  await assert.rejects(implementation.openMemoryDatabase(join(root, 'absent.db'), { readOnly: true }));
  assert.equal(existsSync(join(root, 'absent.db')), false);

  const damaged = await make('damaged'); await format.initializeMemoryContextFormat(damaged.db, identity);
  await damaged.agent.kv.set('facts/damaged', 'A');
  await damaged.db.prepare(`DELETE FROM ${schema.CONTEXT_REVISION_TABLE} WHERE key=?`).run('facts/damaged');
  await assert.rejects(format.readMemorySourceRef(damaged.db, identity, 'facts/damaged'), { code: 'MEMORY_CONTEXT_DAMAGED' });
  await assert.rejects(damaged.agent.kv.set('facts/damaged', 'B'), { code: 'MEMORY_CONTEXT_DAMAGED' });
  await damaged.db.transaction(async () => { await damaged.db.exec('CREATE TRIGGER unrelated_trigger AFTER UPDATE ON kv_store BEGIN SELECT 1; END'); }).immediate();
  await assert.rejects(format.validateMemoryContextFormat(damaged.db, identity), { code: 'MEMORY_CONTEXT_DAMAGED' });
  await damaged.db.exec('DROP TRIGGER unrelated_trigger; DROP TRIGGER cairn_memory_context_revision_update');
  await assert.rejects(format.validateMemoryContextFormat(damaged.db, identity), { code: 'MEMORY_CONTEXT_DAMAGED' });

  console.log('PASS: actual SDK/core adapter, async ownership, revisions/ABA, real process concurrency/crash, read-only, worker failures and bounded queues/results');
} finally {
  for (const process of children) { const exited = once(process, 'exit'); process.kill('SIGKILL'); await exited; }
  for (const db of opened.reverse()) await db.close().catch(() => {});
  rmSync(root, { recursive: true, force: true });
}
