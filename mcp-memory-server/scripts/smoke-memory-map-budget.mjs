import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createContinuityLab } from './memory-continuity-lab.mjs';
import * as ordinary from '../dist/ordinary-memory-store.js';
import { MemoryDatabase } from '../dist/memory-database.js';
import { buildMemoryMap } from '../dist/memory-map.js';
import { readMemoryMapFreshness } from '../dist/memory-context-store.js';
import { readMemoryMapEntities } from '../dist/memory-connections.js';

process.umask(0o077);
const lab = createContinuityLab(), target = { scope: 'project', path: join(lab.projects.alpha, '.agentfs/project.db') };
const beta = { scope: 'project', path: join(lab.projects.beta, '.agentfs/project.db') };
const prepare = MemoryDatabase.prototype.prepare;
let rowsRead = 0, bytesRead = 0, payloadQueries = 0;
const fields = ['key', 'value', 'id', 'assertion_json'];
MemoryDatabase.prototype.prepare = function(sql) {
  const statement = prepare.call(this, sql);
  const payload = (sql.includes('FROM kv_store') && sql.includes(' AS value'))
    || (sql.includes('assertion_json') && /SELECT|WITH/.test(sql) && !sql.includes('sqlite_master') && !sql.includes('LEFT JOIN'));
  if (payload) {
    const all = statement.all;
    statement.all = async (...args) => {
      const rows = await all(...args); payloadQueries++; rowsRead += rows.length;
      for (const row of rows) for (const field of fields) {
        if (typeof row[field] === 'string') bytesRead += Buffer.byteLength(row[field]);
        else if (ArrayBuffer.isView(row[field])) bytesRead += row[field].byteLength;
      }
      return rows;
    };
  }
  return statement;
};
const reset = () => { rowsRead = 0; bytesRead = 0; payloadQueries = 0; };
try {
  const study = readFileSync(new URL('./run-memory-connections-study.mjs', import.meta.url), 'utf8');
  const start = study.indexOf('async function compareMap('), end = study.indexOf('\ntry {', start);
  const timing = study.slice(start, end), stop = timing.indexOf('const markdownMs = performance.now() - mdStarted;');
  assert.ok(stop > timing.indexOf('markdown = markdownMap(item)'), 'capture the Markdown operation cost');
  assert.ok(stop < timing.indexOf('assert.deepEqual'), 'Markdown clock must stop before parity/serialization validation');
  assert.match(timing, /markdown_ms: Math\.round\(markdownMs \* 100\) \/ 100/, 'report the captured operation cost, not later validation time');
  const plan = await ordinary.planContextStoreInit(target);
  await ordinary.applyContextStoreInit({ ...target, confirm: plan.digest });
  const betaPlan = await ordinary.planContextStoreInit(beta);
  await ordinary.applyContextStoreInit({ ...beta, confirm: betaPlan.digest });
  const other = await ordinary.openOrdinaryMemoryStore(beta.path, beta.scope);
  try {
    await other.getDatabase().exec(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<5010)
      INSERT INTO kv_store(key,value,created_at,updated_at) SELECT printf('other%05d/key',n),'"other"',1,1 FROM seq`);
  } finally { await other.close(); }
  for (const [count, characters] of [[5010, 1], [400, 32698]]) {
    const agent = await ordinary.openOrdinaryMemoryStore(target.path, target.scope);
    try {
      await agent.getDatabase().exec('DELETE FROM kv_store');
      await agent.getDatabase().prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<?)
        INSERT INTO kv_store(key,value,created_at,updated_at) SELECT printf('group%05d/key',n),?,1,1 FROM seq`).run(count, JSON.stringify('x'.repeat(characters)));
    } finally { await agent.close(); }
    reset();
    const map = await buildMemoryMap([target, beta]);
    assert.equal(map.truncated, true);
    assert.ok(payloadQueries > 0 && rowsRead > 0 && bytesRead > 0, 'read instrumentation must positively observe current queries');
    assert.ok(rowsRead <= 5000, `MAP_SCAN_ROWS_RED: materialized ${rowsRead} rows across validation passes`);
    assert.ok(bytesRead <= 8 * 1024 * 1024, `MAP_SCAN_BYTES_RED: materialized ${bytesRead} source/key bytes`);
  }
  for (const [index, selected] of [target, beta].entries()) {
    const agent = await ordinary.openOrdinaryMemoryStore(selected.path, selected.scope);
    try {
      await agent.getDatabase().exec('DELETE FROM kv_store');
      await agent.getDatabase().prepare(`WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<?)
        INSERT INTO kv_store(key,value,created_at,updated_at) SELECT printf('group%05d/key',n),${index ? 'CAST(? AS TEXT)' : '?'},1,1 FROM seq`)
        .run(index ? 32 : 96, index ? Buffer.alloc(32700, 0x80) : JSON.stringify('x'.repeat(32698)));
    } finally { await agent.close(); }
  }
  reset();
  await assert.rejects(buildMemoryMap([target, beta]), /MEMORY_CONTEXT_DAMAGED/,
    'MAP_UTF8_RED: invalid stored UTF-8 must be rejected before replacement-character expansion');
  assert.ok(payloadQueries > 0 && bytesRead > 0);
  assert.ok(bytesRead <= 8 * 1024 * 1024, `malformed TEXT materialized ${bytesRead} bytes before refusal`);
  const valid = await ordinary.openOrdinaryMemoryStore(target.path, target.scope);
  try { await valid.getDatabase().exec('DELETE FROM kv_store'); await valid.kv.set('\ufeffbom/界', 'valid 🌊 text'); }
  finally { await valid.close(); }
  const bom = await buildMemoryMap([target]);
  assert.equal(bom.partitions[0].entries[0].navigation[0].key, '\ufeffbom/界', 'strict decoding must preserve valid BOM and multibyte keys');
  // Zero/tiny allowances must prevent fetching assertions, not clip counters.
  const agent = await ordinary.openOrdinaryMemoryStore(target.path, target.scope);
  try {
    const db = agent.getDatabase();
    const schema = await import('../dist/memory-context-schema.js');
    await db.exec(schema.CONTEXT_FACT_SQL);
    for (const sql of schema.CONTEXT_CONNECTION_SQL) await db.exec(sql);
    // Deliberately opaque records must never be materialized/parsed at zero budget.
    await db.prepare(`INSERT INTO ${schema.CONTEXT_FACT_TABLE}(key,assertion_json) VALUES(?,CAST(? AS TEXT))`).run('group00001/key', Buffer.alloc(65536, 0x80));
    await db.prepare(`INSERT INTO ${schema.CONTEXT_ENTITY_TABLE}(id,revision,present,assertion_json) VALUES(?,1,1,CAST(? AS TEXT))`).run('00000000-0000-4000-8000-000000000001', Buffer.alloc(65536, 0x80));
    for (const allowance of [0, 1]) {
      reset();
      await db.transaction(async () => {
        const source = { key: 'group00001/key' };
        await readMemoryMapFreshness(db, [source], new Date(), { rows: 10, bytes: allowance });
        await readMemoryMapEntities(db, new Map(), { rows: 10, bytes: allowance });
      })();
      assert.equal(bytesRead, 0, 'assertion payload must not be fetched when its bytes cannot fit');
      if (allowance === 0) assert.equal(payloadQueries, 0, 'zero allowance must not issue assertion payload queries');
    }
    for (const kind of ['freshness', 'entities']) {
      reset();
      await assert.rejects(db.transaction(() => kind === 'freshness'
        ? readMemoryMapFreshness(db, [{ key: 'group00001/key' }], new Date(), { rows: 10, bytes: 100000 })
        : readMemoryMapEntities(db, new Map(), { rows: 10, bytes: 100000 }))(), /MEMORY_CONTEXT_DAMAGED/);
      assert.ok(payloadQueries > 0 && bytesRead > 0 && bytesRead <= 100000, 'invalid assertion UTF-8 stays raw and bounded before refusal');
    }
  } finally { await agent.close(); }
  lab.assertOffline();
  console.log('PASS: actual map database materialization stays within aggregate row/byte ceilings, including agreement reads and exhausted assertion budgets');
} finally { MemoryDatabase.prototype.prepare = prepare; await lab.close(); }
