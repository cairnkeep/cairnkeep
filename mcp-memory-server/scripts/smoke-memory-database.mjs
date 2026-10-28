#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AgentFS } from 'agentfs-sdk';
import { createTypedNode, getTypedNode, supersedeTypedNode, planMemoryImport, commitMemoryImport } from '../dist/node-store.js';

// Before implementation, exercise the actual existing backend to expose the
// missing transaction ownership behavior rather than stopping on an import error.
let implementation;
try { implementation = await import('../dist/memory-database.js'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const root = mkdtempSync(join(tmpdir(), 'cairn-memory-database-'));
const opened = [];
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

  const short = await make('deadline', { limits: { operationMs: 60 } });
  const timed = short.db.transaction(async () => { await short.agent.kv.set('facts/timeout', 'bad'); await delay(200); })();
  await assert.rejects(timed, { code: 'MEMORY_OPERATION_TIMEOUT' });
  await assert.rejects(short.db.prepare('SELECT 1').get(), { code: 'MEMORY_DATABASE_UNUSABLE' });

  console.log('PASS: actual SDK/core adapter, isolated async ownership, bounded input and poisoned timeout');
} finally {
  for (const db of opened.reverse()) await db.close().catch(() => {});
  rmSync(root, { recursive: true, force: true });
}
