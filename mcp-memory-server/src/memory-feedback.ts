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
export const memoryFeedbackSourceDigest = (value: MemorySourceRef): string => memoryFeedbackDigest(memorySourceRefSchema.parse(value));
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
async function currentSources(targets: Array<{ target: Target; source: MemorySourceRef }>): Promise<Set<string>> {
    const groups = new Map<string, typeof targets>(), current = new Set<string>();
    for (const item of targets) {
        const id = JSON.stringify([canonicalMemoryPath(item.target.path), item.target.scope]);
        const group = groups.get(id) ?? []; group.push(item); groups.set(id, group);
    }
    for (const group of groups.values()) {
        const { target } = group[0];
        if (probeOrdinaryMemoryFormat(target.path).kind !== 'context-v1') continue;
        const view = await openOrdinaryMemoryView(target.path, target.scope, 'context-v1');
        if (!view) continue;
        try {
            const db = dbOf(view.getDatabase());
            await db.transaction(async () => {
                for (const { source } of group) {
                    if (target.scope !== source.scope) continue;
                    const allowed = await db.prepare("SELECT 1 AS allowed FROM kv_store WHERE key=? AND typeof(value)='text' AND length(CAST(value AS BLOB))<=32768").get(source.key);
                    if (!allowed) continue;
                    const found = await readMemorySourceRef(db, memoryStoreIdentity(target.path, target.scope), source.key);
                    if (memoryFeedbackDigest(found) === memoryFeedbackDigest(source)) current.add(memoryFeedbackDigest(source));
                }
            })();
        } finally { await view.close(); }
    }
    return current;
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
        const source = memorySourceRefSchema.parse(sourceInput);
        return (await this.issueMany([source], taskDigest)).get(memoryFeedbackDigest(source)) ?? null;
    }
    async issueMany(input: MemorySourceRef[], taskDigest: string): Promise<Map<string, string>> {
        if (!Array.isArray(input) || input.length > 50) throw memoryError('MEMORY_FEEDBACK_INPUT_INVALID');
        const sources = input.map(value => memorySourceRefSchema.parse(value));
        for (const source of sources) assertMemoryContextKey(source.key);
        const result = new Map<string, string>();
        if (!digestSchema.safeParse(taskDigest).success) throw memoryError('MEMORY_FEEDBACK_INPUT_INVALID');
        if (!sources.length || probeOrdinaryMemoryFormat(this.ledger.path).kind !== 'context-v1') return result;
        const marker = await withLedger(this.ledger, false, db => validateMemoryContextFormat(db, memoryStoreIdentity(this.ledger.path, this.ledger.scope)));
        const current = await currentSources(sources.map(source => ({ target: this.resolveSource(source.scope), source })));
        const issued = checkedTime(this.now);
        for (const source of sources) {
            if (!current.has(memoryFeedbackDigest(source))) continue;
            const payload = receiptSchema.parse({ schema_version: 1, project: projectId(this.ledger), ledger_uuid: marker.store_uuid,
                ledger_epoch: marker.restore_epoch, source, task_digest: taskDigest, issued, expires: issued + TTL });
            const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.secret, nonce);
            cipher.setAAD(Buffer.from('cairn-feedback-receipt-v1'));
            const token = Buffer.concat([nonce, cipher.update(JSON.stringify(payload), 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64url');
            if (token.length <= 16384) result.set(memoryFeedbackDigest(source), token);
        }
        return result;
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
            const current = await currentSources([{ target: this.resolveSource(receipt.source.scope), source: receipt.source }]);
            if (!current.has(memoryFeedbackDigest(receipt.source))) throw memoryError('MEMORY_FEEDBACK_SOURCE_STALE');
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
            const checked = sources.map(source => memorySourceRefSchema.parse(source));
            const current = await currentSources(checked.map(source => ({ target: this.resolveSource(source.scope), source })));
            for (const source of checked) {
                const digest = memoryFeedbackDigest(source);
                if (!current.has(digest)) continue;
                const active = records.filter(row => row.source_digest === digest && row.ledger_uuid === marker.store_uuid
                    && row.ledger_epoch === marker.restore_epoch && Date.parse(row.created_at) <= now && now - Date.parse(row.created_at) < RETENTION);
                if (active.length) result.set(digest, active);
            }
            return result;
        });
    }
}

export const MEMORY_FEEDBACK_POLICY = Object.freeze({
    name: 'feedback-adjacent-v1', max_delta: 0.02, tier_width: 0.1, minimum_tasks: 3, max_displacement: 1,
});
type FeedbackRankEntry = { scope: string; key: string; score: number; source: MemorySourceRef | null };
const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** Policy over already admitted, response-bounded candidates, never an admission
 * scorer. Returned scores and source text remain unchanged. Provider ordering is
 * the baseline; zero feedback cannot undo it even when hybrid scores differ. */
export function rankMemoryWithFeedback<T extends FeedbackRankEntry>(entries: T[], eligible: Map<string, MemoryFeedbackRecord[]>,
    options: { query: string; aliases?: string[]; enabled?: boolean }) {
    if (options.enabled === false || entries.length < 2 || entries.length > 50 || !eligible.size
        || entries.some(row => Object.hasOwn(row, 'feedback'))) return entries;
    const exact = new Set([options.query, ...(options.aliases ?? [])].map(value => value.normalize('NFKC').toLowerCase().trim()));
    const weights = entries.map(entry => {
        if (!entry.source || entry.source.key !== entry.key || entry.source.scope !== entry.scope
            || !Number.isFinite(entry.score) || entry.score < 0 || entry.score > 1) return { count: 0, delta: 0 };
        const digest = memoryFeedbackSourceDigest(entry.source), votes = eligible.get(digest) ?? [];
        if (votes.length > CAPACITY) return { count: 0, delta: 0 };
        const tasks = new Map<string, string>(), conflicts = new Set<string>();
        for (const vote of votes) {
            if (vote.source_digest !== digest || !digestSchema.safeParse(vote.task_digest).success
                || !['useful', 'stale', 'wrong_context'].includes(vote.outcome) || conflicts.has(vote.task_digest)) continue;
            const previous = tasks.get(vote.task_digest);
            if (previous && previous !== vote.outcome) { tasks.delete(vote.task_digest); conflicts.add(vote.task_digest); }
            else tasks.set(vote.task_digest, vote.outcome);
        }
        if (tasks.size < MEMORY_FEEDBACK_POLICY.minimum_tasks) return { count: tasks.size, delta: 0 };
        const mean = [...tasks.values()].reduce((n, outcome) => n + (outcome === 'useful' ? 1 : -1), 0) / tasks.size;
        return { count: tasks.size, delta: round(Math.max(0, Math.min(1, entry.score + 0.02 * mean)) - entry.score) };
    });
    const result = [...entries]; let changed = false;
    for (let index = 0; index + 1 < entries.length; index++) {
        const left = entries[index], right = entries[index + 1], a = left.source, b = right.source;
        if (!a || !b || a.owner_domain !== b.owner_domain || a.store_uuid !== b.store_uuid
            || a.restore_epoch !== b.restore_epoch || left.scope !== right.scope
            || a.key !== left.key || b.key !== right.key || a.scope !== left.scope || b.scope !== right.scope
            || exact.has(left.key.normalize('NFKC').toLowerCase()) || exact.has(right.key.normalize('NFKC').toLowerCase())
            || !Number.isFinite(left.score) || !Number.isFinite(right.score)
            || Math.floor(left.score * 10) !== Math.floor(right.score * 10)) continue;
        if (round(weights[index + 1].delta - weights[index].delta) <= round(Math.abs(right.score - left.score))) continue;
        const explanation = (position: number, displacement: number) => ({ policy: MEMORY_FEEDBACK_POLICY.name,
            evidence: 'self-reported-usefulness', distinct_tasks: weights[position].count,
            delta: weights[position].delta, displacement });
        result[index] = { ...right, feedback: explanation(index + 1, -1) };
        result[index + 1] = { ...left, feedback: explanation(index, 1) };
        changed = true; index++; // Disjoint swaps: never ratchet a source through this result.
    }
    return changed ? result : entries;
}
