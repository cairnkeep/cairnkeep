import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, type Stats } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { hardenPrivatePath, posixPrivateMetadataIsSafe, privatePathIsSafe, replacementBoundaryIsSafe, memoryPathAncestorsAreSafe } from './platform-security.js';
import { memoryError } from './memory-database-protocol.js';
import {
    CONTEXT_APPLICATION_ID, CONTEXT_STORE_TABLE, CONTEXT_REVISION_TABLE, CONTEXT_TABLE_SQL, CONTEXT_TRIGGER_SQL,
    contextStoreIdentitySchema, contextStoreMarkerSchema, memorySourceRefSchema,
    type ContextStoreIdentity, type MemorySourceRef,
} from './memory-context-schema.js';
import type { MemoryDatabase } from './memory-database.js';

function sameIdentity(left: Stats, right: Stats): boolean {
    return left.dev === right.dev && left.ino === right.ino && left.uid === right.uid && left.mode === right.mode
        && right.isFile() && !right.isSymbolicLink();
}

function inspectFile<T>(path: string, privateRequired: boolean, read: (descriptor: number, info: Stats) => T): { value: T; stat: Stats } {
    let descriptor: number | undefined;
    try {
        descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
            | (constants.O_NOCTTY ?? 0) | (process.platform === 'win32' ? 0 : constants.O_NONBLOCK ?? 0));
        const info = fstatSync(descriptor), parent = lstatSync(dirname(path));
        if (!info.isFile() || !parent.isDirectory() || parent.isSymbolicLink() || !sameIdentity(info, lstatSync(path))) throw memoryError('MEMORY_FILE_UNSAFE');
        if (privateRequired && (!replacementBoundaryIsSafe(dirname(path)) || !memoryPathAncestorsAreSafe(path)
            || (process.platform === 'win32' ? !privatePathIsSafe(path) : !posixPrivateMetadataIsSafe(info)))) throw memoryError('MEMORY_FILE_UNSAFE');
        const value = read(descriptor, info);
        const after = fstatSync(descriptor), parentAfter = lstatSync(dirname(path));
        if (!sameIdentity(info, after) || !sameIdentity(info, lstatSync(path)) || !parentAfter.isDirectory()
            || parentAfter.isSymbolicLink() || parentAfter.dev !== parent.dev || parentAfter.ino !== parent.ino) throw memoryError('MEMORY_FILE_CHANGED');
        return { value, stat: after };
    } finally { if (descriptor !== undefined) closeSync(descriptor); }
}
export function inspectMemoryDatabaseFile(path: string, privateRequired = false): Stats {
    try { return inspectFile(path, privateRequired, () => undefined).stat; }
    catch (error) {
        if (String((error as { code?: string }).code).startsWith('MEMORY_')) throw error;
        throw memoryError('MEMORY_FILE_UNSAFE');
    }
}
export type OrdinaryMemoryFormat = { kind: 'missing' | 'legacy' | 'context-v1' | 'unsupported'; identity?: { dev: number; ino: number } };
export function probeOrdinaryMemoryFormat(path: string): OrdinaryMemoryFormat {
    try {
        const { value: kind, stat } = inspectFile(path, false, (descriptor, info) => {
            if (info.size === 0) return 'legacy' as const;
            const header = Buffer.alloc(100); let offset = 0;
            while (offset < header.length) {
                const count = readSync(descriptor, header, offset, header.length - offset, offset);
                if (count === 0) break;
                offset += count;
            }
            if (offset !== 100 || header.toString('ascii', 0, 16) !== 'SQLite format 3\0') return 'unsupported' as const;
            const id = header.readUInt32BE(68);
            return id === 0 ? 'legacy' as const : id === CONTEXT_APPLICATION_ID ? 'context-v1' as const : 'unsupported' as const;
        });
        return { kind, identity: { dev: stat.dev, ino: stat.ino } };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
        throw memoryError('MEMORY_FILE_UNSAFE');
    }
}

/** Low-level fresh staging creation; lifecycle publication belongs to the CLI. */
export function createMemoryDatabaseFile(path: string): void {
    if (!replacementBoundaryIsSafe(dirname(path))) throw memoryError('MEMORY_FILE_UNSAFE');
    const descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    closeSync(descriptor); hardenPrivatePath(path); inspectMemoryDatabaseFile(path, true);
}

export async function initializeMemoryContextFormat(db: MemoryDatabase, identity: ContextStoreIdentity): Promise<void> {
    contextStoreIdentitySchema.parse(identity);
    if (!db.created || db.readonly) throw memoryError('MEMORY_FRESH_STORE_REQUIRED');
    await db.transaction(async () => {
        const count = await db.prepare('SELECT COUNT(*) AS count FROM kv_store').get();
        if (count?.count !== 0) throw memoryError('MEMORY_FRESH_STORE_REQUIRED');
        for (const sql of CONTEXT_TABLE_SQL) await db.exec(sql);
        await db.prepare(`INSERT INTO ${CONTEXT_STORE_TABLE} VALUES(1,1,?,?,?,?)`).run(randomUUID(), randomUUID(), identity.owner_domain, identity.scope);
        for (const sql of CONTEXT_TRIGGER_SQL) await db.exec(sql);
        await db.exec(`PRAGMA application_id=${CONTEXT_APPLICATION_ID}`);
    }).immediate();
}

export async function validateMemoryContextFormat(db: MemoryDatabase, identity: ContextStoreIdentity) {
    try {
        const marker = contextStoreMarkerSchema.parse(await db.prepare(`SELECT * FROM ${CONTEXT_STORE_TABLE} WHERE id=1`).get());
        if (marker.owner_domain !== identity.owner_domain || marker.scope !== identity.scope) throw memoryError('MEMORY_OWNER_MISMATCH');
        const pragma = await db.prepare('PRAGMA application_id').get();
        if (pragma?.application_id !== CONTEXT_APPLICATION_ID) throw memoryError('MEMORY_CONTEXT_DAMAGED');
        const objects = await db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' OR (type='table' AND name LIKE 'cairn_memory_context_%') ORDER BY name").all();
        // Later phases add assertion tables; this foundation always validates its own exact objects.
        const required = new Set([...CONTEXT_TABLE_SQL, ...CONTEXT_TRIGGER_SQL].map(sql => sql.trim()));
        for (const row of objects) required.delete(String(row.sql).trim());
        if (required.size || objects.filter(row => String(row.sql).startsWith('CREATE TRIGGER')).length !== CONTEXT_TRIGGER_SQL.length) throw memoryError('MEMORY_CONTEXT_DAMAGED');
        const damaged = await db.prepare(`SELECT 1 AS damaged FROM kv_store k
            LEFT JOIN ${CONTEXT_REVISION_TABLE} r ON r.key=k.key
            WHERE k.key!='__history__' AND substr(k.key,1,12)!='__history__/'
              AND k.key!='__reviewed__' AND substr(k.key,1,13)!='__reviewed__/'
              AND (r.key IS NULL OR r.present!=1)
            UNION ALL SELECT 1 FROM ${CONTEXT_REVISION_TABLE} r
            LEFT JOIN kv_store k ON k.key=r.key
            WHERE (r.present=1 AND k.key IS NULL) OR typeof(r.generation)!='integer'
              OR typeof(r.context_revision)!='integer' LIMIT 1`).get();
        if (damaged) throw memoryError('MEMORY_CONTEXT_DAMAGED');
        return marker;
    } catch (error) {
        if ((error as { code?: string }).code === 'MEMORY_OWNER_MISMATCH') throw error;
        throw memoryError('MEMORY_CONTEXT_DAMAGED');
    }
}

export async function readMemorySourceRef(db: MemoryDatabase, identity: ContextStoreIdentity, key: string): Promise<MemorySourceRef | null> {
    if (Buffer.byteLength(key) > 4096 || key === '__history__' || key.startsWith('__history__/')
        || key === '__reviewed__' || key.startsWith('__reviewed__/')) throw memoryError('MEMORY_INVALID_SOURCE');
    const read = async () => {
        const marker = await validateMemoryContextFormat(db, identity);
        const value = await db.prepare('SELECT value FROM kv_store WHERE key=?').get(key);
        if (!value) return null;
        const revision = await db.prepare(`SELECT generation,present,context_revision FROM ${CONTEXT_REVISION_TABLE} WHERE key=?`).get(key);
        if (!revision || revision.present !== 1 || typeof value.value !== 'string') throw memoryError('MEMORY_CONTEXT_DAMAGED');
        try {
            return memorySourceRefSchema.parse({ schema_version: 1, owner_domain: marker.owner_domain, scope: marker.scope,
                store_uuid: marker.store_uuid, restore_epoch: marker.restore_epoch, key, generation: revision.generation,
                context_revision: revision.context_revision, content_digest: createHash('sha256').update(value.value).digest('hex') });
        } catch { throw memoryError('MEMORY_CONTEXT_DAMAGED'); }
    };
    return db.inOwnedTransaction ? read() : db.transaction(read)();
}
