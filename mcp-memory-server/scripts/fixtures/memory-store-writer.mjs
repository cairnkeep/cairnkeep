import { basename, dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { openOrdinaryMemoryStore } from '../../dist/ordinary-memory-store.js';
const path = resolve(process.argv[2]);
if (!/^cairn-memory-continuity-[A-Za-z0-9]+$/.test(basename(dirname(dirname(dirname(path)))))) throw new Error('disposable fixture required');
const agent = await openOrdinaryMemoryStore(path, 'project');
let stop = false;
process.on('message', () => { stop = true; });
try {
  for (let n = 1; !stop; n++) {
    await agent.getDatabase().transaction(async () => {
      await agent.kv.set('facts/pair-left', n); await agent.kv.set('facts/pair-right', n);
    }).immediate();
    if (n === 1) process.send({ ready: true });
    await delay(5);
  }
} finally { await agent.close(); process.disconnect(); }
