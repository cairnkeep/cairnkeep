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

export { readMemorySourceRef } from './memory-store-format.js';
type Target = { path: string; scope: string; key: string; now?: () => Date };
type Change = Target & { input: unknown };
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

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

async function readAssertion(db: MemoryDatabase, key: string) {
    if (!await assertionTableExists(db)) return null;
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

export async function inspectMemoryFreshness(target: Target) {
    const now = clock(target.now);
    const kind = probeOrdinaryMemoryFormat(target.path).kind;
    if (kind === 'legacy' || kind === 'missing') return { schema_version: 1 as const, tracked: false, status: 'unknown' as const,
        source: null, metadata: null, stale: false, future_effective: false };
    if (kind !== 'context-v1') throw memoryError('MEMORY_FORMAT_UNSUPPORTED');
    const view = await openOrdinaryMemoryView(target.path, target.scope);
    if (!view) throw memoryError('MEMORY_SOURCE_MISSING');
    try {
        const db = contextDatabase(view.getDatabase());
        return await db.transaction(async () => {
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
        })();
    } finally { await view.close(); }
}
