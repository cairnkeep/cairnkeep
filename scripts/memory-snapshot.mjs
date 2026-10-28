import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeOrdinaryMemoryFormat } from '../mcp-memory-server/dist/memory-store-format.js';
import { backupMemoryContextStore } from '../mcp-memory-server/dist/ordinary-memory-store.js';

export async function snapshotOrdinaryMemory({ path, scope, output }) {
  const format = probeOrdinaryMemoryFormat(path);
  if (format.kind === 'context-v1') return backupMemoryContextStore({ path, scope, output });
  if (format.kind !== 'legacy') throw new Error('MEMORY_FORMAT_UNSUPPORTED');
  const result = spawnSync(process.platform === 'win32' ? 'sqlite3.exe' : 'sqlite3', [path, `.backup '${output.replaceAll("'", "''")}'`], { encoding: 'utf8', timeout: 120_000 });
  if (result.status !== 0) throw new Error('MEMORY_EXPORT_FAILED: sqlite3 is required for legacy online snapshots.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 5) throw new Error('MEMORY_ARGUMENTS_INVALID');
    await snapshotOrdinaryMemory({ path: process.argv[2], output: process.argv[3], scope: process.argv[4] });
  } catch { console.error('MEMORY_EXPORT_FAILED: use cairn memory-context backup for tracked stores; legacy export requires sqlite3.'); process.exitCode = 1; }
}
