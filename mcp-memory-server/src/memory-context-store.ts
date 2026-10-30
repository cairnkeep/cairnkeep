import { createHash } from 'node:crypto';
import {
    CONTEXT_FACT_TABLE, CONTEXT_FACT_SQL, CONTEXT_REVISION_TABLE,
    contextStoreIdentitySchema, memoryFreshnessMetadataSchema, memoryFreshnessAssertionSchema,
    type ContextStoreIdentity, type MemoryFreshnessMetadata, type MemorySourceRef,
} from './memory-context-schema.js';
import { MemoryDatabase } from './memory-database.js';
import { memoryError } from './memory-database-protocol.js';
import { probeOrdinaryMemoryFormat, readMemorySourceRef, validateMemoryContextFormat } from './memory-store-format.js';
import { canonicalMemoryPath, memoryStoreIdentity, openOrdinaryMemoryStore, openOrdinaryMemoryView } from './ordinary-memory-store.js';
import { withOrdinaryMemorySnapshot } from './ordinary-memory-store.js';
import { readLegacyMemoryInspection } from './memory-legacy-inspection.js';
import { memoryMapPage, chargeMemoryMapPage, type MemoryMapBudget } from './memory-map-budget.js';
import { readMemorySearchMetadata } from './memory-search-metadata.js';

export { readMemorySourceRef } from './memory-store-format.js';
type Target = { path: string; scope: string; key: string; now?: () => Date };
type Change = Target & { input: unknown };
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function assertMemoryContextKey(key: string): void {
    if (typeof key !== 'string' || !key.length || Buffer.byteLength(key) > 4096
        || key === '__history__' || key.startsWith('__history__/')
        || key === '__reviewed__' || key.startsWith('__reviewed__/')) throw memoryError('MEMORY_INVALID_SOURCE');
}

function clock(now?: () => Date): Date {
    const result = now ? now() : new Date();
    if (!Number.isFinite(result.getTime())) throw memoryError('MEMORY_FRESHNESS_INVALID');
    return result;
}
function metadata(input: unknown, now: Date): MemoryFreshnessMetadata {
    // CLI file reads have their own pre-allocation bound; the core independently
    // enforces a strict shape and total serialized input budget.
    try {
        if (!input || typeof input !== 'object' || Array.isArray(input)
            || !('source_refs' in input) || !Array.isArray(input.source_refs) || input.source_refs.length > 8) throw new Error();
        const result = memoryFreshnessMetadataSchema.parse(input);
        if (Buffer.byteLength(JSON.stringify(result)) > 65536) throw new Error();
        if (result.verified_at && Date.parse(result.verified_at) > now.getTime()) throw new Error();
        return result;
    } catch { throw memoryError('MEMORY_FRESHNESS_INVALID'); }
}
function identity(target: Target): ContextStoreIdentity {
    return contextStoreIdentitySchema.parse(memoryStoreIdentity(target.path, target.scope));
}
function contextDatabase(value: unknown): MemoryDatabase {
    if (!(value instanceof MemoryDatabase)) throw memoryError('MEMORY_FRESH_STORE_REQUIRED');
    return value;
}

async function assertionTableExists(db: MemoryDatabase): Promise<boolean> {
    const found = await db.prepare("SELECT type,sql FROM sqlite_master WHERE name=?").get(CONTEXT_FACT_TABLE);
    if (found && (found.type !== 'table' || found.sql !== CONTEXT_FACT_SQL)) throw memoryError('MEMORY_CONTEXT_DAMAGED');
    // A missing table/row after any curation is damaged, not untracked metadata.
    const missing = await db.prepare(found
        ? `SELECT 1 FROM ${CONTEXT_REVISION_TABLE} r LEFT JOIN ${CONTEXT_FACT_TABLE} f ON f.key=r.key WHERE r.context_revision>0 AND f.key IS NULL LIMIT 1`
        : `SELECT 1 FROM ${CONTEXT_REVISION_TABLE} WHERE context_revision>0 LIMIT 1`).get();
    if (missing) throw memoryError('MEMORY_CONTEXT_DAMAGED');
    return Boolean(found);
}

/** Internal explicit-apply primitive. Never called by read/plan/startup/doctor. */
export async function initMemoryFreshnessMetadataTables(db: MemoryDatabase, owner: ContextStoreIdentity): Promise<void> {
    if (db.readonly || !db.inOwnedTransaction) throw memoryError('MEMORY_FRESHNESS_TRANSACTION_REQUIRED');
    await validateMemoryContextFormat(db, owner);
    if (!await assertionTableExists(db)) await db.exec(CONTEXT_FACT_SQL);
}

async function readAssertion(db: MemoryDatabase, key: string, tableChecked = false) {
    if (!tableChecked && !await assertionTableExists(db)) return null;
    const row = await db.prepare(`SELECT assertion_json FROM ${CONTEXT_FACT_TABLE} WHERE key=?`).get(key);
    if (!row) return null;
    try {
        if (typeof row.assertion_json !== 'string' || Buffer.byteLength(row.assertion_json) > 65536) throw new Error();
        const assertion = memoryFreshnessAssertionSchema.parse(JSON.parse(row.assertion_json));
        if (assertion.source.key !== key || (assertion.metadata.verified_at
            && Date.parse(assertion.metadata.verified_at) > Date.parse(assertion.captured_at))) throw new Error();
        return assertion;
    } catch { throw memoryError('MEMORY_CONTEXT_DAMAGED'); }
}

async function readPlan(db: MemoryDatabase, target: Change, value: MemoryFreshnessMetadata) {
    const owner = identity(target);
    const source = await readMemorySourceRef(db, owner, target.key);
    if (!source) throw memoryError('MEMORY_SOURCE_MISSING');
    const previous = await readAssertion(db, target.key);
    const body = { schema_version: 1 as const, operation: 'set-freshness' as const,
        path: canonicalMemoryPath(target.path), source, metadata: value, previous_digest: hash(previous) };
    return { ...body, digest: hash(body) };
}

export async function planFreshnessChange(target: Change) {
    assertMemoryContextKey(target.key);
    const value = metadata(target.input, clock(target.now));
    if (probeOrdinaryMemoryFormat(target.path).kind !== 'context-v1') throw memoryError('MEMORY_FRESH_STORE_REQUIRED');
    const view = await openOrdinaryMemoryView(target.path, target.scope);
    if (!view) throw memoryError('MEMORY_SOURCE_MISSING');
    try {
        const db = contextDatabase(view.getDatabase());
        return await db.transaction(() => readPlan(db, target, value))();
    } finally { await view.close(); }
}

export async function applyFreshnessChange(target: Change & { confirm: string }) {
    assertMemoryContextKey(target.key);
    const now = clock(target.now), value = metadata(target.input, now);
    if (!/^[a-f0-9]{64}$/.test(target.confirm)) throw memoryError('MEMORY_FRESHNESS_STALE_PLAN');
    if (probeOrdinaryMemoryFormat(target.path).kind !== 'context-v1') throw memoryError('MEMORY_FRESH_STORE_REQUIRED');
    const agent = await openOrdinaryMemoryStore(target.path, target.scope);
    if (!agent) throw memoryError('MEMORY_SOURCE_MISSING');
    try {
        const db = contextDatabase(agent.getDatabase());
        return await db.transaction(async () => {
            const planned = await readPlan(db, target, value);
            if (planned.digest !== target.confirm) throw memoryError('MEMORY_FRESHNESS_STALE_PLAN');
            if (planned.source.context_revision === Number.MAX_SAFE_INTEGER) throw memoryError('MEMORY_CONTEXT_REVISION_EXHAUSTED');
            await initMemoryFreshnessMetadataTables(db, identity(target));
            await db.prepare(`UPDATE ${CONTEXT_REVISION_TABLE} SET context_revision=context_revision+1 WHERE key=?`).run(target.key);
            const source: MemorySourceRef = { ...planned.source, context_revision: planned.source.context_revision + 1 };
            const assertion = memoryFreshnessAssertionSchema.parse({ schema_version: 1, source, metadata: value, captured_at: now.toISOString() });
            await db.prepare(`INSERT INTO ${CONTEXT_FACT_TABLE}(key,assertion_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET assertion_json=excluded.assertion_json`)
                .run(target.key, JSON.stringify(assertion));
            return { schema_version: 1 as const, applied: true, source, digest: planned.digest };
        }).immediate();
    } finally { await agent.close(); }
}

async function readTrackedFreshness(db: MemoryDatabase, target: Target, now: Date) {
    const source = await readMemorySourceRef(db, identity(target), target.key);
    const assertion = await readAssertion(db, target.key);
    const stale = Boolean(assertion && (!source || hash(assertion.source) !== hash(source)));
    const active = assertion && !stale;
    const status = !active ? 'unknown' : !assertion.metadata.verified_at ? 'unverified'
        : assertion.metadata.review_after && Date.parse(assertion.metadata.review_after) <= now.getTime() ? 'needs_review' : 'current';
    return { schema_version: 1 as const, tracked: true, source, status, stale,
        metadata: assertion?.metadata ?? null, asserted_source: assertion?.source ?? null,
        captured_at: assertion?.captured_at ?? null,
        future_effective: Boolean(assertion?.metadata.effective_at && Date.parse(assertion.metadata.effective_at) > now.getTime()) };
}
const untracked = () => ({ schema_version: 1 as const, tracked: false, status: 'unknown' as const,
    source: null, metadata: null, stale: false, future_effective: false });

/** Map snapshot projection: the caller already admitted these exact live refs.
 * Do not re-open a store or validate its whole schema once per navigation key. */
export async function readMemoryMapFreshness(db: MemoryDatabase, sources: MemorySourceRef[], now: Date, budget: MemoryMapBudget) {
    const statuses = new Map(sources.map(source => [source.key, 'unknown']));
    let truncated = false;
    if (await assertionTableExists(db)) {
        scan: for (let offset = 0; offset < sources.length; offset += 32) {
            if (!budget.rows || !budget.bytes) { truncated = true; break; }
            const batch = sources.slice(offset, offset + 32), allowed = new Map(batch.map(source => [source.key, source]));
            const page = memoryMapPage('freshness', `SELECT key,assertion_json FROM ${CONTEXT_FACT_TABLE}
                WHERE key IN (${batch.map(() => '?').join(',')})`, [...allowed.keys()], 0, budget);
            const rows = await db.prepare(page.sql).all(...page.args);
            const limited = chargeMemoryMapPage('freshness', rows, budget);
            for (const row of rows) {
                if (row.__map_limited === 1) continue;
                if (typeof row.assertion_json !== 'string') throw memoryError('MEMORY_CONTEXT_DAMAGED');
                let assertion;
                try { assertion = memoryFreshnessAssertionSchema.parse(JSON.parse(row.assertion_json)); }
                catch { throw memoryError('MEMORY_CONTEXT_DAMAGED'); }
                if (assertion.source.key !== row.key || (assertion.metadata.verified_at && Date.parse(assertion.metadata.verified_at) > Date.parse(assertion.captured_at))) throw memoryError('MEMORY_CONTEXT_DAMAGED');
                if (hash(assertion.source) !== hash(allowed.get(String(row.key)))) continue;
                statuses.set(String(row.key), !assertion.metadata.verified_at ? 'unverified'
                    : assertion.metadata.review_after && Date.parse(assertion.metadata.review_after) <= now.getTime() ? 'needs_review' : 'current');
            }
            if (limited || budget.rows === 0 || budget.bytes === 0) { truncated = true; break scan; }
        }
    }
    return { statuses, truncated };
}

export async function inspectMemoryFreshness(target: Target) {
    assertMemoryContextKey(target.key);
    const now = clock(target.now);
    const kind = probeOrdinaryMemoryFormat(target.path).kind;
    if (kind === 'legacy' || kind === 'missing') return untracked();
    if (kind !== 'context-v1') throw memoryError('MEMORY_FORMAT_UNSUPPORTED');
    const view = await openOrdinaryMemoryView(target.path, target.scope);
    if (!view) throw memoryError('MEMORY_SOURCE_MISSING');
    try {
        const db = contextDatabase(view.getDatabase());
        return await db.transaction(() => readTrackedFreshness(db, target, now))();
    } finally { await view.close(); }
}

/** Read text and its assertion under one tracked-store snapshot. Never join a
 * value from one generation with provenance from a later connection. */
export async function inspectMemoryCandidate(target: Target) {
    assertMemoryContextKey(target.key);
    const now = clock(target.now), kind = probeOrdinaryMemoryFormat(target.path).kind;
    if (kind === 'missing') return null;
    if (kind === 'unsupported') throw memoryError('MEMORY_FORMAT_UNSUPPORTED');
    const decode = (raw: unknown) => {
        let value: unknown;
        try { value = JSON.parse(String(raw)); } catch { throw memoryError('MEMORY_CONTEXT_DAMAGED'); }
        return typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
    };
    if (kind === 'legacy') {
        const row = await readLegacyMemoryInspection(target.path, target.key);
        return !row ? null : row.value === null ? { oversized: true as const }
            : { scope: target.scope, key: target.key, value: decode(row.value), ...untracked() };
    }
    const view = await openOrdinaryMemoryView(target.path, target.scope);
    if (!view) return null;
    try {
        return await withOrdinaryMemorySnapshot(view, async () => {
            const row = await view.getDatabase().prepare('SELECT CASE WHEN length(CAST(value AS BLOB))<=32768 THEN value END AS value FROM kv_store WHERE key=?').get(target.key) as { value: unknown } | undefined;
            if (!row) return null;
            if (row.value === null) return { oversized: true as const };
            const freshness = await readTrackedFreshness(contextDatabase(view.getDatabase()), target, now);
            const { readMemoryClaimConflicts } = await import('./memory-connections.js');
            const conflicts = await readMemoryClaimConflicts(contextDatabase(view.getDatabase()), target, target.key);
            return { scope: target.scope, key: target.key, value: decode(row.value), ...freshness,
                ...(conflicts.length ? { claim_conflicts: conflicts } : {}) };
        });
    } finally { await view.close(); }
}

/** One admitted snapshot per physical tracked scope, not one worker per result.
 * Targets and already-admitted entries come only from the trusted retrieval path. */
export async function inspectMemorySearchEntries(targets: Array<{ path: string; scope: string }>,
    entries: Array<{ key: string; scope: string; value: string; node_type?: string; tags?: string[] }>) {
    if (entries.length > 50 || targets.length > 32) throw memoryError('MEMORY_CONTEXT_SEARCH_LIMIT');
    const result = new Map<string, { source: MemorySourceRef | null; tracked: boolean; status: string }>();
    for (const entry of entries) assertMemoryContextKey(entry.key);
    for (const target of targets) {
        const group = entries.filter(entry => entry.scope === target.scope);
        if (!group.length) continue;
        const kind = probeOrdinaryMemoryFormat(target.path).kind;
        if (kind === 'missing') continue;
        if (kind === 'legacy') {
            for (const entry of group) {
                const typed = entry.node_type !== undefined || entry.tags !== undefined;
                const observed = await readLegacyMemoryInspection(target.path, entry.key, { typed });
                if (!observed || observed.value === null) continue;
                let decoded: unknown;
                try { decoded = JSON.parse(observed.value); } catch { throw memoryError('MEMORY_CONTEXT_DAMAGED'); }
                const value = typeof decoded === 'string' ? decoded : decoded == null ? '' : JSON.stringify(decoded);
                if (value !== entry.value || (typed && (!observed.metadata || observed.metadata.node_type !== entry.node_type
                    || JSON.stringify(observed.metadata.tags) !== JSON.stringify(entry.tags)))) continue;
                result.set(JSON.stringify([entry.scope, entry.key]), untracked());
            }
            continue;
        }
        if (kind !== 'context-v1') throw memoryError('MEMORY_FORMAT_UNSUPPORTED');
        const view = await openOrdinaryMemoryView(target.path, target.scope, 'context-v1');
        if (!view) continue;
        try {
            const db = contextDatabase(view.getDatabase()), now = clock();
            await db.transaction(async () => {
                for (const entry of group) {
                    const row = await db.prepare("SELECT CASE WHEN typeof(value)='text' AND length(CAST(value AS BLOB))<=32768 THEN CAST(value AS BLOB) END AS value FROM kv_store WHERE key=?").get(entry.key);
                    if (!row || row.value === null) continue;
                    let decoded: unknown;
                    try {
                        if (!(row.value instanceof Uint8Array)) throw new Error();
                        decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(row.value));
                    } catch { throw memoryError('MEMORY_CONTEXT_DAMAGED'); }
                    const value = typeof decoded === 'string' ? decoded : decoded == null ? '' : JSON.stringify(decoded);
                    if (value !== entry.value) continue;
                    if (entry.node_type !== undefined || entry.tags !== undefined) {
                        const metadata = await readMemorySearchMetadata(db, entry.key);
                        if (metadata.node_type !== entry.node_type || JSON.stringify(metadata.tags) !== JSON.stringify(entry.tags)) continue;
                    }
                    const current = await readTrackedFreshness(db, { ...target, key: entry.key }, now);
                    result.set(JSON.stringify([entry.scope, entry.key]), { source: current.source, tracked: true, status: current.status });
                }
            })();
        } finally { await view.close(); }
    }
    return result;
}

type Candidate = Exclude<Awaited<ReturnType<typeof inspectMemoryCandidate>>, null | { oversized: true }>;
export type MemoryInspection = { schema_version: 1; key: string; candidates: Candidate[]; possible_conflicts: boolean; truncated: boolean };
export const memoryInspectionResponse = (payload: MemoryInspection) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }], structuredContent: payload,
});

/** Targets are resolved by the trusted caller; never accept a client-supplied path. */
export async function inspectMemoryCandidates(key: string, targets: Array<{ path: string; scope: string }>) {
    assertMemoryContextKey(key);
    if (targets.length > 32) throw memoryError('MEMORY_SCOPE_LIMIT');
    const payload: MemoryInspection = { schema_version: 1, key, candidates: [], possible_conflicts: false, truncated: false };
    // The echoed key appears twice, with additional escaping in text content.
    // Bound even an empty frame before accessing any store, not just additions.
    if (Buffer.byteLength(JSON.stringify(memoryInspectionResponse(payload))) > 32768) throw memoryError('MEMORY_INSPECTION_LIMIT');
    for (const target of targets) {
        if (payload.candidates.length === 16) { payload.truncated = true; break; }
        const candidate = await inspectMemoryCandidate({ ...target, key });
        if (!candidate) continue;
        if ('oversized' in candidate) { payload.truncated = true; continue; }
        // JSON false is one byte longer than true; reserve the larger flags in
        // both content and structuredContent so the final result cannot grow.
        const proposed = { ...payload, candidates: [...payload.candidates, candidate], possible_conflicts: false, truncated: false };
        if (Buffer.byteLength(JSON.stringify(memoryInspectionResponse(proposed))) > 32768) { payload.truncated = true; continue; }
        payload.candidates.push(candidate);
    }
    payload.possible_conflicts = new Set(payload.candidates.map(candidate => candidate.value)).size > 1
        || payload.candidates.some(candidate => 'claim_conflicts' in candidate && Boolean(candidate.claim_conflicts?.length));
    return payload;
}

/** Explicit local administration: metadata only, never kv_store values. */
export async function memoryFreshnessStoreStatus(target: { path: string; scope?: string }) {
    const kind = probeOrdinaryMemoryFormat(target.path).kind;
    if (kind === 'legacy' || kind === 'missing') return { initialized: false, assertion_count: 0 };
    if (kind !== 'context-v1') throw memoryError('MEMORY_FORMAT_UNSUPPORTED');
    const view = await openOrdinaryMemoryView(target.path, target.scope);
    if (!view) throw memoryError('MEMORY_SOURCE_MISSING');
    try {
        const db = contextDatabase(view.getDatabase());
        return await db.transaction(async () => {
            if (!await assertionTableExists(db)) return { initialized: false, assertion_count: 0 };
            const keys = await db.prepare(`SELECT key FROM ${CONTEXT_FACT_TABLE} ORDER BY key LIMIT 5001`).all();
            if (keys.length > 5000) throw memoryError('MEMORY_FRESHNESS_SCAN_LIMIT');
            for (const row of keys) { assertMemoryContextKey(String(row.key)); await readAssertion(db, String(row.key), true); }
            return { initialized: true, assertion_count: keys.length };
        })();
    } finally { await view.close(); }
}
