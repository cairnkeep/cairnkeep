import { dirname, join, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, lstatSync, existsSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { extractTar } from './windows-platform.mjs';
import { readStableFile } from './lib/stable-file.mjs';
import { canonicalMemoryPath, withMemoryAdmission } from '../mcp-memory-server/dist/ordinary-memory-store.js';
import { probeOrdinaryMemoryFormat, inspectMemoryDatabaseFile } from '../mcp-memory-server/dist/memory-store-format.js';
import { hardenPrivatePath, privatePathIsSafe, replacementBoundaryIsSafe, memoryPathAncestorsAreSafe, atomicReplace } from '../mcp-memory-server/dist/platform-security.js';

const LIMIT = 512 * 1024 * 1024;
const GUIDANCE = 'MEMORY_IMPORT_REFUSED: use cairn memory-context restore for tracked stores; stop clients and preserve recovery files.';
function legacyBytes(bytes) {
  return bytes.length === 0 || (bytes.length >= 100 && bytes.toString('ascii', 0, 16) === 'SQLite format 3\0' && bytes.readUInt32BE(68) === 0);
}
function present(path) { try { return lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }

/** Offline legacy administration. Hold every destination lease through preflight
 * and replacement; a crash leaves a journal and owned stages that block admission. */
export async function importLegacyMemoryArchive({ base, archive, publish = (destination, _bytes, staged) => atomicReplace(staged, destination) }) {
  const packed = readStableFile(resolve(archive), { label: 'Memory archive', maxBytes: LIMIT }).bytes;
  const files = extractTar(gunzipSync(packed, { maxOutputLength: LIMIT }));
  if (!files.length || files.length > 1024 || files.some(([, bytes]) => !legacyBytes(bytes))) throw new Error(GUIDANCE);
  const root = dirname(canonicalMemoryPath(join(resolve(base), `.import-${randomUUID()}.db`)));
  const rootExisted = existsSync(root);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  // Windows ignores POSIX creation modes. A fresh store is hardened before
  // bytes enter it; an existing store must already satisfy the private ACL
  // contract so import never silently changes an operator's access policy.
  if (process.platform === 'win32' && !rootExisted) hardenPrivatePath(root);
  if (!replacementBoundaryIsSafe(root) || (process.platform !== 'win32'
      && !memoryPathAncestorsAreSafe(join(root, '.pending-import')))
      || (process.platform === 'win32' && !privatePathIsSafe(root))) throw new Error(GUIDANCE);
  const pending = join(root, '.cairn-memory-import-pending');
  const targets = files.map(([name, bytes]) => ({ path: canonicalMemoryPath(join(root, name)), name, bytes })).sort((a, b) => a.path.localeCompare(b.path));
  const locked = async index => index === targets.length ? apply() : withMemoryAdmission(targets[index].path, () => locked(index + 1));
  async function apply() {
    if (present(pending)) throw new Error(GUIDANCE);
    let retainedBytes = 0;
    const records = targets.map(target => {
      const kind = probeOrdinaryMemoryFormat(target.path).kind;
      if (!['missing', 'legacy'].includes(kind) || ['-wal', '-shm', '-journal'].some(suffix => present(target.path + suffix))) throw new Error(GUIDANCE);
      const backup = `${target.path}.bak-pre-import`;
      if (present(backup) && probeOrdinaryMemoryFormat(backup).kind !== 'legacy') throw new Error(GUIDANCE);
      if (process.platform === 'win32' && ((kind !== 'missing' && !privatePathIsSafe(target.path))
          || (present(backup) && !privatePathIsSafe(backup)))) throw new Error(GUIDANCE);
      retainedBytes += (kind === 'missing' ? 0 : inspectMemoryDatabaseFile(target.path).size)
        + (present(backup) ? inspectMemoryDatabaseFile(backup).size : 0);
      if (retainedBytes > LIMIT) throw new Error(GUIDANCE);
      return { ...target, previous: kind === 'missing' ? null : readStableFile(target.path, { label: 'Memory pre-image', maxBytes: LIMIT }).bytes,
        oldBackup: present(backup) ? readStableFile(backup, { label: 'Memory retained backup', maxBytes: LIMIT }).bytes : null };
    });
    // Reject an interrupted predecessor, even when its current target looks legacy.
    if (readdirSync(root).some(name => name.startsWith('.cairn-memory-import-stage-'))) throw new Error(GUIDANCE);
    const stage = mkdtempSync(join(root, '.cairn-memory-import-stage-')); hardenPrivatePath(stage);
    let journal = false, complete = false;
    const applied = [];
    try {
      for (const [index, item] of records.entries()) {
        writeFileSync(join(stage, `${index}.next`), item.bytes, { flag: 'wx', mode: 0o600 }); hardenPrivatePath(join(stage, `${index}.next`));
        if (item.previous !== null) { writeFileSync(join(stage, `${index}.previous`), item.previous, { flag: 'wx', mode: 0o600 }); hardenPrivatePath(join(stage, `${index}.previous`)); }
        if (item.oldBackup !== null) { writeFileSync(join(stage, `${index}.retained`), item.oldBackup, { flag: 'wx', mode: 0o600 }); hardenPrivatePath(join(stage, `${index}.retained`)); }
      }
      writeFileSync(pending, JSON.stringify({ schema_version: 1, stage: stage.slice(root.length + 1), names: records.map(item => item.name) }), { flag: 'wx', mode: 0o600 });
      journal = true; hardenPrivatePath(pending);
      for (const [index, item] of records.entries()) {
        if (item.previous !== null) {
          const backup = `${item.path}.bak-pre-import`;
          if (item.oldBackup !== null) {
            const retained = `${backup}.${randomUUID()}`;
            await publish(retained, item.oldBackup, join(stage, `${index}.retained`));
          }
          const stagedBackup = join(stage, `${index}.backup`);
          writeFileSync(stagedBackup, item.previous, { flag: 'wx', mode: 0o600 }); hardenPrivatePath(stagedBackup);
          await publish(backup, item.previous, stagedBackup);
        }
        applied.push([index, item]);
        await publish(item.path, item.bytes, join(stage, `${index}.next`));
      }
      complete = true;
    } catch (error) {
      let recovered = true;
      for (const [index, item] of applied.reverse()) {
        try {
          const current = present(item.path) ? readStableFile(item.path, { label: 'Memory rollback check', maxBytes: LIMIT }).bytes : null;
          if (item.previous === null ? current === null : current?.equals(item.previous)) continue;
          if (item.previous === null) rmSync(item.path);
          else await publish(item.path, item.previous, join(stage, `${index}.previous`));
        } catch { recovered = false; }
      }
      if (recovered) complete = true;
      throw error;
    } finally {
      if (complete) { if (journal) rmSync(pending); rmSync(stage, { recursive: true, force: true }); }
    }
    return { count: records.length, base: root };
  }
  return locked(0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: memory-import BASE ARCHIVE');
    const result = await importLegacyMemoryArchive({ base: process.argv[2], archive: process.argv[3] });
    console.log(`imported ${result.count} scope db file(s) -> ${result.base}`);
  } catch { console.error(GUIDANCE); process.exitCode = 1; }
}
