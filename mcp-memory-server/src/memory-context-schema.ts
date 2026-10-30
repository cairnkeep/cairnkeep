import { z } from 'zod';

export const CONTEXT_APPLICATION_ID = 0x434B4331;
export const CONTEXT_STORE_TABLE = 'cairn_memory_context_store_v1';
export const CONTEXT_REVISION_TABLE = 'cairn_memory_context_revisions_v1';
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const contextStoreIdentitySchema = z.object({
    owner_domain: digest, scope: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(128),
}).strict();
export type ContextStoreIdentity = z.infer<typeof contextStoreIdentitySchema>;
export const contextStoreMarkerSchema = contextStoreIdentitySchema.extend({
    id: z.literal(1), format_version: z.literal(1), store_uuid: z.uuid(), restore_epoch: z.uuid(),
}).strict();
export const memorySourceRefSchema = contextStoreIdentitySchema.extend({
    schema_version: z.literal(1), store_uuid: z.uuid(), restore_epoch: z.uuid(),
    key: z.string().min(1).max(4096), generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    content_digest: digest, context_revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type MemorySourceRef = z.infer<typeof memorySourceRefSchema>;

export const memoryFeedbackOutcomeSchema = z.enum(['useful', 'stale', 'wrong_context']);
export const memoryFeedbackInputSchema = z.object({
    receipt: z.string().min(1).max(16384), task_digest: digest, outcome: memoryFeedbackOutcomeSchema,
}).strict();
export const memoryFeedbackRecordSchema = z.object({
    schema_version: z.literal(1), id: digest, task_digest: digest, source_digest: digest,
    ledger_uuid: z.uuid(), ledger_epoch: z.uuid(), outcome: memoryFeedbackOutcomeSchema,
    created_at: z.iso.datetime({ precision: 3 }),
}).strict();
export type MemoryFeedbackRecord = z.infer<typeof memoryFeedbackRecordSchema>;
export const CONTEXT_FEEDBACK_TABLE = 'cairn_memory_feedback_v1';
export const CONTEXT_FEEDBACK_SQL = `CREATE TABLE ${CONTEXT_FEEDBACK_TABLE}(id TEXT PRIMARY KEY CHECK(typeof(id)='text' AND length(id)=64 AND id NOT GLOB '*[^0-9a-f]*'),record_json TEXT NOT NULL CHECK(typeof(record_json)='text' AND length(CAST(record_json AS BLOB))<=2048))`;

const connectionText = (bytes: number) => z.string().min(1).max(bytes).refine(value => Buffer.byteLength(value) <= bytes);
const connectionKey = connectionText(4096).refine(value => value !== '__history__' && !value.startsWith('__history__/')
    && value !== '__reviewed__' && !value.startsWith('__reviewed__/'));
const distinct = (values: string[]) => new Set(values).size === values.length;
export const memoryEntityInputSchema = z.object({
    schema_version: z.literal(1), id: z.uuid(), title: connectionText(512),
    aliases: z.array(connectionText(512)).max(16).refine(distinct), anchor_key: connectionKey,
    claims: z.array(z.object({ key: connectionKey, attribute: connectionText(128), value: connectionText(512) }).strict()).max(16),
}).strict();
export const memoryLinkInputSchema = z.object({
    schema_version: z.literal(1), id: z.uuid(), from: z.uuid(), to: z.uuid(), predicate: connectionText(128),
    evidence_keys: z.array(connectionKey).min(1).max(8).refine(distinct),
}).strict();
export const memoryConnectionRemoveSchema = z.object({ schema_version: z.literal(1), id: z.uuid() }).strict();
const connectionRevision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const memoryClaimSchema = z.object({ attribute: connectionText(128), value: connectionText(512), source: memorySourceRefSchema }).strict();
export const memoryEntitySchema = z.object({
    schema_version: z.literal(1), id: z.uuid(), revision: connectionRevision,
    title: connectionText(512), aliases: z.array(connectionText(512)).max(16).refine(distinct),
    anchor: memorySourceRefSchema, claims: z.array(memoryClaimSchema).max(16), captured_at: z.iso.datetime({ precision: 3 }),
}).strict();
export const memoryLinkSchema = z.object({
    schema_version: z.literal(1), id: z.uuid(), revision: connectionRevision,
    from: z.object({ id: z.uuid(), digest }).strict(), to: z.object({ id: z.uuid(), digest }).strict(),
    predicate: connectionText(128), evidence: z.array(memorySourceRefSchema).min(1).max(8), captured_at: z.iso.datetime({ precision: 3 }),
}).strict();
export type MemoryEntity = z.infer<typeof memoryEntitySchema>;
export type MemoryLink = z.infer<typeof memoryLinkSchema>;
export type MemoryClaim = z.infer<typeof memoryClaimSchema>;
export const CONTEXT_ENTITY_TABLE = 'cairn_memory_context_entities_v1';
export const CONTEXT_LINK_TABLE = 'cairn_memory_context_links_v1';
export const CONTEXT_CONNECTION_SQL = [CONTEXT_ENTITY_TABLE, CONTEXT_LINK_TABLE].map(name =>
    `CREATE TABLE ${name}(id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>0 AND revision<=${Number.MAX_SAFE_INTEGER}), present INTEGER NOT NULL CHECK(present IN(0,1)), assertion_json TEXT CHECK((present=0 AND assertion_json IS NULL) OR (present=1 AND assertion_json IS NOT NULL AND length(CAST(assertion_json AS BLOB))<=65536)))`);

export const CONTEXT_FACT_TABLE = 'cairn_memory_context_facts_v1';
export const CONTEXT_FACT_SQL = `CREATE TABLE ${CONTEXT_FACT_TABLE}(key TEXT PRIMARY KEY, assertion_json TEXT NOT NULL CHECK(length(CAST(assertion_json AS BLOB))<=65536))`;
const utcDate = z.iso.datetime({ precision: 3 });
export const memoryFreshnessMetadataSchema = z.object({
    schema_version: z.literal(1),
    source_refs: z.array(z.string().min(1).max(512).refine(value => Buffer.byteLength(value) <= 512)).max(8),
    effective_at: z.iso.datetime().max(32).optional(),
    verified_at: z.iso.datetime().max(32).optional(),
    review_after: z.iso.datetime().max(32).optional(),
}).strict();
export type MemoryFreshnessMetadata = z.infer<typeof memoryFreshnessMetadataSchema>;
export const memoryFreshnessAssertionSchema = z.object({
    schema_version: z.literal(1), source: memorySourceRefSchema,
    metadata: memoryFreshnessMetadataSchema, captured_at: utcDate,
}).strict();

const live = (name: string) => `${name}.key != '__history__' AND substr(${name}.key,1,12) != '__history__/' AND ${name}.key != '__reviewed__' AND substr(${name}.key,1,13) != '__reviewed__/'`;
export const CONTEXT_TABLE_SQL = [
    `CREATE TABLE ${CONTEXT_STORE_TABLE}(id INTEGER PRIMARY KEY CHECK(id=1), format_version INTEGER NOT NULL CHECK(format_version=1), store_uuid TEXT NOT NULL, restore_epoch TEXT NOT NULL, owner_domain TEXT NOT NULL, scope TEXT NOT NULL)`,
    `CREATE TABLE ${CONTEXT_REVISION_TABLE}(key TEXT PRIMARY KEY, generation INTEGER NOT NULL CHECK(generation>0 AND generation<=${Number.MAX_SAFE_INTEGER}), present INTEGER NOT NULL CHECK(present IN(0,1)), context_revision INTEGER NOT NULL DEFAULT 0 CHECK(context_revision>=0 AND context_revision<=${Number.MAX_SAFE_INTEGER}))`,
];
export const CONTEXT_TRIGGER_SQL = [
    `CREATE TRIGGER cairn_memory_context_no_key_rename BEFORE UPDATE ON kv_store WHEN NEW.key != OLD.key BEGIN SELECT RAISE(ABORT,'MEMORY_KEY_RENAME'); END`,
    `CREATE TRIGGER cairn_memory_context_missing_revision BEFORE UPDATE ON kv_store WHEN ${live('OLD')} AND NOT EXISTS(SELECT 1 FROM ${CONTEXT_REVISION_TABLE} WHERE key=OLD.key) BEGIN SELECT RAISE(ABORT,'MEMORY_CONTEXT_DAMAGED'); END`,
    ...['INSERT', 'DELETE'].map(event => {
        const ref = event === 'DELETE' ? 'OLD' : 'NEW';
        const existing = event === 'INSERT' ? ` AND EXISTS(SELECT 1 FROM kv_store WHERE key=NEW.key)` : '';
        return `CREATE TRIGGER cairn_memory_context_missing_revision_${event.toLowerCase()} BEFORE ${event} ON kv_store WHEN ${live(ref)}${existing} AND NOT EXISTS(SELECT 1 FROM ${CONTEXT_REVISION_TABLE} WHERE key=${ref}.key) BEGIN SELECT RAISE(ABORT,'MEMORY_CONTEXT_DAMAGED'); END`;
    }),
    ...['INSERT', 'UPDATE', 'DELETE'].map(event => {
        const ref = event === 'DELETE' ? 'OLD' : 'NEW';
        return `CREATE TRIGGER cairn_memory_context_limit_${event.toLowerCase()} BEFORE ${event} ON kv_store WHEN ${live(ref)} AND (SELECT generation FROM ${CONTEXT_REVISION_TABLE} WHERE key=${ref}.key)>=${Number.MAX_SAFE_INTEGER} BEGIN SELECT RAISE(ABORT,'MEMORY_GENERATION_EXHAUSTED'); END`;
    }),
    ...['INSERT', 'UPDATE', 'DELETE'].map(event => {
        const ref = event === 'DELETE' ? 'OLD' : 'NEW', present = event === 'DELETE' ? 0 : 1;
        return `CREATE TRIGGER cairn_memory_context_revision_${event.toLowerCase()} AFTER ${event} ON kv_store WHEN ${live(ref)} BEGIN INSERT INTO ${CONTEXT_REVISION_TABLE}(key,generation,present,context_revision) VALUES(${ref}.key,1,${present},0) ON CONFLICT(key) DO UPDATE SET generation=generation+1,present=${present}; END`;
    }),
];
