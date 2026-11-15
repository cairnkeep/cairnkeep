import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { planWikiEvidence, publishWikiEvidence, checkWikiEvidence } from '../dist/wiki-evidence.js';
import { createContinuation, readContinuation } from '../dist/continuation.js';
import { localFileReader } from '../dist/local-context-record.js';
import { createHash } from 'node:crypto';

const scratch = mkdtempSync(join(tmpdir(), 'cairn-evidence-continuity-'));
const root = join(scratch, 'Project α'), second = join(scratch, 'Other Project');
try {
  for (const p of [root, second]) mkdirSync(p, { mode: 0o700 });
  writeFileSync(join(root, 'source.md'), 'Use port 443. Do NOT expose port 8080.\n');
  writeFileSync(join(root, 'page.md'), '# Network\nUse port 443.\n');
  writeFileSync(join(second, 'route.md'), 'Use tunnel blue, not tunnel red.\n');
  const input = { schema_version: 1, pages: [{ path: 'page.md', sources: [{ path: 'source.md', quotes: ['Do NOT expose port 8080.'] }], links: ['source.md'] }] };
  const bom = Buffer.from('\ufeffA BOM is part of exact source bytes.');
  writeFileSync(join(root, 'bom.md'), bom);
  assert.equal(localFileReader(root)('bom.md').digest, createHash('sha256').update(bom).digest('hex'));
  writeFileSync(join(root, 'page.md'), '# Broken\n[[missing]]\n');
  assert.throws(() => planWikiEvidence(root, input), /unsafe|unreadable/);
  writeFileSync(join(root, 'page.md'), '# Network\n[Source](source.md)\n');
  const plan = planWikiEvidence(root, input);
  assert.equal(readdirSync(root).includes('.agentfs'), false, 'planning creates no runtime state');
  assert.throws(() => publishWikiEvidence(root, plan, '0'.repeat(64)), /confirm/);
  publishWikiEvidence(root, plan, plan.digest);
  assert.equal(checkWikiEvidence(root, plan.digest).ok, true);
  const packetInput = { schema_version: 1, owner: 'operator', goal: 'Resume network work', projects: [{ id: 'first', root }, { id: 'second', root: second }], entries: [
    { project: 'first', kind: 'decision', status: 'observed', text: 'Do NOT expose port 8080.', evidence: [{ path: 'source.md', quote: 'Do NOT expose port 8080.' }] },
    { project: 'second', kind: 'next_step', status: 'asserted', text: 'Check tunnel blue.', evidence: [{ path: 'route.md', quote: 'Use tunnel blue, not tunnel red.' }] },
    ...Array.from({ length: 12 }, () => ({ project: 'first', kind: 'question', status: 'hypothesis', text: 'Unconfirmed question '.repeat(40), evidence: [] })),
  ] };
  const packet = createContinuation(root, packetInput);
  const stored = join(root, '.agentfs', 'local-context', 'continuations', packet.digest + '.json');
  const before = readFileSync(stored);
  const tampered = JSON.parse(before); tampered.goal = 'forged goal';
  writeFileSync(stored, JSON.stringify(tampered));
  assert.throws(() => readContinuation(root, packet.digest), /digest mismatch/);
  writeFileSync(stored, before);
  const output = readContinuation(root, packet.digest, 4096);
  assert.ok(Buffer.byteLength(JSON.stringify(output) + '\n') <= 4096);
  assert.equal(output.truncated, true);
  assert.equal(output.entries[0].text, 'Do NOT expose port 8080.');
  assert.deepEqual(readFileSync(stored), before, 'reading never consumes or rewrites a packet');
  const cli = join(import.meta.dirname, '..', 'dist', 'continuation-cli.js');
  for (const cwd of [root, second]) {
    const result = spawnSync(process.execPath, [cli, 'show', packet.digest, '--project', root, '--max-bytes', '4096', '--json'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), output, 'fresh processes and cwd changes preserve continuation');
  }
  assert.throws(() => readContinuation(second, packet.digest), /unsafe|unreadable|not found/);
  assert.throws(() => readContinuation(root, packet.digest, 32769), /budget/);
  const unknown = structuredClone(packetInput); unknown.entries[0].project = 'unselected';
  assert.throws(() => createContinuation(root, unknown), /unselected/);
  unknown.entries[0].project = 'first'; unknown.entries[0].evidence[0].quote = 'Not in the source';
  assert.throws(() => createContinuation(root, unknown), /quote missing/);
  writeFileSync(join(root, 'source.md'), 'Use port 8443.\n');
  const changed = checkWikiEvidence(root, plan.digest);
  assert.equal(changed.ok, false);
  assert.ok(changed.findings.some(f => f.code === 'source_changed' && f.page === 'page.md'));
  assert.ok(changed.findings.some(f => f.code === 'quote_missing'));
  assert.equal(readContinuation(root, packet.digest).entries[0].stale, true);
  assert.throws(() => publishWikiEvidence(root, plan, plan.digest), /changed|stale/);
  for (const path of ['../escape', '/absolute', 'C:/absolute', 'a\\b', 'a/../b', '.git/config']) {
    const bad = structuredClone(input); bad.pages[0].sources[0].path = path;
    assert.throws(() => planWikiEvidence(root, bad));
  }
  const extra = structuredClone(input); extra.unknown = true;
  assert.throws(() => planWikiEvidence(root, extra));
  writeFileSync(join(root, 'invalid.md'), Buffer.from([0xff]));
  const invalid = structuredClone(input); invalid.pages[0].path = 'invalid.md';
  assert.throws(() => planWikiEvidence(root, invalid), /UTF-8/);
  writeFileSync(join(root, 'large.md'), Buffer.alloc(1024 * 1024 + 1));
  invalid.pages[0].path = 'large.md';
  assert.throws(() => planWikiEvidence(root, invalid), /unsafe|limit/);
  if (process.platform !== 'win32') {
    symlinkSync(second, join(root, 'linked'));
    invalid.pages[0].path = 'linked/route.md';
    assert.throws(() => planWikiEvidence(root, invalid), /symlink|unsafe/);
    const fifo = spawnSync('mkfifo', [join(root, 'pipe.md')]);
    assert.equal(fifo.status, 0);
    invalid.pages[0].path = 'pipe.md';
    assert.throws(() => planWikiEvidence(root, invalid), /unsafe/);
  }
  // Documentation examples are schema-checked, not just copied from prose.
  const doc = readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'evidence-continuity.md'), 'utf8');
  const { wikiEvidenceInputSchema } = await import('../dist/wiki-evidence.js');
  const { continuationInputSchema } = await import('../dist/continuation.js');
  const { consolidationInputSchema } = await import('../dist/memory-proposal-schema.js');
  const lf = doc.replace(/\r\n/g, '\n');
  for (const text of [lf, lf.replace(/\n/g, '\r\n')]) {
    const samples = [...text.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)].map(m => JSON.parse(m[1]));
    assert.equal(samples.length, 3, 'all documented examples must be checked with LF and CRLF');
    wikiEvidenceInputSchema.parse(samples[0]); continuationInputSchema.parse(samples[1]); consolidationInputSchema.parse(samples[2]);
  }
  console.log('PASS: deterministic evidence, literal fidelity, bounded non-consuming cross-process/cwd/project continuity and hostile local paths');
} finally { rmSync(scratch, { recursive: true, force: true }); }
