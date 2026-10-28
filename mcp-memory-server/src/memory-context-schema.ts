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

const live = (name: string) => `${name}.key != '__history__' AND substr(${name}.key,1,12) != '__history__/' AND ${name}.key != '__reviewed__' AND substr(${name}.key,1,13) != '__reviewed__/'`;
export const CONTEXT_TABLE_SQL = [
    `CREATE TABLE ${CONTEXT_STORE_TABLE}(id INTEGER PRIMARY KEY CHECK(id=1), format_version INTEGER NOT NULL CHECK(format_version=1), store_uuid TEXT NOT NULL, restore_epoch TEXT NOT NULL, owner_domain TEXT NOT NULL, scope TEXT NOT NULL)`,
    `CREATE TABLE ${CONTEXT_REVISION_TABLE}(key TEXT PRIMARY KEY, generation INTEGER NOT NULL CHECK(generation>0 AND generation<=${Number.MAX_SAFE_INTEGER}), present INTEGER NOT NULL CHECK(present IN(0,1)), context_revision INTEGER NOT NULL DEFAULT 0 CHECK(context_revision>=0 AND context_revision<=${Number.MAX_SAFE_INTEGER}))`,
];
export const CONTEXT_TRIGGER_SQL = [
    `CREATE TRIGGER cairn_memory_context_no_key_rename BEFORE UPDATE ON kv_store WHEN NEW.key != OLD.key BEGIN SELECT RAISE(ABORT,'MEMORY_KEY_RENAME'); END`,
    `CREATE TRIGGER cairn_memory_context_missing_revision BEFORE UPDATE ON kv_store WHEN ${live('OLD')} AND NOT EXISTS(SELECT 1 FROM ${CONTEXT_REVISION_TABLE} WHERE key=OLD.key) BEGIN SELECT RAISE(ABORT,'MEMORY_CONTEXT_DAMAGED'); END`,
    ...['INSERT', 'UPDATE', 'DELETE'].map(event => {
        const ref = event === 'DELETE' ? 'OLD' : 'NEW';
        return `CREATE TRIGGER cairn_memory_context_limit_${event.toLowerCase()} BEFORE ${event} ON kv_store WHEN ${live(ref)} AND (SELECT generation FROM ${CONTEXT_REVISION_TABLE} WHERE key=${ref}.key)>=${Number.MAX_SAFE_INTEGER} BEGIN SELECT RAISE(ABORT,'MEMORY_GENERATION_EXHAUSTED'); END`;
    }),
    ...['INSERT', 'UPDATE', 'DELETE'].map(event => {
        const ref = event === 'DELETE' ? 'OLD' : 'NEW', present = event === 'DELETE' ? 0 : 1;
        return `CREATE TRIGGER cairn_memory_context_revision_${event.toLowerCase()} AFTER ${event} ON kv_store WHEN ${live(ref)} BEGIN INSERT INTO ${CONTEXT_REVISION_TABLE}(key,generation,present,context_revision) VALUES(${ref}.key,1,${present},0) ON CONFLICT(key) DO UPDATE SET generation=generation+1,present=${present}; END`;
    }),
];
