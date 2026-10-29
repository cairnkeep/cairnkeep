// A single-purpose legacy observer, isolated from the SDK's process-wide cache.
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { Database as LegacyDatabase } from '@tursodatabase/database';
import { assertNoPendingImport, canonicalMemoryPath, withMemoryAdmission } from './ordinary-memory-store.js';
import { inspectMemoryDatabaseMetadata, probeOrdinaryMemoryFormat } from './memory-store-format.js';
import { memoryError } from './memory-database-protocol.js';

const LIMIT = 65536;
const uint64 = z.string().regex(/^(?:0|[1-9][0-9]{0,19})$/)
    .refine(value => value.length < 20 || value <= '18446744073709551615');
const identitySchema = z.object({ dev: uint64, ino: uint64 }).strict();
export function memoryLegacyIdentity(stat: { dev: bigint; ino: bigint }) {
    const encode = (value: bigint) => {
        // Node's native BigInt64 stat buffer may expose unsigned IDs with the
        // sign bit set as negative values. Preserve those bits, not their sign.
        if (typeof value !== 'bigint' || value < -(1n << 63n) || value > (1n << 64n) - 1n) throw memoryError('MEMORY_FILE_UNSAFE');
        return BigInt.asUintN(64, value).toString();
    };
    return identitySchema.parse({ dev: encode(stat.dev), ino: encode(stat.ino) });
}
const requestSchema = z.object({
    path: z.string().min(1).max(32768), key: z.string().min(1).max(4096).optional(),
    map_limit: z.number().int().min(1).max(5000).optional(), map_bytes: z.number().int().min(1).max(48000).optional(),
    ...identitySchema.shape,
}).strict();
const replySchema = z.union([
    z.object({ ok: z.literal(true), row: z.object({ value: z.string().nullable() }).strict().nullable() }).strict(),
    z.object({ ok: z.literal(true), keys: z.array(z.string().min(1).max(4096)).max(5000), scanned: z.number().int().min(0).max(5000), bytes: z.number().int().min(0).max(48000), truncated: z.boolean() }).strict(),
    z.object({ ok: z.literal(false), code: z.string().regex(/^MEMORY_[A-Z_]{1,64}$/) }).strict(),
]);
function inspect(path: string) {
    // Windows file IDs can exceed Number.MAX_SAFE_INTEGER. Bracket the existing
    // permission checks with exact stats; never round an identity for IPC.
    const before = lstatSync(path, { bigint: true });
    inspectMemoryDatabaseMetadata(path, true);
    for (const suffix of ['-wal', '-shm', '-journal']) {
        try { lstatSync(path + suffix); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
        inspectMemoryDatabaseMetadata(path + suffix, true, true);
    }
    const after = lstatSync(path, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || !after.isFile() || after.isSymbolicLink()
        || before.dev !== after.dev || before.ino !== after.ino || before.uid !== after.uid || before.mode !== after.mode) throw memoryError('MEMORY_FILE_CHANGED');
    return memoryLegacyIdentity(after);
}

/** Never imports a legacy driver into the caller. SDK readonly-first caching
 * would otherwise make subsequent ordinary writes fail until native-object GC. */
async function observeLegacyMemory(input: string, key?: string, limits?: { rows: number; bytes: number }) {
    const path = canonicalMemoryPath(input);
    assertNoPendingImport(path);
    return withMemoryAdmission(path, async () => {
        assertNoPendingImport(path);
        if (probeOrdinaryMemoryFormat(path).kind !== 'legacy') throw memoryError('MEMORY_FILE_CHANGED');
        const before = inspect(path);
        const request = JSON.stringify(requestSchema.parse({ path, key, dev: before.dev, ino: before.ino,
            ...(limits ? { map_limit: limits.rows, map_bytes: Math.min(48000, limits.bytes) } : {}) }));
        if (Buffer.byteLength(request) > LIMIT) throw memoryError('MEMORY_INSPECTION_LIMIT');
        // Preserve explicit preload guards/instrumentation, not parent eval or
        // inspector arguments. Paths and keys travel over bounded stdin, no shell.
        const preloads: string[] = [];
        for (let index = 0; index < process.execArgv.length; index++) {
            const arg = process.execArgv[index];
            if (['--import', '--require', '-r'].includes(arg) && process.execArgv[index + 1]) preloads.push(arg, process.execArgv[++index]);
            else if (arg.startsWith('--import=') || arg.startsWith('--require=')) preloads.push(arg);
        }
        const output = await new Promise<string>((done, fail) => {
            const child = execFile(process.execPath, [...preloads, '--max-old-space-size=128', fileURLToPath(import.meta.url)], {
                encoding: 'utf8', windowsHide: true, maxBuffer: LIMIT, timeout: 30000, killSignal: 'SIGKILL',
            }, (error, stdout) => error ? fail(memoryError('MEMORY_LEGACY_INSPECTION_FAILED')) : done(stdout));
            child.stdin?.on('error', () => {}); // Exit/overflow is reported by execFile's bounded callback.
            child.stdin?.end(request);
        });
        const after = inspect(path);
        if (before.dev !== after.dev || before.ino !== after.ino) throw memoryError('MEMORY_FILE_CHANGED');
        let reply: z.infer<typeof replySchema>;
        try { reply = replySchema.parse(JSON.parse(output)); }
        catch { throw memoryError('MEMORY_LEGACY_INSPECTION_FAILED'); }
        if (!reply.ok) throw memoryError(reply.code);
        return reply;
    });
}

export async function readLegacyMemoryInspection(input: string, key: string) {
    const reply = await observeLegacyMemory(input, key);
    if (!('row' in reply)) throw memoryError('MEMORY_LEGACY_INSPECTION_FAILED');
    return reply.row;
}
export async function readLegacyMemoryMapKeys(input: string, limits: { rows: number; bytes: number }) {
    const reply = await observeLegacyMemory(input, undefined, limits);
    if (!('keys' in reply)) throw memoryError('MEMORY_LEGACY_INSPECTION_FAILED');
    if (reply.scanned > limits.rows || reply.bytes > limits.bytes) throw memoryError('MEMORY_MAP_SCAN_LIMIT');
    return { keys: reply.keys, scanned: reply.scanned, bytes: reply.bytes, truncated: reply.truncated };
}

async function runObserver() {
    let db: LegacyDatabase | undefined;
    try {
        const chunks: Buffer[] = []; let bytes = 0;
        for await (const chunk of process.stdin) {
            const buffer = Buffer.from(chunk); bytes += buffer.length;
            if (bytes > LIMIT) throw memoryError('MEMORY_INSPECTION_LIMIT');
            chunks.push(buffer);
        }
        const request = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        const before = inspect(request.path);
        if (before.dev !== request.dev || before.ino !== request.ino || probeOrdinaryMemoryFormat(request.path).kind !== 'legacy') throw memoryError('MEMORY_FILE_CHANGED');
        const driver = createRequire(import.meta.resolve('agentfs-sdk')).resolve('@tursodatabase/database');
        const { Database } = await import(pathToFileURL(driver).href) as { Database: typeof LegacyDatabase };
        db = new Database(request.path, { readonly: true, fileMustExist: true, timeout: 500 });
        await db.connect();
        if (!db.readonly) throw memoryError('MEMORY_READ_ONLY');
        const result = await db.transaction(async () => {
            if (request.key === undefined) {
                const keys: string[] = []; let truncated = false, bytes = 0, encodedBytes = 0, scanned = 0;
                if (!await db!.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kv_store'").get()) return { ok: true as const, keys, scanned, bytes, truncated };
                for (;;) {
                    const remaining = (request.map_bytes ?? 48000) - bytes;
                    if (scanned === (request.map_limit ?? 5000) || remaining <= 0) { truncated = true; break; }
                    // The legacy driver needs no window-function support: one
                    // key at a time, rejected in SQL before materialization.
                    const row = await db!.prepare(`SELECT CASE WHEN length(CAST(key AS BLOB))<=4096 AND length(CAST(key AS BLOB))<=? THEN key END AS safe_key,
                        length(CAST(key AS BLOB))>? AS limited FROM kv_store
                        WHERE key!='__history__' AND substr(key,1,12)!='__history__/'
                        AND key!='__reviewed__' AND substr(key,1,13)!='__reviewed__/' ORDER BY key LIMIT 1 OFFSET ?`).get(remaining, remaining, scanned);
                    if (!row) break;
                    scanned++;
                    if (row.limited === 1) { truncated = true; break; }
                    if (typeof row.safe_key !== 'string' || !row.safe_key.length) { truncated = true; continue; }
                    bytes += Buffer.byteLength(row.safe_key);
                    const size = Buffer.byteLength(JSON.stringify(row.safe_key)) + 1;
                    if (encodedBytes + size > 48000) { truncated = true; break; }
                    keys.push(row.safe_key); encodedBytes += size;
                }
                return { ok: true as const, keys, scanned, bytes, truncated };
            }
            if (!await db!.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kv_store'").get()) return null;
            return await db!.prepare('SELECT CASE WHEN length(CAST(value AS BLOB))<=32768 THEN value END AS value FROM kv_store WHERE key=?').get(request.key) ?? null;
        })();
        await db.close(); db = undefined;
        const after = inspect(request.path);
        if (before.dev !== after.dev || before.ino !== after.ino) throw memoryError('MEMORY_FILE_CHANGED');
        // Returning the stored JSON string needs its own escaping budget.
        if (request.key === undefined) process.stdout.write(JSON.stringify(replySchema.parse(result)));
        else {
            const row = Buffer.byteLength(JSON.stringify({ ok: true, row: result })) > LIMIT ? { value: null } : result;
            process.stdout.write(JSON.stringify(replySchema.parse({ ok: true, row })));
        }
    } catch (error) {
        const code = (error as { code?: string }).code;
        process.stdout.write(JSON.stringify({ ok: false, code: typeof code === 'string' && /^MEMORY_[A-Z_]{1,64}$/.test(code) ? code : 'MEMORY_LEGACY_INSPECTION_FAILED' }));
    } finally { await db?.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runObserver();
