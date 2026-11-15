import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, realpathSync, unlinkSync, writeFileSync, type Stats } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { digestValue } from './memory-proposal-schema.js';
import { readStableFile, readStableJson } from './stable-file.js';
import { hardenPrivatePath, memoryPathAncestorsAreSafe, privatePathIsSafe, replacementBoundaryIsSafe } from './platform-security.js';

export const localDigest = z.string().regex(/^[a-f0-9]{64}$/);
export const localText = (max: number) => z.string().min(1).max(max).refine(s => Buffer.byteLength(s) <= max);
export const localRelative = localText(512).refine(p => !isAbsolute(p) && !/[\\:\x00-\x1f\x7f]/.test(p)
    && p.split('/').every(part => part !== '' && part !== '.' && part !== '..' && !['.git', '.agentfs'].includes(part)));
export const fileDigest = (text: string) => createHash('sha256').update(text).digest('hex');
export const LOCAL_RECORD_BYTES = 512 * 1024;

export function canonicalLocalProject(path: string): string {
    const root = realpathSync(resolve(path));
    if (!lstatSync(root).isDirectory()) throw new Error('Project must be a directory.');
    return root;
}

function info(path: string): Stats | undefined {
    try { return lstatSync(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
}

// Inspect every descendant, not just the final file's immediate parent. These
// point-in-time guards do not promise a filesystem-wide atomic snapshot.
export function guardedLocalPath(root: string, relative: string, internal = false): { path: string; recheck: () => void } {
    const parts = relative.split('/');
    if (!internal) localRelative.parse(relative);
    const rootInfo = lstatSync(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || realpathSync(root) !== root) throw new Error('Local project root is unsafe.');
    const parents: [string, Stats][] = [[root, rootInfo]];
    let current = root;
    for (const part of parts.slice(0, -1)) {
        current = join(current, part);
        const st = lstatSync(current);
        if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Local context path crosses an unsafe directory or symlink.');
        parents.push([current, st]);
    }
    const recheck = () => {
        for (const [path, before] of parents) {
            const after = lstatSync(path);
            if (!after.isDirectory() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino)
                throw new Error('Local context directory changed.');
        }
    };
    return { path: join(root, ...parts), recheck };
}

export function localFileReader(root: string, maxTotal = 8 * 1024 * 1024) {
    let total = 0;
    const cache = new Map<string, { text: string; digest: string }>();
    return (relative: string) => {
        const previous = cache.get(relative);
        if (previous) return previous;
        const guarded = guardedLocalPath(root, relative);
        const { bytes } = readStableFile(guarded.path, { label: 'Local evidence file', maxBytes: Math.min(1024 * 1024, maxTotal - total) });
        let text: string;
        try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
        catch { throw new Error('Local evidence contains invalid UTF-8.'); }
        guarded.recheck(); total += bytes.length;
        if (text.includes('\0')) throw new Error('Local evidence must be textual UTF-8.');
        const result = { text, digest: fileDigest(text) }; cache.set(relative, result); return result;
    };
}

export function sealLocal<T extends object>(body: T): T & { digest: string } {
    return { ...body, digest: digestValue(body) };
}

export function verifyLocal<T extends { digest: string }>(record: T): T {
    const { digest, ...body } = record;
    if (digestValue(body) !== digest) throw new Error('Local context record digest mismatch.');
    return record;
}

export function readLocalInput(path: string): unknown {
    return readStableJson(resolve(path), { label: 'Local context input', maxBytes: LOCAL_RECORD_BYTES });
}

function store(root: string, kind: 'wiki-evidence' | 'continuations', create: boolean): string {
    if (!memoryPathAncestorsAreSafe(join(root, '.agentfs'))) throw new Error('Local context store ancestry is unsafe.');
    let current = root;
    for (const part of ['.agentfs', 'local-context', kind]) {
        if (create && !replacementBoundaryIsSafe(current)) throw new Error('Local context publication parent is unsafe.');
        current = join(current, part);
        let st = info(current);
        if (!st && create) {
            mkdirSync(current, { mode: 0o700 }); hardenPrivatePath(current); st = lstatSync(current);
        }
        if (!st) return current;
        if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('Local context store is unsafe.');
        if (part !== '.agentfs' && !privatePathIsSafe(current)) throw new Error('Local context store is not private.');
    }
    return current;
}

export function readLocalRecord(root: string, kind: 'wiki-evidence' | 'continuations', digest: string): unknown {
    localDigest.parse(digest);
    const directory = store(root, kind, false);
    if (!info(join(root, '.agentfs', 'local-context', kind, `${digest}.json`))) throw new Error('Local context record not found.');
    const guarded = guardedLocalPath(root, `.agentfs/local-context/${kind}/${digest}.json`, true);
    if (dirname(guarded.path) !== directory) throw new Error('Local context record not found.');
    const record = readStableJson(guarded.path, { label: 'Local context record', maxBytes: LOCAL_RECORD_BYTES, private: true });
    guarded.recheck();
    if (!record || typeof record !== 'object' || (record as { digest?: string }).digest !== digest)
        throw new Error('Local context record filename mismatch.');
    return record;
}

export function publishLocalRecord(root: string, kind: 'wiki-evidence' | 'continuations', record: { digest: string }): void {
    localDigest.parse(record.digest); verifyLocal(record);
    const bytes = Buffer.from(JSON.stringify(record) + '\n');
    if (bytes.length > LOCAL_RECORD_BYTES) throw new Error('Local context record byte limit exceeded.');
    const directory = store(root, kind, true);
    const names = readdirSync(directory);
    let total = 0;
    for (const name of names) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) throw new Error('Unexpected local context store entry; inspect interrupted publication.');
        const st = lstatSync(join(directory, name));
        if (!st.isFile() || st.isSymbolicLink() || st.size > LOCAL_RECORD_BYTES) throw new Error('Unsafe local context store entry.');
        total += st.size;
    }
    const path = join(directory, `${record.digest}.json`);
    if (info(path)) {
        if (JSON.stringify(readLocalRecord(root, kind, record.digest)) !== JSON.stringify(record)) throw new Error('Immutable local record conflict.');
        return;
    }
    if (names.length >= 1024 || total + bytes.length > 64 * 1024 * 1024) throw new Error('Local context store limit exceeded.');
    const guarded = guardedLocalPath(root, `.agentfs/local-context/${kind}/${record.digest}.json`, true);
    const temp = join(directory, `.${randomUUID()}.tmp`);
    let fd: number | undefined, created = false;
    try {
        fd = openSync(temp, 'wx', 0o600); created = true; writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
        hardenPrivatePath(temp); guarded.recheck();
        // Hard-link publication never replaces an existing digest, even when
        // concurrent creators race. Unsupported filesystems fail closed.
        try { linkSync(temp, path); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
            if (JSON.stringify(readLocalRecord(root, kind, record.digest)) !== JSON.stringify(record)) throw new Error('Immutable local record conflict.');
        }
        guarded.recheck();
    } finally { if (fd !== undefined) closeSync(fd); if (created) unlinkSync(temp); }
}
