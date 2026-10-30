// Synthetic native/Markdown continuity parity, not autonomous model quality.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createContinuityLab } from './memory-continuity-lab.mjs';
import * as ordinary from '../dist/ordinary-memory-store.js';
import * as graph from '../dist/memory-connections.js';
import { planFreshnessChange, applyFreshnessChange } from '../dist/memory-context-store.js';
import { resolveMcpToolProfile } from '../dist/mcp-tool-profile.js';
import { buildMemoryMap, memoryMapResponse } from '../dist/memory-map.js';

const args = process.argv.slice(2), bytes = readFileSync(new URL('./fixtures/memory-continuity-v2.json', import.meta.url));
const selectedArm = args[2] === '--arm' ? args[3] : null;
assert.ok(args[0] === '--features' && ['freshness,links', 'freshness,links,maps', 'freshness,links,maps,feedback'].includes(args[1])
  && (!selectedArm || ['collection-only', 'bounded-ranking'].includes(selectedArm))
  && args.slice(selectedArm ? 4 : 2).every(arg => ['--check', '--summary'].includes(arg)),
  'Usage: --features freshness,links[,maps[,feedback]] [--arm collection-only|bounded-ranking] [--check] [--summary]');
const mapsEnabled = args[1].split(',').includes('maps'), feedbackEnabled = args[1].endsWith(',feedback'), mapResults = [], markers = new Map();
assert.ok(!selectedArm || feedbackEnabled, 'arm selection requires the actual joint feedback replay');
const rankingArms = selectedArm ? [selectedArm === 'bounded-ranking'] : [false, true];
const fixture = JSON.parse(bytes), lab = createContinuityLab();
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const records = new Map(fixture.records.map(row => [row.id, row]));
const active = new Map(), generations = new Map(), metadataRevisions = new Map(), entities = [], links = [], results = [];
let unsupportedEdges = 0, unauthorizedReturns = 0;
const curationCounters = { entity_changes: 0, link_changes: 0, freshness_changes: 0, elapsed_ms: 0 };
const storeKey = row => `${row.scope === 'identity' ? 'shared' : row.project}:${row.scope}:${row.key}`;
const store = row => ({ scope: row.scope, path: row.scope === 'identity' ? join(lab.env.CAIRN_AGENTFS_BASE_DIR, 'identity.db')
  : join(lab.projects[row.project], '.agentfs', 'project.db') });
const partitionId = row => `${row.scope === 'identity' ? 'shared' : row.project}:${row.scope}`;
const folder = join(lab.root, 'markdown'); mkdirSync(folder, { mode: 0o700 });
const sessions = new Map();
async function client(project, harness = 'a', ranked = false) {
  const key = `${project}:${harness}`;
  if (!sessions.has(key)) sessions.set(key, await lab.connect(project, { CAIRN_MEMORY_CONTEXT: '1',
    CAIRN_MEMORY_FEEDBACK_RANKING: ranked ? '1' : '0' }, `continuity-harness-${harness}`));
  return sessions.get(key);
}
async function mutate(operation, row) {
  const input = { scope: row.scope, key: row.key }, session = await client(row.project), key = storeKey(row);
  if (operation === 'delete') { await session.call('memory_delete', input); active.delete(key); }
  else {
    await session.call(operation === 'supersede' ? 'memory_supersede' : 'memory_write', { ...input, value: row.value,
      ...(operation === 'supersede' ? { reason: 'synthetic continuity mutation' } : {}) });
    active.set(key, row);
  }
  generations.set(key, (generations.get(key) ?? 0) + 1);
  writeFileSync(join(folder, `${hash(key)}.md`), JSON.stringify({ key, generation: generations.get(key), present: active.has(key),
    context_revision: metadataRevisions.get(key) ?? 0, row: active.get(key) ?? null }), { mode: 0o600 });
}
const aliasInput = { device: ['sensor lumen'], tunnel: ['cobalt'], endpoint: ['ember-42'],
  'alias-one': ['relay'], 'alias-two': ['relay'], renamed: ['glimmer', 'lumen-current'], 'gateway-current': ['relaybox'] };
const persistCuration = () => writeFileSync(join(folder, 'curation.json'), JSON.stringify({ entities, links }), { mode: 0o600 });
async function curateEntity(row, input, operation = 'set') {
  const started = performance.now(), target = store(row), plan = await graph.planMemoryEntityChange({ ...target, input, operation });
  await graph.applyMemoryEntityChange({ ...target, input, operation, confirm: plan.digest });
  curationCounters.entity_changes++; curationCounters.elapsed_ms += performance.now() - started;
  const previous = entities.find(entity => entity.id === input.id), revision = (previous?.revision ?? 0) + 1;
  // The control has its own monotonic curation revisions and assertion digest.
  // It receives the same source provenance, never the native result/digest.
  const assertion = operation === 'remove' ? null : { ...input, anchor: plan.record.anchor, revision };
  const record = { id: input.id, revision, scope: row.scope, project: row.project, assertion,
    assertion_digest: assertion ? hash(assertion) : null };
  if (previous) entities[entities.indexOf(previous)] = record; else entities.push(record);
  return plan;
}
async function curateLink(row, input, operation = 'set') {
  const started = performance.now(), target = store(row), plan = await graph.planMemoryLinkChange({ ...target, input, operation });
  await graph.applyMemoryLinkChange({ ...target, input, operation, confirm: plan.digest });
  curationCounters.link_changes++; curationCounters.elapsed_ms += performance.now() - started;
  const previous = links.find(link => link.id === input.id), revision = (previous?.revision ?? 0) + 1;
  const record = operation === 'remove' ? { id: input.id, revision, present: false } : { ...input, revision, present: true,
    from: { id: input.from, digest: entities.find(entity => entity.id === input.from).assertion_digest },
    to: { id: input.to, digest: entities.find(entity => entity.id === input.to).assertion_digest }, evidence: plan.record.evidence };
  if (previous) links[links.indexOf(previous)] = record; else links.push(record);
}
const edgeView = edge => ({ id: edge.id, revision: edge.revision, from: edge.from.id, to: edge.to.id,
  predicate: edge.predicate, evidence: edge.evidence });
function markdownRelated(item) {
  // Independently enumerate actual files; never choose records from native results.
  const rows = readdirSync(folder).filter(name => name.endsWith('.md')).map(name => JSON.parse(readFileSync(join(folder, name), 'utf8')));
  const visible = new Map(rows.filter(({ row, present }) => present && row.scope === item.scope
    && (row.scope === 'identity' || row.project === item.project)).map(row => [row.row.key, row]));
  const current = reference => {
    const row = visible.get(reference.key);
    const marker = markers.get(partitionId(item));
    return row && row.generation === reference.generation && row.context_revision === reference.context_revision
      && (!marker || (marker.owner_domain === reference.owner_domain && marker.store_uuid === reference.store_uuid
        && marker.restore_epoch === reference.restore_epoch && marker.scope === reference.scope))
      && hash(JSON.stringify(row.row.value)) === reference.content_digest;
  };
  const curation = JSON.parse(readFileSync(join(folder, 'curation.json'), 'utf8'));
  const nodes = curation.entities.filter(row => row.assertion && row.scope === item.scope
    && (row.scope === 'identity' || row.project === item.project) && current(row.assertion.anchor))
    .map(row => ({ ...row.assertion, assertion_digest: row.assertion_digest }));
  const seeds = nodes.filter(row => row.id === item.entity || row.aliases.includes(item.entity) || row.title === item.entity);
  if (seeds.length !== 1) return { ambiguous: seeds.length > 1, keys: [], matches: seeds.map(row => row.anchor.key).sort(), edges: [] };
  const found = new Set([seeds[0].id]), traversed = new Map(); let frontier = [seeds[0].id];
  for (let level = 0; level < (item.depth ?? 1); level++) {
    const next = [];
    for (const id of frontier) for (const link of curation.links) {
      if (!link.present || link.from.id !== id || !link.evidence.every(current)
        || !nodes.some(row => row.id === link.from.id && row.assertion_digest === link.from.digest)
        || !nodes.some(row => row.id === link.to.id && row.assertion_digest === link.to.digest)) continue;
      traversed.set(link.id, edgeView(link));
      if (!found.has(link.to.id)) { found.add(link.to.id); next.push(link.to.id); }
    }
    frontier = next;
  }
  return { ambiguous: false, keys: nodes.filter(row => found.has(row.id)).map(row => row.anchor.key).sort(),
    matches: [seeds[0].anchor.key], edges: [...traversed.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}
async function compare(item) {
  const session = await client(item.project, item.harness ?? 'a'), started = performance.now();
  const native = await session.call('memory_related', { scope: item.scope, entity: item.entity, depth: item.depth ?? 1 });
  const nativeMs = performance.now() - started, markdownStarted = performance.now();
  const markdown = markdownRelated(item), markdownMs = performance.now() - markdownStarted;
  const observed = { ambiguous: native.ambiguous, keys: native.nodes.map(row => row.anchor.key).sort(),
    matches: native.matches.map(row => row.anchor.key).sort(), edges: native.edges.map(edgeView).sort((a, b) => a.id.localeCompare(b.id)) };
  unsupportedEdges += observed.edges.filter(edge => !markdown.edges.some(expected => hash(expected) === hash(edge))).length;
  unauthorizedReturns += observed.keys.filter(key => !item.keys.includes(key)).length;
  assert.deepEqual(observed, markdown, `${item.id}: equal-information graph policies must agree`);
  assert.deepEqual(observed.keys, [...item.keys].sort()); assert.equal(observed.ambiguous, Boolean(item.ambiguous));
  assert.ok(Buffer.byteLength(JSON.stringify(graph.memoryConnectionsResponse(native))) <= 32768);
  results.push({ case_id: item.id, ...observed, native_ms: Math.round(nativeMs * 100) / 100,
    markdown_ms: Math.round(markdownMs * 100) / 100, returned_bytes: Buffer.byteLength(JSON.stringify(graph.memoryConnectionsResponse(native))) });
}
function markdownMap(item) {
  const marker = markers.get(partitionId(item));
  const rows = readdirSync(folder).filter(name => name.endsWith('.md')).map(name => JSON.parse(readFileSync(join(folder, name), 'utf8')))
    .filter(({ row, present }) => present && row.scope === item.scope && (row.scope === 'identity' || row.project === item.project))
    .sort((a, b) => a.row.key < b.row.key ? -1 : a.row.key > b.row.key ? 1 : 0);
  const curation = JSON.parse(readFileSync(join(folder, 'curation.json'), 'utf8'));
  const source = row => ({ schema_version: 1, owner_domain: marker.owner_domain, scope: marker.scope, store_uuid: marker.store_uuid,
    restore_epoch: marker.restore_epoch, key: row.row.key, generation: row.generation,
    content_digest: hash(JSON.stringify(row.row.value)), context_revision: row.context_revision });
  const refs = new Map(rows.map(row => [row.row.key, source(row)]));
  const sameRef = (left, right) => left && right && Object.keys(left).every(key => left[key] === right[key])
    && Object.keys(left).length === Object.keys(right).length;
  const status = ref => {
    const assertion = curation.freshness?.find(row => sameRef(row.source, ref));
    return !assertion ? 'unknown' : !assertion.metadata.verified_at ? 'unverified'
      : assertion.metadata.review_after && Date.parse(assertion.metadata.review_after) <= Date.now() ? 'needs_review' : 'current';
  };
  const groups = new Map();
  for (const row of rows) {
    const key = row.row.key, prefix = key.includes('/') ? key.slice(0, key.indexOf('/')) : key;
    const group = groups.get(prefix) ?? []; group.push({ key, source: refs.get(key), status: status(refs.get(key)) }); groups.set(prefix, group);
  }
  const entries = [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([prefix, group]) => {
    const freshness = {}; for (const row of group) freshness[row.status] = (freshness[row.status] ?? 0) + 1;
    return { kind: 'prefix', prefix, count: group.length, freshness, navigation: group.slice(0, 3), navigation_truncated: group.length > 3 };
  });
  const live = curation.entities.filter(row => row.assertion && row.scope === item.scope && (row.scope === 'identity' || row.project === item.project)
    && sameRef(refs.get(row.assertion.anchor.key), row.assertion.anchor))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const row of live) {
    const entity = row.assertion, names = new Set([entity.title, ...entity.aliases]);
    const ambiguous = live.some(other => other.id !== row.id && [other.assertion.title, ...other.assertion.aliases].some(alias => names.has(alias)));
    entries.push({ kind: 'entity', id: row.id, title: entity.title, ambiguous,
      navigation: [{ key: entity.anchor.key, source: entity.anchor, status: status(entity.anchor) }] });
  }
  const result = { schema_version: 1, partitions: [{ scope: item.scope, tracked: true, entries: [] }], exact_reads_required: true, truncated: false };
  // Independently enforce the same complete MCP framing/budget, not the native
  // output or its selected navigation. No production map builder is reused.
  const framedBytes = value => Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }));
  for (const entry of entries) {
    if (result.partitions[0].entries.length === 50) { result.truncated = true; break; }
    const proposed = { ...result, partitions: [{ ...result.partitions[0], entries: [...result.partitions[0].entries, entry] }], truncated: false };
    if (framedBytes(proposed) > 8192) { result.truncated = true; continue; }
    result.partitions[0].entries.push(entry);
    if (entry.navigation_truncated) result.truncated = true;
  }
  return result;
}
async function compareMap(item) {
  const started = performance.now(), cold = await buildMemoryMap([store(item)], { max_bytes: 8192 });
  const coldMs = performance.now() - started, warmed = performance.now();
  const warm = await buildMemoryMap([store(item)], { max_bytes: 8192 });
  const warmMs = performance.now() - warmed, mdStarted = performance.now(), markdown = markdownMap(item);
  const markdownMs = performance.now() - mdStarted;
  assert.deepEqual(cold, markdown, 'equal-information Markdown map must derive the same bounded navigation independently');
  assert.deepEqual(warm, cold);
  assert.ok(Buffer.byteLength(JSON.stringify(memoryMapResponse(cold))) <= 8192);
  mapResults.push({ project: item.project ?? 'shared', scope: item.scope, parity: true,
    returned_bytes: Buffer.byteLength(JSON.stringify(memoryMapResponse(cold))), truncated: cold.truncated,
    cold_ms: Math.round(coldMs * 100) / 100, warm_ms: Math.round(warmMs * 100) / 100,
    markdown_ms: Math.round(markdownMs * 100) / 100 });
}
const integrated = feedbackEnabled ? (await import('./memory-integrated-replay.mjs')).createIntegratedReplay({
  fixture, corpusBytes: bytes, lab, folder, markers, generations, metadataRevisions, rankingArms,
  storeKey, partitionId, store, client, markdownMap, markdownRelated, hash,
  curationCost: () => ({ ...curationCounters, plan_apply_calls: 2 * (curationCounters.entity_changes + curationCounters.link_changes + curationCounters.freshness_changes) }),
  recordFreshness: elapsed => { curationCounters.freshness_changes++; curationCounters.elapsed_ms += elapsed; },
  closeClients: async () => { for (const session of sessions.values()) await session.close(); sessions.clear(); },
}) : null;
try {
  for (const row of [{ project: 'alpha', scope: 'project' }, { project: 'beta', scope: 'project' }, { scope: 'identity' }]) {
    const target = store(row), plan = await ordinary.planContextStoreInit(target);
    await ordinary.applyContextStoreInit({ ...target, confirm: plan.digest });
    if (mapsEnabled) markers.set(partitionId(row), (await ordinary.contextStoreStatus(target.path, target.scope)).marker);
  }
  for (const event of fixture.events) { const [operation, id] = Object.entries(event)[0]; await mutate(operation, records.get(id)); }
  const byRecord = new Map(); let nextId = 1;
  for (const row of active.values()) {
    if (row.project !== 'alpha') continue;
    const id = `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
    const input = { schema_version: 1, id, title: row.id, aliases: aliasInput[row.id] ?? [], anchor_key: row.key, claims: [] };
    const plan = await curateEntity(row, input);
    assert.equal(plan.record.anchor.generation, generations.get(storeKey(row)), 'Markdown must receive actual equivalent source generations');
    byRecord.set(row.id, { id, row, input });
  }
  const edgeInputs = [];
  for (const edge of fixture.links) {
    const from = byRecord.get(edge.from), to = byRecord.get(edge.to), id = `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
    const input = { schema_version: 1, id, from: from.id, to: to.id, predicate: edge.predicate,
      evidence_keys: edge.evidence.map(id => byRecord.get(id).row.key) };
    await curateLink(from.row, input); edgeInputs.push({ row: from.row, input });
  }
  persistCuration();
  await integrated?.start();
  // The unchanged standalone replay owns graph re-curation/removal and cold/
  // warm-map ablations. The joint replay keeps its own shared-state controls,
  // without repeating those independent suites inside an already lengthy job.
  if (!integrated) {
  await compare({ id: 'linked-route', project: 'alpha', scope: 'project', entity: 'sensor lumen', depth: 2,
    keys: ['devices/sensor-lumen', 'tunnels/cobalt', 'gateways/ember-42'] });
  await compare({ id: 'ambiguous-alias', project: 'alpha', scope: 'project', entity: 'relay', keys: [], ambiguous: true });
  await compare({ id: 'explicit-rename', project: 'alpha', scope: 'project', entity: 'glimmer', keys: ['devices/lumen-name'] });
  await compare({ id: 'foreign-project-negative', project: 'beta', scope: 'project', entity: 'sensor lumen', keys: [] });
  await compare({ id: 'nearby-identifier-negative', project: 'alpha', scope: 'project', entity: 'ember-43', keys: [] });
  await compare({ id: 'cross-harness-cwd', project: 'neutral', harness: 'b', scope: 'identity', entity: 'relaybox', keys: ['decisions/office-tunnel'] });
  const tunnel = byRecord.get('tunnel');
  await curateEntity(tunnel.row, { ...tunnel.input, title: 'Explicitly revised tunnel' }); persistCuration();
  await compare({ id: 'endpoint-recuration-negative', project: 'alpha', scope: 'project', entity: 'sensor lumen', depth: 2,
    keys: ['devices/sensor-lumen'] });
  for (const edge of edgeInputs) await curateLink(edge.row, edge.input);
  await curateEntity(tunnel.row, { schema_version: 1, id: tunnel.id }, 'remove'); persistCuration();
  await compare({ id: 'endpoint-removal-negative', project: 'alpha', scope: 'project', entity: 'sensor lumen', depth: 2,
    keys: ['devices/sensor-lumen'] });
  await curateEntity(tunnel.row, tunnel.input); persistCuration();
  await compare({ id: 'endpoint-recreate-negative', project: 'alpha', scope: 'project', entity: 'sensor lumen', depth: 2,
    keys: ['devices/sensor-lumen'] });
  for (const edge of edgeInputs) await curateLink(edge.row, edge.input);
  const first = edgeInputs[0];
  await curateLink(first.row, { schema_version: 1, id: first.input.id }, 'remove'); persistCuration();
  await compare({ id: 'link-removal-negative', project: 'alpha', scope: 'project', entity: 'sensor lumen', depth: 2,
    keys: ['devices/sensor-lumen'] });
  await curateLink(first.row, first.input); persistCuration();
  await compare({ id: 'explicit-link-recreate', project: 'alpha', scope: 'project', entity: 'sensor lumen', depth: 2,
    keys: ['devices/sensor-lumen', 'tunnels/cobalt', 'gateways/ember-42'] });
  }
  const old = records.get('route-old'), target = { ...store(old), key: old.key, input: { schema_version: 1,
    source_refs: ['opaque:synthetic'], verified_at: '1999-01-01T00:00:00Z', review_after: '2000-01-01T00:00:00Z' } };
  const freshnessStarted = performance.now(), freshness = await planFreshnessChange(target), assertion = await applyFreshnessChange({ ...target, confirm: freshness.digest });
  curationCounters.freshness_changes++; curationCounters.elapsed_ms += performance.now() - freshnessStarted;
  metadataRevisions.set(storeKey(old), 1);
  writeFileSync(join(folder, `${hash(storeKey(old))}.md`), JSON.stringify({ key: storeKey(old), generation: generations.get(storeKey(old)),
    present: true, context_revision: 1, row: old }), { mode: 0o600 });
  writeFileSync(join(folder, 'curation.json'), JSON.stringify({ entities, links,
    freshness: [{ source: assertion.source, metadata: target.input }] }), { mode: 0o600 });
  const status = await (await client('alpha')).call('memory_inspect', { scope: 'project', key: old.key });
  assert.equal(status.candidates[0].status, 'needs_review'); assert.equal(status.candidates[0].value, old.value, 'review warnings must not silently rewrite text');
  const mdFreshness = JSON.parse(readFileSync(join(folder, 'curation.json'), 'utf8')).freshness[0];
  const mdSource = JSON.parse(readFileSync(join(folder, `${hash(storeKey(old))}.md`), 'utf8'));
  assert.equal(mdSource.generation, mdFreshness.source.generation); assert.equal(mdSource.context_revision, mdFreshness.source.context_revision);
  const mdStatus = mdFreshness.metadata.verified_at && Date.parse(mdFreshness.metadata.review_after) < Date.now() ? 'needs_review' : 'unknown';
  assert.equal(mdStatus, status.candidates[0].status, 'Markdown receives the same asserted dates and current source metadata');
  await integrated?.heldOut();
  const renamed = records.get('renamed');
  await integrated?.metadataChange(renamed);
  await mutate('write', { ...renamed, value: 'temporary replacement' }); await mutate('write', renamed);
  if (!integrated) await compare({ id: 'source-aba-negative', project: 'alpha', scope: 'project', entity: 'glimmer', keys: [] });
  await integrated?.afterAba(renamed);
  if (mapsEnabled && !integrated) for (const item of [{ project: 'alpha', scope: 'project' }, { project: 'beta', scope: 'project' }, { scope: 'identity' }]) await compareMap(item);
  await integrated?.finishRestore();
  lab.assertOffline();
  const frozen = JSON.parse(readFileSync(new URL('./fixtures/memory-continuity-baseline-v227.json', import.meta.url)));
  const baselineLinked = frozen.results.find(row => row.adapter === 'cairn-v227' && row.case_id === 'linked-route').recall_at_5;
  const jointReport = integrated?.report();
  assert.equal(baselineLinked, 1 / 3);
  assert.equal(jointReport ? jointReport.workflows[0].keys.length : results.find(row => row.case_id === 'linked-route').keys.length, 3);
  const source = ['memory-connections.ts', 'memory-context-store.ts', 'memory-context-schema.ts', 'index.ts', ...(mapsEnabled ? ['memory-map.ts', 'memory-map-budget.ts'] : [])]
    .map(name => readFileSync(new URL(`../src/${name}`, import.meta.url)));
  console.log(JSON.stringify({ schema_version: 1, study: integrated ? 'native-memory-integrated-continuity' : mapsEnabled ? 'native-memory-freshness-links-maps' : 'native-memory-freshness-links', synthetic_only: true,
    fixture_digest: hash(bytes), source_digest: hash(Buffer.concat(source)), configuration_digest: hash({ aliasInput, links: fixture.links, depth: 2, maps: mapsEnabled,
      ...(integrated ? { feedback: 'collection-only-with-separate-ranking-control', ranking_arms: rankingArms } : {}) }),
    profile_digest: resolveMcpToolProfile({ projectRoot: lab.projects.alpha, env: lab.env }).profile_digest,
    adapters: ['cairn-freshness-links', 'markdown-curated-links'], cases: results.length, parity: true,
    ...(integrated ? { separate_controls_replayed: false } : {}),
    linked_recall: { frozen_baseline: baselineLinked, curated_native: 1, curated_markdown: 1 },
    ambiguous_alias_signaled: true, overdue_review_signaled: true, unauthorized_returns: unauthorizedReturns, unsupported_edges: unsupportedEdges, network_attempts: 0,
    limitations: ['Synthetic curated retrieval, not autonomous task quality or a human pilot.',
      'Both formats receive identical explicit aliases, evidence and link metadata; neither infers entities.',
      'Freshness dates warn without choosing truth or changing source text; no production conversion.',
      'Maps are bounded orientation, not exact source reads or an automatic quality gain; warm cache still revalidates live records.',
      integrated ? 'Joint synthetic tool workflow is not an autonomous agent-quality or human-pilot result; original held-out feedback no-gain evidence remains separate.'
        : 'Feedback, learned ranking and complete milestone held-out ablations remain separate.'],
    ...(jointReport ? { integrated: jointReport } : {}), ...(mapsEnabled ? { maps: mapResults } : {}), results }, null, 2));
} finally { await lab.close(); }
