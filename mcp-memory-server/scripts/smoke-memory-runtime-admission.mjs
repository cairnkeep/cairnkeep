#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MemoryDatabase, assertContextRuntime } from '../dist/memory-database.js';
import { openOrdinaryMemoryStore } from '../dist/ordinary-memory-store.js';
import { hardenPrivatePath } from '../dist/platform-security.js';

let refusal;
try { assertContextRuntime(); } catch (error) { refusal = error.code; }
if (!refusal) {
  console.log('PASS: actual Node runtime bundles a WAL-reset-patched SQLite');
} else {
  assert.ok(['MEMORY_RUNTIME_UNSUPPORTED', 'MEMORY_SQLITE_UNPATCHED'].includes(refusal));
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'cairn-runtime-admission-'))); hardenPrivatePath(root);
  const project = join(root, 'project'); mkdirSync(project, { mode: 0o700 }); hardenPrivatePath(project);
  const home = join(root, 'home'); mkdirSync(home, { mode: 0o700 }); hardenPrivatePath(home);
  let legacy;
  try {
    legacy = await openOrdinaryMemoryStore(join(root, 'legacy.db'), 'identity', { create: true });
    await legacy.kv.set('facts/legacy', 'retained'); assert.equal(await legacy.kv.get('facts/legacy'), 'retained');
    await legacy.close(); legacy = undefined;
    const target = join(root, 'refused.db');
    await assert.rejects(MemoryDatabase.open(target, { create: true }), { code: refusal });
    assert.equal(existsSync(target), false, 'unsupported runtime must not create a native database');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^(CAIRN_|MCP_|NODE_OPTIONS|NODE_PATH|AGENT_MEMORY_CONFIG)/.test(key) && !/(?:API_KEY|TOKEN|SECRET)/.test(key)));
    Object.assign(env, { HOME: home, USERPROFILE: home, CAIRN_AGENTFS_BASE_DIR: join(root, 'stores') });
    const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../../bin/cairn', import.meta.url)),
      'memory-context', 'init', '--scope', 'project', '--project', project, '--json'], { env, encoding: 'utf8', timeout: 30000 });
    assert.equal(cli.status, 1); assert.ok(cli.stderr.includes(refusal));
    assert.equal(existsSync(join(project, '.agentfs')), false);
    console.log('PASS: unsafe native runtime refused before writes; ordinary legacy memory remains usable');
  } finally { await legacy?.close(); rmSync(root, { recursive: true, force: true }); }
}
