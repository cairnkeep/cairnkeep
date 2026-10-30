#!/usr/bin/env node
// Synthetic longitudinal retrieval; no model, provider, real memory or native UI.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createContinuityLab } from './memory-continuity-lab.mjs';
import { rankHybridMemory } from '../dist/memory-retrieval.js';
import { resolveMcpToolProfile } from '../dist/mcp-tool-profile.js';

const args = process.argv.slice(2);
if (args.includes('--all')) {
  await import('./run-memory-feedback-study.mjs');
  process.exit(0);
}
if (args[0] === '--features') {
  await import('./run-memory-connections-study.mjs');
  process.exit(0);
}
assert.ok(args.every(arg => ['--baseline', '--check', '--summary'].includes(arg)), 'Usage: run-memory-continuity-study.mjs [--baseline] [--check] [--summary]');
const bytes = readFileSync(new URL('./fixtures/memory-continuity-v2.json', import.meta.url));
const fixture = JSON.parse(bytes);
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const lab = createContinuityLab();
const records = new Map(fixture.records.map(row => [row.id, row]));
const active = new Map();
const storeKey = row => `${row.scope === 'project' ? row.project : 'shared'}:${row.scope}:${row.key}`;
const folder = join(lab.root, 'markdown'); mkdirSync(folder);
const resultRows = [], latencies = { 'cairn-v227': [], 'markdown-hybrid': [] };
let connection, selected;
async function client(project, label = 'continuity-fixture') {
  if (selected !== project) {
    await connection?.close();
    connection = await lab.connect(project, {}, label); selected = project;
  }
  return connection;
}
function mdPath(row) { return join(folder, `${hash(storeKey(row))}.md`); }
function visible(rows, item) {
  return rows.filter(row =>
    (row.scope !== 'project' || row.project === item.project) &&
    (item.scope === 'all' ? ['project', 'identity'].includes(row.scope) : row.scope === item.scope));
}
function rowForResult(result, candidates) {
  const row = candidates.find(candidate => candidate.scope === result.scope && candidate.key === result.key && candidate.value === result.value);
  assert.ok(row, 'retrieval returned hidden, archived or unknown fixture content'); return row;
}
function measure(adapter, item, result, elapsed, candidates) {
  const found = result.map(row => rowForResult(row, candidates).id);
  const relevant = new Set(item.relevant), stale = new Set(item.stale ?? []);
  latencies[adapter].push(elapsed);
  return { adapter, case_id: item.id, split: item.split, returned_records: found,
    hit_at_1: relevant.size ? relevant.has(found[0]) : null,
    recall_at_5: relevant.size ? found.filter(id => relevant.has(id)).length / relevant.size : null,
    false_positive: relevant.size === 0 && found.length > 0,
    stale_returns: found.filter(id => stale.has(id)).length,
    returned_bytes: Buffer.byteLength(JSON.stringify(result.map(({ scope, key, value }) => ({ scope, key, value })))),
    ambiguous_without_signal: Boolean(item.ambiguous && found.length),
    unsupported_edges: 0, links_available: false,
  };
}
function filesSize(path) {
  return readdirSync(path, { withFileTypes: true }).reduce((n, item) => n + (item.isDirectory() ? filesSize(join(path, item.name)) : statSync(join(path, item.name)).size), 0);
}
try {
  for (const event of fixture.events) {
    const [operation, id] = Object.entries(event)[0], row = records.get(id);
    assert.ok(row);
    const endpoint = await client(row.project);
    const input = { scope: row.scope, key: row.key };
    if (operation === 'delete') {
      await endpoint.call('memory_delete', input); active.delete(storeKey(row));
      rmSync(mdPath(row), { force: true });
    } else {
      assert.ok(['write', 'supersede'].includes(operation));
      await endpoint.call(operation === 'write' ? 'memory_write' : 'memory_supersede', {
        ...input, value: row.value, ...(operation === 'supersede' ? { reason: 'synthetic fixture change' } : {}),
      });
      active.set(storeKey(row), row);
      const metadata = JSON.stringify({ scope: row.scope, project: row.project, key: row.key });
      writeFileSync(mdPath(row), `${metadata}\n\n${row.value}\n`, { mode: 0o600 });
    }
  }
  // Both adapters receive identical curated relationship metadata. Neither
  // baseline consumes it; a future policy must be compared on both formats.
  writeFileSync(join(folder, 'curation.json'), JSON.stringify({ links: fixture.links, clock: fixture.clock }), { mode: 0o600 });
  for (const [index, item] of fixture.queries.entries()) {
    const candidates = visible([...active.values()], item);
    const current = await client(item.project, index % 2 ? 'fixture-harness-b' : 'fixture-harness-a');
    const started = performance.now();
    const payload = await current.call('memory_search', { scope: item.scope, query: item.query,
      top_k: fixture.limits.top_k, strategy: 'hybrid', explain: true });
    assert.equal(payload.mode, 'hybrid'); assert.equal(payload.retrieval.embedding_status, 'unconfigured');
    const cairn = measure('cairn-v227', item, payload.results, performance.now() - started, candidates);
    const folderStarted = performance.now();
    // Independently enumerate the folder, rather than using the result oracle
    // to select documents (which would hide deletion or filtering mistakes).
    const folderRows = readdirSync(folder).filter(name => name.endsWith('.md')).map(name => {
      const content = readFileSync(join(folder, name), 'utf8'), split = content.indexOf('\n\n');
      return { ...JSON.parse(content.slice(0, split)), value: content.slice(split + 2, -1) };
    });
    const folderCandidates = visible(folderRows, item);
    assert.deepEqual(folderCandidates.map(storeKey).sort(), candidates.map(storeKey).sort());
    const ranked = rankHybridMemory(folderCandidates, item.query, { topK: fixture.limits.top_k, minScore: 0, explain: true });
    const markdown = measure('markdown-hybrid', item, ranked.results, performance.now() - folderStarted, candidates);
    assert.deepEqual(markdown.returned_records, cairn.returned_records, 'equal-information policies must have storage-format parity');
    if (!item.relevant.length) assert.equal(cairn.false_positive, false, `${item.id} must stay empty`);
    if (item.id === 'exact-key') assert.equal(cairn.hit_at_1, true);
    resultRows.push(cairn, markdown);
  }
  await connection?.close(); connection = undefined;
  lab.assertOffline();
  const metrics = Object.keys(latencies).map(adapter => {
    const rows = resultRows.filter(row => row.adapter === adapter), positives = rows.filter(row => row.hit_at_1 !== null);
    const times = latencies[adapter].sort((a, b) => a - b);
    return { adapter, cases: rows.length, hit_at_1: positives.filter(row => row.hit_at_1).length / positives.length,
      recall_at_5: positives.reduce((n, row) => n + row.recall_at_5, 0) / positives.length,
      stale_returns: rows.reduce((n, row) => n + row.stale_returns, 0),
      negative_false_positives: rows.filter(row => row.false_positive).length,
      ambiguous_without_signal: rows.filter(row => row.ambiguous_without_signal).length,
      unsupported_edges: 0, unauthorized_returns: 0,
      returned_bytes: rows.reduce((n, row) => n + row.returned_bytes, 0),
      p50_ms: Math.round(times[Math.floor(times.length / 2)] * 100) / 100,
      p95_ms: Math.round(times[Math.ceil(times.length * 0.95) - 1] * 100) / 100 };
  });
  const sourceDigest = hash(Buffer.concat(['index.ts', 'memory-retrieval.ts'].map(name => readFileSync(new URL(`../src/${name}`, import.meta.url)))));
  const report = {
    schema_version: 1, study: fixture.study, baseline_version: fixture.baseline,
    fixture_digest: hash(bytes), source_digest: sourceDigest,
    configuration_digest: hash({ top_k: fixture.limits.top_k, strategy: 'hybrid', embedding: null, reranker: null, scopes: ['project', 'identity'] }),
    profile_digest: resolveMcpToolProfile({ projectRoot: lab.projects.alpha, env: lab.env }).profile_digest,
    network_attempts: 0, synthetic_only: true, native_harness_ui_verified: false,
    status: 'baseline-only', feature_ablations: 'pending implementation and revision feasibility',
    metrics, storage_bytes: {
      markdown: filesSize(folder),
      sqlite: [join(lab.root, 'stores'), ...Object.values(lab.projects).map(project => join(project, '.agentfs'))]
        .filter(path => existsSync(path)).reduce((total, path) => total + filesSize(path), 0),
      disposable_lab_total: filesSize(lab.root),
    },
    limitations: [
      'Synthetic retrieval continuity, not autonomous task quality, human consent or native harness UI.',
      'Actual stdio processes change cwd and client labels; project scope follows local cwd, identity scope is shared.',
      'Markdown receives the same current text and curated relationship data; equal policies must achieve parity.',
      'Baseline leaves stale cross-key facts and ambiguous entities unresolved; no new feature passes are claimed.',
      'Embeddings/reranker disabled; this does not measure learned semantic or feedback ranking quality.',
      'Restore/concurrent revision validation remains blocked by the separate backend capability gate.',
    ],
    ...(args.includes('--summary') ? {} : { results: resultRows }),
  };
  if (args.includes('--check')) {
    const expected = JSON.parse(readFileSync(new URL('./fixtures/memory-continuity-baseline-v227.json', import.meta.url)));
    assert.equal(report.fixture_digest, expected.fixture_digest, 'fixture changed: review and deliberately refresh the baseline');
    assert.deepEqual(resultRows, expected.results, 'frozen per-case baseline changed; parity alone is insufficient');
    assert.equal(resultRows.length, fixture.queries.length * 2);
    assert.equal(metrics[0].stale_returns, 1, 'freeze the known baseline freshness gap, not an invented improvement');
    assert.equal(metrics[0].ambiguous_without_signal, 1);
    assert.equal(resultRows.find(row => row.adapter === 'cairn-v227' && row.case_id === 'linked-route').recall_at_5, 1 / 3);
  }
  console.log(JSON.stringify(report, null, 2));
} finally { await lab.close(); }
