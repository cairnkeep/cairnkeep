import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createContinuityLab } from './memory-continuity-lab.mjs';
import * as ordinary from '../dist/ordinary-memory-store.js';
import { planFreshnessChange, applyFreshnessChange, inspectMemoryFreshness } from '../dist/memory-context-store.js';
import { MemoryDatabase } from '../dist/memory-database.js';

const feature = await import('../dist/memory-connections.js').catch(() => null);
assert.ok(feature?.relatedMemoryContext, 'CONNECTIONS_RED: explicit evidence-backed connections are missing');
const lab = createContinuityLab();
const path = join(lab.projects.alpha, '.agentfs', 'project.db');
const target = { path, scope: 'project' };
const ids = Array.from({ length: 5 }, () => randomUUID());
const write = async (key, value) => {
  const agent = await ordinary.openOrdinaryMemoryStore(path, 'project');
  try { await agent.kv.set(key, value); } finally { await agent.close(); }
};
const entity = (id, anchor_key, title, aliases = [], claims = []) => ({ schema_version: 1, id, anchor_key, title, aliases, claims });
const link = (id, from, to, evidence_keys) => ({ schema_version: 1, id, from, to, predicate: 'uses', evidence_keys });
const curate = async (kind, input, operation = 'set') => {
  const options = { ...target, input, operation };
  const plan = await feature[kind === 'entity' ? 'planMemoryEntityChange' : 'planMemoryLinkChange'](options);
  return feature[kind === 'entity' ? 'applyMemoryEntityChange' : 'applyMemoryLinkChange']({ ...options, confirm: plan.digest });
};
const related = (entity, options = {}) => feature.relatedMemoryContext({ ...target, entity, ...options });
try {
  assert.deepEqual((await related('missing')).nodes, []);
  const initial = await ordinary.planContextStoreInit(target);
  await ordinary.applyContextStoreInit({ ...target, confirm: initial.digest });
  for (const [key, value] of [['devices/sensor', 'Sensor uses tunnel cobalt'], ['tunnels/cobalt', 'Tunnel uses gateway ember'],
    ['gateways/ember', 'Gateway endpoint'], ['facts/old', 'old route'], ['facts/current', 'current route']]) await write(key, value);
  const sensor = entity(ids[0], 'devices/sensor', 'Sensor', ['lumen', 'glimmer']);
  const tunnel = entity(ids[1], 'tunnels/cobalt', 'Tunnel', ['relay']);
  const gateway = entity(ids[2], 'gateways/ember', 'Gateway', ['relay']);
  const before = readFileSync(path);
  const planned = await feature.planMemoryEntityChange({ ...target, input: sensor });
  assert.deepEqual(readFileSync(path), before, 'curation plan must not write tables or data');
  const prepare = MemoryDatabase.prototype.prepare;
  try {
    MemoryDatabase.prototype.prepare = function(sql) {
      const statement = prepare.call(this, sql);
      return sql.startsWith('INSERT INTO cairn_memory_context_entities_v1')
        ? { ...statement, run: async () => { throw new Error('connection-write-fault'); } } : statement;
    };
    await assert.rejects(feature.applyMemoryEntityChange({ ...target, input: sensor, confirm: planned.digest }), /connection-write-fault/);
  } finally { MemoryDatabase.prototype.prepare = prepare; }
  const view = await ordinary.openOrdinaryMemoryView(path, 'project');
  try { assert.equal((await view.getDatabase().prepare("SELECT name FROM sqlite_master WHERE name IN ('cairn_memory_context_entities_v1','cairn_memory_context_links_v1')").all()).length, 0, 'failed first curation must roll back both graph tables'); }
  finally { await view.close(); }
  await feature.applyMemoryEntityChange({ ...target, input: sensor, confirm: planned.digest });
  await assert.rejects(feature.applyMemoryEntityChange({ ...target, input: sensor, confirm: planned.digest }), /MEMORY_CONNECTION_STALE_PLAN/);
  await curate('entity', tunnel); await curate('entity', gateway);
  const firstLink = link(ids[3], ids[0], ids[1], ['devices/sensor']);
  const secondLink = link(ids[4], ids[1], ids[2], ['tunnels/cobalt', 'gateways/ember']);
  await curate('link', firstLink); await curate('link', secondLink);
  assert.equal((await related('lumen')).nodes.length, 2);
  assert.equal((await related('glimmer', { depth: 2 })).nodes.length, 3);
  assert.equal((await related(ids[2], { direction: 'inbound', depth: 2 })).nodes.length, 3);
  const ambiguous = await related('relay', { depth: 2 });
  assert.equal(ambiguous.ambiguous, true); assert.equal(ambiguous.matches.length, 2); assert.equal(ambiguous.edges.length, 0);
  assert.equal((await related('unknown')).nodes.length, 0);
  for (const bad of [{ ...sensor, extra: true }, { ...sensor, id: 'guessed-id' }, { ...sensor, anchor_key: '__history__/hidden' },
    { ...sensor, aliases: ['x'.repeat(513)] }, { ...sensor, claims: Array(17).fill({ key: 'facts/old', attribute: 'route', value: 'old' }) }]) {
    await assert.rejects(feature.planMemoryEntityChange({ ...target, input: bad }));
  }
  for (const options of [{ depth: 3 }, { limit: 51 }, { entity: 'x'.repeat(513) }, { direction: 'sideways' }]) {
    await assert.rejects(related(ids[0], options));
  }
  const longKey = 'facts/' + 'k'.repeat(3494);
  await write(longKey, 'bounded source');
  const expanded = entity(randomUUID(), longKey, 'Expanded provenance', [],
    Array.from({ length: 16 }, (_, index) => ({ key: longKey, attribute: `a${index}`, value: 'v' })));
  assert.ok(Buffer.byteLength(JSON.stringify(expanded)) <= 65536);
  await assert.rejects(feature.planMemoryEntityChange({ ...target, input: expanded }), /MEMORY_CONNECTION_LIMIT/,
    'resolved provenance must fit the stored record before a plan is offered');
  assert.equal((await feature.memoryConnectionsStoreStatus({ path })).entities, 3);
  const foreign = { ...target, path: join(lab.projects.beta, '.agentfs', 'project.db') };
  assert.equal((await feature.relatedMemoryContext({ ...foreign, entity: ids[0] })).nodes.length, 0);
  await assert.rejects(feature.relatedMemoryContext({ ...target, scope: 'identity', entity: ids[0] }), /MEMORY_OWNER_MISMATCH/);
  const bounded = await related(ids[0], { depth: 2, limit: 1 });
  assert.equal(bounded.nodes.length, 1); assert.equal(bounded.edges.length, 0); assert.equal(bounded.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(feature.memoryConnectionsResponse(bounded))) <= 32768);
  // Source ABA must invalidate an anchor and both endpoint-bound edges.
  await write('tunnels/cobalt', 'changed'); await write('tunnels/cobalt', 'Tunnel uses gateway ember');
  assert.equal((await related(ids[0], { depth: 2 })).edges.length, 0);
  await curate('entity', tunnel); await curate('link', firstLink); await curate('link', secondLink);
  assert.equal((await related(ids[0], { depth: 2 })).edges.length, 2);
  const staleEntity = await feature.planMemoryEntityChange({ ...target, input: tunnel });
  await write('tunnels/cobalt', 'another route'); await write('tunnels/cobalt', 'Tunnel uses gateway ember');
  await assert.rejects(feature.applyMemoryEntityChange({ ...target, input: tunnel, confirm: staleEntity.digest }), /MEMORY_CONNECTION_STALE_PLAN/);
  await curate('entity', tunnel); await curate('link', firstLink); await curate('link', secondLink);
  // Entity ABA, including remove/recreate, must not revive an old edge or plan.
  await curate('entity', { schema_version: 1, id: ids[1] }, 'remove');
  assert.equal((await related(ids[0], { depth: 2 })).edges.length, 0);
  await curate('entity', tunnel);
  assert.equal((await related(ids[0], { depth: 2 })).edges.length, 0);
  await curate('link', firstLink); await curate('link', secondLink);
  await curate('entity', { ...sensor, claims: [
    { key: 'facts/old', attribute: 'route', value: 'old' }, { key: 'facts/current', attribute: 'route', value: 'new' },
  ] });
  let conflicts = await feature.inspectMemoryClaimConflicts({ ...target, key: 'facts/current' });
  assert.equal(conflicts.length, 1); assert.equal(conflicts[0].claims.length, 2);
  await write('facts/old', 'replaced old route');
  assert.deepEqual(await feature.inspectMemoryClaimConflicts({ ...target, key: 'facts/current' }), []);
  // Freshness metadata changes invalidate graph evidence; graph edits never
  // silently refresh a freshness assertion or alter ordinary source text.
  const fresh = { ...target, key: 'devices/sensor', input: { schema_version: 1, source_refs: [] } };
  const freshnessPlan = await planFreshnessChange(fresh);
  await applyFreshnessChange({ ...fresh, confirm: freshnessPlan.digest });
  assert.equal((await related(ids[0])).nodes.length, 0);
  const freshnessBefore = await inspectMemoryFreshness(fresh);
  await curate('entity', sensor);
  assert.deepEqual(await inspectMemoryFreshness(fresh), freshnessBefore);
  await curate('link', firstLink);
  // Cycles terminate deterministically and never exceed node/edge/frame caps.
  await curate('link', link(randomUUID(), ids[2], ids[0], ['gateways/ember']));
  const cycle = await related(ids[0], { direction: 'both', depth: 2 });
  assert.equal(new Set(cycle.nodes.map(row => row.id)).size, cycle.nodes.length);
  assert.deepEqual(await related(ids[0], { direction: 'both', depth: 2 }), cycle);
  const close = MemoryDatabase.prototype.close;
  let race = true;
  try {
    MemoryDatabase.prototype.close = async function() {
      await close.call(this);
      if (race && this.name === path) { race = false; await write('devices/sensor', 'concurrent source replacement'); }
    };
    const raced = await related(ids[0], { depth: 2 });
    assert.equal(raced.truncated, true); assert.deepEqual(raced.nodes, []); assert.deepEqual(raced.edges, []);
  } finally { MemoryDatabase.prototype.close = close; }
  await curate('entity', sensor);
  await curate('link', firstLink);
  const oldLinkPlan = await feature.planMemoryLinkChange({ ...target, input: firstLink });
  await curate('link', { schema_version: 1, id: firstLink.id }, 'remove');
  await curate('link', firstLink);
  await assert.rejects(feature.applyMemoryLinkChange({ ...target, input: firstLink, confirm: oldLinkPlan.digest }), /MEMORY_CONNECTION_STALE_PLAN/);
  // Real online backup/managed restore retains records but renews their epoch.
  // Preserve the closed original and any sidecars inside this disposable lab.
  const snapshot = join(lab.root, 'connections-snapshot.db'), held = join(lab.root, 'connections-before-restore.db');
  await ordinary.backupMemoryContextStore({ ...target, output: snapshot });
  const beforeRestore = await feature.planMemoryEntityChange({ ...target, input: sensor });
  for (const suffix of ['', '-wal', '-shm', '-journal']) if (existsSync(path + suffix)) renameSync(path + suffix, held + suffix);
  const restore = await ordinary.planContextStoreRestore({ ...target, input: snapshot });
  await ordinary.applyContextStoreRestore({ ...target, input: snapshot, confirm: restore.digest });
  assert.deepEqual((await related(ids[0], { depth: 2 })).nodes, [], 'restored graph records cannot become current under the renewed epoch');
  await assert.rejects(feature.applyMemoryEntityChange({ ...target, input: sensor, confirm: beforeRestore.digest }), /MEMORY_CONNECTION_STALE_PLAN/);
  await curate('entity', sensor);
  assert.equal((await related(ids[0], { depth: 2 })).edges.length, 0, 'recurating one restored endpoint cannot reactivate old links');
  const fatId = randomUUID();
  await curate('entity', entity(fatId, 'devices/sensor', '界'.repeat(170), Array.from({ length: 16 }, (_, n) => `${n}${'x'.repeat(500)}`),
    Array.from({ length: 16 }, (_, n) => ({ key: 'facts/current', attribute: `${n}${'a'.repeat(120)}`, value: 'v'.repeat(512) }))));
  const framed = await related(fatId);
  assert.equal(framed.truncated, true); assert.ok(Buffer.byteLength(JSON.stringify(feature.memoryConnectionsResponse(framed))) <= 32768);
  const raw = await ordinary.openOrdinaryMemoryStore(path, 'project');
  try {
    await raw.getDatabase().prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<150)
      INSERT INTO cairn_memory_context_entities_v1(id,revision,present,assertion_json)
      SELECT printf('00000000-0000-4000-8000-%012d',n),1,1,? FROM seq`).run('x'.repeat(65536));
  } finally { await raw.close(); }
  await assert.rejects(related(ids[0]), /MEMORY_CONNECTION_LIMIT/, 'scan byte limit must refuse before parsing bulk assertions');
  const overflow = await ordinary.openOrdinaryMemoryStore(path, 'project');
  try {
    await overflow.getDatabase().exec("DELETE FROM cairn_memory_context_entities_v1 WHERE id LIKE '00000000-0000-4000-8000-%'");
    await overflow.getDatabase().exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<5010)
      INSERT INTO cairn_memory_context_entities_v1(id,revision,present,assertion_json)
      SELECT printf('00000000-0000-4000-8000-%012d',n),1,0,NULL FROM seq`);
  } finally { await overflow.close(); }
  await assert.rejects(related(ids[0]), /MEMORY_CONNECTION_LIMIT/, 'row ceiling includes tombstones and cannot trigger an unbounded scan');
  lab.assertOffline();
  console.log('PASS: explicit identities, ambiguous aliases, revision-bound links/claims, ABA, scope isolation, cycles and bounded graph observation');
} finally { await lab.close(); }
