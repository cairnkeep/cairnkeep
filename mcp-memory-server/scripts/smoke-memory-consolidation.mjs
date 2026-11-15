import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentFS } from 'agentfs-sdk';
import { createConsolidationProposal, applyMemoryProposal, showMemoryProposal } from '../dist/memory-proposal-store.js';
import { putTrajectory } from '../dist/trajectory-store.js';
import { redactTrajectory } from '../dist/trajectory-redaction.js';

const scratch = mkdtempSync(join(tmpdir(), 'cairn-consolidation-'));
const root = join(scratch, 'project'), base = join(scratch, 'memory');
const old = { ...process.env }, fetch = globalThis.fetch;
try {
  mkdirSync(root, { mode: 0o700 }); mkdirSync(base, { mode: 0o700 });
  mkdirSync(join(root, '.agentfs'), { mode: 0o700 });
  process.env.CAIRN_AGENTFS_BASE_DIR = base;
  globalThis.fetch = () => { throw new Error('Consolidation must not call a provider.'); };
  const make = (id, text) => ({ schema_version: 1, session_id: id, harness: 'pi', project_root: root,
    started_at: '2026-11-01T10:00:00Z', ended_at: '2026-11-01T10:01:00Z',
    events: [{ sequence: 0, kind: 'tool_result', payload: { text } }],
    capture: { captured_at: '2026-11-01T10:01:00Z', omitted_reasoning_blocks: 0, omitted_unknown_records: 0, truncated: false } });
  const save = s => putTrajectory(root, redactTrajectory(s, root), { sessionMaxBytes: 1024*1024, storeMaxBytes: 4*1024*1024, retentionDays: 3650 });
  await save(make('first', 'Do NOT expose port 8080.'));
  await save(make('second', 'Use port 443 and tunnel blue.'));
  const input = { schema_version: 1, candidates: [{ key: 'decisions/network', value: 'Do NOT expose port 8080. Use port 443 and tunnel blue.',
    status: 'asserted', preserve: ['Do NOT expose port 8080.', '443', 'tunnel blue'], evidence: [
      { session_id: 'first', sequence: 0, quote: 'Do NOT expose port 8080.' },
      { session_id: 'second', sequence: 0, quote: 'Use port 443 and tunnel blue.' },
    ] }] };
  const options = { projectRoot: root, sessionIds: ['first', 'second'], scope: 'identity', input };
  if (process.platform !== 'win32') {
    chmodSync(join(root, '.agentfs'), 0o777);
    await assert.rejects(() => createConsolidationProposal(options), /unsafe/);
    chmodSync(join(root, '.agentfs'), 0o700);
  }
  input.candidates.push({ ...structuredClone(input.candidates[0]), key: 'patterns/no-partial-write' });
  const proposal = await createConsolidationProposal(options);
  assert.equal(proposal.schema_version, 2);
  assert.equal(proposal.source.kind, 'trajectories');
  assert.match(proposal.candidates[0].value, /^\[asserted\]/);
  assert.equal(showMemoryProposal(proposal.digest, root).digest, proposal.digest);
  const bad = structuredClone(input); bad.candidates[0].value = 'Expose port 8080. Use port 443 and tunnel blue.';
  await assert.rejects(() => createConsolidationProposal({ ...options, input: bad }), /preserv|literal/);
  bad.candidates[0].evidence[0].quote = 'An invented quote';
  await assert.rejects(() => createConsolidationProposal({ ...options, input: bad }), /quote|evidence|preserv/);
  await assert.rejects(() => createConsolidationProposal({ ...options, sessionIds: ['first', 'first'] }), /distinct/);
  await assert.rejects(() => createConsolidationProposal({ ...options, sessionIds: ['firs', 'second'] }), /exact/);
  const foreign = structuredClone(input); foreign.candidates[0].evidence[0].session_id = 'unselected';
  await assert.rejects(() => createConsolidationProposal({ ...options, input: foreign }), /evidence/);
  const secret = 'synthetic-consolidation-secret-123456789';
  process.env.CAIRN_LLM_API_KEY = secret;
  const unsafe = structuredClone(input); unsafe.candidates[0].value += secret;
  await assert.rejects(() => createConsolidationProposal({ ...options, input: unsafe }), /redacted/);
  delete process.env.CAIRN_LLM_API_KEY;
  await save(make('second', 'Use port 8443, not 443.'));
  await assert.rejects(() => applyMemoryProposal(proposal.digest, root), /stale/);
  await save(make('second', 'Use port 443 and tunnel blue.'));
  const changing = await AgentFS.open({ id: 'identity', path: join(base, 'identity.db') });
  try { await changing.kv.set('decisions/network', 'changed target'); } finally { await changing.close(); }
  await assert.rejects(() => applyMemoryProposal(proposal.digest, root), /stale/);
  const refused = await AgentFS.open({ id: 'identity', path: join(base, 'identity.db') });
  try {
    assert.equal(await refused.kv.get('patterns/no-partial-write'), undefined, 'stale base must not partially apply a second candidate');
    await refused.kv.delete('decisions/network');
  } finally { await refused.close(); }
  const result = await applyMemoryProposal(proposal.digest, root);
  assert.equal(result.applied, true);
  const agent = await AgentFS.open({ id: 'identity', path: join(base, 'identity.db') });
  try { assert.equal(await agent.kv.get('decisions/network'), '[asserted]\nDo NOT expose port 8080. Use port 443 and tunnel blue.'); }
  finally { await agent.close(); }
  assert.equal((await applyMemoryProposal(proposal.digest, root)).idempotent, true);
  console.log('PASS: cross-session consolidation, explicit status, exact literal preservation, stale refusal and existing atomic reviewed apply without providers');
} finally { globalThis.fetch = fetch; process.env = old; rmSync(scratch, { recursive: true, force: true }); }
