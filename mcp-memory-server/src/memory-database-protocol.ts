// Internal worker protocol. No SQL or worker options are accepted from MCP input.
export const MEMORY_DATABASE_LIMITS = Object.freeze({
    queueEntries: 128, queueBytes: 64 * 1024 * 1024,
    requestBytes: 8 * 1024 * 1024, replyBytes: 32 * 1024 * 1024,
    startupMs: 5_000, operationMs: 30_000, backupMs: 120_000,
    snapshotBytes: 512 * 1024 * 1024,
});
export type MemoryDatabaseLimits = { -readonly [K in keyof typeof MEMORY_DATABASE_LIMITS]: number };
export type MemoryBinding = null | string | number | bigint | Uint8Array;
export type MemoryRow = Record<string, unknown>;
export type MemoryOperation = 'exec' | 'get' | 'all' | 'run' | 'close' | 'backup';
export type MemoryRequest = {
    id: number; operation: MemoryOperation; sql?: string; params?: MemoryBinding[];
    path?: string; rate?: number;
};
export class MemoryDatabaseError extends Error {
    constructor(readonly code: string) { super(code); this.name = 'MemoryDatabaseError'; }
}
export const memoryError = (code: string): MemoryDatabaseError => new MemoryDatabaseError(code);

export function memoryDatabaseLimits(overrides: Partial<MemoryDatabaseLimits> = {}): MemoryDatabaseLimits {
    const result = { ...MEMORY_DATABASE_LIMITS } as MemoryDatabaseLimits;
    for (const [key, value] of Object.entries(overrides)) {
        if (!Object.hasOwn(result, key) || !Number.isSafeInteger(value) || value < 1 || value > result[key as keyof MemoryDatabaseLimits]) {
            throw memoryError('MEMORY_INVALID_LIMIT');
        }
        result[key as keyof MemoryDatabaseLimits] = value;
    }
    return result;
}

/** Count incrementally; never stringify an unbounded request/result to size it. */
export function memoryWireBytes(value: unknown, maximum: number, code: string): number {
    let bytes = 0, items = 0;
    const seen = new WeakSet<object>();
    function add(n: number): void { bytes += n; if (bytes > maximum) throw memoryError(code); }
    function visit(item: unknown, depth: number): void {
        if (++items > 100_000 || depth > 16) throw memoryError(code);
        if (item === null || item === undefined || typeof item === 'boolean') { add(8); return; }
        if (typeof item === 'number') { if (!Number.isFinite(item)) throw memoryError(code); add(16); return; }
        if (typeof item === 'bigint') { add(16); return; }
        if (typeof item === 'string') {
            if (item.length > maximum - bytes) throw memoryError(code);
            add(Buffer.byteLength(item, 'utf8') + 8); return;
        }
        if (item instanceof Uint8Array) { add(item.byteLength + 16); return; }
        if (typeof item !== 'object' || seen.has(item)) throw memoryError(code);
        seen.add(item);
        if (Array.isArray(item)) {
            if (item.length > 100_000) throw memoryError(code);
            add(16);
            for (const part of item) visit(part, depth + 1);
        } else {
            const prototype = Object.getPrototypeOf(item);
            if (prototype !== null && prototype !== Object.prototype) throw memoryError(code);
            const descriptors = Object.getOwnPropertyDescriptors(item);
            for (const [key, descriptor] of Object.entries(descriptors)) {
                if (!('value' in descriptor)) throw memoryError(code);
                visit(key, depth + 1); visit(descriptor.value, depth + 1);
            }
        }
        seen.delete(item);
    }
    visit(value, 0); return bytes;
}

export function validateMemoryRequest(input: unknown, limits: MemoryDatabaseLimits): asserts input is MemoryRequest {
    memoryWireBytes(input, limits.requestBytes, 'MEMORY_REQUEST_LIMIT');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw memoryError('MEMORY_INVALID_REQUEST');
    const request = input as MemoryRequest;
    const allowed = ['id', 'operation', 'sql', 'params', 'path', 'rate'];
    if (Object.keys(input).some(key => !allowed.includes(key)) || !Number.isSafeInteger(request.id) || request.id < 1
        || !['exec', 'get', 'all', 'run', 'close', 'backup'].includes(request.operation)) throw memoryError('MEMORY_INVALID_REQUEST');
    if (['exec', 'get', 'all', 'run'].includes(request.operation)
        && (typeof request.sql !== 'string' || !request.sql.trim())) throw memoryError('MEMORY_INVALID_REQUEST');
    if (['get', 'all', 'run'].includes(request.operation)) {
        if (!Array.isArray(request.params) || request.params.length > 32_766) throw memoryError('MEMORY_INVALID_BINDING');
        for (const value of request.params) {
            if (value !== null && typeof value !== 'string' && typeof value !== 'bigint'
                && !(typeof value === 'number' && Number.isFinite(value)) && !(value instanceof Uint8Array)) {
                throw memoryError('MEMORY_INVALID_BINDING');
            }
        }
    }
    if (request.operation === 'backup' && (typeof request.path !== 'string' || !Number.isSafeInteger(request.rate)
        || request.rate! < 1 || request.rate! > 1000)) throw memoryError('MEMORY_INVALID_REQUEST');
}

export function normalizeMemoryValue(value: unknown): unknown {
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (Array.isArray(value)) return value.map(normalizeMemoryValue);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeMemoryValue(item)]));
    return value;
}
