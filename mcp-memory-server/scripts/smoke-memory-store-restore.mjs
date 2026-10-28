#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, truncateSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { spawnSync, fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash, createHmac } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createContinuityLab } from './memory-continuity-lab.mjs';
import { createTar } from '../../scripts/windows-platform.mjs';
import { hardenPrivatePath } from '../dist/platform-security.js';

function copyPrivateSnapshot(bytes, target) { writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 }); hardenPrivatePath(target); }

const lab = createContinuityLab();
const cli = fileURLToPath(new URL('../../bin/cairn', import.meta.url));
const path = join(lab.projects.alpha, '.agentfs', 'project.db');
const backup = join(lab.root, 'snapshot.db');
let snapshotDescriptor;
function readSnapshotBytes() {
  const opened = fs.fstatSync(snapshotDescriptor), named = fs.lstatSync(backup);
  assert.ok(opened.isFile() && named.isFile() && !named.isSymbolicLink());
  assert.equal(opened.dev, named.dev); assert.equal(opened.ino, named.ino);
  assert.ok(opened.size >= 100 && opened.size <= 512 * 1024 * 1024);
  const bytes = Buffer.alloc(opened.size);
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.readSync(snapshotDescriptor, bytes, offset, bytes.length - offset, offset);
    assert.ok(count > 0); offset += count;
  }
  return bytes;
}
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
  snapshotDescriptor = fs.openSync(backup, fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW ?? 0));
  const snapshotBytes = readSnapshotBytes();
  const foreignCopy = join(lab.root, 'foreign-snapshot.db'); copyPrivateSnapshot(snapshotBytes, foreignCopy);
  await assert.rejects(store.openOrdinaryMemoryStore(foreignCopy, 'project'), /MEMORY_OWNER_MISMATCH/);
  assert.deepEqual(readFileSync(foreignCopy), snapshotBytes, 'rejected writer cannot change a foreign snapshot journal mode');
  const snapshotDb = await MemoryDatabase.open(backup, { readOnly: true });
  try {
    const left = await snapshotDb.prepare('SELECT value FROM kv_store WHERE key=?').get('facts/pair-left');
    const right = await snapshotDb.prepare('SELECT value FROM kv_store WHERE key=?').get('facts/pair-right');
    assert.equal(left.value, right.value, 'online snapshot must include a complete concurrent transaction');
  } finally { await snapshotDb.close(); }
  assert.notEqual(run(['backup', ...args, '--output', backup]).status, 0);
  assert.deepEqual(readSnapshotBytes(), snapshotBytes, 'backup must not overwrite existing output');
  const failedBackup = join(lab.root, 'failed-snapshot.db');
  const nativeBackup = MemoryDatabase.prototype.backup;
  try {
    MemoryDatabase.prototype.backup = async function(...params) { await nativeBackup.apply(this, params); throw Error('FIXTURE_AFTER_BACKUP_WRITE'); };
    await assert.rejects(store.backupMemoryContextStore({ path, scope: 'project', output: failedBackup }), /FIXTURE_AFTER_BACKUP_WRITE/);
  } finally { MemoryDatabase.prototype.backup = nativeBackup; }
  assert.equal(existsSync(failedBackup), false, 'failed backup must not publish its written stage');
  assert.deepEqual(readSnapshotBytes(), snapshotBytes);
  const orphanOutput = join(lab.root, 'orphan-output.db');
  writeFileSync(orphanOutput + '-wal', 'ABANDONED_WAL', { mode: 0o600 }); hardenPrivatePath(orphanOutput + '-wal');
  await assert.rejects(store.backupMemoryContextStore({ path, scope: 'project', output: orphanOutput }), { code: 'MEMORY_AUXILIARY_PRESENT' });
  assert.equal(existsSync(orphanOutput), false);
  assert.equal(readFileSync(orphanOutput + '-wal', 'utf8'), 'ABANDONED_WAL');
  rmSync(orphanOutput + '-wal');
  const backupWinner = join(lab.root, 'racing-snapshot.db');
  const originalLink = fs.linkSync;
  try {
    fs.linkSync = function(source, target) {
      if (target === backupWinner) { writeFileSync(target, 'COMPETING_BACKUP', { flag: 'wx', mode: 0o600 }); hardenPrivatePath(target); }
      return originalLink(source, target);
    }; syncBuiltinESMExports();
    await assert.rejects(store.backupMemoryContextStore({ path, scope: 'project', output: backupWinner }), { code: 'EEXIST' });
  } finally { fs.linkSync = originalLink; syncBuiltinESMExports(); }
  assert.equal(readFileSync(backupWinner, 'utf8'), 'COMPETING_BACKUP', 'backup must retain a racing publisher');
  assert.ok(!store.memoryAdministrationIssues(lab.root).includes('MEMORY_STAGING_PRESENT'));
  assert.equal(receipt(await sourceRef()), oldReceipt);
  drop(); copyPrivateSnapshot(snapshotBytes, path);
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
  const injected = join(lab.root, 'injected-trigger.db'); copyPrivateSnapshot(snapshotBytes, injected);
  const injectedDb = await MemoryDatabase.open(injected);
  try {
    await injectedDb.transaction(async () => { await injectedDb.exec('CREATE TRIGGER unexpected_fs_trigger AFTER INSERT ON fs_config BEGIN DELETE FROM kv_store; END'); })();
    await injectedDb.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    await injectedDb.prepare('PRAGMA journal_mode=DELETE').get();
  } finally { await injectedDb.close(); }
  await assert.rejects(store.planContextStoreRestore({ path, scope: 'project', input: injected }), /MEMORY_CONTEXT_DAMAGED/, 'restore must reject unexpected triggers outside the KV table too');
  assert.notEqual(run(['restore', ...args, '--input', backup, '--apply', '--confirm', '0'.repeat(64)]).status, 0);
  assert.equal(existsSync(path), false);
  const oversized = join(lab.root, 'oversized.db'); writeFileSync(oversized, '', { mode: 0o600 }); hardenPrivatePath(oversized); truncateSync(oversized, 512 * 1024 * 1024 + 1);
  await assert.rejects(store.planContextStoreRestore({ path, scope: 'project', input: oversized }));
  const corrupt = join(lab.root, 'corrupt.db'); const bad = Buffer.from(snapshotBytes); bad[100] ^= 0xff; writeFileSync(corrupt, bad, { mode: 0o600 }); hardenPrivatePath(corrupt);
  await assert.rejects(store.planContextStoreRestore({ path, scope: 'project', input: corrupt }));
  assert.equal(existsSync(path), false);
  const swapped = Buffer.from(snapshotBytes); swapped[swapped.length - 1] ^= 0xff;
  const writeSnapshot = bytes => {
    assert.equal(fs.fstatSync(snapshotDescriptor).isFile(), true);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.writeSync(snapshotDescriptor, bytes, offset, bytes.length - offset, offset);
      assert.ok(count > 0); offset += count;
    }
  };
  try {
    writeSnapshot(swapped);
    await assert.rejects(store.applyContextStoreRestore({ path, scope: 'project', input: backup, confirm: restorePlan.digest }));
    assert.equal(existsSync(path), false, 'a changed snapshot must not satisfy an old plan');
  } finally { writeSnapshot(snapshotBytes); }
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
    assert.equal(existsSync(path), false); assert.deepEqual(readSnapshotBytes(), snapshotBytes);
  }
  const publish = fs.linkSync;
  try {
    fs.linkSync = () => { throw new Error('FIXTURE_PUBLICATION_FAILURE'); }; syncBuiltinESMExports();
    await assert.rejects(store.applyContextStoreRestore({ path, scope: 'project', input: backup, confirm: restorePlan.digest }), /FIXTURE_PUBLICATION_FAILURE/);
  } finally { fs.linkSync = publish; syncBuiltinESMExports(); }
  assert.equal(existsSync(path), false); assert.deepEqual(readSnapshotBytes(), snapshotBytes);
  const nativeFsync = fs.fsyncSync;
  try {
    fs.fsyncSync = () => { throw Error('FIXTURE_STAGE_SYNC_FAILURE'); }; syncBuiltinESMExports();
    await assert.rejects(store.applyContextStoreRestore({ path, scope: 'project', input: backup, confirm: restorePlan.digest }), /FIXTURE_STAGE_SYNC_FAILURE/);
  } finally { fs.fsyncSync = nativeFsync; syncBuiltinESMExports(); }
  assert.equal(existsSync(path), false, 'a failed explicit stage sync must precede publication');
  let auxiliaryRaced = false;
  try {
    fs.fsyncSync = function(descriptor) {
      if (!auxiliaryRaced && fs.fstatSync(descriptor).isFile()) {
        auxiliaryRaced = true;
        writeFileSync(path + '-shm', 'RACING_AUXILIARY', { flag: 'wx', mode: 0o600 }); hardenPrivatePath(path + '-shm');
      }
      return nativeFsync(descriptor);
    }; syncBuiltinESMExports();
    await assert.rejects(store.applyContextStoreRestore({ path, scope: 'project', input: backup, confirm: restorePlan.digest }), { code: 'MEMORY_AUXILIARY_PRESENT' });
  } finally { fs.fsyncSync = nativeFsync; syncBuiltinESMExports(); }
  assert.equal(auxiliaryRaced, true);
  assert.equal(existsSync(path), false, 'publication must recheck auxiliary names after staging');
  assert.equal(readFileSync(path + '-shm', 'utf8'), 'RACING_AUXILIARY');
  rmSync(path + '-shm');
  const nativeUnlink = fs.unlinkSync, nativeRemove = fs.rmSync;
  for (const failure of process.platform === 'win32' ? ['unlink', 'stage-cleanup'] : ['directory-sync', 'unlink', 'stage-cleanup']) {
    let linked = false, stagedSource;
    try {
      fs.linkSync = function(source, target) {
        const result = originalLink(source, target);
        if (target === path) { linked = true; stagedSource = source; }
        return result;
      };
      fs.fsyncSync = function(descriptor) {
        if (failure === 'directory-sync' && fs.fstatSync(descriptor).isDirectory()) {
          if (linked) throw Object.assign(Error('FIXTURE_AFTER_LINK_SYNC'), { code: 'EIO' });
          return; // Exercise the supported-directory branch even on filesystems without it.
        }
        return nativeFsync(descriptor);
      };
      fs.unlinkSync = function(file) {
        if (failure === 'unlink' && file === stagedSource) throw Error('FIXTURE_AFTER_LINK_UNLINK');
        return nativeUnlink(file);
      };
      fs.rmSync = function(file, options) {
        if (failure === 'stage-cleanup' && stagedSource && file === dirname(stagedSource)) throw Error('FIXTURE_AFTER_LINK_CLEANUP');
        return nativeRemove(file, options);
      }; syncBuiltinESMExports();
      await assert.rejects(store.applyContextStoreRestore({ path, scope: 'project', input: backup, confirm: restorePlan.digest }), { code: 'MEMORY_PUBLICATION_UNCERTAIN' });
    } finally {
      fs.linkSync = originalLink; fs.fsyncSync = nativeFsync; fs.unlinkSync = nativeUnlink; fs.rmSync = nativeRemove; syncBuiltinESMExports();
    }
    assert.equal(existsSync(path), true, 'post-publication errors must not remove a complete object');
    assert.notEqual((await sourceRef()).restore_epoch, oldRef.restore_epoch, 'even uncertain publication exposes only the renewed epoch');
    assert.deepEqual(readSnapshotBytes(), snapshotBytes);
    if (failure === 'stage-cleanup') {
      assert.ok(store.memoryAdministrationIssues(dirname(path)).includes('MEMORY_STAGING_PRESENT'));
      assert.equal(dirname(dirname(stagedSource)), dirname(path));
      assert.match(basename(dirname(stagedSource)), /^\.cairn-memory-restore-[A-Za-z0-9]+$/);
      rmSync(dirname(stagedSource), { recursive: true, force: true });
    }
    drop();
  }
  try {
    fs.linkSync = function(source, target) {
      if (target === path) { writeFileSync(target, 'COMPETING_RESTORE', { flag: 'wx', mode: 0o600 }); hardenPrivatePath(target); }
      return originalLink(source, target);
    }; syncBuiltinESMExports();
    await assert.rejects(store.applyContextStoreRestore({ path, scope: 'project', input: backup, confirm: restorePlan.digest }), { code: 'EEXIST' });
  } finally { fs.linkSync = originalLink; syncBuiltinESMExports(); }
  assert.equal(readFileSync(path, 'utf8'), 'COMPETING_RESTORE', 'restore cannot replace a racing winner');
  assert.deepEqual(readSnapshotBytes(), snapshotBytes);
  drop();
  assert.equal(run(['restore', ...args, '--input', backup, '--apply', '--confirm', restorePlan.digest]).status, 0);
  const restored = await sourceRef();
  assert.equal(restored.store_uuid, oldRef.store_uuid); assert.equal(restored.generation, oldRef.generation);
  assert.equal(restored.content_digest, oldRef.content_digest); assert.notEqual(restored.restore_epoch, oldRef.restore_epoch);
  assert.notEqual(receipt(restored), oldReceipt, 'managed restore must invalidate old receipts with the same signing key');
  const restoredBytes = readFileSync(path);
  assert.notEqual(run(['restore', ...args, '--input', backup, '--apply', '--confirm', restorePlan.digest]).status, 0);
  assert.deepEqual(readFileSync(path), restoredBytes);
  assert.deepEqual(readSnapshotBytes(), snapshotBytes, 'restore must never modify the input snapshot');
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
  const target = join(base, 'project.db'); copyPrivateSnapshot(snapshotBytes, target);
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
} finally { if (snapshotDescriptor !== undefined) fs.closeSync(snapshotDescriptor); await lab.close(); }
