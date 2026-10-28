/** Build a literal SQLite LIKE prefix. Every escape character and wildcard
 * occurrence must be quoted before the single trailing prefix wildcard. */
export function memoryKeyPrefixPattern(prefix: string): string {
    return `${prefix.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
}

export const MEMORY_KEY_PREFIX_SQL = "SELECT key,value FROM kv_store WHERE key LIKE ? ESCAPE '\\'";

type PrefixKv = { list(prefix: string): Promise<Array<{ key: string; value: unknown }>> };
type PrefixRow = { key: unknown; value: unknown };

/** Correct the literal-prefix contract at the SDK boundary as well as in
 * Cairnkeep's read-only view, including legacy stores opened through Cairnkeep. */
export function literalPrefixKv<T extends PrefixKv>(
    target: T,
    query: (pattern: string) => Promise<PrefixRow[]>,
): T {
    return new Proxy(target, { get(object, key) {
        if (key === 'list') return async (prefix: string) => {
            const rows = await query(memoryKeyPrefixPattern(prefix));
            return rows.map(row => ({ key: String(row.key), value: JSON.parse(String(row.value)) as unknown }));
        };
        const value = Reflect.get(object, key, object);
        return typeof value === 'function' ? value.bind(object) : value;
    } });
}
