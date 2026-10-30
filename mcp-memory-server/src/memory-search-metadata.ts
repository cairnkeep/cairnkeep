import { nodeMetadataSchema, type NodeMetadata } from './node-schema.js';
import { memoryError } from './memory-database-protocol.js';

type Reader = { prepare(sql: string): { get(...values: string[]): Promise<unknown> } };

/** Read current typed fields in the caller's admitted snapshot. Bound raw bytes
 * before worker transfer, and never initialize a missing metadata table. */
export async function readMemorySearchMetadata(db: Reader, key: string): Promise<NodeMetadata> {
    const table = await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cairn_node_metadata_v1'").get();
    if (!table) return { schema_version: 1, node_type: 'memory', tags: [] };
    const row = await db.prepare(`SELECT schema_version,
        CASE WHEN typeof(node_type)='text' AND length(CAST(node_type AS BLOB))<=128 THEN CAST(node_type AS BLOB) END AS node_type,
        CASE WHEN typeof(tags_json)='text' AND length(CAST(tags_json AS BLOB))<=32768 THEN CAST(tags_json AS BLOB) END AS tags_json
        FROM cairn_node_metadata_v1 WHERE key=?`).get(key) as Record<string, unknown> | undefined;
    if (!row) return { schema_version: 1, node_type: 'memory', tags: [] };
    try {
        const text = (value: unknown) => {
            if (!ArrayBuffer.isView(value)) throw new Error();
            return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
                .decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
        };
        return nodeMetadataSchema.parse({ schema_version: row.schema_version, node_type: text(row.node_type), tags: JSON.parse(text(row.tags_json)) });
    } catch { throw memoryError('MEMORY_CONTEXT_DAMAGED'); }
}
