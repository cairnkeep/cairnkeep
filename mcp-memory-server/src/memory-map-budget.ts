import { memoryError } from './memory-database-protocol.js';

export type MemoryMapBudget = { rows: number; bytes: number };
type Kind = 'ordinary' | 'freshness' | 'entities';
const columns = {
    ordinary: { fields: [['key', 4096], ['value', 32768]], extra: ['generation', 'present', 'context_revision'] },
    freshness: { fields: [['key', 4096], ['assertion_json', 65536]], extra: [] },
    entities: { fields: [['id', 36], ['assertion_json', 65536]], extra: ['revision', 'present'] },
} as const;

/** Trusted SQL only. Limit rows in SQLite and suppress an entire payload before
 * it crosses the worker boundary if its cumulative UTF-8 bytes cannot fit.
 * The window orders the bounded page, not the entire authoritative store. */
export function memoryMapPage(kind: Kind, query: string, parameters: Array<string | number>, offset: number, budget: MemoryMapBudget) {
    if (!Number.isSafeInteger(budget.rows) || budget.rows <= 0 || !Number.isSafeInteger(budget.bytes) || budget.bytes <= 0) throw memoryError('MEMORY_MAP_SCAN_LIMIT');
    const { fields, extra } = columns[kind], limit = Math.min(32, budget.rows);
    const projected = fields.map(([name, maximum], index) => `CASE WHEN length(CAST(${name} AS BLOB))<=${maximum} THEN ${name} END AS __map_data${index}`);
    const size = fields.map((_, index) => `COALESCE(length(CAST(__map_data${index} AS BLOB)),0)`).join('+');
    const output = fields.map(([name], index) => `CASE WHEN __map_bytes<=? THEN __map_data${index} END AS ${name}`);
    return { limit, sql: `/* memory-map:${kind} */ WITH candidates AS (${query} ORDER BY ${fields[0][0]} LIMIT ? OFFSET ?),
        projected AS (SELECT ${projected.join(',')}${extra.length ? ',' + extra.join(',') : ''},row_number() OVER (ORDER BY ${fields[0][0]}) AS __map_order FROM candidates),
        sized AS (SELECT *,sum(${size}) OVER (ORDER BY __map_order ROWS UNBOUNDED PRECEDING) AS __map_bytes FROM projected)
        SELECT ${output.join(',')}${extra.length ? ',' + extra.join(',') : ''},__map_bytes>? AS __map_limited FROM sized ORDER BY __map_order`,
        args: [...parameters, limit, offset, ...fields.map(() => budget.bytes), budget.bytes] };
}

/** Charge actual materialization, including null sentinel rows; never hide an
 * overread by clipping a counter. Only the SQL projection may omit payloads. */
export function chargeMemoryMapPage(kind: Kind, rows: Array<Record<string, unknown>>, budget: MemoryMapBudget) {
    let bytes = 0;
    for (const row of rows) for (const [name] of columns[kind].fields) {
        const value = row[name];
        if (typeof value === 'string') bytes += Buffer.byteLength(value);
        else if (ArrayBuffer.isView(value)) bytes += value.byteLength;
    }
    if (rows.length > budget.rows || bytes > budget.bytes) throw memoryError('MEMORY_MAP_SCAN_LIMIT');
    budget.rows -= rows.length; budget.bytes -= bytes;
    return rows.some(row => row.__map_limited === 1);
}
