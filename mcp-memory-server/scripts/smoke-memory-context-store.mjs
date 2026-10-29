import assert from 'node:assert/strict';
import childProcess, { spawnSync } from 'node:child_process';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readFileSync, writeFileSync, copyFileSync, unlinkSync, existsSync } from 'node:fs';
import { createContinuityLab } from './memory-continuity-lab.mjs';
import { hardenPrivatePath } from '../dist/platform-security.js';
import * as ordinary from '../dist/ordinary-memory-store.js';
import { AgentFS } from 'agentfs-sdk';
import { MemoryDatabase } from '../dist/memory-database.js';

// Missing feature is an explicit RED, not an accidental import failure.
const feature = await import('../dist/memory-context-store.js').catch(() => null);
assert.ok(feature?.planFreshnessChange, 'FRESHNESS_RED: revision-bound curation is missing');
const { planFreshnessChange, applyFreshnessChange, inspectMemoryFreshness } = feature;
const lab = createContinuityLab();
const path = join(lab.projects.alpha, '.agentfs', 'project.db');
const options = { path, scope: 'project', key: 'facts/device' };
const now = () => new Date('2026-01-10T12:00:00.000Z');
const input = { schema_version: 1, source_refs: ['opaque:fixture'], verified_at: '2026-01-09T00:00:00.000Z', review_after: '2026-01-11T00:00:00.000Z' };
const plan = (value = input, target = options) => planFreshnessChange({ ...target, input: value, now });
const apply = (value, target = options) => applyFreshnessChange({ ...target, input: value.metadata, confirm: value.digest, now });
const inspect = (target = options, clock = now) => inspectMemoryFreshness({ ...target, now: clock });
const mutate = async operation => {
  const agent = await ordinary.openOrdinaryMemoryStore(path, 'project');
  try { return await operation(agent); } finally { await agent.close(); }
};
const tables = async () => {
  const view = await ordinary.openOrdinaryMemoryView(path, 'project');
  try { return await view.getDatabase().prepare("SELECT name FROM sqlite_master WHERE name LIKE 'cairn_memory_context_%' ORDER BY name").all(); }
  finally { await view.close(); }
};
try {
  const empty = join(lab.root, 'empty-legacy.db');
  writeFileSync(empty, '', { mode: 0o600, flag: 'wx' }); hardenPrivatePath(empty);
  assert.equal(await feature.inspectMemoryCandidate({ ...options, path: empty }), null);
  assert.equal(readFileSync(empty).length, 0, 'inspection must not initialize an empty legacy file');
  const minimal = join(lab.root, 'minimal-legacy.db');
  const minimalDb = await MemoryDatabase.open(minimal, { create: true });
  await minimalDb.exec('CREATE TABLE kv_store(key TEXT PRIMARY KEY,value TEXT)');
  await minimalDb.prepare('INSERT INTO kv_store VALUES(?,?)').run(options.key, JSON.stringify('minimal legacy'));
  await minimalDb.close();
  const minimalBefore = readFileSync(minimal);
  assert.equal((await feature.inspectMemoryCandidate({ ...options, path: minimal })).value, 'minimal legacy');
  const minimalView = await MemoryDatabase.open(minimal, { readOnly: true });
  try {
    assert.deepEqual((await minimalView.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()).map(row => row.name), ['kv_store'], 'inspection must not initialize SDK tables, including in WAL');
  } finally { await minimalView.close(); }
  assert.deepEqual(readFileSync(minimal), minimalBefore);
  const observer = fileURLToPath(new URL('../dist/memory-legacy-inspection.js', import.meta.url));
  for (const malformed of ['{', ' '.repeat(65537)]) {
    const response = spawnSync(process.execPath, [observer], { input: malformed, encoding: 'utf8', timeout: 30000 });
    assert.equal(response.status, 0, response.stderr);
    assert.equal(JSON.parse(response.stdout).ok, false);
    assert.ok(Buffer.byteLength(response.stdout) <= 65536);
  }
  const execFile = childProcess.execFile;
  try {
    for (const fault of ['process.exit(7)', 'process.stdout.write("null")', 'process.stdout.write("x".repeat(70000))', 'setInterval(()=>{},1000)']) {
      childProcess.execFile = (program, args, settings, callback) => {
        assert.equal(settings.timeout, 30000); assert.equal(settings.maxBuffer, 65536);
        assert.equal(settings.killSignal, 'SIGKILL'); assert.ok(args.includes('--max-old-space-size=128'));
        return execFile(program, ['-e', fault], { ...settings, timeout: fault.startsWith('setInterval') ? 100 : settings.timeout }, callback);
      };
      syncBuiltinESMExports();
      await assert.rejects(feature.inspectMemoryCandidate({ ...options, path: empty }), /MEMORY_LEGACY_INSPECTION_FAILED/);
      assert.equal(readFileSync(empty).length, 0, 'failed child must not initialize or change the legacy store');
      assert.equal(existsSync(`${empty}.cairn-admission`), false, 'failed child must release its owned admission lease');
    }
  } finally { childProcess.execFile = execFile; syncBuiltinESMExports(); }
  await assert.rejects(feature.inspectMemoryCandidates('\u0000'.repeat(4096), []), /MEMORY_INSPECTION_LIMIT/);
  await assert.rejects(feature.inspectMemoryCandidates('\u0000'.repeat(4096), [{ path: '\u0000invalid-path', scope: 'project' }]), /MEMORY_INSPECTION_LIMIT/, 'oversized framing must refuse before even probing a store');
  const init = await ordinary.planContextStoreInit(options);
  await ordinary.applyContextStoreInit({ ...options, confirm: init.digest });
  await mutate(agent => agent.kv.set(options.key, 'A'));
  const before = readFileSync(path), initialTables = await tables();
  assert.equal((await inspect()).status, 'unknown');
  const first = await plan();
  assert.deepEqual(readFileSync(path), before, 'plan/read must not change durable bytes');
  assert.deepEqual(await tables(), initialTables, 'plan/read must not install assertion tables');
  await assert.rejects(apply({ ...first, digest: '0'.repeat(64) }), /MEMORY_FRESHNESS_STALE_PLAN/);
  for (const invalid of [
    { ...input, surprise: true }, { ...input, schema_version: 2 },
    { ...input, source_refs: Array(9).fill('x') }, { ...input, source_refs: ['界'.repeat(171)] },
    { ...input, verified_at: '2026-01-11T00:00:00.000Z' },
    { ...input, verified_at: '2026-02-30T00:00:00Z' }, { ...input, effective_at: 'yesterday' },
    { ...input, source_refs: ['x'.repeat(65537)] },
  ]) await assert.rejects(plan(invalid), /MEMORY_FRESHNESS_INVALID/);
  for (const key of ['__history__/hidden', '__reviewed__/hidden', '']) {
    await assert.rejects(plan(input, { ...options, key }));
  }
  const prepare = MemoryDatabase.prototype.prepare;
  try {
    MemoryDatabase.prototype.prepare = function(sql) {
      const statement = prepare.call(this, sql);
      if (sql.startsWith('INSERT INTO cairn_memory_context_facts_v1')) {
        return { ...statement, run: async () => { throw new Error('fixture-write-failure'); } };
      }
      return statement;
    };
    await assert.rejects(apply(first), /fixture-write-failure/);
  } finally { MemoryDatabase.prototype.prepare = prepare; }
  assert.deepEqual(await tables(), initialTables, 'failed apply must roll back table creation and revision bump');
  assert.deepEqual((await plan()).source, first.source);
  const applied = await apply(first);
  let current = await inspect();
  assert.equal(current.status, 'current'); assert.equal(current.stale, false);
  assert.equal(current.source.context_revision, first.source.context_revision + 1);
  assert.deepEqual(current.source, applied.source, 'own revision bump must not invalidate the assertion');
  assert.equal((await inspect(options, () => new Date('2026-01-12T00:00:00Z'))).status, 'needs_review');
  await mutate(agent => agent.kv.set('facts/unrelated', 'other'));
  const unrelated = await plan(input, { ...options, key: 'facts/unrelated' });
  await apply(unrelated, { ...options, key: 'facts/unrelated' });
  assert.equal((await inspect()).status, 'current', 'unrelated metadata must not invalidate this key');
  await assert.rejects(apply(first), /MEMORY_FRESHNESS_STALE_PLAN/);
  const competing = await plan();
  const contenders = await Promise.allSettled([apply(competing), apply(competing)]);
  assert.equal(contenders.filter(item => item.status === 'fulfilled').length, 1);
  // Native ACL admission can outlast a competing opener's bounded lease wait.
  // Both refusals are safe; require exactly one mutation and prove that the old
  // confirmation still fails after all admission contention has ended.
  assert.match(contenders.find(item => item.status === 'rejected').reason.message, /^MEMORY_(?:FRESHNESS_STALE_PLAN|ADMISSION_BUSY)$/);
  assert.equal((await inspect()).source.context_revision, competing.source.context_revision + 1);
  await assert.rejects(apply(competing), /MEMORY_FRESHNESS_STALE_PLAN/);
  const stale = await plan();
  await mutate(async agent => { await agent.kv.set(options.key, 'B'); await agent.kv.set(options.key, 'A'); });
  current = await inspect();
  assert.equal(current.stale, true); assert.equal(current.status, 'unknown');
  assert.equal(current.source.content_digest, first.source.content_digest);
  assert.ok(current.source.generation > first.source.generation);
  await assert.rejects(apply(stale), /MEMORY_FRESHNESS_STALE_PLAN/);
  await apply(await plan());
  const rollbackSource = (await inspect()).source;
  await mutate(async agent => {
    await assert.rejects(agent.getDatabase().transaction(async () => {
      await agent.kv.set(options.key, 'rolled back'); throw new Error('fixture-rollback');
    })(), /fixture-rollback/);
  });
  assert.deepEqual((await inspect()).source, rollbackSource); assert.equal((await inspect()).status, 'current');
  await mutate(async agent => { await agent.kv.delete(options.key); await agent.kv.set(options.key, 'A'); });
  assert.equal((await inspect()).stale, true);
  await apply(await plan({ schema_version: 1, source_refs: [], effective_at: '2026-02-01T00:00:00Z' }));
  current = await inspect(); assert.equal(current.status, 'unverified'); assert.equal(current.future_effective, true);

  // Existing high-level typed/import/review writers must invalidate assertions.
  const typed = await import('../dist/node-store.js');
  await mutate(async agent => {
    const prepared = await typed.planMemoryImport(agent, { schema_version: 1, scope: 'project', nodes: [
      { key: options.key, value: 'import replacement', node_type: 'knowledge', tags: [] },
    ], conflict_policy: 'supersede' });
    await typed.commitMemoryImport(agent, prepared);
  });
  assert.equal((await inspect()).stale, true);
  await apply(await plan());
  await mutate(agent => typed.supersedeTypedNode({ agent, scope: 'project', key: options.key, value: 'typed replacement' }));
  assert.equal((await inspect()).stale, true);
  await apply(await plan());
  const reviewed = await import('../dist/reviewed-memory-store.js');
  await reviewed.applyReviewedMemory('project', 'freshness-fixture', options.key, 'reviewed replacement', { cwd: lab.projects.alpha, typed: true });
  assert.equal((await inspect()).stale, true);
  await apply(await plan());

  const snapshot = join(lab.root, 'snapshot.db');
  await ordinary.backupMemoryContextStore({ path, scope: 'project', output: snapshot });
  const copied = join(lab.root, 'copied.db'); copyFileSync(snapshot, copied); hardenPrivatePath(copied);
  await assert.rejects(inspect({ ...options, path: copied }), /MEMORY_OWNER_MISMATCH/);
  const oldRef = (await inspect()).source;
  unlinkSync(path); // Dispose only this lab's closed DB; restore requires an absent destination.
  for (const suffix of ['-wal', '-shm', '-journal']) if (existsSync(path + suffix)) unlinkSync(path + suffix);
  const restore = await ordinary.planContextStoreRestore({ path, scope: 'project', input: snapshot });
  await ordinary.applyContextStoreRestore({ path, scope: 'project', input: snapshot, confirm: restore.digest });
  current = await inspect(); assert.equal(current.stale, true);
  assert.notEqual(current.source.restore_epoch, oldRef.restore_epoch);
  assert.deepEqual(current.metadata.source_refs, input.source_refs, 'backup retains asserted metadata, not current authority');

  const legacy = join(lab.root, 'legacy.db');
  const legacyAgent = await AgentFS.open({ id: 'legacy', path: legacy });
  await legacyAgent.kv.set(options.key, 'legacy'); await legacyAgent.close(); hardenPrivatePath(legacy);
  const legacyBefore = readFileSync(legacy);
  assert.equal((await inspect({ ...options, path: legacy })).tracked, false);
  await assert.rejects(plan(input, { ...options, path: legacy }), /MEMORY_FRESH_STORE_REQUIRED/);
  assert.deepEqual(readFileSync(legacy), legacyBefore);
  const driver = pathToFileURL(createRequire(import.meta.resolve('agentfs-sdk')).resolve('@tursodatabase/database')).href;
  const livePath = join(lab.root, 'live-legacy.db');
  const writeLegacy = value => spawnSync(process.execPath, ['--input-type=module', '-e', `
    const {Database}=await import(process.argv[1]);
    const db=new Database(process.argv[2],{fileMustExist:true,timeout:100});
    try { await db.connect(); await db.exec('BEGIN IMMEDIATE');
      await db.prepare('UPDATE kv_store SET value=? WHERE key=?').run(JSON.stringify(process.argv[3]),process.argv[4]);
      await db.exec('COMMIT'); console.log('written');
    } catch(error) { if (!/busy|locked/i.test(String(error))) throw error; console.error(String(error)); console.log('blocked'); }
    finally { await db.close(); }
  `, driver, livePath, value, options.key], { encoding: 'utf8', timeout: 30000 });
  const readLegacy = () => feature.inspectMemoryCandidate({ ...options, path: livePath });
  const privateMask = process.umask(0o077);
  let live;
  try {
    // Seed in another process: this SDK can retain its process-level file lease
    // while closed native objects remain reachable. Positive/negative controls
    // must not depend on garbage-collection timing.
    const seeded = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const {AgentFS}=await import(process.argv[1]); const agent=await AgentFS.open({path:process.argv[2]});
      await agent.kv.set(process.argv[3],'seed'); await agent.close();
    `, import.meta.resolve('agentfs-sdk'), livePath, options.key], { encoding: 'utf8', timeout: 30000 });
    assert.equal(seeded.status, 0, seeded.stderr); hardenPrivatePath(livePath);
    const write = writeLegacy('committed'); assert.equal(write.status, 0, write.stderr); assert.equal(write.stdout.trim(), 'written', write.stderr);
    assert.equal((await readLegacy()).value, 'committed');
    live = await ordinary.openOrdinaryMemoryStore(livePath, 'project');
    assert.equal(await live.kv.get(options.key), 'committed');
    await live.kv.set(options.key, 'committed'); // Readonly-first inspection must not poison later ordinary writes.
    await live.getDatabase().exec('BEGIN IMMEDIATE');
    try {
      await live.kv.set(options.key, 'uncommitted');
      assert.equal((await readLegacy()).value, 'committed', 'inspection must not see an active SDK writer\'s uncommitted WAL');
      const blocked = writeLegacy('must-not-write'); assert.equal(blocked.status, 0, blocked.stderr); assert.equal(blocked.stdout.trim(), 'blocked', 'inspection close must not release an active writer\'s lock');
    } finally { await live.getDatabase().exec('ROLLBACK'); }
    assert.equal(await live.kv.get(options.key), 'committed');
    await live.kv.set(options.key, 'after');
    assert.equal((await readLegacy()).value, 'after');
  } finally { await live?.close(); process.umask(privateMask); }
  await assert.rejects(inspect({ ...options, scope: 'identity' }), /MEMORY_OWNER_MISMATCH/);
  await mutate(agent => agent.getDatabase().exec('DROP TABLE cairn_memory_context_facts_v1'));
  await assert.rejects(inspect(), /MEMORY_CONTEXT_DAMAGED/);
  lab.assertOffline();
  console.log('PASS: strict no-write freshness plans, atomic revisions, ABA/rollback/import/review invalidation, restore isolation and legacy refusal');
} finally { await lab.close(); }
