#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, copyFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createContinuityLab } from './memory-continuity-lab.mjs';
import { createTar } from '../../scripts/windows-platform.mjs';

const lab = createContinuityLab();
const cli = new URL('../../bin/cairn', import.meta.url).pathname;
const path = join(lab.projects.alpha, '.agentfs', 'project.db');
const backup = join(lab.root, 'snapshot.db');
const run = args => spawnSync(process.execPath, [cli, 'memory-context', ...args], { cwd: lab.projects.alpha, env: lab.env, encoding: 'utf8', timeout: 30_000 });
const args = ['--scope', 'project', '--project', lab.projects.alpha, '--json'];
const drop = () => { for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true }); };
try {
  const plan = JSON.parse(run(['init', ...args]).stdout);
  assert.equal(run(['init', ...args, '--apply', '--confirm', plan.digest]).status, 0);
  const store = await import('../dist/ordinary-memory-store.js');
  const { MemoryDatabase } = await import('../dist/memory-database.js');
  const { readMemorySourceRef } = await import('../dist/memory-store-format.js');
  const writer = await store.openOrdinaryMemoryStore(path, 'project');
  await writer.kv.set('decisions/fixture', 'append-only'); await writer.close();
  const sourceRef = async () => {
    const db = await MemoryDatabase.open(path, { readOnly: true });
    try { return await readMemorySourceRef(db, store.memoryStoreIdentity(path, 'project'), 'decisions/fixture'); }
    finally { await db.close(); }
  };
  const oldRef = await sourceRef();
  const receiptKey = Buffer.from('disposable-receipt-fixture-key');
  const receipt = value => createHmac('sha256', receiptKey).update(JSON.stringify(value)).digest('hex');
  const oldReceipt = receipt(oldRef);
  const backed = run(['backup', ...args, '--output', backup]);
  assert.equal(backed.status, 0, 'managed online backup must be a supported operation');
  assert.equal(existsSync(backup), true);
  const snapshotBytes = readFileSync(backup);
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
  assert.notEqual(run(['restore', ...args, '--input', backup, '--apply', '--confirm', '0'.repeat(64)]).status, 0);
  assert.equal(existsSync(path), false);
  assert.equal(run(['restore', ...args, '--input', backup, '--apply', '--confirm', restorePlan.digest]).status, 0);
  const restored = await sourceRef();
  assert.equal(restored.store_uuid, oldRef.store_uuid); assert.equal(restored.generation, oldRef.generation);
  assert.equal(restored.content_digest, oldRef.content_digest); assert.notEqual(restored.restore_epoch, oldRef.restore_epoch);
  assert.notEqual(receipt(restored), oldReceipt, 'managed restore must invalidate old receipts with the same signing key');
  const restoredBytes = readFileSync(path);
  assert.notEqual(run(['restore', ...args, '--input', backup, '--apply', '--confirm', restorePlan.digest]).status, 0);
  assert.deepEqual(readFileSync(path), restoredBytes);
  assert.deepEqual(readFileSync(backup), snapshotBytes, 'restore must never modify the input snapshot');
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
  lab.assertOffline();
  console.log('PASS: online backup, fresh managed restore, epoch receipt boundary and all-member generic import refusal');
} finally { await lab.close(); }
