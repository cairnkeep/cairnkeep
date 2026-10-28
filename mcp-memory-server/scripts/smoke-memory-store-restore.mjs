#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, copyFileSync, rmSync, existsSync, mkdirSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync, fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash, createHmac } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createContinuityLab } from './memory-continuity-lab.mjs';
import { createTar } from '../../scripts/windows-platform.mjs';

const lab = createContinuityLab();
const cli = fileURLToPath(new URL('../../bin/cairn', import.meta.url));
const path = join(lab.projects.alpha, '.agentfs', 'project.db');
const backup = join(lab.root, 'snapshot.db');
// Native ACL subprocesses are part of the fixture's elapsed time, not SQL work.
// Production request/startup limits are unchanged; backup itself has a 120s cap.
const run = args => spawnSync(process.execPath, [cli, 'memory-context', ...args], { cwd: lab.projects.alpha, env: lab.env, encoding: 'utf8', timeout: process.platform === 'win32' ? (args[0] === 'backup' ? 150_000 : 90_000) : 30_000 });
const args = ['--scope', 'project', '--project', lab.projects.alpha, '--json'];
const drop = () => { for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true }); };
try {
  const planned = run(['init', ...args]);
  assert.equal(planned.status, 0, `fresh-store planning failed (${planned.error?.code ?? planned.signal ?? 'exit'}): ${planned.stderr}`);
  const plan = JSON.parse(planned.stdout);
  assert.equal(run(['init', ...args, '--apply', '--confirm', plan.digest]).status, 0);
  const store = await import('../dist/ordinary-memory-store.js');
  const { MemoryDatabase } = await import('../dist/memory-database.js');
  const { readMemorySourceRef } = await import('../dist/memory-store-format.js');
  const writer = await store.openOrdinaryMemoryStore(path, 'project');
  await writer.kv.set('decisions/fixture', 'append-only'); await writer.close();
  const malformedDb = await MemoryDatabase.open(path);
  const sentinel = 'PRIVATE_JSON_FIXTURE_SENTINEL';
  try {
    await malformedDb.prepare('INSERT INTO kv_store(key,value) VALUES(?,?)').run('facts/malformed', sentinel);
  } finally { await malformedDb.close(); }
  const malformedView = await store.openOrdinaryMemoryView(path, 'project');
  try {
    await assert.rejects(malformedView.kv.get('facts/malformed'), error => error.code === 'MEMORY_CONTEXT_DAMAGED' && !error.message.includes(sentinel), 'malformed stored JSON must produce payload-free diagnostics');
  } finally {
    await malformedView.close();
    const cleanup = await MemoryDatabase.open(path);
    try { await cleanup.prepare('DELETE FROM kv_store WHERE key=?').run('facts/malformed'); } finally { await cleanup.close(); }
  }
  const sourceRef = async () => {
    const db = await MemoryDatabase.open(path, { readOnly: true });
    try { return await readMemorySourceRef(db, store.memoryStoreIdentity(path, 'project'), 'decisions/fixture'); }
    finally { await db.close(); }
  };
  const oldRef = await sourceRef();
  const receiptKey = Buffer.from('disposable-receipt-fixture-key');
  const receipt = value => createHmac('sha256', receiptKey).update(JSON.stringify(value)).digest('hex');
  const oldReceipt = receipt(oldRef);
  const child = fork(fileURLToPath(new URL('./fixtures/memory-store-writer.mjs', import.meta.url)), [path], { env: lab.env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let childDiagnostic = '';
  child.stderr.on('data', bytes => { childDiagnostic = (childDiagnostic + String(bytes)).slice(-65_536); });
  const finished = new Promise(done => child.once('close', (code, signal) => done({ code, signal })));
  child.on('error', error => { childDiagnostic += `\nwriter IPC: ${error.code ?? 'failed'}`; });
  let backed;
  const timer = setTimeout(() => child.kill(), process.platform === 'win32' ? 150_000 : 15_000);
  try {
    await Promise.race([once(child, 'message'), once(child, 'exit').then(() => { throw new Error('writer exited early'); })]);
    backed = run(['backup', ...args, '--output', backup]);
    let sendError;
    await new Promise(done => child.send({ stop: true }, error => { sendError = error; done(); }));
    const outcome = await finished;
    assert.equal(outcome.code, 0, `writer exited during online backup (${outcome.signal ?? 'no signal'}): ${childDiagnostic}; backup: ${backed.stderr}`);
    assert.equal(sendError, null, `writer shutdown failed: ${childDiagnostic}`);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await finished;
  }
  assert.equal(backed.status, 0, 'managed online backup must be a supported operation');
  assert.equal(existsSync(backup), true);
  const snapshotBytes = readFileSync(backup);
  const foreignCopy = join(lab.root, 'foreign-snapshot.db'); copyFileSync(backup, foreignCopy);
  await assert.rejects(store.openOrdinaryMemoryStore(foreignCopy, 'project'), /MEMORY_OWNER_MISMATCH/);
  assert.deepEqual(readFileSync(foreignCopy), snapshotBytes, 'rejected writer cannot change a foreign snapshot journal mode');
  const snapshotDb = await MemoryDatabase.open(backup, { readOnly: true });
  try {
    const left = await snapshotDb.prepare('SELECT value FROM kv_store WHERE key=?').get('facts/pair-left');
    const right = await snapshotDb.prepare('SELECT value FROM kv_store WHERE key=?').get('facts/pair-right');
    assert.equal(left.value, right.value, 'online snapshot must include a complete concurrent transaction');
  } finally { await snapshotDb.close(); }
  assert.notEqual(run(['backup', ...args, '--output', backup]).status, 0);
  assert.deepEqual(readFileSync(backup), snapshotBytes, 'backup must not overwrite existing output');
  assert.equal(receipt(await sourceRef()), oldReceipt);
  drop(); copyFileSync(backup, path);
  assert.equal(receipt(await sourceRef()), oldReceipt, 'raw copy cannot invalidate an authentic old receipt');
  drop();
  const restore = run(['restore', ...args, '--input', backup]);
  assert.equal(restore.status, 0, restore.stderr); assert.equal(existsSync(path), false);
  const restorePlan = JSON.parse(restore.stdout);
  assert.match(restorePlan.digest, /^[a-f0-9]{64}$/);
  const heldSnapshot = await MemoryDatabase.open(backup, { readOnly: true });
  try {
    await assert.rejects(store.planContextStoreRestore({ path, scope: 'project', input: backup }),
      /MEMORY_SNAPSHOT_IN_USE/, 'a raw snapshot read must not cancel a live SQLite connection lock in this process');
  } finally { await heldSnapshot.close(); }
  const injected = join(lab.root, 'injected-trigger.db'); copyFileSync(backup, injected);
  const injectedDb = await MemoryDatabase.open(injected);
  try {
    await injectedDb.transaction(async () => { await injectedDb.exec('CREATE TRIGGER unexpected_fs_trigger AFTER INSERT ON fs_config BEGIN DELETE FROM kv_store; END'); })();
    await injectedDb.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    await injectedDb.prepare('PRAGMA journal_mode=DELETE').get();
  } finally { await injectedDb.close(); }
  await assert.rejects(store.planContextStoreRestore({ path, scope: 'project', input: injected }), /MEMORY_CONTEXT_DAMAGED/, 'restore must reject unexpected triggers outside the KV table too');
  assert.notEqual(run(['restore', ...args, '--input', backup, '--apply', '--confirm', '0'.repeat(64)]).status, 0);
  assert.equal(existsSync(path), false);
  const oversized = join(lab.root, 'oversized.db'); writeFileSync(oversized, '', { mode: 0o600 }); truncateSync(oversized, 512 * 1024 * 1024 + 1);
  await assert.rejects(store.planContextStoreRestore({ path, scope: 'project', input: oversized }));
  const corrupt = join(lab.root, 'corrupt.db'); const bad = Buffer.from(snapshotBytes); bad[100] ^= 0xff; writeFileSync(corrupt, bad, { mode: 0o600 });
  await assert.rejects(store.planContextStoreRestore({ path, scope: 'project', input: corrupt }));
  assert.equal(existsSync(path), false);
  for (const failure of ['before-renewal', 'after-renewal']) {
    const prepare = MemoryDatabase.prototype.prepare;
    try {
      MemoryDatabase.prototype.prepare = function(sql) {
        const statement = prepare.call(this, sql);
        if (!sql.startsWith('UPDATE cairn_memory_context_store_v1 SET restore_epoch=')) return statement;
        return { ...statement, run: async (...params) => {
          if (failure === 'after-renewal') await statement.run(...params);
          throw new Error('FIXTURE_RENEWAL_FAILURE');
        } };
      };
      await assert.rejects(store.applyContextStoreRestore({ path, scope: 'project', input: backup, confirm: restorePlan.digest }), /FIXTURE_RENEWAL_FAILURE/);
    } finally { MemoryDatabase.prototype.prepare = prepare; }
    assert.equal(existsSync(path), false); assert.deepEqual(readFileSync(backup), snapshotBytes);
  }
  const publish = fs.linkSync;
  try {
    fs.linkSync = () => { throw new Error('FIXTURE_PUBLICATION_FAILURE'); }; syncBuiltinESMExports();
    await assert.rejects(store.applyContextStoreRestore({ path, scope: 'project', input: backup, confirm: restorePlan.digest }), /FIXTURE_PUBLICATION_FAILURE/);
  } finally { fs.linkSync = publish; syncBuiltinESMExports(); }
  assert.equal(existsSync(path), false); assert.deepEqual(readFileSync(backup), snapshotBytes);
  assert.equal(run(['restore', ...args, '--input', backup, '--apply', '--confirm', restorePlan.digest]).status, 0);
  const restored = await sourceRef();
  assert.equal(restored.store_uuid, oldRef.store_uuid); assert.equal(restored.generation, oldRef.generation);
  assert.equal(restored.content_digest, oldRef.content_digest); assert.notEqual(restored.restore_epoch, oldRef.restore_epoch);
  assert.notEqual(receipt(restored), oldReceipt, 'managed restore must invalidate old receipts with the same signing key');
  const restoredBytes = readFileSync(path);
  assert.notEqual(run(['restore', ...args, '--input', backup, '--apply', '--confirm', restorePlan.digest]).status, 0);
  assert.deepEqual(readFileSync(path), restoredBytes);
  assert.deepEqual(readFileSync(backup), snapshotBytes, 'restore must never modify the input snapshot');
  drop();
  const contenders = await Promise.allSettled([
    store.applyContextStoreRestore({ path, scope: 'project', input: backup, confirm: restorePlan.digest }),
    store.applyContextStoreRestore({ path, scope: 'project', input: backup, confirm: restorePlan.digest }),
  ]);
  assert.equal(contenders.filter(item => item.status === 'fulfilled').length, 1);
  assert.notEqual(receipt(await sourceRef()), oldReceipt);
  const foreign = run(['restore', '--scope', 'project', '--project', lab.projects.beta, '--input', backup, '--json']);
  assert.notEqual(foreign.status, 0); assert.equal(existsSync(join(lab.projects.beta, '.agentfs')), false);

  // Preflight the entire archive and all destinations before changing any member.
  const base = lab.env.CAIRN_AGENTFS_BASE_DIR; mkdirSync(base, { recursive: true, mode: 0o700 });
  const legacy = await store.openOrdinaryMemoryStore(join(base, 'identity.db'), 'identity', { create: true });
  await legacy.kv.set('facts/original', 'retained'); await legacy.close();
  const legacyBytes = readFileSync(join(base, 'identity.db'));
  const mixed = join(lab.root, 'mixed.tgz'); writeFileSync(mixed, gzipSync(createTar([
    ['identity.db', Buffer.alloc(0)], ['project.db', snapshotBytes],
  ])));
  const importArchive = archive => spawnSync(process.execPath, [cli, 'memory', 'import', archive], { cwd: lab.projects.alpha, env: { ...lab.env, CAIRN_MEMORY_CONTEXT: '0' }, encoding: 'utf8', timeout: 30_000 });
  assert.notEqual(importArchive(mixed).status, 0, 'generic import must reject context-format archive members');
  assert.deepEqual(readFileSync(join(base, 'identity.db')), legacyBytes);
  assert.equal(existsSync(join(base, 'identity.db.bak-pre-import')), false);
  const target = join(base, 'project.db'); copyFileSync(backup, target);
  const legacyOnly = join(lab.root, 'legacy-only.tgz'); writeFileSync(legacyOnly, gzipSync(createTar([
    ['identity.db', Buffer.alloc(0)], ['project.db', Buffer.alloc(0)],
  ])));
  assert.notEqual(importArchive(legacyOnly).status, 0, 'generic import must reject context-format destinations');
  assert.deepEqual(readFileSync(join(base, 'identity.db')), legacyBytes);
  assert.deepEqual(readFileSync(target), snapshotBytes);
  const pending = join(base, '.cairn-memory-import-pending'); writeFileSync(pending, '{}', { mode: 0o600 });
  await assert.rejects(store.openOrdinaryMemoryView(join(base, 'identity.db'), 'identity'), /MEMORY_IMPORT_RECOVERY_REQUIRED/);
  assert.ok(store.memoryAdministrationIssues(base).includes('MEMORY_IMPORT_RECOVERY_REQUIRED'));
  lab.assertOffline();
  console.log('PASS: online backup, fresh managed restore, epoch receipt boundary and all-member generic import refusal');
} finally { await lab.close(); }
