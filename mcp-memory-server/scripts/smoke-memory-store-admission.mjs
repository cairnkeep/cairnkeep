#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createContinuityLab, serverEntry } from './memory-continuity-lab.mjs';

const lab = createContinuityLab();
const cli = fileURLToPath(new URL('../../bin/cairn', import.meta.url));
const path = join(lab.projects.alpha, '.agentfs', 'project.db');
const run = args => spawnSync(process.execPath, [cli, 'memory-context', ...args], { cwd: lab.projects.alpha, env: lab.env, encoding: 'utf8', timeout: 30_000 });
try {
  const planned = run(['init', '--scope', 'project', '--project', lab.projects.alpha, '--json']);
  assert.equal(planned.status, 0, 'fresh-store no-write plan must be a supported CLI operation');
  assert.equal(existsSync(path), false); assert.equal(existsSync(join(lab.projects.alpha, '.agentfs')), false);
  const plan = JSON.parse(planned.stdout); assert.match(plan.digest, /^[a-f0-9]{64}$/);
  assert.notEqual(run(['init', '--scope', 'project', '--project', lab.projects.alpha, '--apply', '--confirm', '0'.repeat(64), '--json']).status, 0);
  assert.equal(existsSync(join(lab.projects.alpha, '.agentfs')), false, 'wrong confirmation cannot create state');
  const applied = run(['init', '--scope', 'project', '--project', lab.projects.alpha, '--apply', '--confirm', plan.digest, '--json']);
  assert.equal(applied.status, 0, applied.stderr); assert.equal(existsSync(path), true);
  const store = await import('../dist/ordinary-memory-store.js');
  const format = await import('../dist/memory-store-format.js');
  const schema = await import('../dist/memory-context-schema.js');
  assert.equal(format.probeOrdinaryMemoryFormat(path).kind, 'context-v1');
  const digest = () => createHash('sha256').update(readFileSync(path)).digest('hex');
  const before = digest();
  assert.notEqual(run(['init', '--scope', 'project', '--project', lab.projects.alpha, '--apply', '--confirm', plan.digest, '--json']).status, 0);
  assert.equal(digest(), before);
  const status = run(['status', '--scope', 'project', '--project', lab.projects.alpha, '--json']);
  assert.equal(status.status, 0, status.stderr); assert.equal(JSON.parse(status.stdout).format, 'context-v1');
  assert.equal(digest(), before, 'observation must not initialize SDK schema or change durable bytes');

  for (const enabled of ['0', '1']) {
    const session = await lab.connect('alpha', { CAIRN_MEMORY_CONTEXT: enabled, CAIRN_TYPED_MEMORY_NODES: '1' });
    await session.call('memory_write', { scope: 'project', key: 'facts/fixture', value: 'A' });
    assert.equal((await session.call('memory_read', { scope: 'project', key: 'facts/fixture' })).results[0].value, 'A');
    await session.call('memory_supersede', { scope: 'project', key: 'facts/fixture', value: 'B' });
    assert.equal((await session.call('memory_read', { scope: 'project', key: 'facts/fixture' })).results[0].value, 'B');
    await session.call('memory_history', { scope: 'project', key: 'facts/fixture' });
    await session.call('memory_list', { scope: 'project' });
    await session.call('memory_search', { scope: 'project', query: 'fixture' });
    await session.call('memory_delete', { scope: 'project', key: 'facts/fixture' });
    assert.deepEqual((await session.call('memory_read', { scope: 'project', key: 'facts/fixture' })).results, []);
    await session.close();
  }
  const reviewed = await import('../dist/reviewed-memory-store.js');
  await reviewed.applyReviewedMemory('project', 'fixture-review', 'decisions/reviewed', 'reviewed fixture', { cwd: lab.projects.alpha, typed: true });
  const wakeup = spawnSync(process.execPath, [serverEntry, 'wakeup'], { cwd: lab.projects.alpha, env: lab.env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(wakeup.status, 0); assert.match(wakeup.stdout, /reviewed fixture/);
  await reviewed.invalidateReviewedMemory('project', 'fixture-review', 'decisions/reviewed', 'fixture invalidation', { cwd: lab.projects.alpha, typed: true });
  const nodes = await import('../dist/node-store.js');
  const doctor = await nodes.doctorTypedNodeStore({ scope: 'project', baseDir: join(lab.projects.alpha, '.agentfs') });
  assert.equal(doctor.ok, true, JSON.stringify(doctor.issues));
  const view = await store.openOrdinaryMemoryView(path, 'project');
  try {
    const row = await view.getDatabase().prepare(`SELECT generation,present FROM ${schema.CONTEXT_REVISION_TABLE} WHERE key=?`).get('decisions/reviewed');
    assert.equal(row.present, 0); assert.ok(row.generation >= 2);
  } finally { await view.close(); }

  const beta = join(lab.projects.beta, '.agentfs', 'project.db');
  const betaPlan = await store.planContextStoreInit({ path: beta, scope: 'project' });
  const contenders = await Promise.allSettled([
    store.applyContextStoreInit({ path: beta, scope: 'project', confirm: betaPlan.digest }),
    store.applyContextStoreInit({ path: beta, scope: 'project', confirm: betaPlan.digest }),
  ]);
  assert.equal(contenders.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(format.probeOrdinaryMemoryFormat(beta).kind, 'context-v1');
  const zero = join(lab.root, 'zero.db'); writeFileSync(zero, '');
  await assert.rejects(store.planContextStoreInit({ path: zero, scope: 'identity' }), /EXISTING_STORE_UNSUPPORTED/);
  if (process.platform !== 'win32') {
    const link = join(lab.root, 'link.db'); symlinkSync(path, link);
    await assert.rejects(store.planContextStoreInit({ path: link, scope: 'identity' }));
  }
  assert.equal(readdirSync(join(lab.projects.alpha, '.agentfs')).some(name => name.endsWith('.cairn-admission')), false);
  lab.assertOffline();
  console.log('PASS: fresh-only admission, no-overwrite, explicit confirmation, read-only status, actual MCP/review/wakeup/doctor routing and init races');
} finally { await lab.close(); }
