#!/usr/bin/env node
// Capability probe only: no production store, runtime flag or schema is changed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { AgentFS } from 'agentfs-sdk';

const args = process.argv.slice(2);
assert.ok(args.length <= 1 && [undefined, '--baseline'].includes(args[0]), 'Usage: probe-memory-context-revisions.mjs [--baseline]');
const root = mkdtempSync(join(tmpdir(), 'cairn-revision-probe-'));
const agent = await AgentFS.open({ path: join(root, 'probe.db') });
const db = agent.getDatabase();
let report;
try {
  // Make the hash/timestamp collision deterministic instead of racing the clock.
  const key = 'facts/revision-probe';
  await agent.kv.set(key, 'amber');
  const freezeTimestamp = () => db.prepare('UPDATE kv_store SET updated_at = ? WHERE key = ?').run(123, key);
  await freezeTimestamp();
  const before = await db.prepare('SELECT value, updated_at FROM kv_store WHERE key = ?').get(key);
  await agent.kv.set(key, 'blue');
  await agent.kv.set(key, 'amber');
  await freezeTimestamp();
  const after = await db.prepare('SELECT value, updated_at FROM kv_store WHERE key = ?').get(key);
  assert.deepEqual(after, before, 'fixture must demonstrate indistinguishable value/time after ABA');
  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.equal(hash(after.value), hash(before.value));

  let triggerStatus = 'supported', triggerFailure;
  try {
    await db.transaction(async () => {
      await db.exec('CREATE TABLE revision_probe_v1 (key TEXT PRIMARY KEY, generation INTEGER NOT NULL)');
      await db.exec(`CREATE TRIGGER revision_probe_insert AFTER INSERT ON kv_store
        BEGIN INSERT INTO revision_probe_v1 VALUES (NEW.key, 1); END`);
      // Roll back the probe even on engines which support it.
      throw new Error('PROBE_ROLLBACK');
    }).immediate();
  } catch (error) {
    if (error.message !== 'PROBE_ROLLBACK') {
      assert.match(error.message, /CREATE TRIGGER is an experimental feature/, 'unexpected failure must not masquerade as a known backend limitation');
      triggerStatus = 'experimental-disabled';
      triggerFailure = 'CREATE TRIGGER is an experimental feature. Enable with --experimental-triggers flag';
    }
  }
  assert.deepEqual(await db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'revision_probe_%'").all(), [], 'failed/probe schema must roll back atomically');
  assert.equal(await agent.kv.get(key), 'amber', 'probe must not corrupt ordinary values');
  // Creating the trigger with another standard SQLite implementation does not
  // fix interoperability: prove whether an unchanged AgentFS can reopen it.
  const compatibilityPath = join(root, 'trigger-compatibility.db');
  const compatible = new DatabaseSync(compatibilityPath);
  try {
    compatible.exec(`CREATE TABLE kv_store (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at INTEGER, updated_at INTEGER);
      CREATE TABLE revision_probe_v1 (key TEXT);
      CREATE TRIGGER revision_probe_insert AFTER INSERT ON kv_store
      BEGIN INSERT INTO revision_probe_v1 VALUES (NEW.key); END;`);
  } finally { compatible.close(); }
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { AgentFS } from 'agentfs-sdk';
    let agent;
    try { agent = await AgentFS.open({path:process.argv[1]}); await agent.kv.set('facts/probe','fixture'); console.log('SUPPORTED'); }
    catch(error) { if (!/Database contains triggers but --experimental-triggers flag is not set/.test(error.message)) throw error; console.log('REFUSED'); }
    finally { if(agent) await agent.close(); }
  `, compatibilityPath], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 10000,
    env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(NODE_OPTIONS$|NODE_PATH$|CAIRN_|MCP_|AGENT_MEMORY_CONFIG$)/.test(name))) });
  assert.equal(child.status, 0, 'legacy compatibility subprocess failed unexpectedly');
  const legacyReopen = child.stdout.trim();
  assert.ok(['SUPPORTED', 'REFUSED'].includes(legacyReopen));
  const sqlite = await db.prepare('SELECT sqlite_version() AS version').get();
  report = {
    schema_version: 1, study: 'native-memory-revision-feasibility-v1',
    status: triggerStatus === 'supported' ? 'needs-full-trigger-validation' : 'blocked',
    backend_version: String(sqlite.version), trigger_status: triggerStatus,
    ...(triggerFailure ? { diagnostic: triggerFailure } : {}),
    legacy_trigger_database_reopen: legacyReopen === 'REFUSED' ? 'refused' : 'supported',
    hash_timestamp_aba_collision_proved: true, atomic_schema_rollback_verified: true,
    legacy_writer_compatible_generations_proved: false,
    restore_epoch_invalidation_proved: false,
    dependent_features_ready: false, experimental_features_enabled: false,
    production_configuration_changed: false,
    limitation: 'No source-revision guarantee is inferred from a hash or timestamp. Dependent implementation requires a separately reviewed storage design.',
  };
  if (args[0] === '--baseline') {
    assert.equal(triggerStatus, 'experimental-disabled', 'backend capability changed: revisit the frozen feasibility gate deliberately');
    assert.equal(legacyReopen, 'REFUSED', 'legacy interoperability changed: revisit the design gate deliberately');
    console.log('PASS: known baseline limitation, deterministic ABA collision and atomic probe rollback; dependent features remain BLOCKED');
  } else {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 2; // A successful diagnostic is not a passing feature gate.
  }
} finally {
  await agent.close();
  rmSync(root, { recursive: true, force: true });
}
