import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import { createContinuityLab } from './memory-continuity-lab.mjs';
import * as ordinary from '../dist/ordinary-memory-store.js';
import * as connections from '../dist/memory-connections.js';
import * as freshness from '../dist/memory-context-store.js';
import { MemoryDatabase } from '../dist/memory-database.js';
import { hardenPrivatePath } from '../dist/platform-security.js';

const feature = await import('../dist/memory-map.js').catch(() => null);
assert.ok(feature?.buildMemoryMap, 'MAP_RED: bounded ordinary-memory maps are missing');
process.umask(0o077);
let networkAttempts = 0;
const denyNetwork = () => { networkAttempts++; throw new Error('MAP_NETWORK_FORBIDDEN'); };
const originalFetch = globalThis.fetch, originalConnect = net.Socket.prototype.connect, originalTls = tls.connect;
globalThis.fetch = denyNetwork; net.Socket.prototype.connect = denyNetwork; tls.connect = denyNetwork;
const lab = createContinuityLab();
const target = { path: join(lab.projects.alpha, '.agentfs', 'project.db'), scope: 'project' };
const cache = join(lab.projects.alpha, '.agentfs', '.memory-map-cache');
const map = options => feature.buildMemoryMap([target], options);
const bytes = payload => Buffer.byteLength(JSON.stringify(feature.memoryMapResponse(payload)));
const entries = payload => payload.partitions.flatMap(partition => partition.entries);
async function mutate(action) {
  const agent = await ordinary.openOrdinaryMemoryStore(target.path, target.scope);
  try { return await action(agent); } finally { await agent.close(); }
}
async function curate(input) {
  const options = { ...target, input }, plan = await connections.planMemoryEntityChange(options);
  return connections.applyMemoryEntityChange({ ...options, confirm: plan.digest });
}
try {
  const missing = await map(); assert.deepEqual(entries(missing), []);
  assert.equal(existsSync(target.path), false); assert.equal(existsSync(cache), false);
  await assert.rejects(map({ max_bytes: 8193 }), /MEMORY_MAP_INVALID/);
  await assert.rejects(map({ limit: 51 }), /MEMORY_MAP_INVALID/);
  const plan = await ordinary.planContextStoreInit(target);
  await ordinary.applyContextStoreInit({ ...target, confirm: plan.digest });
  await mutate(async agent => {
    for (const [key, value] of [['devices/sensor', 'private sensor text'], ['devices/router', 'router text'], ['routes/current', 'tunnel text'],
      ['__history__/devices/old', 'hidden archive'], ['__reviewed__/audit', 'hidden provenance']]) await agent.kv.set(key, value);
  });
  const before = readFileSync(target.path);
  const cold = await map(), warm = await map();
  assert.deepEqual(warm, cold); assert.ok(bytes(cold) <= 4096);
  assert.equal(cold.exact_reads_required, true);
  assert.equal(JSON.stringify(cold).includes('private sensor text'), false);
  assert.equal(JSON.stringify(cold).includes('__history__'), false);
  assert.equal(JSON.stringify(cold).includes('__reviewed__'), false);
  assert.equal(entries(cold).find(row => row.prefix === 'devices').count, 2);
  assert.ok(entries(cold).every(row => row.navigation.every(item => item.source.generation === 1)));
  assert.deepEqual(readFileSync(target.path), before, 'map must not modify authoritative data');
  const files = readdirSync(cache).filter(name => name.endsWith('.json'));
  assert.equal(files.length, 1);
  const cacheFile = join(cache, files[0]);
  writeFileSync(cacheFile, '{'); assert.deepEqual(await map(), cold, 'corrupt cache must rebuild');
  const forged = JSON.parse(readFileSync(cacheFile));
  forged.payload.partitions[0].entries[0].prefix = 'foreign-project-secret';
  writeFileSync(cacheFile, JSON.stringify(forged));
  assert.deepEqual(await map(), cold, 'cache membership or valid structure cannot grant authority');
  const held = cache + '-held'; renameSync(cache, held);
  {
    symlinkSync(held, cache, process.platform === 'win32' ? 'junction' : 'dir');
    const heldBytes = readFileSync(join(held, files[0]));
    assert.deepEqual(await map(), cold, 'unsafe cache must degrade to uncached observation');
    assert.deepEqual(readFileSync(join(held, files[0])), heldBytes, 'never write through a cache symlink');
    // Restore only the symlink this disposable test created.
    const { unlinkSync } = await import('node:fs'); unlinkSync(cache);
  }
  renameSync(held, cache);
  const key = 'devices/sensor';
  const options = { ...target, key, input: { schema_version: 1, source_refs: [], verified_at: '2026-01-01T00:00:00Z', review_after: '2026-02-01T00:00:00Z' } };
  const freshPlan = await freshness.planFreshnessChange(options);
  await freshness.applyFreshnessChange({ ...options, confirm: freshPlan.digest });
  const reviewed = await map({ now: () => new Date('2026-03-01T00:00:00Z') });
  assert.equal(entries(reviewed).find(row => row.prefix === 'devices').freshness.needs_review, 1);
  const id = randomUUID(), other = randomUUID();
  const entity = { schema_version: 1, id, title: 'Sensor', aliases: ['shared-name'], anchor_key: key, claims: [] };
  await curate(entity);
  await curate({ ...entity, id: other, title: 'Router', anchor_key: 'devices/router' });
  const graphMap = await map({ max_bytes: 8192 });
  assert.equal(entries(graphMap).filter(row => row.kind === 'entity' && row.ambiguous).length, 2);
  await curate({ ...entity, id: other, title: 'Router', aliases: [], anchor_key: 'devices/router' });
  await mutate(agent => agent.kv.set('oversized/source', 'x'.repeat(32769)));
  const incomplete = await map({ max_bytes: 8192 });
  assert.equal(incomplete.truncated, true);
  assert.equal(entries(incomplete).find(row => row.id === other).ambiguous, null, 'partial scans cannot claim an alias is unique');
  await mutate(agent => agent.kv.delete('oversized/source'));
  await mutate(agent => agent.kv.set(key, 'replacement text'));
  assert.equal(entries(await map({ max_bytes: 8192 })).some(row => row.id === id), false, 'stale anchor cannot remain active');
  await mutate(agent => agent.kv.set(key, 'private sensor text'));
  assert.equal(entries(await map({ max_bytes: 8192 })).some(row => row.id === id), false, 'A→B→A cannot revive cached entities');
  // A separate physical store has independent identity, even with equal keys.
  const beta = { scope: 'project', path: join(lab.projects.beta, '.agentfs', 'project.db') };
  const betaPlan = await ordinary.planContextStoreInit(beta);
  await ordinary.applyContextStoreInit({ ...beta, confirm: betaPlan.digest });
  const agent = await ordinary.openOrdinaryMemoryStore(beta.path, beta.scope);
  try { await agent.kv.set('other/navigation', 'other project'); } finally { await agent.close(); }
  const separate = await feature.buildMemoryMap([target, beta], { max_bytes: 8192 });
  assert.equal(separate.partitions.length, 2);
  assert.ok(separate.partitions[0].entries.every(row => row.prefix !== 'other'));
  assert.ok(bytes(separate) <= 8192);
  const betaCache = join(lab.projects.beta, '.agentfs', '.memory-map-cache');
  const betaFile = join(betaCache, readdirSync(betaCache).find(name => name.endsWith('.json')));
  writeFileSync(cacheFile, readFileSync(betaFile));
  assert.equal(JSON.stringify(await map()).includes('other/navigation'), false, 'foreign cache never crosses owner boundary');
  // Real managed restore renews epoch; old entity/cache evidence stays inactive.
  const snapshot = join(lab.root, 'map-snapshot.db'), original = join(lab.root, 'map-original.db');
  await curate(entity);
  const previous = await map({ max_bytes: 8192 });
  const epoch = entries(previous).find(row => row.id === id).navigation[0].source.restore_epoch;
  await ordinary.backupMemoryContextStore({ ...target, output: snapshot });
  for (const suffix of ['', '-wal', '-shm', '-journal']) if (existsSync(target.path + suffix)) renameSync(target.path + suffix, original + suffix);
  const restore = await ordinary.planContextStoreRestore({ ...target, input: snapshot });
  await ordinary.applyContextStoreRestore({ ...target, input: snapshot, confirm: restore.digest });
  const restored = await map({ max_bytes: 8192 });
  assert.equal(entries(restored).some(row => row.id === id), false);
  assert.notEqual(entries(restored)[0].navigation[0].source.restore_epoch, epoch);
  const close = MemoryDatabase.prototype.close; let race = true;
  try {
    MemoryDatabase.prototype.close = async function() {
      await close.call(this);
      if (race && this.name === target.path) { race = false; await mutate(agent => agent.kv.set(key, 'concurrent replacement')); }
    };
    const changed = await map();
    assert.equal(changed.truncated, true); assert.deepEqual(entries(changed), [], 'concurrent snapshots cannot mix navigation and newer provenance');
  } finally { MemoryDatabase.prototype.close = close; }
  // Bound scans, UTF-8/escaping, huge values and single oversized navigation.
  await mutate(async agent => {
    await agent.getDatabase().exec('DELETE FROM kv_store');
    await agent.kv.set('界'.repeat(1300), 'short value');
  });
  const oversized = await map(); assert.equal(oversized.truncated, true); assert.deepEqual(entries(oversized), []);
  await mutate(async agent => {
    await agent.getDatabase().exec('DELETE FROM kv_store');
    await agent.getDatabase().exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<5010)
      INSERT INTO kv_store(key,value,created_at,updated_at) SELECT printf('group%05d/key',n),'"value"',1,1 FROM seq`);
  });
  const huge = await map({ max_bytes: 8192 });
  assert.equal(huge.truncated, true); assert.ok(entries(huge).length <= 50); assert.ok(bytes(huge) <= 8192);
  assert.deepEqual(await map({ max_bytes: 8192 }), huge, 'stable ties/order across cache reads');
  const globallyBounded = await feature.buildMemoryMap([target, beta], { max_bytes: 8192 });
  assert.equal(globallyBounded.partitions.length, 1, 'all scopes share one scan budget, not 5000 rows per store');
  assert.equal(globallyBounded.truncated, true);
  // Legacy rows are read without SDK schema initialization or reliable revisions.
  const legacy = await lab.connect('neutral');
  await legacy.call('memory_write', { scope: 'project', key: 'legacy/anchor', value: 'legacy text' }); await legacy.close();
  const legacyPath = join(lab.projects.neutral, '.agentfs', 'project.db');
  // The legacy SDK inherits Windows ACLs; the read-only observer correctly
  // requires explicitly private fixture files. Do not weaken runtime admission.
  hardenPrivatePath(join(lab.projects.neutral, '.agentfs')); hardenPrivatePath(legacyPath);
  const legacyBefore = readFileSync(legacyPath);
  await assert.rejects(async () => {
    const view = await ordinary.openOrdinaryMemoryView(legacyPath, 'project', 'context-v1');
    await view?.close();
  }, /MEMORY_FILE_CHANGED/, 'a tracked-only observer must not fall through to SDK legacy initialization after substitution');
  const untracked = await feature.buildMemoryMap([{ path: legacyPath, scope: 'project' }]);
  assert.equal(untracked.partitions[0].tracked, false);
  assert.equal(entries(untracked)[0].navigation[0].status, 'untracked');
  assert.equal(entries(untracked)[0].navigation[0].source, null);
  assert.deepEqual(readFileSync(legacyPath), legacyBefore);
  const { readLegacyMemoryMapKeys } = await import('../dist/memory-legacy-inspection.js');
  const limitedLegacy = await readLegacyMemoryMapKeys(legacyPath, { rows: 1, bytes: 1 });
  assert.deepEqual(limitedLegacy.keys, []);
  assert.equal(limitedLegacy.bytes, 0, 'legacy SQL must suppress a key that cannot fit before driver decoding');
  assert.ok(limitedLegacy.scanned <= 1); assert.equal(limitedLegacy.truncated, true);
  assert.equal(existsSync(lab.env.CAIRN_PACK_BASE_DIR), false, 'ordinary maps must not open or initialize pack storage');
  lab.assertOffline();
  assert.equal(networkAttempts, 0, 'in-process map/curation paths must remain offline even when errors are caught');
  console.log('PASS: bounded deterministic maps, UTF-8 framing, live provenance/freshness, ABA/restore, cache isolation and untracked legacy navigation');
} finally { globalThis.fetch = originalFetch; net.Socket.prototype.connect = originalConnect; tls.connect = originalTls; await lab.close(); }
