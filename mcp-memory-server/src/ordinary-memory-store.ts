import { AgentFS } from 'agentfs-sdk';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve, basename } from 'node:path';
import { lstatSync, realpathSync, mkdirSync, mkdtempSync, linkSync, unlinkSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { hardenPrivatePath, privatePathIsSafe, replacementBoundaryIsSafe } from './platform-security.js';
import { probeOrdinaryMemoryFormat, inspectMemoryDatabaseFile, initializeMemoryContextFormat, validateMemoryContextFormat } from './memory-store-format.js';
import { contextStoreIdentitySchema, contextStoreMarkerSchema, CONTEXT_STORE_TABLE } from './memory-context-schema.js';
import { memoryError } from './memory-database-protocol.js';
import type { MemoryDatabase, OrdinaryMemoryReader, OrdinaryMemoryStore } from './memory-database.js';

const readDatabases = new WeakMap<OrdinaryMemoryReader, MemoryDatabase>();
export async function withOrdinaryMemorySnapshot<T>(view: OrdinaryMemoryReader, read: () => Promise<T>): Promise<T> {
    const db = readDatabases.get(view);
    return db ? db.transaction(read)() : read();
}

function info(path: string) {
    try { return lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}

/** Resolve an absent destination without creating it; never follow its final link. */
export function canonicalMemoryPath(path: string): string {
    const absolute = resolve(path);
    const last = info(absolute);
    if (last?.isSymbolicLink() || (last && !last.isFile())) throw memoryError('MEMORY_FILE_UNSAFE');
    let parent = dirname(absolute);
    const tail = [basename(absolute)];
    while (!info(parent)) { tail.unshift(basename(parent)); parent = dirname(parent); }
    const stat = info(parent)!;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw memoryError('MEMORY_FILE_UNSAFE');
    return join(realpathSync.native(parent), ...tail);
}

export function memoryStoreIdentity(path: string, scope: string) {
    return contextStoreIdentitySchema.parse({ scope, owner_domain: createHash('sha256')
        .update('cairn-ordinary-store-v1\0').update(canonicalMemoryPath(path)).digest('hex') });
}

/** A cooperating admission lease, not a replacement for SQLite transactions.
 * Never guesses whether an existing lease is stale. Only its creator releases it. */
export async function withMemoryAdmission<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const lock = `${path}.cairn-admission`;
    const nonce = randomUUID();
    const deadline = Date.now() + 5000;
    for (;;) {
        try { mkdirSync(lock, { mode: 0o700 }); break; } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw memoryError('MEMORY_ADMISSION_FAILED');
            const existing = info(lock);
            if (!existing?.isDirectory() || existing.isSymbolicLink() || !privatePathIsSafe(lock)) throw memoryError('MEMORY_ADMISSION_UNSAFE');
            if (Date.now() >= deadline) throw memoryError('MEMORY_ADMISSION_BUSY');
            await new Promise(done => setTimeout(done, 25));
        }
    }
    const owned = lstatSync(lock);
    const token = join(lock, nonce);
    try {
        hardenPrivatePath(lock);
        writeFileSync(token, JSON.stringify({ pid: process.pid, nonce }), { flag: 'wx', mode: 0o600 });
        hardenPrivatePath(token);
        return await operation();
    } finally {
        const now = info(lock);
        if (now?.dev === owned.dev && now.ino === owned.ino && !now.isSymbolicLink()) {
            if (info(token)?.isFile()) unlinkSync(token);
            // Unexpected contents are retained for explicit diagnosis, never recursively removed.
            try { rmdirSync(lock); } catch { /* retain an altered admission lease */ }
        }
    }
}

function ensureParent(path: string): void {
    const parent = dirname(path);
    if (info(parent)) return;
    ensureParent(parent);
    try { mkdirSync(parent, { mode: 0o700 }); hardenPrivatePath(parent); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if (!info(parent)?.isDirectory() || info(parent)?.isSymbolicLink()) throw memoryError('MEMORY_FILE_UNSAFE');
}

export async function planContextStoreInit(options: { path: string; scope: string }) {
    const { assertContextRuntime } = await import('./memory-database.js');
    assertContextRuntime();
    const path = canonicalMemoryPath(options.path);
    if (info(path)) throw memoryError('EXISTING_STORE_UNSUPPORTED');
    const identity = memoryStoreIdentity(path, options.scope);
    let ancestor = dirname(path);
    while (!info(ancestor)) ancestor = dirname(ancestor);
    if (!replacementBoundaryIsSafe(ancestor)) throw memoryError('MEMORY_FILE_UNSAFE');
    const stat = lstatSync(ancestor);
    const plan = { schema_version: 1 as const, operation: 'init' as const, path, ...identity,
        runtime: process.versions.node, ancestor: { path: ancestor, dev: stat.dev, ino: stat.ino }, expected: 'absent' };
    return { ...plan, digest: createHash('sha256').update(JSON.stringify(plan)).digest('hex') };
}

export async function applyContextStoreInit(options: { path: string; scope: string; confirm: string }) {
    const plan = await planContextStoreInit(options);
    if (!/^[a-f0-9]{64}$/.test(options.confirm) || options.confirm !== plan.digest) throw memoryError('MEMORY_CONFIRMATION_MISMATCH');
    ensureParent(plan.path);
    if (!replacementBoundaryIsSafe(dirname(plan.path))) throw memoryError('MEMORY_FILE_UNSAFE');
    return withMemoryAdmission(plan.path, async () => {
        if (info(plan.path)) throw memoryError('EXISTING_STORE_UNSUPPORTED');
        const ancestor = lstatSync(plan.ancestor.path);
        if (ancestor.dev !== plan.ancestor.dev || ancestor.ino !== plan.ancestor.ino
            || canonicalMemoryPath(options.path) !== plan.path) throw memoryError('MEMORY_FILE_CHANGED');
        const stage = mkdtempSync(join(dirname(plan.path), '.cairn-memory-init-'));
        hardenPrivatePath(stage);
        let db: MemoryDatabase | undefined;
        try {
            const { MemoryDatabase, attachMemoryAgent } = await import('./memory-database.js');
            const staged = join(stage, 'store.db');
            db = await MemoryDatabase.open(staged, { create: true });
            await attachMemoryAgent(db);
            await initializeMemoryContextFormat(db, memoryStoreIdentity(plan.path, options.scope));
            await validateMemoryContextFormat(db, memoryStoreIdentity(plan.path, options.scope));
            const checkpoint = await db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
            if (checkpoint?.busy !== 0) throw memoryError('MEMORY_CHECKPOINT_FAILED');
            await db.close(); db = undefined;
            inspectMemoryDatabaseFile(staged, true);
            // Hard-link publication is atomic and refuses every existing destination.
            linkSync(staged, plan.path);
            unlinkSync(staged);
            return { schema_version: 1, format: 'context-v1', path: plan.path, digest: plan.digest, created: true };
        } finally {
            await db?.close();
            rmSync(stage, { recursive: true, force: true });
        }
    });
}

async function openContextDatabase(path: string, scope: string | undefined, readOnly: boolean) {
    const { MemoryDatabase } = await import('./memory-database.js');
    const before = inspectMemoryDatabaseFile(path, true);
    for (const suffix of ['-wal', '-shm', '-journal']) if (info(path + suffix)) inspectMemoryDatabaseFile(path + suffix, true);
    const db = await MemoryDatabase.open(path, { readOnly });
    try {
        // Only the local administrative doctor may discover a stored logical scope.
        const logicalScope = scope ?? contextStoreMarkerSchema.parse(await db.prepare(`SELECT * FROM ${CONTEXT_STORE_TABLE} WHERE id=1`).get()).scope;
        await validateMemoryContextFormat(db, memoryStoreIdentity(path, logicalScope));
        const after = inspectMemoryDatabaseFile(path, true);
        for (const suffix of ['-wal', '-shm', '-journal']) if (info(path + suffix)) inspectMemoryDatabaseFile(path + suffix, true);
        if (before.dev !== after.dev || before.ino !== after.ino) throw memoryError('MEMORY_FILE_CHANGED');
        return db;
    } catch (error) { await db.close(); throw error; }
}

export async function openOrdinaryMemoryStore(input: string, scope: string, options: { create?: boolean } = {}): Promise<OrdinaryMemoryStore | null> {
    const path = canonicalMemoryPath(input);
    if (!info(path) && !options.create) return null;
    if (options.create) ensureParent(path);
    return withMemoryAdmission(path, async () => {
        const format = probeOrdinaryMemoryFormat(path);
        if (format.kind === 'missing' && !options.create) return null;
        if (format.kind === 'unsupported') throw memoryError('MEMORY_FORMAT_UNSUPPORTED');
        if (format.kind === 'context-v1') {
            const db = await openContextDatabase(path, scope, false);
            try { const { attachMemoryAgent } = await import('./memory-database.js'); return await attachMemoryAgent(db); }
            catch (error) { await db.close(); throw error; }
        }
        return AgentFS.open({ id: scope, path });
    });
}

export async function openOrdinaryMemoryView(input: string, scope?: string): Promise<OrdinaryMemoryReader | null> {
    const path = canonicalMemoryPath(input);
    if (!info(path)) return null;
    return withMemoryAdmission(path, async () => {
        const format = probeOrdinaryMemoryFormat(path);
        if (format.kind === 'unsupported' || format.kind === 'missing') throw memoryError('MEMORY_FORMAT_UNSUPPORTED');
        if (format.kind === 'legacy') return AgentFS.open({ id: scope ?? 'inspection', path });
        const db = await openContextDatabase(path, scope, true);
        const view: OrdinaryMemoryReader = {
            kv: {
                async get(key: string) {
                    const row = await db.prepare('SELECT value FROM kv_store WHERE key=?').get(key);
                    return row ? JSON.parse(String(row.value)) as unknown : undefined;
                },
                async list(prefix: string) {
                    const rows = await db.prepare('SELECT key,value FROM kv_store WHERE substr(key,1,length(?))=? ORDER BY key').all(prefix, prefix);
                    return rows.map(row => ({ key: String(row.key), value: JSON.parse(String(row.value)) as unknown }));
                },
            },
            getDatabase: () => db,
            close: () => db.close(),
        };
        readDatabases.set(view, db);
        return view;
    });
}

export async function contextStoreStatus(path: string, scope: string) {
    const format = probeOrdinaryMemoryFormat(canonicalMemoryPath(path));
    if (format.kind !== 'context-v1') return { schema_version: 1, format: format.kind, tracked: false };
    const view = await openOrdinaryMemoryView(path, scope);
    try { return { schema_version: 1, format: format.kind, tracked: true,
        marker: await view!.getDatabase().prepare(`SELECT * FROM ${CONTEXT_STORE_TABLE} WHERE id=1`).get() }; }
    finally { await view?.close(); }
}
