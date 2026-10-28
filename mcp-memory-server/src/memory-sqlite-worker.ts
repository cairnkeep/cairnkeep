import { parentPort, workerData } from 'node:worker_threads';
import { statSync } from 'node:fs';
import {
    memoryDatabaseLimits, memoryError, memoryWireBytes, validateMemoryRequest,
    MemoryDatabaseError, type MemoryRequest, type MemoryBinding,
} from './memory-database-protocol.js';
import { inspectMemoryDatabaseFile } from './memory-store-format.js';

if (!parentPort) throw memoryError('MEMORY_WORKER_REQUIRED');
const port = parentPort, limits = memoryDatabaseLimits(workerData.limits);
// Only this worker imports the synchronous driver, after parent runtime admission.
const { DatabaseSync, backup } = await import('node:sqlite');
if (typeof backup !== 'function') throw memoryError('MEMORY_RUNTIME_UNSUPPORTED');
const before = inspectMemoryDatabaseFile(workerData.path, true);
if (before.dev !== workerData.identity.dev || before.ino !== workerData.identity.ino) throw memoryError('MEMORY_FILE_CHANGED');
const db = new DatabaseSync(workerData.path, { readOnly: workerData.readOnly, timeout: workerData.busyTimeoutMs });
try {
    if (typeof db.isTransaction !== 'boolean') throw memoryError('MEMORY_RUNTIME_UNSUPPORTED');
    const after = inspectMemoryDatabaseFile(workerData.path, true);
    if (after.dev !== before.dev || after.ino !== before.ino) throw memoryError('MEMORY_FILE_CHANGED');
    if (workerData.readOnly) db.exec('PRAGMA query_only=ON');
    else db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
} catch (error) { db.close(); throw error; }
port.postMessage({ ready: true });

function diagnostic(error: unknown): string {
    if (error instanceof MemoryDatabaseError) return error.code;
    const detail = error as { errcode?: number; message?: string };
    if ([5, 6].includes(detail.errcode ?? -1)) return 'MEMORY_SQLITE_BUSY';
    if (detail.errcode === 8) return 'MEMORY_READ_ONLY';
    for (const code of ['MEMORY_KEY_RENAME', 'MEMORY_GENERATION_EXHAUSTED', 'MEMORY_CONTEXT_DAMAGED']) {
        if (detail.message?.includes(code)) return code;
    }
    return 'MEMORY_SQLITE_QUERY_FAILED'; // Never echo SQL, bound text or OS paths.
}

async function execute(input: unknown): Promise<void> {
    let request: MemoryRequest | undefined;
    try {
        validateMemoryRequest(input, limits); request = input;
        const { id, operation, sql, params } = request;
        let value: unknown;
        if (operation === 'exec') value = db.exec(sql!);
        else if (operation === 'close') {
            db.close(); port.postMessage({ id, value: null, transaction: false }); port.close(); return;
        } else if (operation === 'backup') {
            await backup(db, request.path!, { rate: request.rate!, progress(info) {
                if (info.totalPages * 65536 > limits.snapshotBytes) {
                    // Exact size is also checked below; use page size, not a guessed
                    // final-file length, for the live snapshot's allocation bound.
                    const row = db.prepare('PRAGMA page_size').get();
                    if (info.totalPages * Number(row?.page_size) > limits.snapshotBytes) throw memoryError('MEMORY_SNAPSHOT_LIMIT');
                }
            } });
            if (statSync(request.path!).size > limits.snapshotBytes) throw memoryError('MEMORY_SNAPSHOT_LIMIT');
            value = null;
        } else {
            const statement = db.prepare(sql!);
            const bindings = params as MemoryBinding[];
            if (operation === 'get') value = statement.get(...bindings);
            else if (operation === 'run') value = statement.run(...bindings);
            else {
                const rows: unknown[] = []; let remaining = limits.replyBytes - 64;
                // Do not materialize all rows and only then discover an overflow.
                for (const row of statement.iterate(...bindings)) {
                    remaining -= memoryWireBytes(row, remaining, 'MEMORY_REPLY_LIMIT');
                    if (rows.length >= 100_000) throw memoryError('MEMORY_REPLY_LIMIT');
                    rows.push(row);
                }
                value = rows;
            }
        }
        const result = { id, value, transaction: db.isTransaction };
        memoryWireBytes(result, limits.replyBytes, 'MEMORY_REPLY_LIMIT');
        port.postMessage(result);
    } catch (error) {
        // Invalid frames are fatal; only an already validated request gets a reply.
        if (!request) { port.postMessage({ fatal: 'MEMORY_INVALID_REQUEST' }); port.close(); db.close(); return; }
        port.postMessage({ id: request.id, error: diagnostic(error), transaction: db.isTransaction });
    }
}
// Serialize backup's asynchronous progress against all later driver operations.
let tail = Promise.resolve();
port.on('message', input => { tail = tail.then(() => execute(input)); });
