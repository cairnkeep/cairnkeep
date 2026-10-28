#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { probeOrdinaryMemoryFormat, inspectMemoryDatabaseFile, inspectMemoryDatabaseMetadata } from '../dist/memory-store-format.js';
import { canonicalMemoryPath, planContextStoreInit, memoryAdministrationIssues, withMemoryAdmission } from '../dist/ordinary-memory-store.js';
import { CONTEXT_APPLICATION_ID } from '../dist/memory-context-schema.js';
import { hardenPrivatePath } from '../dist/platform-security.js';

const root = fs.realpathSync.native(fs.mkdtempSync(join(tmpdir(), 'cairn-memory-files-')));
hardenPrivatePath(root);
try {
  const source = join(root, 'header.db'), header = Buffer.alloc(100);
  header.write('SQLite format 3\0', 0, 'ascii'); header.writeUInt32BE(CONTEXT_APPLICATION_ID, 68);
  fs.writeFileSync(source, header, { mode: 0o600 }); hardenPrivatePath(source);
  fs.truncateSync(source, 512 * 1024 * 1024 + 1);
  const originalRead = fs.readSync;
  let readBytes = 0;
  try {
    fs.readSync = function(descriptor, bytes, offset, length, position) {
      assert.ok(length <= 100, 'format probing must not allocate/read an entire database');
      const count = originalRead(descriptor, bytes, offset, length, position); readBytes += count; return count;
    }; syncBuiltinESMExports();
    // Header dispatch is not schema/integrity admission; the body is deliberately invalid.
    assert.equal(probeOrdinaryMemoryFormat(source).kind, 'context-v1');
    assert.equal(readBytes, 100);
  } finally { fs.readSync = originalRead; syncBuiltinESMExports(); }
  assert.equal(probeOrdinaryMemoryFormat(join(root, 'absent.db')).kind, 'missing');
  const malformed = join(root, 'malformed.db');
  fs.writeFileSync(malformed, 'not a database', { mode: 0o600 });
  assert.equal(probeOrdinaryMemoryFormat(malformed).kind, 'unsupported');
  const link = join(root, 'linked.db'); fs.symlinkSync(source, link, 'file');
  for (const inspect of [probeOrdinaryMemoryFormat, inspectMemoryDatabaseFile, inspectMemoryDatabaseMetadata, canonicalMemoryPath]) {
    assert.throws(() => inspect(link), { code: 'MEMORY_FILE_UNSAFE' });
    assert.throws(() => inspect(root), { code: 'MEMORY_FILE_UNSAFE' });
  }
  const dangling = join(root, 'dangling.db'); fs.symlinkSync(join(root, 'absent-target'), dangling, 'file');
  assert.throws(() => canonicalMemoryPath(dangling), { code: 'MEMORY_FILE_UNSAFE' });
  const orphan = join(root, 'orphan.db');
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const sidecar = orphan + suffix;
    fs.writeFileSync(sidecar, 'abandoned auxiliary bytes', { mode: 0o600 }); hardenPrivatePath(sidecar);
    try {
      await assert.rejects(planContextStoreInit({ path: orphan, scope: 'identity' }), { code: 'MEMORY_AUXILIARY_PRESENT' });
      assert.ok(memoryAdministrationIssues(root).includes('MEMORY_AUXILIARY_PRESENT'));
      assert.equal(fs.existsSync(orphan), false);
      assert.equal(fs.readFileSync(sidecar, 'utf8'), 'abandoned auxiliary bytes');
    } finally { fs.unlinkSync(sidecar); }
  }
  const leaseTarget = join(root, 'lease.db'), lease = leaseTarget + '.cairn-admission';
  const originalUnlink = fs.unlinkSync;
  try {
    fs.unlinkSync = function(file) {
      if (dirname(file) === lease) throw Object.assign(Error('FIXTURE_LEASE_RELEASE'), { code: 'EACCES' });
      return originalUnlink(file);
    }; syncBuiltinESMExports();
    assert.equal(await withMemoryAdmission(leaseTarget, async () => 'completed'), 'completed', 'release failures must not discard a completed operation result or returned connection');
  } finally { fs.unlinkSync = originalUnlink; syncBuiltinESMExports(); }
  assert.ok(memoryAdministrationIssues(root).includes('MEMORY_ADMISSION_PRESENT'));
  fs.rmSync(lease, { recursive: true, force: true });
  if (process.platform !== 'win32') {
    const fifo = join(root, 'pipe.db');
    const made = spawnSync('mkfifo', [fifo], { encoding: 'utf8', timeout: 5000 });
    assert.equal(made.status, 0, made.stderr);
    const bounded = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      const { probeOrdinaryMemoryFormat } = await import(process.argv[1]);
      assert.throws(() => probeOrdinaryMemoryFormat(process.argv[2]), {code:'MEMORY_FILE_UNSAFE'});
    `, new URL('../dist/memory-store-format.js', import.meta.url).href, fifo], { encoding: 'utf8', timeout: 5000 });
    assert.equal(bounded.error, undefined, 'FIFO inspection must not block awaiting a writer');
    assert.equal(bounded.status, 0, bounded.stderr);
    assert.throws(() => probeOrdinaryMemoryFormat('/dev/null'), { code: 'MEMORY_FILE_UNSAFE' });
  }
  console.log('PASS: fixed header read, malformed/missing files, native links and bounded special-file refusal');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
