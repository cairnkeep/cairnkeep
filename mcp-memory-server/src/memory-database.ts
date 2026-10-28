import { AsyncLocalStorage } from 'node:async_hooks';
import { isBuiltin } from 'node:module';
import { Worker, type WorkerOptions } from 'node:worker_threads';
import { AgentFS } from 'agentfs-sdk';
import {
    memoryDatabaseLimits, memoryError, memoryWireBytes, normalizeMemoryValue, validateMemoryRequest,
    type MemoryBinding, type MemoryDatabaseLimits, type MemoryOperation, type MemoryRow,
} from './memory-database-protocol.js';
import { createMemoryDatabaseFile, inspectMemoryDatabaseFile, retainMemoryDatabaseFile } from './memory-store-format.js';

export type MemoryDatabaseOptions = {
    create?: boolean; readOnly?: boolean; busyTimeoutMs?: number;
    limits?: Partial<MemoryDatabaseLimits>;
    // Internal dependency seam for real worker-death/protocol tests, never client configuration.
    workerFactory?: (url: URL, options: WorkerOptions) => Worker;
};
type Owner = { active: boolean };
type Pending = { operation: MemoryOperation; resolve: (value: unknown) => void; reject: (error: Error) => void; bytes: number; settled: Promise<void> };

export interface OrdinaryMemoryReader {
    readonly kv: {
        get(key: string): Promise<unknown>;
        list(prefix: string): Promise<Array<{ key: string; value: unknown }>>;
    };
    getDatabase(): {
        prepare(sql: string): {
            get(...params: MemoryBinding[]): Promise<unknown>;
            all(...params: MemoryBinding[]): Promise<unknown[]>;
        };
    };
    close(): Promise<void>;
}
export interface OrdinaryMemoryStore extends OrdinaryMemoryReader {
    readonly kv: OrdinaryMemoryReader['kv'] & {
        set(key: string, value: unknown): Promise<void>; delete(key: string): Promise<void>;
    };
    getDatabase(): {
        prepare(sql: string): ReturnType<ReturnType<OrdinaryMemoryReader['getDatabase']>['prepare']> & {
            run(...params: MemoryBinding[]): Promise<unknown>;
        };
        exec(sql: string): Promise<void>;
        transaction<T>(operation: () => Promise<T>): () => Promise<T>;
    };
}

export function assertContextRuntime(version = process.versions.node, sqliteVersion = process.versions.sqlite): void {
    const [major, minor] = version.split('.').map(Number);
    if (!isBuiltin('node:sqlite') || !Number.isInteger(major) || !Number.isInteger(minor) || major < 22 || (major === 22 && minor < 16)) {
        throw memoryError('MEMORY_RUNTIME_UNSUPPORTED');
    }
    const sqlite = typeof sqliteVersion === 'string' ? /^(\d{1,3})\.(\d{1,3})\.(\d{1,6})$/.exec(sqliteVersion) : null;
    const [sqlMajor, sqlMinor, sqlPatch] = sqlite ? sqlite.slice(1).map(Number) : [];
    // WAL-reset fix: 3.51.3+, with the two documented maintenance backports.
    if (!sqlite || !(sqlMajor > 3 || (sqlMajor === 3 && (sqlMinor > 51 || (sqlMinor === 51 && sqlPatch >= 3)
        || (sqlMinor === 50 && sqlPatch >= 7) || (sqlMinor === 44 && sqlPatch >= 6))))) throw memoryError('MEMORY_SQLITE_UNPATCHED');
}

function controlsTransaction(sql: string): boolean {
    // Scan once: repeated adjacent comments must not cause regex backtracking.
    // Quoted semicolons are data, not new statement boundaries.
    let prefix = true, offset = 0;
    while (offset < sql.length) {
        const char = sql[offset];
        if (/\s/.test(char)) { offset++; continue; }
        if (sql.startsWith('--', offset)) {
            const end = sql.indexOf('\n', offset + 2);
            if (end < 0) return false;
            offset = end + 1; continue;
        }
        if (sql.startsWith('/*', offset)) {
            const end = sql.indexOf('*/', offset + 2);
            if (end < 0) return false;
            offset = end + 2; continue;
        }
        if (char === ';') { prefix = true; offset++; continue; }
        if (char === "'" || char === '"' || char === '`' || char === '[') {
            const quote = char === '[' ? ']' : char;
            prefix = false; offset++;
            while (offset < sql.length) {
                if (sql[offset++] !== quote) continue;
                if (char !== '[' && sql[offset] === quote) { offset++; continue; }
                break;
            }
            continue;
        }
        if (prefix && /[A-Za-z_]/.test(char)) {
            const start = offset++;
            while (offset < sql.length && /[A-Za-z0-9_$]/.test(sql[offset])) offset++;
            if (offset - start <= 9 && ['BEGIN', 'COMMIT', 'END', 'ROLLBACK', 'SAVEPOINT', 'RELEASE'].includes(sql.slice(start, offset).toUpperCase())) return true;
        } else offset++;
        prefix = false;
    }
    return false;
}

export class MemoryDatabase {
    readonly memory = false;
    readonly limits: MemoryDatabaseLimits;
    readonly name: string;
    readonly readonly: boolean;
    readonly created: boolean;
    #thread!: Worker;
    #owner = new AsyncLocalStorage<Owner>();
    #tail: Promise<void> = Promise.resolve();
    #pending = new Map<number, Pending>();
    #sequence = 0; #pendingBytes = 0; #queuedBytes = 0; #queued = 0;
    #closed = false; #unusable = false; #transaction = false;
    #committing = false;
    #rawTransaction = false;
    #failActive?: (code: string) => void;
    #termination?: Promise<number>; #closing?: Promise<void>;

    private constructor(path: string, options: MemoryDatabaseOptions) {
        this.name = path; this.readonly = options.readOnly ?? false;
        this.created = options.create ?? false;
        this.limits = memoryDatabaseLimits(options.limits);
    }
    static async open(path: string, options: MemoryDatabaseOptions = {}): Promise<MemoryDatabase> {
        assertContextRuntime();
        if (options.create && options.readOnly) throw memoryError('MEMORY_INVALID_OPTIONS');
        const busyTimeoutMs = options.busyTimeoutMs ?? 500;
        if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 5000) throw memoryError('MEMORY_INVALID_TIMEOUT');
        const db = new MemoryDatabase(path, options);
        if (options.create) createMemoryDatabaseFile(path);
        const file = retainMemoryDatabaseFile(path), identity = file.stat;
        const factory = options.workerFactory ?? ((url, configuration) => new Worker(url, configuration));
        try {
            db.#thread = factory(new URL('./memory-sqlite-worker.js', import.meta.url), {
                workerData: { path, readOnly: db.readonly, busyTimeoutMs, limits: db.limits, identity: { dev: identity.dev, ino: identity.ino } },
                execArgv: process.execArgv.filter(arg => !arg.startsWith('--input-type')),
                resourceLimits: { maxOldGenerationSizeMb: 128 },
            });
            db.#thread.once('exit', file.release);
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => { reject(memoryError('MEMORY_STARTUP_TIMEOUT')); db.poison(); }, db.limits.startupMs);
                const finish = (error?: Error) => { clearTimeout(timeout); error ? reject(error) : resolve(); };
                db.#thread.once('error', () => finish(memoryError('MEMORY_WORKER_STARTUP_FAILED')));
                db.#thread.once('exit', () => { if (!db.#closed) { finish(memoryError('MEMORY_WORKER_EXIT')); db.poison(); } });
                let ready = false;
                db.#thread.on('message', (message: unknown) => {
                    if (!ready) {
                        if (!message || typeof message !== 'object' || Object.keys(message).length !== 1 || !('ready' in message) || message.ready !== true) {
                            finish(memoryError('MEMORY_WORKER_PROTOCOL')); db.poison(); return;
                        }
                        ready = true; finish(); return;
                    }
                    db.receive(message);
                });
            });
            const after = inspectMemoryDatabaseFile(path, true);
            if (after.dev !== identity.dev || after.ino !== identity.ino) throw memoryError('MEMORY_FILE_CHANGED');
            return db;
        } catch (error) {
            if (db.#thread) { db.poison(); await db.#termination; }
            else file.release();
            throw error;
        }
    }
    get open(): boolean { return !this.#closed && !this.#unusable; }
    get inTransaction(): boolean { return this.#transaction; }
    get inOwnedTransaction(): boolean { return this.#transaction && Boolean(this.#owner.getStore()?.active); }
    async connect(): Promise<void> { if (!this.open) throw memoryError('MEMORY_DATABASE_UNUSABLE'); }

    private receive(message: unknown): void {
        try {
            memoryWireBytes(message, this.limits.replyBytes, 'MEMORY_WORKER_PROTOCOL');
            if (!message || typeof message !== 'object' || Array.isArray(message)) throw memoryError('MEMORY_WORKER_PROTOCOL');
            const result = message as { id: number; value?: unknown; error?: string; transaction: boolean };
            if (Object.keys(result).some(key => !['id', 'value', 'error', 'transaction'].includes(key)) || !Number.isSafeInteger(result.id)
                || typeof result.transaction !== 'boolean'
                || Object.hasOwn(result, 'value') === Object.hasOwn(result, 'error')
                || (result.error !== undefined && !/^MEMORY_[A-Z_]{1,64}$/.test(result.error))) throw memoryError('MEMORY_WORKER_PROTOCOL');
            const item = this.#pending.get(result.id);
            if (!item) throw memoryError('MEMORY_WORKER_PROTOCOL');
            if (item.operation === 'close' && !result.error) {
                if (result.value !== null || result.transaction) throw memoryError('MEMORY_WORKER_PROTOCOL');
                // Exit may be delivered before the awaiting close continuation.
                // Record the validated ACK synchronously, not in a later microtask.
                this.#closed = true;
            }
            this.#pending.delete(result.id); this.#pendingBytes -= item.bytes;
            this.#rawTransaction = result.transaction;
            if (result.error) item.reject(memoryError(result.error));
            else item.resolve(normalizeMemoryValue(result.value));
        } catch { this.poison('MEMORY_WORKER_PROTOCOL'); }
    }
    private poison(code = 'MEMORY_DATABASE_UNUSABLE'): void {
        this.#unusable = true;
        for (const item of this.#pending.values()) item.reject(memoryError(code));
        this.#pending.clear(); this.#pendingBytes = 0;
        this.#failActive?.(code);
        this.#termination ??= this.#thread.terminate();
    }
    interrupt(): void { this.poison('MEMORY_WORKER_EXIT'); }

    exclusive<T>(operation: () => Promise<T>, bytes = 0, timeoutMs = this.limits.operationMs): Promise<T> {
        if (!this.open) return Promise.reject(memoryError('MEMORY_DATABASE_UNUSABLE'));
        const owner = this.#owner.getStore();
        if (owner) {
            return Promise.resolve().then(() => {
                if (!owner.active) throw memoryError('MEMORY_STALE_OWNER');
                if (!this.open) throw memoryError('MEMORY_DATABASE_UNUSABLE');
                return operation();
            });
        }
        if (this.#queued >= this.limits.queueEntries || this.#queuedBytes + bytes > this.limits.queueBytes) {
            return Promise.reject(memoryError('MEMORY_QUEUE_LIMIT'));
        }
        this.#queued++; this.#queuedBytes += bytes;
        const result = this.#tail.then(async () => {
            if (!this.open) throw memoryError('MEMORY_DATABASE_UNUSABLE');
            const token: Owner = { active: true }; let timer: NodeJS.Timeout | undefined;
            try {
                const failed = new Promise<never>((_, reject) => {
                    this.#failActive = code => {
                        token.active = false;
                        reject(memoryError(this.#committing ? 'MEMORY_COMMIT_UNCERTAIN' : code));
                    };
                });
                return await Promise.race([
                    this.#owner.run(token, async () => {
                        try { return await operation(); }
                        finally {
                            // Seal before draining: descendants cannot start new work
                            // after the owned operation has returned. Already posted
                            // statements must settle before another owner can enter.
                            token.active = false;
                            while (this.#pending.size) await Promise.all([...this.#pending.values()].map(item => item.settled));
                            if (this.open && this.#rawTransaction) {
                                this.poison('MEMORY_UNCLOSED_TRANSACTION'); throw memoryError('MEMORY_UNCLOSED_TRANSACTION');
                            }
                        }
                    }),
                    failed,
                    new Promise<never>((_, reject) => {
                        timer = setTimeout(() => {
                            token.active = false;
                            reject(memoryError(this.#committing ? 'MEMORY_COMMIT_UNCERTAIN' : 'MEMORY_OPERATION_TIMEOUT'));
                            this.poison();
                        }, timeoutMs);
                    }),
                ]);
            } finally { if (timer) clearTimeout(timer); this.#failActive = undefined; token.active = false; }
        });
        this.#tail = result.then(() => {}, () => {});
        return result.finally(() => { this.#queued--; this.#queuedBytes -= bytes; });
    }

    private request(operation: MemoryOperation, options: { sql?: string; params?: MemoryBinding[]; path?: string; rate?: number } = {}): Promise<unknown> {
        if (!this.open) return Promise.reject(memoryError('MEMORY_DATABASE_UNUSABLE'));
        const request = { id: ++this.#sequence, operation, ...options };
        validateMemoryRequest(request, this.limits);
        const bytes = memoryWireBytes(request, this.limits.requestBytes, 'MEMORY_REQUEST_LIMIT');
        if (this.#pending.size >= this.limits.queueEntries || this.#pendingBytes + bytes > this.limits.queueBytes) throw memoryError('MEMORY_QUEUE_LIMIT');
        return new Promise((resolve, reject) => {
            let finish!: () => void;
            const settled = new Promise<void>(done => { finish = done; });
            this.#pendingBytes += bytes; this.#pending.set(request.id, {
                operation,
                resolve: value => { finish(); resolve(value); }, reject: error => { finish(); reject(error); }, bytes, settled,
            });
            try { this.#thread.postMessage(request); }
            catch { this.poison('MEMORY_WORKER_PROTOCOL'); }
        });
    }
    exec(sql: string): Promise<void> {
        let bytes: number;
        try {
            validateMemoryRequest({ id: 1, operation: 'exec', sql }, this.limits);
            bytes = memoryWireBytes(sql, this.limits.requestBytes, 'MEMORY_REQUEST_LIMIT');
        }
        catch (error) { return Promise.reject(error); }
        if (controlsTransaction(sql) && !this.#owner.getStore()) return Promise.reject(memoryError('MEMORY_UNOWNED_TRANSACTION'));
        return this.exclusive(async () => {
            const committing = /^\s*COMMIT\b/i.test(sql);
            if (committing) this.#committing = true;
            try { await this.request('exec', { sql }); }
            catch (error) {
                if (committing) { this.poison(); throw memoryError('MEMORY_COMMIT_UNCERTAIN'); }
                throw error;
            } finally { if (committing) this.#committing = false; }
        }, bytes);
    }
    prepare(sql: string) {
        if (typeof sql !== 'string' || !sql.trim()) throw memoryError('MEMORY_INVALID_SQL');
        const call = (operation: 'get' | 'all' | 'run', params: MemoryBinding[]): Promise<unknown> => {
            try {
                const request = { id: 1, operation, sql, params }; validateMemoryRequest(request, this.limits);
                const bytes = memoryWireBytes(request, this.limits.requestBytes, 'MEMORY_REQUEST_LIMIT');
                if (controlsTransaction(sql) && !this.#owner.getStore()) return Promise.reject(memoryError('MEMORY_UNOWNED_TRANSACTION'));
                return this.exclusive(() => this.request(operation, { sql, params }), bytes);
            } catch (error) { return Promise.reject(error); }
        };
        return {
            get: (...params: MemoryBinding[]) => call('get', params) as Promise<MemoryRow | undefined>,
            all: (...params: MemoryBinding[]) => call('all', params) as Promise<MemoryRow[]>,
            run: (...params: MemoryBinding[]) => call('run', params) as Promise<{ changes: number; lastInsertRowid: number }>,
            close: () => {},
        };
    }
    transaction<T, Args extends unknown[]>(operation: (...args: Args) => Promise<T>) {
        const wrap = (mode: string) => (...args: Args): Promise<T> => this.exclusive(async () => {
            if (this.#transaction) throw memoryError('MEMORY_NESTED_TRANSACTION');
            await this.request('exec', { sql: `BEGIN ${mode}` }); this.#transaction = true;
            try {
                // The outer owner must remain active for COMMIT/ROLLBACK, while
                // the callback gets a shorter-lived token. Seal that token as
                // soon as the callback settles so inherited async descendants
                // cannot submit statements during transaction finalization.
                const callbackOwner: Owner = { active: true };
                let result!: T, callbackFailed = false, callbackError: unknown;
                try { result = await this.#owner.run(callbackOwner, () => operation(...args)); }
                catch (error) { callbackFailed = true; callbackError = error; }
                finally {
                    callbackOwner.active = false;
                    while (this.#pending.size) await Promise.all([...this.#pending.values()].map(item => item.settled));
                }
                if (callbackFailed) throw callbackError;
                this.#committing = true;
                try { await this.request('exec', { sql: 'COMMIT' }); }
                catch { this.poison(); throw memoryError('MEMORY_COMMIT_UNCERTAIN'); }
                finally { this.#committing = false; }
                return result;
            } catch (error) {
                if (this.open) {
                    try { await this.request('exec', { sql: 'ROLLBACK' }); }
                    catch { this.poison(); throw memoryError('MEMORY_ROLLBACK_UNCERTAIN'); }
                }
                throw error;
            } finally { this.#transaction = false; }
        });
        const normal = wrap('DEFERRED');
        return Object.assign(normal, { deferred: normal, immediate: wrap('IMMEDIATE'), exclusive: wrap('EXCLUSIVE') });
    }
    backup(path: string, rate = 100): Promise<void> {
        return this.exclusive(async () => { await this.request('backup', { path, rate }); }, 0, this.limits.backupMs);
    }
    close(): Promise<void> {
        if (this.#closing) return this.#closing;
        this.#closing = (async () => {
            try { if (this.open) await this.exclusive(async () => { await this.request('close'); this.#closed = true; }); }
            finally { this.#closed = true; this.#termination ??= this.#thread.terminate(); await this.#termination; }
        })();
        return this.#closing;
    }
}

function ownedApi<T extends object>(target: T, db: MemoryDatabase): T {
    return new Proxy(target, { get(object, key) {
        const method = Reflect.get(object, key);
        if (typeof method !== 'function') return method;
        // AgentFS exposes this metadata accessor synchronously. It does not
        // touch SQLite, so preserve the SDK contract instead of promisifying it.
        if (key === 'getChunkSize') return (...args: unknown[]) => {
            memoryWireBytes(args, db.limits.requestBytes, 'MEMORY_REQUEST_LIMIT');
            return method.apply(object, args);
        };
        return async (...args: unknown[]) => {
            const bytes = memoryWireBytes(args, db.limits.requestBytes, 'MEMORY_REQUEST_LIMIT');
            return db.exclusive(async () => {
                const result = await method.apply(object, args);
                return result && typeof result === 'object' && typeof result.pread === 'function' ? ownedApi(result, db) : result;
            }, bytes);
        };
    } });
}

export const openMemoryDatabase = (path: string, options: MemoryDatabaseOptions = {}): Promise<MemoryDatabase> => MemoryDatabase.open(path, options);

export async function attachMemoryAgent(db: MemoryDatabase): Promise<AgentFS> {
    if (db.readonly) throw memoryError('MEMORY_READ_ONLY_SDK_UNSUPPORTED');
    // The SDK types name a concrete driver with private members. This single
    // boundary assertion is backed by real SDK/core method-contract tests.
    const agent = await db.exclusive(() => AgentFS.openWith(db as unknown as Parameters<typeof AgentFS.openWith>[0]));
    Object.defineProperty(agent, 'fs', { value: ownedApi(agent.fs, db) });
    Object.defineProperty(agent, 'tools', { value: ownedApi(agent.tools, db) });
    return agent;
}
