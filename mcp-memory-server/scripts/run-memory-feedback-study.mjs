// Frozen synthetic retrieval feedback; no model or production memory.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createContinuityLab } from './memory-continuity-lab.mjs';
import * as ordinary from '../dist/ordinary-memory-store.js';
import { rankHybridMemory } from '../dist/memory-retrieval.js';
import { MEMORY_FEEDBACK_POLICY } from '../dist/memory-feedback.js';
import { resolveMcpToolProfile } from '../dist/mcp-tool-profile.js';

const args = process.argv.slice(2);
assert.ok(args.every(arg => ['--all', '--check', '--summary'].includes(arg)), 'Usage: [--all] [--check] [--summary]');
const fixtureBytes = readFileSync(new URL('./fixtures/memory-continuity-v2.json', import.meta.url));
const frozenBytes = readFileSync(new URL('./fixtures/memory-continuity-baseline-v227.json', import.meta.url));
const policyBytes = readFileSync(new URL('./fixtures/memory-feedback-policy-v1.json', import.meta.url));
const fixture = JSON.parse(fixtureBytes), policy = JSON.parse(policyBytes);
for (const key of ['name', 'max_delta', 'tier_width', 'minimum_tasks', 'max_displacement']) assert.equal(MEMORY_FEEDBACK_POLICY[key], policy[key]);
assert.equal(policy.default_enabled, false);
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const supplemental = {};
if (args.includes('--all')) {
  for (const [name, options] of [['baseline', ['--baseline']], ['freshness_links_maps', ['--features', 'freshness,links,maps']]]) {
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./run-memory-continuity-study.mjs', import.meta.url)), ...options, '--check', '--summary'],
      { encoding: 'utf8', timeout: 1800000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(child.status, 0, child.stderr); supplemental[name] = JSON.parse(child.stdout);
  }
}
const lab = createContinuityLab(), folder = join(lab.root, 'markdown'); mkdirSync(folder, { mode: 0o700 });
const active = new Map(), generations = new Map(), markers = new Map(), sessions = new Map(), mdVotes = new Map(), rows = [];
const records = new Map(fixture.records.map(row => [row.id, row]));
const slot = row => `${row.scope === 'project' ? row.project : 'shared'}:${row.scope}:${row.key}`;
const target = row => ({ scope: row.scope, path: row.scope === 'project'
  ? join(lab.projects[row.project], '.agentfs', 'project.db') : join(lab.env.CAIRN_AGENTFS_BASE_DIR, `${row.scope}.db`) });
const partition = row => `${row.scope === 'project' ? row.project : 'shared'}:${row.scope}`;
const visible = (row, item) => (row.scope !== 'project' || row.project === item.project)
  && (item.scope === 'all' ? ['project', 'identity'].includes(row.scope) : row.scope === item.scope);
const source = row => {
  const marker = markers.get(partition(row));
  return { owner_domain: marker.owner_domain, scope: row.scope, schema_version: 1, store_uuid: marker.store_uuid,
    restore_epoch: marker.restore_epoch, key: row.key, generation: generations.get(slot(row)), content_digest: hash(JSON.stringify(row.value)), context_revision: 0 };
};
async function client(project, ranked = false) {
  const key = `${project}:${ranked}`;
  if (!sessions.has(key)) sessions.set(key, await lab.connect(project, { CAIRN_MEMORY_CONTEXT: '1',
    CAIRN_MEMORY_FEEDBACK_RANKING: ranked ? '1' : '0' }, ranked ? 'feedback-harness-b' : 'feedback-harness-a'));
  return sessions.get(key);
}
function markdownCandidates(item) {
  return readdirSync(folder).filter(name => name.endsWith('.md')).map(name => JSON.parse(readFileSync(join(folder, name), 'utf8')))
    .filter(row => visible(row, item)).map(row => ({ scope: row.scope, key: row.key, value: row.value, source: source(row) }));
}
// Independent implementation over the same minimized vote inputs and fixed
// policy. Never invoke native rankMemoryWithFeedback to manufacture parity.
function markdownRank(entries, project, query) {
  const outcomes = mdVotes.get(project) ?? [], exact = query.normalize('NFKC').toLowerCase().trim();
  const weights = entries.map(entry => {
    const tasks = new Map(outcomes.filter(vote => vote.source_digest === hash(entry.source)).map(vote => [vote.task_digest, vote.outcome]));
    const delta = tasks.size < policy.minimum_tasks ? 0 : policy.max_delta * [...tasks.values()].reduce((n, value) => n + (value === 'useful' ? 1 : -1), 0) / tasks.size;
    return { count: tasks.size, delta: Math.round((Math.max(0, Math.min(1, entry.score + delta)) - entry.score) * 1e6) / 1e6 };
  });
  const ordered = [...entries];
  for (let i = 0; i < entries.length - 1; i++) {
    const a = entries[i], b = entries[i + 1];
    if (a.key.normalize('NFKC').toLowerCase() === exact || b.key.normalize('NFKC').toLowerCase() === exact
        || a.scope !== b.scope || a.source.owner_domain !== b.source.owner_domain || a.source.store_uuid !== b.source.store_uuid
        || a.source.restore_epoch !== b.source.restore_epoch || Math.floor(a.score * 10) !== Math.floor(b.score * 10)) continue;
    if (Math.round((weights[i + 1].delta - weights[i].delta) * 1e6) <= Math.round(Math.abs(a.score - b.score) * 1e6)) continue;
    const reason = (index, displacement) => ({ policy: policy.name, evidence: 'self-reported-usefulness', distinct_tasks: weights[index].count, delta: weights[index].delta, displacement });
    ordered[i] = { ...b, feedback: reason(i + 1, -1) }; ordered[i + 1] = { ...a, feedback: reason(i, 1) }; i++;
  }
  return ordered;
}
function recordFor(entry, item) {
  const row = [...active.values()].find(row => row.scope === entry.scope && row.key === entry.key && row.value === entry.value && visible(row, item));
  assert.ok(row, 'unauthorized or unknown source returned'); return row;
}
const projection = entry => ({ scope: entry.scope, key: entry.key, value: entry.value, score: entry.score,
  source: entry.source, ...(entry.feedback ? { feedback: entry.feedback } : {}) });
function measure(adapter, item, results, elapsed) {
  const found = results.map(row => recordFor(row, item).id), relevant = new Set(item.relevant);
  rows.push({ adapter, case_id: item.id, split: item.split, ids: found,
    hit_at_1: relevant.size ? Number(relevant.has(found[0])) : null,
    recall_at_5: relevant.size ? found.filter(id => relevant.has(id)).length / relevant.size : null,
    stale_returns: found.filter(id => (item.stale ?? []).includes(id)).length,
    false_positive: !relevant.size && found.length > 0,
    bytes: Buffer.byteLength(JSON.stringify(results)), elapsed_ms: elapsed });
}
try {
  for (const row of fixture.records) {
    if (markers.has(partition(row))) continue;
    const store = target(row); mkdirSync(join(store.path, '..'), { recursive: true, mode: 0o700 });
    const plan = await ordinary.planContextStoreInit(store); await ordinary.applyContextStoreInit({ ...store, confirm: plan.digest });
    markers.set(partition(row), (await ordinary.contextStoreStatus(store.path, store.scope)).marker);
  }
  for (const event of fixture.events) {
    const [operation, id] = Object.entries(event)[0], row = records.get(id), session = await client(row.project);
    if (operation === 'delete') {
      await session.call('memory_delete', { scope: row.scope, key: row.key }); active.delete(slot(row));
      rmSync(join(folder, `${hash(slot(row))}.md`), { force: true });
    } else {
      await session.call(operation === 'supersede' ? 'memory_supersede' : 'memory_write', { scope: row.scope, key: row.key, value: row.value,
        ...(operation === 'supersede' ? { reason: 'synthetic correction' } : {}) });
      active.set(slot(row), row); writeFileSync(join(folder, `${hash(slot(row))}.md`), JSON.stringify(row), { mode: 0o600 });
    }
    generations.set(slot(row), (generations.get(slot(row)) ?? 0) + 1);
  }
  let recorded = 0;
  // Freeze development labels before reading any held-out relevance outcome.
  for (const item of fixture.queries.filter(item => item.split === 'development')) {
    const session = await client(item.project);
    for (let attempt = 0; attempt < policy.development_repetitions; attempt++) {
      const task = hash(['development', item.id, attempt]);
      const observed = await session.call('memory_context_search', { scope: item.scope, query: item.query, top_k: fixture.limits.top_k, task_digest: task });
      const independent = rankHybridMemory(markdownCandidates(item), item.query, { topK: fixture.limits.top_k, minScore: 0 }).results;
      assert.deepEqual(observed.results.map(row => row.key), independent.map(row => row.key));
      for (const result of observed.results) {
        const row = recordFor(result, item); assert.deepEqual(result.source, source(row)); assert.ok(result.receipt);
        const outcome = item.relevant.includes(row.id) ? 'useful' : (item.stale ?? []).includes(row.id) ? 'stale' : 'wrong_context';
        const stored = await session.call('memory_feedback_record', { receipt: result.receipt, task_digest: task, outcome });
        assert.equal(stored.recorded, true); recorded++;
      }
      const votes = mdVotes.get(item.project) ?? [];
      for (const result of independent) {
        const row = recordFor(result, item);
        votes.push({ task_digest: task, source_digest: hash(source(row)), outcome: item.relevant.includes(row.id) ? 'useful' : (item.stale ?? []).includes(row.id) ? 'stale' : 'wrong_context' });
      }
      mdVotes.set(item.project, votes);
    }
  }
  for (const [project, votes] of mdVotes) writeFileSync(join(folder, `${project}.feedback.json`), JSON.stringify(votes), { mode: 0o600 });
  for (const item of fixture.queries) {
    const input = { scope: item.scope, query: item.query, top_k: fixture.limits.top_k };
    const plain = await client(item.project), ranked = await client(item.project, true);
    let started = performance.now(); const old = await plain.call('memory_search', { ...input, strategy: 'hybrid' });
    measure('frozen-policy', item, old.results, performance.now() - started);
    started = performance.now(); const collected = await plain.call('memory_context_search', input);
    measure('collection-only', item, collected.results, performance.now() - started);
    assert.deepEqual(collected.results.map(row => row.key), old.results.map(row => row.key));
    started = performance.now(); const adjusted = await ranked.call('memory_context_search', input);
    measure('feedback-ranking', item, adjusted.results, performance.now() - started);
    assert.deepEqual(adjusted.results.map(row => row.key).sort(), collected.results.map(row => row.key).sort(), 'feedback must preserve admission');
    for (const [i, row] of adjusted.results.entries()) {
      const previous = collected.results.findIndex(candidate => candidate.key === row.key && candidate.scope === row.scope);
      assert.ok(Math.abs(i - previous) <= 1); assert.equal(row.score, collected.results[previous].score);
    }
    started = performance.now(); const md = markdownRank(rankHybridMemory(markdownCandidates(item), item.query, { topK: fixture.limits.top_k, minScore: 0 }).results, item.project, item.query);
    const markdownMs = performance.now() - started;
    assert.deepEqual(adjusted.results.map(projection), md.map(projection), 'independent equal-information Markdown policy must match');
    measure('markdown-feedback', item, md, markdownMs);
    if (!item.relevant.length) assert.equal(adjusted.count, 0);
    if (item.id === 'exact-key') assert.equal(adjusted.results[0].key, item.query);
  }
  const metrics = ['frozen-policy', 'collection-only', 'feedback-ranking', 'markdown-feedback'].map(adapter => {
    const selected = rows.filter(row => row.adapter === adapter && row.split === 'held-out'), positives = selected.filter(row => row.hit_at_1 !== null);
    const times = selected.map(row => row.elapsed_ms).sort((a, b) => a - b);
    return { adapter, held_out_cases: selected.length, hit_at_1: positives.reduce((n, row) => n + row.hit_at_1, 0) / positives.length,
      recall_at_5: positives.reduce((n, row) => n + row.recall_at_5, 0) / positives.length,
      stale_returns: selected.reduce((n, row) => n + row.stale_returns, 0), negative_false_positives: selected.filter(row => row.false_positive).length,
      returned_bytes: selected.reduce((n, row) => n + row.bytes, 0), p50_ms: times[Math.floor(times.length / 2)], p95_ms: times.at(-1) };
  });
  const collected = metrics[1], ranked = metrics[2];
  const regressions = rows.filter(row => row.adapter === 'feedback-ranking').filter(row => {
    const baseline = rows.find(candidate => candidate.adapter === 'collection-only' && candidate.case_id === row.case_id);
    return (row.hit_at_1 ?? 0) < (baseline.hit_at_1 ?? 0) || (row.recall_at_5 ?? 0) < (baseline.recall_at_5 ?? 0) || row.stale_returns > baseline.stale_returns || Number(row.false_positive) > Number(baseline.false_positive);
  });
  assert.equal(regressions.length, 0, 'no held-out or development quality/negative regressions permitted');
  const improved = ranked.hit_at_1 > collected.hit_at_1 || ranked.recall_at_5 > collected.recall_at_5;
  for (const session of sessions.values()) await session.close(); sessions.clear(); lab.assertOffline();
  assert.deepEqual(readFileSync(new URL('./fixtures/memory-continuity-v2.json', import.meta.url)), fixtureBytes);
  assert.deepEqual(readFileSync(new URL('./fixtures/memory-continuity-baseline-v227.json', import.meta.url)), frozenBytes);
  const size = path => readdirSync(path, { withFileTypes: true }).reduce((n, item) => n + (item.isDirectory() ? size(join(path, item.name)) : statSync(join(path, item.name)).size), 0);
  const sourceFiles = ['index.ts', 'memory-feedback.ts', 'memory-context-store.ts', 'memory-context-schema.ts', 'memory-retrieval.ts', 'memory-reranker.ts'];
  const report = { schema_version: 1, study: 'frozen-longitudinal-feedback', synthetic_only: true, native_harness_ui_verified: false,
    fixture_digest: hash(fixtureBytes), frozen_reference_digest: hash(frozenBytes), policy_digest: hash(policyBytes),
    source_digest: hash(sourceFiles.map(file => ({ file, digest: hash(readFileSync(new URL(`../src/${file}`, import.meta.url))) }))),
    evaluation_digest: hash(readFileSync(fileURLToPath(import.meta.url))),
    configuration_digest: hash({ policy, top_k: fixture.limits.top_k, min_score: 0, embedding: null, reranker: null }),
    profile_digest: resolveMcpToolProfile({ projectRoot: lab.projects.alpha, env: lab.env }).profile_digest,
    capability_contract: 'disabled', arms_share_profile: true, development_feedback_records: recorded,
    network_attempts: 0, unauthorized_returns: 0, unsupported_edges: 0, membership_regressions: 0,
    held_out_ranking_gain: improved, ranking_default_enabled: false,
    decision: improved ? 'opt-in-only-pending-broader-evidence' : 'no-held-out-improvement-use-collection-only',
    metrics, storage_bytes: { markdown: size(folder), sqlite: [...markers.keys()].reduce((n, key) => {
      const row = fixture.records.find(row => partition(row) === key); return n + statSync(target(row).path).size;
    }, 0), entire_disposable_lab: size(lab.root) },
    limitations: ['Synthetic deterministic retrieval, not model quality or human productivity.',
      'Only development labels train votes; query variants and held-out labels are not tuned.',
      'Self-reported distinct tasks are not independently verified or Sybil resistant.',
      'Freshness/links/maps reports are separate feature controls, not a combined autonomous-agent effect.',
      'No providers in this replay; loopback provider integration is exercised by separate MCP contracts.',
      'Zero counters are asserted against visible corpus, exact/negative and membership controls, not a timing-side-channel guarantee.'],
    ...(Object.keys(supplemental).length ? { supplemental } : {}), ...(args.includes('--summary') ? {} : { results: rows }) };
  console.log(JSON.stringify(report, null, 2));
} finally { await lab.close(); }
