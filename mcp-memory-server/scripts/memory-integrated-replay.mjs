// Joint synthetic tool workflow. Markdown derives its own answers from files.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as ordinary from '../dist/ordinary-memory-store.js';
import { rankHybridMemory } from '../dist/memory-retrieval.js';
import { MemoryFeedbackSession, listMemoryFeedback } from '../dist/memory-feedback.js';
import { planFreshnessChange, applyFreshnessChange } from '../dist/memory-context-store.js';

export function createIntegratedReplay({ fixture, corpusBytes, lab, folder, markers, generations,
  metadataRevisions, storeKey, partitionId, store, client, closeClients, markdownMap, markdownRelated,
  curationCost, recordFreshness, hash }) {
  const bytes = readFileSync(new URL('./fixtures/memory-integrated-workflows-v1.json', import.meta.url));
  const contract = JSON.parse(bytes), policyBytes = readFileSync(new URL('./fixtures/memory-feedback-policy-v1.json', import.meta.url));
  const policy = JSON.parse(policyBytes);
  assert.equal(hash(corpusBytes), contract.corpus_sha256); assert.equal(hash(policyBytes), contract.feedback_policy_sha256);
  const controls = [], workflows = [], ablations = [], votes = new Map();
  const ledger = store({ project: 'alpha', scope: 'project' });
  const admin = new MemoryFeedbackSession(ledger, scope => store({ project: 'alpha', scope }));
  let recorded = 0, trainingMs = 0, restore, metadataReceipt, metadataSource;
  const task = hash('integrated-metadata-control');
  const mdRows = item => readdirSync(folder).filter(name => name.endsWith('.md'))
    .map(name => JSON.parse(readFileSync(join(folder, name), 'utf8')))
    .filter(entry => entry.present && (entry.row.scope !== 'project' || entry.row.project === item.project)
      && (item.scope === 'all' ? ['project', 'identity'].includes(entry.row.scope) : entry.row.scope === item.scope));
  const source = row => {
    const marker = markers.get(partitionId(row));
    return { owner_domain: marker.owner_domain, scope: row.scope, schema_version: 1, store_uuid: marker.store_uuid,
      restore_epoch: marker.restore_epoch, key: row.key, generation: generations.get(storeKey(row)),
      content_digest: hash(JSON.stringify(row.value)), context_revision: metadataRevisions.get(storeKey(row)) ?? 0 };
  };
  const mdCandidates = item => mdRows(item).map(({ row }) => ({ scope: row.scope, key: row.key, value: row.value, source: source(row) }));
  const mdSearch = item => rankHybridMemory(mdCandidates(item), item.query, { topK: fixture.limits.top_k, minScore: 0 }).results;
  const mdEligible = (entry, project) => (new Map(JSON.parse(readFileSync(join(folder, 'feedback.json'), 'utf8'))).get(project) ?? []).filter(row => row.source_digest === hash(entry.source)
    && row.ledger_epoch === markers.get(`${project}:project`).restore_epoch);
  function mdFreshness(entry) {
    const data = JSON.parse(readFileSync(join(folder, 'curation.json'), 'utf8'));
    const found = data.freshness?.find(row => Object.keys(entry.source).every(key => row.source[key] === entry.source[key]));
    return !found ? 'unknown' : !found.metadata.verified_at ? 'unverified'
      : found.metadata.review_after && Date.parse(found.metadata.review_after) <= Date.now() ? 'needs_review' : 'current';
  }
  function mdRank(entries, item) {
    const weights = entries.map(entry => {
      const tasks = new Map(mdEligible(entry, item.project).map(row => [row.task_digest, row.outcome]));
      const delta = tasks.size < policy.minimum_tasks ? 0 : policy.max_delta
        * [...tasks.values()].reduce((n, outcome) => n + (outcome === 'useful' ? 1 : -1), 0) / tasks.size;
      return { count: tasks.size, delta: Math.round((Math.max(0, Math.min(1, entry.score + delta)) - entry.score) * 1e6) / 1e6 };
    });
    const out = [...entries], exact = item.query.normalize('NFKC').toLowerCase().trim();
    for (let i = 0; i < entries.length - 1; i++) {
      const a = entries[i], b = entries[i + 1];
      if (a.key.normalize('NFKC').toLowerCase() === exact || b.key.normalize('NFKC').toLowerCase() === exact
        || a.scope !== b.scope || a.source.owner_domain !== b.source.owner_domain || a.source.store_uuid !== b.source.store_uuid
        || a.source.restore_epoch !== b.source.restore_epoch || Math.floor(a.score * 10) !== Math.floor(b.score * 10)) continue;
      if (Math.round((weights[i + 1].delta - weights[i].delta) * 1e6) <= Math.round(Math.abs(a.score - b.score) * 1e6)) continue;
      const reason = (index, displacement) => ({ policy: policy.name, evidence: 'self-reported-usefulness', distinct_tasks: weights[index].count, delta: weights[index].delta, displacement });
      out[i] = { ...b, feedback: reason(i + 1, -1) }; out[i + 1] = { ...a, feedback: reason(i, 1) }; i++;
    }
    return out;
  }
  const projection = entry => ({ scope: entry.scope, key: entry.key, value: entry.value, score: entry.score,
    source: entry.source, ...(entry.feedback ? { feedback: entry.feedback } : {}) });
  const control = id => controls.push({ id, passed: true });
  const edges = rows => rows.map(row => ({ id: row.id, revision: row.revision,
    from: typeof row.from === 'string' ? row.from : row.from.id, to: typeof row.to === 'string' ? row.to : row.to.id,
    predicate: row.predicate, evidence: row.evidence })).sort((a, b) => a.id.localeCompare(b.id));
  function markdownWorkflow(item, ranked) {
    const calls = [];
    const observe = (name, operation, budget = contract.observation_bytes) => {
      const started = performance.now(), value = operation();
      const bytes = Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value }));
      assert.ok(bytes <= budget);
      calls.push({ name, bytes, elapsed_ms: performance.now() - started }); return value;
    };
    observe('memory_map', () => markdownMap(item), contract.map_bytes);
    const related = observe('memory_related', () => markdownRelated(item));
    // Keys come from independent file/curation traversal, not the native answer.
    for (const key of related.keys) observe('memory_read', () => ({ results: mdRows(item).filter(entry => entry.row.key === key).map(entry => entry.row) }));
    observe('memory_context_search', () => ranked ? mdRank(mdSearch(item), item) : mdSearch(item));
    observe('memory_inspect', () => {
      const entry = mdCandidates(item).find(row => row.key === related.keys[0]);
      return { value: entry.value, source: entry.source, status: mdFreshness(entry) };
    });
    return { keys: related.keys, calls, total_bytes: calls.reduce((n, row) => n + row.bytes, 0),
      total_ms: calls.reduce((n, row) => n + row.elapsed_ms, 0), transport: 'in-process-control',
      byte_model: 'control-values-with-matching-CallToolResult-framing-not-an-actual-MCP-server' };
  }
  async function observed(session, name, input, calls, maxBytes = contract.observation_bytes) {
    const start = performance.now(), raw = await session.client.callTool({ name, arguments: input });
    assert.notEqual(raw.isError, true, JSON.stringify(raw));
    const size = Buffer.byteLength(JSON.stringify(raw)); assert.ok(size <= maxBytes, `${name}: complete frame bound`);
    calls?.push({ name, bytes: size, elapsed_ms: performance.now() - start });
    return raw.structuredContent ?? JSON.parse(raw.content[0].text);
  }
  async function relatedControl(id, item, keys, ambiguous = false) {
    const native = await observed(await client(item.project, 'integrated-a'), 'memory_related',
      { scope: item.scope, entity: item.entity, depth: 2 });
    const md = markdownRelated({ ...item, depth: 2 });
    assert.deepEqual(native.nodes.map(row => row.anchor.key).sort(), keys.toSorted());
    assert.deepEqual(md.keys, keys.toSorted()); assert.equal(native.ambiguous, ambiguous); assert.equal(md.ambiguous, ambiguous);
    assert.deepEqual(edges(native.edges), edges(md.edges));
    control(id);
  }
  async function workflow(ranked) {
    const item = { project: 'alpha', scope: 'project', query: 'sensor lumen', entity: 'sensor lumen', depth: 2 };
    const session = await client('alpha', ranked ? 'integrated-ranked' : 'integrated-a', ranked), calls = [];
    const navigation = await observed(session, 'memory_map', { scope: 'project', max_bytes: contract.map_bytes }, calls, contract.map_bytes);
    assert.deepEqual(navigation, markdownMap(item));
    assert.ok(navigation.partitions[0].entries.some(entry => entry.kind === 'prefix' && entry.prefix === 'devices'));
    const related = await observed(session, 'memory_related', { scope: 'project', entity: item.entity, depth: 2 }, calls);
    const md = markdownRelated(item), keys = related.nodes.map(row => row.anchor.key).sort();
    assert.deepEqual(keys, contract.linked_keys); assert.deepEqual(md.keys, keys);
    assert.deepEqual(edges(related.edges), edges(md.edges));
    for (const key of keys) {
      const exact = await observed(session, 'memory_read', { scope: 'project', key }, calls);
      const independent = mdRows(item).find(entry => entry.row.key === key).row;
      assert.equal(exact.results.length, 1); assert.equal(exact.results[0].value, independent.value);
    }
    const searched = await observed(session, 'memory_context_search', { scope: 'project', query: item.query, top_k: fixture.limits.top_k }, calls);
    const independent = ranked ? mdRank(mdSearch(item), item) : mdSearch(item);
    assert.deepEqual(searched.results.map(projection), independent.map(projection));
    const inspected = await observed(session, 'memory_inspect', { scope: 'project', key: keys[0] }, calls);
    assert.equal(inspected.candidates[0].status, 'unknown');
    assert.equal(inspected.candidates[0].value, mdRows(item).find(entry => entry.row.key === keys[0]).row.value);
    const markdown = markdownWorkflow(item, ranked); assert.deepEqual(markdown.keys, keys);
    workflows.push({ arm: ranked ? 'bounded-ranking' : 'recommended-collection-only', keys, calls, markdown,
      total_bytes: calls.reduce((n, row) => n + row.bytes, 0), total_ms: calls.reduce((n, row) => n + row.elapsed_ms, 0),
      markdown_linked_keys: md.keys, extra_operator_curation_required: true, map_truncated: navigation.truncated,
      related_seed: 'caller-supplied-explicit-alias' });
  }
  return {
    async start() {
      const trainingStarted = performance.now();
      // Only development relevance labels create votes, before any held-out replay.
      for (const item of fixture.queries.filter(row => row.split === 'development')) {
        const session = await client(item.project, 'integrated-a');
        for (let repetition = 0; repetition < contract.development_tasks_per_query; repetition++) {
          const taskDigest = hash(['integration-development-v1', item.id, repetition]);
          const native = await observed(session, 'memory_context_search', { scope: item.scope, query: item.query,
            top_k: fixture.limits.top_k, task_digest: taskDigest });
          const independent = mdSearch(item);
          assert.deepEqual(native.results.map(projection), independent.map(projection));
          for (const entry of native.results) {
            const row = mdRows(item).find(candidate => candidate.row.key === entry.key && candidate.row.scope === entry.scope).row;
            const outcome = item.relevant.includes(row.id) ? 'useful' : 'wrong_context';
            assert.ok(entry.receipt);
            assert.equal((await session.call('memory_feedback_record', { receipt: entry.receipt, task_digest: taskDigest, outcome })).recorded, true);
            recorded++;
          }
          const projectVotes = votes.get(item.project) ?? [];
          for (const entry of independent) {
            const row = mdRows(item).find(candidate => candidate.row.key === entry.key && candidate.row.scope === entry.scope).row;
            projectVotes.push({ source_digest: hash(source(row)), task_digest: taskDigest,
              outcome: item.relevant.includes(row.id) ? 'useful' : 'wrong_context', ledger_epoch: markers.get(`${item.project}:project`).restore_epoch });
          }
          votes.set(item.project, projectVotes);
        }
      }
      writeFileSync(join(folder, 'feedback.json'), JSON.stringify([...votes]), { mode: 0o600 });
      trainingMs = performance.now() - trainingStarted;
      assert.equal(recorded, 15);
      await workflow(false); await workflow(true); control('linked-workflow');
      await relatedControl('ambiguous-alias', { project: 'alpha', scope: 'project', entity: 'relay' }, [], true);
      await relatedControl('foreign-project', { project: 'beta', scope: 'project', entity: 'sensor lumen' }, []);
      await relatedControl('nearby-identifier', { project: 'alpha', scope: 'project', entity: 'ember-43' }, []);
      // A separate real process and generic cwd share only the identity scope.
      await relatedControl('generic-cwd-handoff', { project: 'neutral', scope: 'identity', entity: 'relaybox' }, ['decisions/office-tunnel']);
    },
    async heldOut() {
      const before = (await listMemoryFeedback(ledger)).records;
      for (const item of fixture.queries) for (const ranked of [false, true]) {
        const session = await client(item.project, ranked ? 'integrated-ranked' : 'integrated-a', ranked), calls = [];
        const native = await observed(session, 'memory_context_search', { scope: item.scope, query: item.query,
          top_k: fixture.limits.top_k }, calls);
        const started = performance.now(), independent = ranked ? mdRank(mdSearch(item), item) : mdSearch(item);
        const markdownMs = performance.now() - started;
        assert.deepEqual(native.results.map(projection), independent.map(projection));
        assert.deepEqual(native.results.map(row => row.freshness), independent.map(mdFreshness));
        const idsFor = entries => entries.map(entry => {
          const row = mdRows(item).find(candidate => candidate.row.scope === entry.scope && candidate.row.key === entry.key && candidate.row.value === entry.value);
          assert.ok(row, 'joint ablation returned foreign/history/unknown content'); return row.row.id;
        });
        for (const [adapter, entries, elapsed] of [[ranked ? 'joint-bounded-ranking' : 'joint-collection-only', native.results, calls[0].elapsed_ms],
          [ranked ? 'markdown-bounded-ranking' : 'markdown-collection-only', independent, markdownMs]]) {
          const ids = idsFor(entries), relevant = new Set(item.relevant);
          ablations.push({ adapter, case_id: item.id, split: item.split, ids,
            hit_at_1: relevant.size ? Number(relevant.has(ids[0])) : null,
            recall_at_5: relevant.size ? ids.filter(id => relevant.has(id)).length / relevant.size : null,
            stale_returns: ids.filter(id => (item.stale ?? []).includes(id)).length,
            freshness_warnings: entries.filter(entry => mdFreshness(entry) === 'needs_review').length,
            false_positive: !relevant.size && ids.length > 0, elapsed_ms: elapsed,
            candidate_bytes: Buffer.byteLength(JSON.stringify(entries.map(projection))) });
        }
      }
      assert.deepEqual((await listMemoryFeedback(ledger)).records, before, 'held-out queries never train feedback');
    },
    async metadataChange(row) {
      metadataSource = source(row); metadataReceipt = await admin.issue(metadataSource, task);
      assert.ok(metadataReceipt); assert.ok((await admin.eligible([metadataSource])).size > 0);
      const target = { ...store(row), key: row.key, input: { schema_version: 1, source_refs: ['opaque:integrated-control'],
        verified_at: '1999-01-01T00:00:00Z', review_after: '2000-01-01T00:00:00Z' } };
      const started = performance.now(), plan = await planFreshnessChange(target), applied = await applyFreshnessChange({ ...target, confirm: plan.digest });
      recordFreshness(performance.now() - started);
      metadataRevisions.set(storeKey(row), (metadataRevisions.get(storeKey(row)) ?? 0) + 1);
      const file = join(folder, `${hash(storeKey(row))}.md`), current = JSON.parse(readFileSync(file, 'utf8'));
      writeFileSync(file, JSON.stringify({ ...current, context_revision: metadataRevisions.get(storeKey(row)) }), { mode: 0o600 });
      const curation = JSON.parse(readFileSync(join(folder, 'curation.json'), 'utf8'));
      curation.freshness = [...(curation.freshness ?? []), { source: applied.source, metadata: target.input }];
      writeFileSync(join(folder, 'curation.json'), JSON.stringify(curation), { mode: 0o600 });
      assert.deepEqual(applied.source, source(row));
      const inspected = await observed(await client('alpha', 'integrated-a'), 'memory_inspect', { scope: row.scope, key: row.key });
      assert.equal(inspected.candidates[0].status, 'needs_review'); assert.equal(inspected.candidates[0].value, row.value);
      await assert.rejects(admin.record({ receipt: metadataReceipt, task_digest: task, outcome: 'useful' }), /MEMORY_FEEDBACK_SOURCE_STALE/);
      assert.equal((await admin.eligible([metadataSource, source(row)])).size, 0);
      assert.equal(mdEligible({ source: source(row) }, 'alpha').length, 0);
      await relatedControl('metadata-invalidation', { project: 'alpha', scope: 'project', entity: 'glimmer' }, []);
    },
    async afterAba(row) {
      assert.ok(source(row).generation > metadataSource.generation);
      await assert.rejects(admin.record({ receipt: metadataReceipt, task_digest: task, outcome: 'useful' }), /MEMORY_FEEDBACK_SOURCE_STALE/);
      assert.equal((await admin.eligible([source(row)])).size, 0);
      assert.equal(mdEligible({ source: source(row) }, 'alpha').length, 0);
      await relatedControl('source-aba', { project: 'alpha', scope: 'project', entity: 'glimmer' }, []);
    },
    async finishRestore() {
      const local = { project: 'alpha', scope: 'project', key: 'constraints/release-ledger' };
      const projectSource = mdCandidates(local).find(row => row.key === local.key).source;
      const identitySource = mdCandidates({ project: 'alpha', scope: 'identity' })[0].source;
      assert.equal((await admin.eligible([projectSource, identitySource])).size, 2);
      const restoreTask = hash('integration-same-secret-epoch'), receipt = await admin.issue(projectSource, restoreTask);
      assert.ok(receipt); const previous = (await listMemoryFeedback(ledger)).records;
      assert.equal(previous.length, 15);
      await closeClients();
      const output = join(lab.root, 'integrated-snapshot.db');
      await ordinary.backupMemoryContextStore({ ...ledger, output });
      // Retain the entire idle directory, including sidecars; restore never overwrites it.
      renameSync(dirname(ledger.path), join(lab.projects.alpha, 'preserved-agentfs'));
      const plan = await ordinary.planContextStoreRestore({ ...ledger, input: output });
      const applied = await ordinary.applyContextStoreRestore({ ...ledger, input: output, confirm: plan.digest });
      markers.set('alpha:project', applied.marker);
      assert.notEqual(applied.marker.restore_epoch, projectSource.restore_epoch);
      // Keep the same cryptographic session object: failure specifically tests epoch renewal.
      await assert.rejects(admin.record({ receipt, task_digest: restoreTask, outcome: 'useful' }), /MEMORY_FEEDBACK_SOURCE_STALE/);
      const current = mdCandidates(local).find(row => row.key === local.key);
      assert.equal(current.source.generation, projectSource.generation);
      assert.equal((await admin.eligible([current.source, identitySource])).size, 0);
      assert.equal(mdEligible(current, 'alpha').length, 0);
      assert.equal(mdEligible({ source: identitySource }, 'alpha').length, 0, 'restoring project ledger invalidates even unchanged shared-source votes');
      assert.deepEqual((await listMemoryFeedback(ledger)).records, previous, 'restore retains minimized historical votes');
      const session = await client('alpha', 'integrated-after-restore');
      const graph = await observed(session, 'memory_related', { scope: 'project', entity: 'sensor lumen', depth: 2 });
      assert.equal(graph.nodes.length, 0); assert.deepEqual(markdownRelated({ project: 'alpha', scope: 'project', entity: 'sensor lumen' }).keys, []);
      const map = await observed(session, 'memory_map', { scope: 'project', max_bytes: contract.map_bytes }, null, contract.map_bytes);
      assert.deepEqual(map, markdownMap(local)); assert.ok(map.partitions[0].entries.every(row => row.kind !== 'entity'));
      const exact = await observed(session, 'memory_read', { scope: 'project', key: local.key });
      assert.equal(exact.results[0].value, current.value);
      restore = { epoch_changed: true, old_graph_active: false, old_feedback_eligible: false,
        old_feedback_rows_retained: true, retained_feedback_rows: previous.length, same_secret_epoch_control: true,
        unchanged_shared_source_vote_invalidated: true, old_directory_retained: true };
      control('managed-restore');
    },
    report() {
      assert.deepEqual(controls.map(row => row.id).sort(), contract.required_controls.toSorted());
      const metrics = [...new Set(ablations.map(row => row.adapter))].map(adapter => {
        const held = ablations.filter(row => row.adapter === adapter && row.split === 'held-out');
        const mean = field => { const eligible = held.filter(row => row[field] !== null); return eligible.reduce((n, row) => n + row[field], 0) / eligible.length; };
        return { adapter, held_out_cases: held.length, hit_at_1: mean('hit_at_1'), recall_at_5: mean('recall_at_5'),
          stale_returns: held.reduce((n, row) => n + row.stale_returns, 0), negative_false_positives: held.filter(row => row.false_positive).length,
          freshness_warnings: held.reduce((n, row) => n + row.freshness_warnings, 0) };
      });
      assert.equal(ablations.length, fixture.queries.length * 4);
      assert.ok(metrics.every(row => row.negative_false_positives === 0));
      return { executed: true, workflow_fixture_digest: hash(bytes), corpus_digest: hash(corpusBytes), policy_digest: hash(policyBytes),
        evaluation_digest: hash(Buffer.concat([readFileSync(new URL(import.meta.url)), readFileSync(new URL('./run-memory-connections-study.mjs', import.meta.url))])),
        sequence: contract.sequence, recommended_ranking_enabled: false, markdown_independent: true,
        development_feedback_records: recorded, feedback_training_split: 'development-only',
        feedback_training_calls: recorded * 2, training_and_control_ms: trainingMs,
        operator_curation: curationCost(), seed_mutations: fixture.events.length, workflows, controls, restore, metrics, query_ablations: ablations,
        limitations: ['Synthetic explicit tool sequence, not autonomous model quality or real harness UI.',
          'Both arms receive the same explicit curation; graph traversal adds calls and operator work.',
          'Per-call frame budgets are not whole-conversation budgets; workflow costs are summed separately.',
          'Native timings include actual MCP/worker/ACL overhead; Markdown is an in-process file control, not backend efficiency evidence.',
          'Ordinary query ablations remain separate from the extra-curated multi-call linked workflow; no silent graph expansion is added to search.',
          'Ranking stays off; the separate frozen held-out study retains its no-gain result.'] };
    },
  };
}
