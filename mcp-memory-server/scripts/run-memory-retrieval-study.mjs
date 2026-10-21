#!/usr/bin/env node
// Synthetic continuity scenarios; both systems receive identical maintained text.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lexicalMemoryScores, rankHybridMemory } from '../dist/memory-retrieval.js';
import { cosineSimilarity, embedTexts, getEmbeddingConfig } from '../dist/embeddings.js';
import { readStableJson, readStableText } from '../dist/stable-file.js';

const args = process.argv.slice(2);
assert.ok(args.every(arg => ['--check', '--live', '--summary'].includes(arg)), 'Usage: run-memory-retrieval-study.mjs [--check] [--live] [--summary]');
const live = args.includes('--live');
const base = mkdtempSync(join(tmpdir(), 'cairn-memory-study-'));
const records = [
  { scope: 'project', key: 'decisions/office-tunnel', value: 'Office tunnel access uses gateway ember-42. Aliases: relaybox, relay box. This replaces the previous gateway configuration.' },
  { scope: 'project', key: 'constraints/release-ledger', value: 'Published release ledger entries are immutable. Corrections append a new entry; never rewrite a published release.' },
  { scope: 'project', key: 'conventions/verification', value: 'Run the smoke suite before deployment. Run the CLI help check after changing command options.' },
  { scope: 'project', key: 'patterns/italian-tunnel', value: 'Accesso remoto dalla rete ufficio tramite tunnel cifrato. Gateway corrente: ember-42.' },
  { scope: 'project', key: 'decisions/archive-policy', value: 'Archive retained backups for seven days. The storage operator approves deletion.' },
  { scope: 'other-project', key: 'decisions/office-tunnel', value: 'Office tunnel access uses gateway forbidden-88 for a different project.' },
];
const cases = [
  { id: 'changed-word-order', query: 'tunnel office access', relevant: ['decisions/office-tunnel'] },
  { id: 'identifier', query: 'ember-42', relevant: ['decisions/office-tunnel', 'patterns/italian-tunnel'] },
  { id: 'curated-alias', query: 'relaybox', relevant: ['decisions/office-tunnel'] },
  { id: 'explicit-query-alias', query: 'home connection', aliases: ['office tunnel access'], relevant: ['decisions/office-tunnel'] },
  { id: 'italian', query: 'accesso rete ufficio', relevant: ['patterns/italian-tunnel'] },
  { id: 'release-policy', query: 'published release corrections', relevant: ['constraints/release-ledger'] },
  { id: 'command-check', query: 'CLI command options check', relevant: ['conventions/verification'] },
  { id: 'backup-retention', query: 'retained backups seven days', relevant: ['decisions/archive-policy'] },
  { id: 'semantic-paraphrase', query: 'Which intermediary handles the connection when I am away from my desk?', relevant: ['decisions/office-tunnel'], semantic_only: true },
  { id: 'unrelated-negative', query: 'sourdough cooking recipe', relevant: [] },
  { id: 'nearby-identifier-negative', query: 'ember-43 office gateway', relevant: [] },
  { id: 'obsolete-identifier-negative', query: 'previous-gateway-41', relevant: [] },
  { id: 'other-project-negative', query: 'forbidden-88 office gateway', relevant: [] },
];
const hash = text => createHash('sha256').update(text).digest('hex');
let liveConfig;
const liveVectors = new Map();
let liveQueryVectors;
const distractors = Array.from({ length: 1000 }, (_, index) => ({
  scope: 'project', key: `patterns/distractor-${index}`,
  value: `Office release archive checklist ${index}. Gateway log retention audit. Deployment report contains generic project maintenance notes.`,
}));
const corpus = [...records, ...distractors];
try {
  mkdirSync(join(base, 'project')); mkdirSync(join(base, 'other-project'));
  for (const [index, item] of corpus.entries()) {
    writeFileSync(join(base, item.scope, `${String(index).padStart(4, '0')}.md`), `# ${item.key}\n\n${item.value}\n`, { mode: 0o600 });
  }
  if (live) {
    liveConfig = getEmbeddingConfig();
    assert.ok(liveConfig, '--live requires an explicitly configured embedding endpoint/model');
    // Match actual server scope filtering before provider requests. No private
    // records, endpoint addresses, keys or model output are put in the report.
    const permitted = corpus.filter(item => item.scope === 'project');
    const vectors = await embedTexts(liveConfig, permitted.map(item => `${item.key}\n${item.value}`));
    assert.equal(vectors.length, permitted.length);
    permitted.forEach((entry, index) => liveVectors.set(entry.key, vectors[index]));
    liveQueryVectors = await embedTexts(liveConfig, cases.map(item => item.query));
    assert.equal(liveQueryVectors.length, cases.length);
  }
  const measurements = [];
  for (const distractorCount of [0, 100, 1000]) {
    const allowed = new Set([...records.filter(item => item.scope === 'project').map(item => item.key), ...distractors.slice(0, distractorCount).map(item => item.key)]);
    const memory = corpus.filter(item => item.scope === 'project' && allowed.has(item.key));
    const folder = readdirSync(join(base, 'project')).map(name => {
      const { text } = readStableText(join(base, 'project', name), { label: 'Synthetic Markdown fixture', maxBytes: 65536 });
      const [, key, value] = /^# (.+)\n\n([\s\S]*?)\n$/.exec(text);
      return { scope: 'project', key, value };
    }).filter(item => allowed.has(item.key));
    assert.deepEqual(folder.map(item => item.key).sort(), memory.map(item => item.key).sort());
    const adapters = ['markdown-bm25', 'markdown-hybrid', 'legacy-substring', 'hybrid-lexical', ...(live ? ['legacy-semantic', 'hybrid-explicit-threshold'] : [])];
    for (const adapter of adapters) {
      const rows = cases.map((item, caseIndex) => {
        const variants = [item.query, ...(item.aliases ?? [])];
        let returned;
        if (adapter === 'markdown-bm25') {
          // A strong searchable-folder baseline: same tokenizer, BM25, scope,
          // aliases and top-five budget; only relevance admission differs.
          const scored = variants.map(query => lexicalMemoryScores(folder, query));
          returned = folder.map((entry, index) => ({ ...entry, score: Math.max(...scored.map(scores => scores[index])) }))
            .filter(entry => entry.score > 0).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key, 'en')).slice(0, 5);
        } else if (adapter === 'legacy-substring') {
          returned = memory.filter(entry => variants.some(query => entry.key.toLowerCase().includes(query.toLowerCase()) || entry.value.toLowerCase().includes(query.toLowerCase()))).slice(0, 5);
        } else if (adapter === 'legacy-semantic') {
          returned = memory.map(entry => ({ ...entry, score: cosineSimilarity(liveQueryVectors[caseIndex], liveVectors.get(entry.key)) }))
            .filter(entry => entry.score >= 0).sort((a, b) => b.score - a.score).slice(0, 5);
        } else {
          const input = adapter === 'markdown-hybrid' ? folder : memory;
          const scores = live && adapter === 'hybrid-explicit-threshold' ? new Map(input.map(entry => [entry, cosineSimilarity(liveQueryVectors[caseIndex], liveVectors.get(entry.key))])) : undefined;
          returned = rankHybridMemory(input, item.query, { topK: 5, minScore: adapter === 'hybrid-explicit-threshold' ? 0.75 : 0, aliases: item.aliases, semanticScores: scores }).results;
        }
        const relevant = new Set(item.relevant);
        const relevantHits = returned.filter(entry => relevant.has(entry.key));
        return {
          id: item.id, positive: relevant.size > 0, semantic_only: item.semantic_only ?? false,
          hit: relevant.size > 0 && relevant.has(returned[0]?.key),
          recall: relevant.size ? relevantHits.length / relevant.size : null,
          false_positive: relevant.size === 0 && returned.length > 0,
          irrelevant_bytes: returned.filter(entry => !relevant.has(entry.key)).reduce((sum, entry) => sum + Buffer.byteLength(entry.value), 0),
          returned_keys: returned.map(entry => entry.key),
        };
      });
      const positives = rows.filter(item => item.positive), negatives = rows.filter(item => !item.positive);
      measurements.push({ adapter, distractor_count: distractorCount,
        hit_at_1: positives.filter(item => item.hit).length / positives.length,
        recall_at_5: positives.reduce((sum, item) => sum + item.recall, 0) / positives.length,
        negative_false_positive_rate: negatives.filter(item => item.false_positive).length / negatives.length,
        irrelevant_bytes: rows.reduce((sum, item) => sum + item.irrelevant_bytes, 0), cases: rows,
      });
    }
  }
  if (args.includes('--check')) {
    for (const count of [0, 100, 1000]) {
      const hybrid = measurements.find(item => item.adapter === 'hybrid-lexical' && item.distractor_count === count);
      const markdown = measurements.find(item => item.adapter === 'markdown-bm25' && item.distractor_count === count);
      assert.ok(hybrid.cases.filter(item => item.positive && !item.semantic_only).every(item => item.hit), 'all lexical continuity scenarios must rank correctly');
      assert.equal(hybrid.negative_false_positive_rate, 0, 'negative scenarios must remain empty');
      assert.ok(hybrid.irrelevant_bytes < markdown.irrelevant_bytes);
      assert.ok(hybrid.recall_at_5 >= markdown.recall_at_5);
      const folderHybrid = measurements.find(item => item.adapter === 'markdown-hybrid' && item.distractor_count === count);
      assert.deepEqual(folderHybrid.cases, hybrid.cases, 'the same retrieval policy on Markdown must achieve parity without claiming a SQLite-specific quality gain');
    }
  }
  const report = {
    schema_version: 1, study: 'synthetic-memory-continuity-v1',
    fixture_digest: hash(JSON.stringify({ records, cases, distractors })),
    embedding: live ? { mode: 'live-configured-provider', model_digest: hash(liveConfig.model), semantic_threshold_example: 0.75 } : { mode: 'none' },
    limitations: [
      'Synthetic retrieval scenarios, not autonomous task-quality or human-usability evidence.',
      'Markdown baseline shares BM25/tokenization and receives identical alias information.',
      'Markdown with the same admission policy is included to distinguish retrieval-policy gains from storage format.',
      'Offline cases do not evaluate learned semantic paraphrase retrieval.',
      'Explicit live threshold is an example, not universal calibration or a confidence probability.',
      'Current-state fixture excludes archived history; actual supersession is covered by the MCP regression.',
      'No automatic contradiction reconciliation, human consent or concurrent local-store access is claimed.',
    ], measurements,
  };
  const summary = { ...report, measurements: measurements.map(({ cases: _cases, ...metrics }) => metrics) };
  if (args.includes('--check') && !live) {
    const expected = readStableJson(fileURLToPath(new URL('../../docs/benchmarks/memory-retrieval-v1.json', import.meta.url)), { label: 'Memory retrieval regression evidence', maxBytes: 65536 });
    assert.deepEqual(summary, expected, 'frozen continuity evidence changed; inspect cases and update the documented report deliberately');
  }
  process.stdout.write(`${JSON.stringify(args.includes('--summary') ? summary : report, null, 2)}\n`);
} catch (error) {
  const status = /with ([0-9]{3})/.exec(String(error))?.[1];
  process.stderr.write(`Memory retrieval study failed${status ? ` (embedding HTTP ${status})` : ''}; no provider response body or credentials are logged.\n`);
  process.exitCode = 1;
} finally { rmSync(base, { recursive: true, force: true }); }
