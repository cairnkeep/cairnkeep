import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { MemoryDatabase } from './memory-database.js';
import { memoryError } from './memory-database-protocol.js';
import { CONTEXT_REVISION_TABLE, memorySourceRefSchema, type MemorySourceRef } from './memory-context-schema.js';
import { readMemoryMapFreshness } from './memory-context-store.js';
import { readMemoryMapEntities } from './memory-connections.js';
import { readLegacyMemoryMapKeys } from './memory-legacy-inspection.js';
import { memoryStoreIdentity, openOrdinaryMemoryView } from './ordinary-memory-store.js';
import { probeOrdinaryMemoryFormat, validateMemoryContextFormat } from './memory-store-format.js';
import { atomicReplace, hardenPrivatePath, memoryPathAncestorsAreSafe, privatePathIsSafe } from './platform-security.js';
import { readStableJson } from './stable-file.js';
import { memoryMapPage, chargeMemoryMapPage, type MemoryMapBudget } from './memory-map-budget.js';

type Target = { path: string; scope: string };
type Navigation = { key: string; source: MemorySourceRef | null; status: string };
type Entry = { kind: 'prefix'; prefix: string; count: number; freshness: Record<string, number>; navigation: Navigation[]; navigation_truncated: boolean }
    | { kind: 'entity'; id: string; title: string; ambiguous: boolean | null; navigation: Navigation[] };
type Partition = { scope: string; tracked: boolean; entries: Entry[] };
export type MemoryMap = { schema_version: 1; partitions: Partition[]; exact_reads_required: true; truncated: boolean };
type Snapshot = { partition: Partition; revision: string; truncated: boolean; scanned: number; bytes: number };
const MAX_ROWS = 5000, MAX_SCAN_BYTES = 8 * 1024 * 1024;
const optionsSchema = z.object({ max_bytes: z.number().int().min(1024).max(8192).default(4096), limit: z.number().int().min(1).max(50).default(50) }).strict();
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = (code = 'MEMORY_MAP_INVALID'): never => { throw memoryError(code); };
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const liveSql = "key!='__history__' AND substr(key,1,12)!='__history__/' AND key!='__reviewed__' AND substr(key,1,13)!='__reviewed__/'";
export const memoryMapResponse = (payload: MemoryMap) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload });
const empty = (): MemoryMap => ({ schema_version: 1, partitions: [], exact_reads_required: true, truncated: false });

function prefixes(rows: Navigation[]): Entry[] {
    const groups = new Map<string, Navigation[]>();
    for (const row of rows) {
        const prefix = row.key.includes('/') ? row.key.slice(0, row.key.indexOf('/')) : row.key;
        const group = groups.get(prefix) ?? []; group.push(row); groups.set(prefix, group);
    }
    return [...groups].sort(([a], [b]) => compare(a, b)).map(([prefix, group]) => {
        group.sort((a, b) => compare(a.key, b.key));
        const freshness: Record<string, number> = {};
        for (const row of group) freshness[row.status] = (freshness[row.status] ?? 0) + 1;
        return { kind: 'prefix', prefix, count: group.length, freshness, navigation: group.slice(0, 3), navigation_truncated: group.length > 3 };
    });
}

async function snapshot(target: Target, now: Date, budget: { rows: number; bytes: number }): Promise<Snapshot> {
    const remaining: MemoryMapBudget = { ...budget };
    const kind = probeOrdinaryMemoryFormat(target.path).kind;
    const partition: Partition = { scope: target.scope, tracked: kind === 'context-v1', entries: [] };
    if (kind === 'missing') return { partition, revision: digest(['missing', memoryStoreIdentity(target.path, target.scope)]), truncated: false, scanned: 0, bytes: 0 };
    if (kind === 'legacy') {
        const { keys, scanned, bytes, truncated } = await readLegacyMemoryMapKeys(target.path, budget);
        partition.entries = prefixes(keys.map(key => ({ key, source: null, status: 'untracked' })));
        return { partition, revision: digest(['legacy', memoryStoreIdentity(target.path, target.scope), keys]), truncated, scanned,
            bytes };
    }
    if (kind !== 'context-v1') return fail('MEMORY_FORMAT_UNSUPPORTED');
    const view = await openOrdinaryMemoryView(target.path, target.scope, 'context-v1');
    if (!view) return fail('MEMORY_SOURCE_MISSING');
    try {
        const db = view.getDatabase();
        if (!(db instanceof MemoryDatabase)) return fail('MEMORY_FRESH_STORE_REQUIRED');
        return await db.transaction(async () => {
            const marker = await validateMemoryContextFormat(db, memoryStoreIdentity(target.path, target.scope));
            const sources = new Map<string, MemorySourceRef>();
            let offset = 0, truncated = false;
            for (;;) {
                if (!remaining.rows || !remaining.bytes) { truncated = true; break; }
                const page = memoryMapPage('ordinary', `SELECT key,value,r.generation,r.present,r.context_revision
                    FROM kv_store LEFT JOIN ${CONTEXT_REVISION_TABLE} r USING(key) WHERE ${liveSql}`, [], offset, remaining);
                const rows = await db.prepare(page.sql).all(...page.args);
                const limited = chargeMemoryMapPage('ordinary', rows, remaining);
                if (!rows.length) break;
                offset += rows.length;
                for (const row of rows) {
                    if (row.__map_limited === 1) continue;
                    if (typeof row.key !== 'string' || !row.key.length || typeof row.value !== 'string') { truncated = true; continue; }
                    if (row.present !== 1) return fail('MEMORY_CONTEXT_DAMAGED');
                    const source = memorySourceRefSchema.safeParse({ schema_version: 1, owner_domain: marker.owner_domain, scope: marker.scope,
                        store_uuid: marker.store_uuid, restore_epoch: marker.restore_epoch, key: row.key, generation: row.generation,
                        context_revision: row.context_revision, content_digest: createHash('sha256').update(row.value).digest('hex') });
                    if (!source.success) return fail('MEMORY_CONTEXT_DAMAGED');
                    sources.set(row.key, source.data);
                }
                if (limited) { truncated = true; break; }
                if (rows.length < page.limit) break;
            }
            const fresh = await readMemoryMapFreshness(db, [...sources.values()], now, remaining);
            const { statuses } = fresh;
            partition.entries = prefixes([...sources.values()].map(source => ({ key: source.key, source, status: statuses.get(source.key)! })));
            const graph = await readMemoryMapEntities(db, sources, remaining);
            const aliases = new Map<string, Set<string>>();
            for (const entity of graph.entities) for (const alias of new Set([entity.title, ...entity.aliases])) {
                const ids = aliases.get(alias) ?? new Set<string>(); ids.add(entity.id); aliases.set(alias, ids);
            }
            for (const entity of graph.entities) partition.entries.push({ kind: 'entity', id: entity.id, title: entity.title,
                ambiguous: [entity.title, ...entity.aliases].some(alias => aliases.get(alias)!.size > 1) ? true : truncated || graph.truncated ? null : false,
                navigation: [{ key: entity.anchor.key, source: entity.anchor, status: statuses.get(entity.anchor.key)! }] });
            return { partition, revision: digest([marker, [...sources.values()], [...statuses], graph.entities]), truncated: truncated || fresh.truncated || graph.truncated,
                scanned: budget.rows - remaining.rows, bytes: budget.bytes - remaining.bytes };
        })();
    } finally { await view.close(); }
}

/** Optional cache is never an authorization source. Every use follows fresh
 * visibility/revision checks and exact deterministic payload comparison. */
async function cacheSnapshot(target: Target, current: Snapshot): Promise<Snapshot> {
    const directory = join(dirname(target.path), '.memory-map-cache');
    const name = digest([memoryStoreIdentity(target.path, target.scope), 'memory-map-v1']);
    const path = join(directory, `${name}.json`);
    let temporary: string | undefined;
    try {
        const parent = lstatSync(dirname(target.path));
        if (!parent.isDirectory() || parent.isSymbolicLink() || !memoryPathAncestorsAreSafe(directory)) return current;
        try { mkdirSync(directory, { mode: 0o700 }); hardenPrivatePath(directory); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') return current; }
        const dir = lstatSync(directory);
        if (!dir.isDirectory() || dir.isSymbolicLink() || !privatePathIsSafe(directory)) return current;
        // Cache only a bounded preview. The complete current snapshot remains
        // necessary for whole-response budgeting and cannot be recovered here.
        const payload = bounded([current], { max_bytes: 8192, limit: 50 });
        const expected = { schema_version: 1, revision: current.revision, payload };
        // Reject named special files/reparse points before descriptor opening,
        // particularly on platforms without POSIX no-follow/nonblocking flags.
        try {
            const existing = lstatSync(path);
            if (!existing.isFile() || existing.isSymbolicLink() || !privatePathIsSafe(path)) return current;
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return current; }
        try {
            const stored = readStableJson(path, { label: 'Memory map cache', maxBytes: 16384, private: true });
            if (JSON.stringify(stored) === JSON.stringify(expected)) return current;
        } catch { /* Missing, damaged or unsafe cache is not a retrieval failure. */ }
        try {
            const existing = lstatSync(path);
            if (!existing.isFile() || existing.isSymbolicLink() || !privatePathIsSafe(path)) return current;
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return current; }
        temporary = join(directory, `${name}.${randomUUID()}.tmp`);
        await writeFile(temporary, JSON.stringify(expected), { mode: 0o600, flag: 'wx' }); hardenPrivatePath(temporary);
        const after = lstatSync(directory);
        if (after.dev !== dir.dev || after.ino !== dir.ino || after.isSymbolicLink() || !privatePathIsSafe(directory)) return current;
        await atomicReplace(temporary, path);
    } catch { /* Cache failures cannot grant access or block exact navigation. */ }
    finally { if (temporary) await rm(temporary, { force: true }).catch(() => {}); }
    return current;
}

function bounded(snapshots: Snapshot[], options: z.infer<typeof optionsSchema>): MemoryMap {
    const result = empty(); let count = 0;
    const fits = () => Buffer.byteLength(JSON.stringify(memoryMapResponse({ ...result, truncated: false }))) <= options.max_bytes;
    for (const state of snapshots) {
        const partition: Partition = { ...state.partition, entries: [] };
        result.partitions.push(partition);
        if (!fits()) { result.partitions.pop(); result.truncated = true; continue; }
        if (state.truncated) result.truncated = true;
        for (const entry of state.partition.entries) {
            if (count === options.limit) { result.truncated = true; break; }
            partition.entries.push(entry);
            if (!fits()) { partition.entries.pop(); result.truncated = true; continue; }
            if (entry.kind === 'prefix' && entry.navigation_truncated) result.truncated = true;
            count++;
        }
    }
    return result;
}

/** Trusted callers resolve and authorize physical ordinary stores first. A map
 * never joins their graphs, reveals source values or activates instructions. */
export async function buildMemoryMap(targets: Target[], input: { max_bytes?: number; limit?: number; now?: () => Date } = {}): Promise<MemoryMap> {
    const { now: clock, ...raw } = input;
    const parsed = optionsSchema.safeParse(raw);
    if (!parsed.success || targets.length > 32) return fail();
    if (targets.some(target => typeof target.path !== 'string' || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(target.scope))) return fail();
    const now = clock ? clock() : new Date();
    if (!Number.isFinite(now.getTime())) return fail();
    const states: Snapshot[] = [], budget = { rows: MAX_ROWS, bytes: MAX_SCAN_BYTES };
    let exhausted = false;
    for (const target of targets) {
        if (budget.rows < 2 || budget.bytes < 2) { exhausted = true; break; }
        // Reserve an equal validation allowance before the first read. The
        // hard request ceiling covers BOTH snapshots, not their maximum.
        const allowance = { rows: Math.floor(budget.rows / 2), bytes: Math.floor(budget.bytes / 2) };
        const first = await snapshot(target, now, allowance), second = await snapshot(target, now, allowance);
        // Independent snapshots are not linearizable; omit uncertain results.
        if (digest(first) !== digest(second)) states.push({ ...second, partition: { ...second.partition, entries: [] }, truncated: true });
        else states.push(probeOrdinaryMemoryFormat(target.path).kind === 'missing' ? second : await cacheSnapshot(target, second));
        budget.rows -= first.scanned + second.scanned; budget.bytes -= first.bytes + second.bytes;
    }
    const result = bounded(states, parsed.data);
    if (exhausted) result.truncated = true;
    return result;
}
