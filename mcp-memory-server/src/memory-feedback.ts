/** Explicit usefulness is self-reported retrieval evidence, never truth or approval. */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { MemoryDatabase } from './memory-database.js';
import { memoryError } from './memory-database-protocol.js';
import { CONTEXT_FEEDBACK_SQL, CONTEXT_FEEDBACK_TABLE, memoryFeedbackInputSchema, memoryFeedbackRecordSchema,
    memorySourceRefSchema, type MemoryFeedbackRecord, type MemorySourceRef } from './memory-context-schema.js';
import { canonicalMemoryPath, memoryStoreIdentity, openOrdinaryMemoryStore, openOrdinaryMemoryView } from './ordinary-memory-store.js';
import { probeOrdinaryMemoryFormat, readMemorySourceRef, validateMemoryContextFormat } from './memory-store-format.js';
import { assertMemoryContextKey } from './memory-context-store.js';

type Target = { path: string; scope: string };
const CAPACITY = 10000, TTL = 86400000, RETENTION = 30 * TTL;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const memoryFeedbackDigest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const receiptSchema = z.object({
    schema_version: z.literal(1), source: memorySourceRefSchema, task_digest: digestSchema,
    project: digestSchema, ledger_uuid: z.uuid(), ledger_epoch: z.uuid(), issued: z.number().int().nonnegative(),
    expires: z.number().int().positive(),
}).strict();
const selectionSchema = z.object({ schema_version: z.literal(1), ids: z.array(digestSchema).min(1).max(500)
    .refine(ids => new Set(ids).size === ids.length) }).strict();
const projectId = (target: Target) => memoryFeedbackDigest(['feedback-project-v1', canonicalMemoryPath(target.path)]);
function dbOf(value: unknown): MemoryDatabase {
    if (!(value instanceof MemoryDatabase)) throw memoryError('MEMORY_FRESH_STORE_REQUIRED');
    return value;
}
function checkedTime(now: () => Date): number {
    const value = now().getTime();
    if (!Number.isSafeInteger(value) || value < 0) throw memoryError('MEMORY_FEEDBACK_CLOCK_INVALID');
    return value;
}
async function tableExists(db: MemoryDatabase): Promise<boolean> {
    const row = await db.prepare('SELECT type,sql FROM sqlite_master WHERE name=?').get(CONTEXT_FEEDBACK_TABLE);
    if (row && (row.type !== 'table' || row.sql !== CONTEXT_FEEDBACK_SQL)) throw memoryError('MEMORY_CONTEXT_DAMAGED');
    return Boolean(row);
}
async function rows(db: MemoryDatabase): Promise<MemoryFeedbackRecord[]> {
    if (!await tableExists(db)) return [];
    // Admit raw bytes before worker transfer, then reject malformed UTF8 rather
    // than expanding replacement characters across a full project ledger.
    const records = await db.prepare(`SELECT CASE WHEN typeof(id)='text' AND length(CAST(id AS BLOB))=64 THEN CAST(id AS BLOB) END AS id,
        CASE WHEN typeof(record_json)='text' AND length(CAST(record_json AS BLOB))<=2048 THEN CAST(record_json AS BLOB) END AS record_json
        FROM ${CONTEXT_FEEDBACK_TABLE} ORDER BY id LIMIT 10001`).all();
    if (records.length > CAPACITY) throw memoryError('MEMORY_FEEDBACK_CAPACITY');
    return records.map(row => {
        try {
            if (!(row.record_json instanceof Uint8Array) || !(row.id instanceof Uint8Array)) throw new Error();
            const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
            const record = memoryFeedbackRecordSchema.parse(JSON.parse(decoder.decode(row.record_json)));
            if (record.id !== decoder.decode(row.id)) throw new Error();
            return record;
        } catch { throw memoryError('MEMORY_CONTEXT_DAMAGED'); }
    });
}
async function withLedger<T>(target: Target, write: boolean, action: (db: MemoryDatabase) => Promise<T>): Promise<T> {
    if (target.scope !== 'project' || probeOrdinaryMemoryFormat(target.path).kind !== 'context-v1') throw memoryError('MEMORY_FEEDBACK_LEDGER_REQUIRED');
    const view = write ? await openOrdinaryMemoryStore(target.path, target.scope) : await openOrdinaryMemoryView(target.path, target.scope, 'context-v1');
    if (!view) throw memoryError('MEMORY_FEEDBACK_LEDGER_REQUIRED');
    try {
        const db = dbOf(view.getDatabase()), run = db.transaction(() => action(db));
        return await (write ? run.immediate() : run());
    } finally { await view.close(); }
}
async function currentSource(target: Target, source: MemorySourceRef): Promise<boolean> {
    if (target.scope !== source.scope || probeOrdinaryMemoryFormat(target.path).kind !== 'context-v1') return false;
    const view = await openOrdinaryMemoryView(target.path, target.scope, 'context-v1');
    if (!view) return false;
    try {
        const db = dbOf(view.getDatabase());
        return await db.transaction(async () => {
            // Bound before reading provenance, including when a value grew since search.
            const allowed = await db.prepare("SELECT 1 AS allowed FROM kv_store WHERE key=? AND typeof(value)='text' AND length(CAST(value AS BLOB))<=32768").get(source.key);
            if (!allowed) return false;
            return memoryFeedbackDigest(await readMemorySourceRef(db, memoryStoreIdentity(target.path, target.scope), source.key)) === memoryFeedbackDigest(source);
        })();
    } finally { await view.close(); }
}

export async function memoryFeedbackStatus(target: Target) {
    if (target.scope !== 'project' || ['legacy', 'missing'].includes(probeOrdinaryMemoryFormat(target.path).kind)) {
        return { initialized: false, count: 0, capacity: CAPACITY, eligibility_days: 30 };
    }
    return withLedger(target, false, async db => ({ initialized: await tableExists(db), count: (await rows(db)).length, capacity: CAPACITY, eligibility_days: 30 }));
}
export async function listMemoryFeedback(target: Target) {
    if (!['context-v1', 'unsupported'].includes(probeOrdinaryMemoryFormat(target.path).kind)) return { schema_version: 1, records: [] as MemoryFeedbackRecord[] };
    return withLedger(target, false, async db => ({ schema_version: 1, records: await rows(db) }));
}
async function forgetPlan(db: MemoryDatabase, target: Target, input: unknown) {
    let selection;
    try { selection = selectionSchema.parse(input); } catch { throw memoryError('MEMORY_FEEDBACK_INPUT_INVALID'); }
    const selected = (await rows(db)).filter(row => selection.ids.includes(row.id));
    if (selected.length !== selection.ids.length) throw memoryError('MEMORY_FEEDBACK_STALE_PLAN');
    const marker = await validateMemoryContextFormat(db, memoryStoreIdentity(target.path, target.scope));
    const body = { schema_version: 1 as const, operation: 'forget-feedback' as const, project: projectId(target),
        store_uuid: marker.store_uuid, restore_epoch: marker.restore_epoch, records: selected };
    return { ...body, digest: memoryFeedbackDigest(body) };
}
export const planForgetMemoryFeedback = (target: Target, input: unknown) => withLedger(target, false, db => forgetPlan(db, target, input));
export async function forgetMemoryFeedback(target: Target, input: unknown, confirm: string) {
    return withLedger(target, true, async db => {
        const plan = await forgetPlan(db, target, input);
        if (!digestSchema.safeParse(confirm).success || plan.digest !== confirm) throw memoryError('MEMORY_FEEDBACK_STALE_PLAN');
        for (const row of plan.records) await db.prepare(`DELETE FROM ${CONTEXT_FEEDBACK_TABLE} WHERE id=?`).run(row.id);
        return { schema_version: 1, forgotten: plan.records.length, digest: plan.digest };
    });
}

export class MemoryFeedbackSession {
    private readonly secret = randomBytes(32);
    constructor(private readonly ledger: Target, private readonly resolveSource: (scope: string) => Target,
        private readonly now: () => Date = () => new Date()) {}

    async issue(sourceInput: MemorySourceRef, taskDigest: string): Promise<string | null> {
        const source = memorySourceRefSchema.parse(sourceInput); assertMemoryContextKey(source.key);
        if (!digestSchema.safeParse(taskDigest).success) throw memoryError('MEMORY_FEEDBACK_INPUT_INVALID');
        if (probeOrdinaryMemoryFormat(this.ledger.path).kind !== 'context-v1') return null;
        const marker = await withLedger(this.ledger, false, db => validateMemoryContextFormat(db, memoryStoreIdentity(this.ledger.path, this.ledger.scope)));
        if (!await currentSource(this.resolveSource(source.scope), source)) return null;
        const issued = checkedTime(this.now);
        const payload = receiptSchema.parse({ schema_version: 1, project: projectId(this.ledger), ledger_uuid: marker.store_uuid,
            ledger_epoch: marker.restore_epoch, source, task_digest: taskDigest, issued, expires: issued + TTL });
        const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.secret, nonce);
        cipher.setAAD(Buffer.from('cairn-feedback-receipt-v1'));
        const token = Buffer.concat([nonce, cipher.update(JSON.stringify(payload), 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64url');
        return token.length <= 16384 ? token : null;
    }
    private decode(token: string, taskDigest: string) {
        try {
            if (token.length > 16384 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error();
            const data = Buffer.from(token, 'base64url');
            if (data.length < 29 || data.toString('base64url') !== token) throw new Error();
            const cipher = createDecipheriv('aes-256-gcm', this.secret, data.subarray(0, 12));
            cipher.setAAD(Buffer.from('cairn-feedback-receipt-v1')); cipher.setAuthTag(data.subarray(-16));
            const raw = Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]);
            const parsed = receiptSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
            const now = checkedTime(this.now);
            if (parsed.project !== projectId(this.ledger) || parsed.task_digest !== taskDigest
                || parsed.issued > now || parsed.expires <= now || parsed.expires - parsed.issued !== TTL) throw new Error();
            assertMemoryContextKey(parsed.source.key);
            return parsed;
        } catch { throw memoryError('MEMORY_FEEDBACK_RECEIPT_INVALID'); }
    }
    async record(value: unknown) {
        let input;
        try { input = memoryFeedbackInputSchema.parse(value); } catch { throw memoryError('MEMORY_FEEDBACK_INPUT_INVALID'); }
        const receipt = this.decode(input.receipt, input.task_digest);
        return withLedger(this.ledger, true, async db => {
            const marker = await validateMemoryContextFormat(db, memoryStoreIdentity(this.ledger.path, this.ledger.scope));
            if (receipt.ledger_uuid !== marker.store_uuid || receipt.ledger_epoch !== marker.restore_epoch) throw memoryError('MEMORY_FEEDBACK_SOURCE_STALE');
            if (!await currentSource(this.resolveSource(receipt.source.scope), receipt.source)) throw memoryError('MEMORY_FEEDBACK_SOURCE_STALE');
            // An admission wait or source snapshot can cross the receipt deadline.
            this.decode(input.receipt, input.task_digest);
            const sourceDigest = memoryFeedbackDigest(receipt.source);
            const id = memoryFeedbackDigest([receipt.project, marker.store_uuid, marker.restore_epoch, receipt.task_digest, sourceDigest]);
            const records = await rows(db), previous = records.find(row => row.id === id);
            if (previous) {
                if (previous.outcome !== input.outcome) throw memoryError('MEMORY_FEEDBACK_CONFLICT');
                return { schema_version: 1, id, recorded: false, evidence: 'self-reported-usefulness' };
            }
            if (records.length >= CAPACITY) throw memoryError('MEMORY_FEEDBACK_CAPACITY');
            const record = memoryFeedbackRecordSchema.parse({ schema_version: 1, id, task_digest: receipt.task_digest,
                source_digest: sourceDigest, ledger_uuid: marker.store_uuid, ledger_epoch: marker.restore_epoch,
                outcome: input.outcome, created_at: new Date(checkedTime(this.now)).toISOString() });
            if (!await tableExists(db)) await db.exec(CONTEXT_FEEDBACK_SQL);
            await db.prepare(`INSERT INTO ${CONTEXT_FEEDBACK_TABLE}(id,record_json) VALUES(?,?)`).run(id, JSON.stringify(record));
            return { schema_version: 1, id, recorded: true, evidence: 'self-reported-usefulness' };
        });
    }
    async eligible(sources: MemorySourceRef[]): Promise<Map<string, MemoryFeedbackRecord[]>> {
        const result = new Map<string, MemoryFeedbackRecord[]>();
        if (sources.length > 50) throw memoryError('MEMORY_FEEDBACK_INPUT_INVALID');
        if (probeOrdinaryMemoryFormat(this.ledger.path).kind !== 'context-v1') return result;
        return withLedger(this.ledger, false, async db => {
            const marker = await validateMemoryContextFormat(db, memoryStoreIdentity(this.ledger.path, this.ledger.scope));
            const now = checkedTime(this.now), records = await rows(db);
            for (const source of sources) {
                if (!await currentSource(this.resolveSource(source.scope), source)) continue;
                const digest = memoryFeedbackDigest(source);
                const active = records.filter(row => row.source_digest === digest && row.ledger_uuid === marker.store_uuid
                    && row.ledger_epoch === marker.restore_epoch && Date.parse(row.created_at) <= now && now - Date.parse(row.created_at) < RETENTION);
                if (active.length) result.set(digest, active);
            }
            return result;
        });
    }
}
