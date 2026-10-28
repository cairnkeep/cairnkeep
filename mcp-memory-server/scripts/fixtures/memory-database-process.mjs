import { basename, dirname, resolve } from 'node:path';
import { openMemoryDatabase, attachMemoryAgent } from '../../dist/memory-database.js';
const [mode, input] = process.argv.slice(2), path = resolve(input);
if (!/^cairn-memory-database-[A-Za-z0-9]+$/.test(basename(dirname(path)))) throw new Error('disposable root required');
const db = await openMemoryDatabase(path), agent = await attachMemoryAgent(db);
try {
  if (mode === 'increment') {
    process.send({ ready: true }); await new Promise(resolve => process.once('message', resolve));
    for (let n = 0; n < 40; n++) await db.transaction(async () => {
      await agent.kv.set('facts/counter', await agent.kv.get('facts/counter') + 1);
    }).immediate();
  } else if (mode === 'crash' || mode === 'hold') {
    await db.transaction(async () => {
      await agent.kv.set('facts/staged', 'uncommitted'); process.send({ staged: true });
      await new Promise(resolve => { if (mode === 'hold') process.once('message', resolve); });
    }).immediate();
  } else throw new Error('unknown fixture mode');
} finally { await db.close(); }
