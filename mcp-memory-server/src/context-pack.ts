import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants, existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import {
    chmod, cp, mkdir, mkdtemp, open, readdir, readFile, realpath, rename, rm, stat, writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { z } from "zod";
import { EmbeddingCache, cosineSimilarity, embedTexts, getEmbeddingConfig, hashText } from "./embeddings.js";
import { atomicReplace, hardenPrivatePath, privatePathIsSafe } from "./platform-security.js";

const execFileAsync = promisify(execFile);
export const CONTEXT_PACK_MANIFEST = "context-pack.json";
export const CONTEXT_PACK_MAX_FILE_BYTES = 1024 * 1024;
export const CONTEXT_PACK_MAX_ENTRIES = 1024;
export const CONTEXT_PACK_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DIGEST = /^[a-f0-9]{64}$/;
const GIT_COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const PACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROJECT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const contextPackFileSchema = z.object({
    path: z.string().min(1).max(512),
    kind: z.enum(["document", "skill"]),
    title: z.string().min(1).max(256),
    description: z.string().max(2048),
    keywords: z.array(z.string().min(1).max(128)).max(64),
    sha256: z.string().regex(DIGEST),
}).strict();
export const contextPackManifestSchema = z.object({
    schema_version: z.literal(1),
    id: z.string().min(1).max(64).regex(PACK_ID),
    version: z.string().min(1).max(128).regex(SEMVER),
    title: z.string().min(1).max(256),
    description: z.string().min(1).max(2048),
    license: z.string().min(1).max(128),
    files: z.array(contextPackFileSchema).max(CONTEXT_PACK_MAX_ENTRIES),
}).strict();
export type ContextPackManifest = z.infer<typeof contextPackManifestSchema>;
export type ContextPackFile = z.infer<typeof contextPackFileSchema>;

export type ValidatedContextPack = {
    root: string;
    manifest: ContextPackManifest;
    manifest_bytes: Buffer;
    digest: string;
    total_bytes: number;
};
export type PackSource = { kind: "local"; path: string } | { kind: "git"; url: string; ref: string; commit: string };
type EnabledPack = { id: string; version: string; digest: string };
type SkillApproval = { pack_digest: string; path: string; file_digest: string; approved_at: string };
type ProjectPointer = {
    schema_version: 1;
    project_id: string;
    enabled: EnabledPack[];
    skill_approvals: SkillApproval[];
};
type ProjectOptions = { projectRoot?: string; projectId?: string };

function sha256(...parts: Array<string | Buffer>): string {
    const hash = createHash("sha256");
    for (const part of parts) hash.update(part);
    return hash.digest("hex");
}

function packBaseDir(): string {
    const raw = process.env.CAIRN_PACK_BASE_DIR?.trim() || join(homedir(), ".cairnkeep", "packs");
    return resolve(raw === "~" ? homedir() : raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw);
}

function objectRoot(digest: string): string {
    if (!DIGEST.test(digest)) throw new Error("Invalid context pack digest.");
    return join(packBaseDir(), "objects", digest);
}

function normalizePackPath(value: string): string {
    if (!value || value.includes("\\") || isAbsolute(value) || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
        throw new Error(`Unsafe context pack path: ${value}`);
    }
    return value;
}

function contained(root: string, candidate: string): boolean {
    const rel = relative(root, candidate);
    return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function assertUtf8(bytes: Buffer, path: string): string {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (Buffer.from(text, "utf8").compare(bytes) !== 0) throw new Error(`Context pack file is not canonical UTF-8: ${path}`);
    return text;
}

function readPackSource(digest: string): PackSource | undefined {
    const directory = join(packBaseDir(), "sources");
    const path = join(directory, `${digest}.json`);
    if (!existsSync(path)) return undefined;
    const directoryInfo = lstatSync(directory);
    const info = lstatSync(path);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || !info.isFile() || info.isSymbolicLink()
        || info.size > 64 * 1024 || !privatePathIsSafe(path)) {
        throw new Error(`Context pack source record is unsafe: ${digest}`);
    }
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Context pack source record is invalid: ${digest}`);
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some((key) => !["schema_version", "source"].includes(key)) || record.schema_version !== 1
        || !record.source || typeof record.source !== "object" || Array.isArray(record.source)) {
        throw new Error(`Context pack source record is invalid: ${digest}`);
    }
    const source = record.source as Record<string, unknown>;
    if (source.kind === "local") {
        if (Object.keys(source).some((key) => !["kind", "path"].includes(key)) || typeof source.path !== "string"
            || !isAbsolute(source.path) || resolve(source.path) !== source.path) throw new Error(`Context pack source record is invalid: ${digest}`);
        return { kind: "local", path: source.path };
    }
    if (source.kind === "git") {
        if (Object.keys(source).some((key) => !["kind", "url", "ref", "commit"].includes(key))
            || typeof source.url !== "string" || !source.url || typeof source.ref !== "string" || !source.ref
            || typeof source.commit !== "string" || !GIT_COMMIT.test(source.commit)) throw new Error(`Context pack source record is invalid: ${digest}`);
        rejectCredentialUrl(source.url);
        return { kind: "git", url: source.url, ref: source.ref, commit: source.commit };
    }
    throw new Error(`Context pack source record is invalid: ${digest}`);
}

async function walkFiles(root: string, directory = root): Promise<string[]> {
    const result: string[] = [];
    const directoryInfo = lstatSync(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
        throw new Error(`Context packs may not contain symlink directories: ${relative(root, directory) || "."}`);
    }
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
        const absolute = join(directory, entry.name);
        const relativePath = relative(root, absolute).split(sep).join("/");
        if (entry.isSymbolicLink()) throw new Error(`Context packs may not contain symlinks: ${relativePath}`);
        if (entry.isDirectory()) result.push(...await walkFiles(root, absolute));
        else if (entry.isFile()) result.push(relativePath);
        else throw new Error(`Context packs may contain regular files only: ${relativePath}`);
    }
    return result;
}

export async function validateContextPack(directory: string): Promise<ValidatedContextPack> {
    const requestedRoot = resolve(directory);
    const requestedInfo = lstatSync(requestedRoot);
    if (requestedInfo.isSymbolicLink()) throw new Error("Context pack source may not be a symlink.");
    if (!requestedInfo.isDirectory()) throw new Error("Context pack source must be a real directory.");
    const root = await realpath(requestedRoot);
    const rootInfo = await stat(root);
    if (!rootInfo.isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error("Context pack source must be a real directory.");
    const manifestPath = join(root, CONTEXT_PACK_MANIFEST);
    const manifestInfo = lstatSync(manifestPath);
    if (!manifestInfo.isFile() || manifestInfo.isSymbolicLink() || manifestInfo.size > CONTEXT_PACK_MAX_FILE_BYTES) throw new Error("Context pack manifest is unsafe.");
    const manifestBytes = await readFile(manifestPath);
    assertUtf8(manifestBytes, CONTEXT_PACK_MANIFEST);
    const manifest = contextPackManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")) as unknown);
    const declared = new Set<string>();
    let totalBytes = manifestBytes.byteLength;
    const hash = createHash("sha256").update(manifestBytes).update("\0");
    const content = new Map<string, Buffer>();
    for (const file of manifest.files) {
        const normalized = normalizePackPath(file.path);
        if (normalized === CONTEXT_PACK_MANIFEST || declared.has(normalized)) throw new Error(`Duplicate or reserved context pack path: ${normalized}`);
        declared.add(normalized);
        const absolute = resolve(root, normalized);
        if (!contained(root, absolute)) throw new Error(`Unsafe context pack path: ${normalized}`);
        const info = lstatSync(absolute);
        if (!info.isFile() || info.isSymbolicLink() || info.size > CONTEXT_PACK_MAX_FILE_BYTES) throw new Error(`Context pack file is unsafe or too large: ${normalized}`);
        const bytes = await readFile(absolute);
        assertUtf8(bytes, normalized);
        if (sha256(bytes) !== file.sha256) throw new Error(`Context pack digest mismatch: ${normalized}`);
        totalBytes += bytes.byteLength;
        if (totalBytes > CONTEXT_PACK_MAX_TOTAL_BYTES) throw new Error("Context pack exceeds the total size limit.");
        content.set(normalized, bytes);
    }
    const actual = (await walkFiles(root)).filter((path) => path !== CONTEXT_PACK_MANIFEST);
    const undeclared = actual.filter((path) => !declared.has(path));
    const missing = [...declared].filter((path) => !actual.includes(path));
    if (undeclared.length || missing.length) throw new Error(`Context pack file declaration mismatch${undeclared.length ? `; undeclared: ${undeclared.join(", ")}` : ""}${missing.length ? `; missing: ${missing.join(", ")}` : ""}`);
    for (const path of [...declared].sort((a, b) => a.localeCompare(b, "en"))) {
        const bytes = content.get(path)!;
        hash.update(path, "utf8").update("\0").update(bytes).update("\0");
    }
    return { root, manifest, manifest_bytes: manifestBytes, digest: hash.digest("hex"), total_bytes: totalBytes };
}

async function atomicJson(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const directoryInfo = lstatSync(dirname(path));
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error("Context pack state directory is unsafe.");
    if (existsSync(path)) {
        const existing = lstatSync(path);
        if (!existing.isFile() || existing.isSymbolicLink()) throw new Error("Context pack state file is unsafe.");
    }
    const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    let handle;
    try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;
        await chmod(temporary, 0o600);
        hardenPrivatePath(temporary);
        await atomicReplace(temporary, path);
        hardenPrivatePath(path);
    } finally {
        if (handle) await handle.close().catch(() => undefined);
        await rm(temporary, { force: true });
    }
}

async function makeImmutable(root: string): Promise<void> {
    const directories: string[] = [];
    const walk = async (directory: string): Promise<void> => {
        directories.push(directory);
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) await walk(path);
            else if (process.platform === "win32") {
                hardenPrivatePath(path);
                await execFileAsync("attrib.exe", ["+R", path]);
            } else await chmod(path, 0o400);
        }
    };
    await walk(root);
    for (const directory of directories.reverse()) {
        if (process.platform === "win32") hardenPrivatePath(directory);
        else await chmod(directory, 0o500);
    }
}

async function makeWritable(root: string): Promise<void> {
    if (!existsSync(root)) return;
    await chmod(root, 0o700);
    for (const entry of await readdir(root, { withFileTypes: true })) {
        const path = join(root, entry.name);
        if (entry.isDirectory()) await makeWritable(path);
        else if (process.platform === "win32") await execFileAsync("attrib.exe", ["-R", path]);
        else await chmod(path, 0o600);
    }
}

function rejectCredentialUrl(source: string): void {
    try {
        const url = new URL(source);
        if (url.username || url.password) throw new Error("Git source URLs may not contain credentials.");
    } catch (error) {
        if (error instanceof Error && error.message.includes("credentials")) throw error;
    }
    if (/^[^/@:\s]+:[^@\s]+@/.test(source) || /[?&](?:token|password|access_token)=/i.test(source)) {
        throw new Error("Git source URLs may not contain credentials.");
    }
}

function execFileBuffer(program: string, args: string[], options: { timeout: number; maxBuffer: number }): Promise<Buffer> {
    return new Promise((resolvePromise, rejectPromise) => {
        execFile(program, args, { ...options, encoding: null, windowsHide: true }, (error, stdout) => {
            if (error) rejectPromise(error);
            else resolvePromise(Buffer.from(stdout));
        });
    });
}

async function materializeGitTree(repository: string, destination: string, commit: string): Promise<void> {
    const listing = await execFileBuffer(
        "git",
        ["-C", repository, "ls-tree", "-r", "-z", commit],
        { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const records = new TextDecoder("utf-8", { fatal: true }).decode(listing).split("\0").filter(Boolean);
    if (records.length > CONTEXT_PACK_MAX_ENTRIES + 1) throw new Error("Git context pack exceeds the entry limit.");
    let totalBytes = 0;
    for (const record of records) {
        const match = /^(100644|100755|120000) blob ([a-f0-9]{40}|[a-f0-9]{64})\t([\s\S]+)$/.exec(record);
        if (!match || match[1] === "120000") throw new Error("Git context packs may contain only regular files.");
        const path = normalizePackPath(match[3]);
        const { stdout: rawSize } = await execFileAsync(
            "git",
            ["-C", repository, "cat-file", "-s", match[2]],
            { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 },
        );
        const size = Number(rawSize.trim());
        if (!Number.isSafeInteger(size) || size < 0 || size > CONTEXT_PACK_MAX_FILE_BYTES) {
            throw new Error(`Git context pack file is unsafe or too large: ${path}`);
        }
        totalBytes += size;
        if (totalBytes > CONTEXT_PACK_MAX_TOTAL_BYTES) throw new Error("Git context pack exceeds the total size limit.");
        const target = resolve(destination, ...path.split("/"));
        if (!contained(destination, target)) throw new Error(`Unsafe Git context pack path: ${path}`);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        const bytes = await execFileBuffer(
            "git",
            ["-C", repository, "cat-file", "blob", match[2]],
            { timeout: 30_000, maxBuffer: CONTEXT_PACK_MAX_FILE_BYTES + 1 },
        );
        if (bytes.byteLength !== size) throw new Error(`Git context pack blob changed while reading: ${path}`);
        await writeFile(target, bytes, { mode: match[1] === "100755" ? 0o700 : 0o600 });
    }
}

async function materializeSource(source: string, ref?: string): Promise<{ root: string; cleanup?: string; source: PackSource }> {
    if (!ref) {
        const requested = resolve(source);
        const info = lstatSync(requested);
        if (info.isSymbolicLink()) throw new Error("Context pack source may not be a symlink.");
        const root = await realpath(requested);
        return { root, source: { kind: "local", path: root } };
    }
    const gitSource = existsSync(resolve(source)) ? await realpath(resolve(source)) : source;
    rejectCredentialUrl(gitSource);
    const checkout = await mkdtemp(join(tmpdir(), "cairn-pack-git-"));
    try {
        await execFileAsync("git", ["clone", "--quiet", "--no-checkout", "--", gitSource, checkout], { timeout: 120_000, maxBuffer: 1024 * 1024 });
        const { stdout } = await execFileAsync("git", ["-C", checkout, "rev-parse", "--verify", `${ref}^{commit}`], { timeout: 30_000, maxBuffer: 1024 * 1024 });
        const commit = stdout.trim();
        if (!GIT_COMMIT.test(commit)) throw new Error("Git did not resolve the requested ref to a full commit.");
        const root = join(checkout, "pack");
        await mkdir(root, { mode: 0o700 });
        await materializeGitTree(checkout, root, commit);
        return { root, cleanup: checkout, source: { kind: "git", url: gitSource, ref, commit } };
    } catch (error) {
        await rm(checkout, { recursive: true, force: true });
        throw new Error(`Unable to materialize Git context pack: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function installContextPack(sourcePath: string, options: { ref?: string } = {}): Promise<{ pack: ValidatedContextPack; source: PackSource; existing: boolean }> {
    const materialized = await materializeSource(sourcePath, options.ref);
    try {
        const pack = await validateContextPack(materialized.root);
        const destination = objectRoot(pack.digest);
        if (existsSync(destination)) {
            const existing = await validateContextPack(destination);
            if (existing.digest !== pack.digest) throw new Error("Stored context pack object failed verification.");
            await makeImmutable(destination);
            await atomicJson(join(packBaseDir(), "sources", `${pack.digest}.json`), { schema_version: 1, source: materialized.source });
            return { pack: existing, source: materialized.source, existing: true };
        }
        const objects = dirname(destination);
        await mkdir(objects, { recursive: true, mode: 0o700 });
        const temporary = join(objects, `.${pack.digest}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
        let published = true;
        try {
            await cp(pack.root, temporary, { recursive: true, errorOnExist: true, force: false });
            const copied = await validateContextPack(temporary);
            if (copied.digest !== pack.digest) throw new Error("Context pack changed during installation.");
            await makeImmutable(temporary);
            try {
                await rename(temporary, destination);
            } catch (error) {
                const code = (error as NodeJS.ErrnoException).code ?? "";
                const converged = existsSync(destination)
                    && (["EEXIST", "ENOTEMPTY"].includes(code) || (process.platform === "win32" && code === "EPERM"));
                if (!converged) throw error;
                const concurrent = await validateContextPack(destination);
                if (concurrent.digest !== pack.digest) throw new Error("Concurrent context pack installation produced a conflicting object.");
                published = false;
            }
        } finally {
            await makeWritable(temporary).catch(() => undefined);
            await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
        }
        await atomicJson(join(packBaseDir(), "sources", `${pack.digest}.json`), { schema_version: 1, source: materialized.source });
        return { pack: await validateContextPack(destination), source: materialized.source, existing: !published };
    } finally {
        if (materialized.cleanup) await rm(materialized.cleanup, { recursive: true, force: true });
    }
}

export async function listInstalledContextPacks(): Promise<Array<{ id: string; version: string; digest: string; title: string; source?: PackSource }>> {
    const objects = join(packBaseDir(), "objects");
    if (!existsSync(objects)) return [];
    const objectDirectoryInfo = lstatSync(objects);
    if (!objectDirectoryInfo.isDirectory() || objectDirectoryInfo.isSymbolicLink()) throw new Error("Context pack object directory is unsafe.");
    const result = [];
    for (const entry of (await readdir(objects, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
        if (!entry.isDirectory() || !DIGEST.test(entry.name)) continue;
        const pack = await validateContextPack(join(objects, entry.name));
        if (pack.digest !== entry.name) throw new Error(`Stored context pack object has the wrong identity: ${entry.name}`);
        const source = readPackSource(entry.name);
        result.push({ id: pack.manifest.id, version: pack.manifest.version, digest: pack.digest, title: pack.manifest.title, ...(source ? { source } : {}) });
    }
    return result;
}

export async function resolveInstalledPack(selector: string): Promise<ValidatedContextPack> {
    const installed = await listInstalledContextPacks();
    const matches = installed.filter((pack) => pack.digest === selector || pack.digest.startsWith(selector) || pack.id === selector || `${pack.id}@${pack.version}` === selector);
    if (matches.length === 0) throw new Error("Context pack not found.");
    if (matches.length > 1) throw new Error("Context pack selector is ambiguous; use its full digest.");
    return validateContextPack(objectRoot(matches[0].digest));
}

function projectIdentity(options: { projectRoot?: string; projectId?: string }): { id: string; path: string } {
    if (options.projectId) {
        if (!PROJECT_ID.test(options.projectId)) throw new Error("Invalid remote project ID.");
        const id = `remote:${options.projectId}`;
        return { id, path: join(packBaseDir(), "projects", `remote-${options.projectId}.json`) };
    }
    const raw = resolve(options.projectRoot ?? process.cwd());
    const canonical = existsSync(raw) ? realpathSync(raw) : raw;
    const digest = sha256(canonical);
    return { id: `local:${canonical}`, path: join(packBaseDir(), "projects", `local-${digest}.json`) };
}

function emptyPointer(id: string): ProjectPointer {
    return { schema_version: 1, project_id: id, enabled: [], skill_approvals: [] };
}

function parseProjectPointer(value: unknown, expectedId: string): ProjectPointer {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Context pack project pointer is invalid.");
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some((key) => !["schema_version", "project_id", "enabled", "skill_approvals"].includes(key))
        || row.schema_version !== 1 || row.project_id !== expectedId || !Array.isArray(row.enabled) || !Array.isArray(row.skill_approvals)) {
        throw new Error("Context pack project pointer is invalid.");
    }
    const enabled: EnabledPack[] = [];
    const seenIds = new Set<string>();
    for (const value of row.enabled) {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Context pack project pointer is invalid.");
        const entry = value as Record<string, unknown>;
        if (Object.keys(entry).some((key) => !["id", "version", "digest"].includes(key)) || typeof entry.id !== "string"
            || !PACK_ID.test(entry.id) || typeof entry.version !== "string" || !SEMVER.test(entry.version)
            || typeof entry.digest !== "string" || !DIGEST.test(entry.digest) || seenIds.has(entry.id)) {
            throw new Error("Context pack project pointer is invalid.");
        }
        seenIds.add(entry.id);
        enabled.push(entry as EnabledPack);
    }
    const approvals: SkillApproval[] = [];
    const seenApprovals = new Set<string>();
    for (const value of row.skill_approvals) {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Context pack project pointer is invalid.");
        const entry = value as Record<string, unknown>;
        if (Object.keys(entry).some((key) => !["pack_digest", "path", "file_digest", "approved_at"].includes(key))
            || typeof entry.pack_digest !== "string" || !DIGEST.test(entry.pack_digest)
            || typeof entry.file_digest !== "string" || !DIGEST.test(entry.file_digest)
            || typeof entry.path !== "string" || typeof entry.approved_at !== "string" || !Number.isFinite(Date.parse(entry.approved_at))) {
            throw new Error("Context pack project pointer is invalid.");
        }
        normalizePackPath(entry.path);
        const key = `${entry.pack_digest}:${entry.path}`;
        if (seenApprovals.has(key)) throw new Error("Context pack project pointer is invalid.");
        seenApprovals.add(key);
        approvals.push(entry as SkillApproval);
    }
    return { schema_version: 1, project_id: expectedId, enabled, skill_approvals: approvals };
}

export function readProjectPointer(options: ProjectOptions): ProjectPointer {
    const identity = projectIdentity(options);
    if (!existsSync(identity.path)) return emptyPointer(identity.id);
    const info = lstatSync(identity.path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024
        || !privatePathIsSafe(identity.path)) throw new Error("Context pack project pointer is unsafe.");
    return parseProjectPointer(JSON.parse(readFileSync(identity.path, "utf8")) as unknown, identity.id);
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function acquirePointerLock(options: ProjectOptions): Promise<() => Promise<void>> {
    const identity = projectIdentity(options);
    await mkdir(dirname(identity.path), { recursive: true, mode: 0o700 });
    const lock = `${identity.path}.lock`;
    for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
            await mkdir(lock, { mode: 0o700 });
            return () => rm(lock, { recursive: true, force: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            const info = lstatSync(lock);
            if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Context pack project pointer lock is unsafe.");
            await delay(10);
        }
    }
    throw new Error("Context pack project pointer is locked; retry after the active update finishes.");
}

async function mutateProjectPointer(options: ProjectOptions, mutate: (pointer: ProjectPointer) => void | Promise<void>): Promise<ProjectPointer> {
    const release = await acquirePointerLock(options);
    try {
        const pointer = readProjectPointer(options);
        await mutate(pointer);
        await atomicJson(projectIdentity(options).path, pointer);
        return pointer;
    } finally {
        await release();
    }
}

export async function enableContextPack(selector: string, options: ProjectOptions): Promise<ProjectPointer> {
    const pack = await resolveInstalledPack(selector);
    return mutateProjectPointer(options, (pointer) => {
        const previous = pointer.enabled.find((entry) => entry.id === pack.manifest.id);
        pointer.enabled = pointer.enabled.filter((entry) => entry.id !== pack.manifest.id);
        pointer.enabled.push({ id: pack.manifest.id, version: pack.manifest.version, digest: pack.digest });
        pointer.enabled.sort((a, b) => a.id.localeCompare(b.id, "en"));
        if (previous?.digest !== pack.digest) pointer.skill_approvals = pointer.skill_approvals.filter((approval) => approval.pack_digest !== previous?.digest);
    });
}

export async function disableContextPack(selector: string, options: ProjectOptions): Promise<ProjectPointer> {
    return mutateProjectPointer(options, (pointer) => {
        const removed = pointer.enabled.filter((entry) => entry.id === selector || entry.digest === selector || entry.digest.startsWith(selector));
        if (removed.length === 0) throw new Error("Enabled context pack not found.");
        const digests = new Set(removed.map(({ digest }) => digest));
        pointer.enabled = pointer.enabled.filter((entry) => !digests.has(entry.digest));
        pointer.skill_approvals = pointer.skill_approvals.filter((entry) => !digests.has(entry.pack_digest));
    });
}

async function allPointers(): Promise<Array<{ path: string; pointer: ProjectPointer }>> {
    const directory = join(packBaseDir(), "projects");
    if (!existsSync(directory)) return [];
    const directoryInfo = lstatSync(directory);
    if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error("Context pack project pointer directory is unsafe.");
    const result = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const path = join(directory, entry.name);
        const info = lstatSync(path);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024
            || !privatePathIsSafe(path)) {
            throw new Error(`Context pack project pointer is unsafe: ${path}`);
        }
        const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
        const value = raw as { project_id?: unknown };
        if (typeof value.project_id !== "string") throw new Error("Context pack project pointer is invalid.");
        const pointer = parseProjectPointer(raw, value.project_id);
        result.push({ path, pointer });
    }
    return result;
}

export async function removeContextPack(selector: string): Promise<string> {
    const pack = await resolveInstalledPack(selector);
    for (const { pointer } of await allPointers()) {
        if (pointer.enabled.some(({ digest }) => digest === pack.digest)) throw new Error("Context pack is enabled by a project and cannot be removed.");
    }
    const root = objectRoot(pack.digest);
    await makeWritable(root);
    await rm(root, { recursive: true, force: true });
    await rm(join(packBaseDir(), "sources", `${pack.digest}.json`), { force: true });
    return pack.digest;
}

export async function listPackSkills(options: { projectRoot?: string; projectId?: string }): Promise<Array<Record<string, unknown>>> {
    const pointer = readProjectPointer(options);
    const approvals = new Set(pointer.skill_approvals.map((row) => `${row.pack_digest}:${row.path}:${row.file_digest}`));
    const result: Array<Record<string, unknown>> = [];
    for (const enabled of pointer.enabled) {
        const pack = await validateContextPack(objectRoot(enabled.digest));
        for (const file of pack.manifest.files.filter(({ kind }) => kind === "skill")) {
            result.push({ pack_id: pack.manifest.id, version: pack.manifest.version, pack_digest: pack.digest, path: file.path, file_digest: file.sha256, title: file.title, approved: approvals.has(`${pack.digest}:${file.path}:${file.sha256}`) });
        }
    }
    return result;
}

export async function approvePackSkill(selector: string, path: string, confirm: string, options: ProjectOptions): Promise<ProjectPointer> {
    return mutateProjectPointer(options, async (pointer) => {
        const enabled = pointer.enabled.find((entry) => entry.id === selector || entry.digest === selector || entry.digest.startsWith(selector));
        if (!enabled) throw new Error("Context pack is not enabled for this project.");
        const pack = await validateContextPack(objectRoot(enabled.digest));
        const file = pack.manifest.files.find((entry) => entry.path === normalizePackPath(path) && entry.kind === "skill");
        if (!file) throw new Error("Skill file not found in the enabled context pack.");
        if (confirm !== file.sha256) throw new Error("Skill approval confirmation does not match the file digest.");
        pointer.skill_approvals = pointer.skill_approvals.filter((row) => !(row.pack_digest === pack.digest && row.path === file.path));
        pointer.skill_approvals.push({ pack_digest: pack.digest, path: file.path, file_digest: file.sha256, approved_at: new Date().toISOString() });
    });
}

export async function revokePackSkill(selector: string, path: string, options: ProjectOptions): Promise<ProjectPointer> {
    return mutateProjectPointer(options, (pointer) => {
        const enabled = pointer.enabled.find((entry) => entry.id === selector || entry.digest === selector || entry.digest.startsWith(selector));
        if (!enabled) throw new Error("Context pack is not enabled for this project.");
        const before = pointer.skill_approvals.length;
        pointer.skill_approvals = pointer.skill_approvals.filter((row) => !(row.pack_digest === enabled.digest && row.path === normalizePackPath(path)));
        if (before === pointer.skill_approvals.length) throw new Error("Skill approval not found.");
    });
}

export async function visiblePackFiles(options: { projectRoot?: string; projectId?: string }): Promise<Array<{ pack: ValidatedContextPack; file: ContextPackFile }>> {
    const pointer = readProjectPointer(options);
    const approvals = new Set(pointer.skill_approvals.map((row) => `${row.pack_digest}:${row.path}:${row.file_digest}`));
    const result = [];
    for (const enabled of pointer.enabled) {
        const pack = await validateContextPack(objectRoot(enabled.digest));
        for (const file of pack.manifest.files) {
            if (file.kind === "skill" && !approvals.has(`${pack.digest}:${file.path}:${file.sha256}`)) continue;
            result.push({ pack, file });
        }
    }
    return result;
}

function provenance(pack: ValidatedContextPack, file: ContextPackFile) {
    return { pack_id: pack.manifest.id, version: pack.manifest.version, pack_digest: pack.digest, path: file.path, kind: file.kind, file_digest: file.sha256 };
}

function utf8Slice(bytes: Buffer, start: number, maximum: number): { text: string; bytes: number } {
    const requestedStart = Math.min(start, bytes.length);
    let safeStart = requestedStart;
    while (safeStart < bytes.length && (bytes[safeStart] & 0xc0) === 0x80) safeStart += 1;
    let end = Math.min(bytes.length, safeStart + maximum);
    while (end > safeStart) {
        try {
            const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(safeStart, end));
            return { text, bytes: end - requestedStart };
        } catch {
            end -= 1;
        }
    }
    return { text: "", bytes: Math.max(0, safeStart - requestedStart) };
}

function chunks(text: string): Array<{ offset: number; text: string }> {
    const boundaries = new Set([0, text.length]);
    for (const match of text.matchAll(/^#{1,6}\s|\n{2,}(?=\S)/gm)) {
        const boundary = match[0].startsWith("\n") ? match.index + match[0].length : match.index;
        boundaries.add(boundary);
    }
    const positions = [...boundaries].sort((a, b) => a - b);
    const blocks = positions.slice(0, -1).map((start, index) => text.slice(start, positions[index + 1])).filter(Boolean);
    const result: Array<{ offset: number; text: string }> = [];
    let current = "";
    let offset = 0;
    const push = (): void => {
        if (!current) return;
        const bytes = Buffer.from(current, "utf8");
        let localOffset = 0;
        while (localOffset < bytes.length) {
            while (localOffset < bytes.length && (bytes[localOffset] & 0xc0) === 0x80) localOffset += 1;
            const part = utf8Slice(bytes, localOffset, 8192);
            if (!part.bytes) break;
            result.push({ offset: offset + localOffset, text: part.text });
            if (localOffset + part.bytes >= bytes.length) break;
            localOffset += Math.max(1, part.bytes - 512);
        }
        offset += bytes.length;
        current = "";
    };
    for (const block of blocks) {
        if (Buffer.byteLength(current + block, "utf8") > 8192) push();
        current += block;
    }
    push();
    return result;
}

export async function listVisibleContext(options: { projectRoot?: string; projectId?: string }) {
    const files = await visiblePackFiles(options);
    const grouped = new Map<string, { pack_id: string; version: string; pack_digest: string; title: string; files: unknown[] }>();
    for (const { pack, file } of files) {
        const row = grouped.get(pack.digest) ?? { pack_id: pack.manifest.id, version: pack.manifest.version, pack_digest: pack.digest, title: pack.manifest.title, files: [] };
        row.files.push({ ...provenance(pack, file), title: file.title, description: file.description, keywords: file.keywords });
        grouped.set(pack.digest, row);
    }
    return { schema_version: 1, packs: [...grouped.values()] };
}

export async function searchVisibleContext(query: string, options: { projectRoot?: string; projectId?: string; limit?: number }) {
    const normalized = query.trim().toLocaleLowerCase("en");
    if (!normalized) throw new Error("Context pack search query must not be empty.");
    const candidates: Array<{ pack: ValidatedContextPack; file: ContextPackFile; offset: number; text: string; searchable: string }> = [];
    for (const { pack, file } of await visiblePackFiles(options)) {
        const text = await readFile(join(pack.root, file.path), "utf8");
        for (const chunk of chunks(text)) {
            candidates.push({ pack, file, offset: chunk.offset, text: chunk.text, searchable: `${file.title}\n${file.description}\n${file.keywords.join(" ")}\n${chunk.text}` });
        }
    }
    const config = getEmbeddingConfig();
    if (config && candidates.length) {
        try {
            const cache = new EmbeddingCache(join(packBaseDir(), "cache", "embeddings.json"), config.model);
            const vectors: Array<number[] | undefined> = candidates.map((candidate) => {
                const key = `${candidate.pack.digest}:${candidate.file.sha256}:${sha256(candidate.text)}`;
                return cache.get(key, hashText(candidate.searchable));
            });
            const missing = candidates.map((candidate, index) => ({ candidate, index })).filter(({ index }) => !vectors[index]);
            const embedded = await embedTexts(config, [query, ...missing.map(({ candidate }) => candidate.searchable)]);
            if (embedded.length !== missing.length + 1) throw new Error("Embedding endpoint returned an incomplete result.");
            missing.forEach(({ candidate, index }, missingIndex) => {
                const vector = embedded[missingIndex + 1];
                vectors[index] = vector;
                cache.set(`${candidate.pack.digest}:${candidate.file.sha256}:${sha256(candidate.text)}`, hashText(candidate.searchable), vector);
            });
            cache.save();
            const results = candidates.map((candidate, index) => ({
                ...provenance(candidate.pack, candidate.file), offset: candidate.offset, text: candidate.text,
                score: cosineSimilarity(embedded[0], vectors[index] ?? []),
            })).sort((a, b) => b.score - a.score || a.pack_digest.localeCompare(b.pack_digest, "en") || a.path.localeCompare(b.path, "en") || a.offset - b.offset);
            return { schema_version: 1, query, search_mode: "embedding" as const, results: results.slice(0, options.limit ?? 20) };
        } catch {
            // Retrieval remains available when an optional embedding service fails.
        }
    }
    const results = candidates.flatMap((candidate) => {
        const occurrences = candidate.searchable.toLocaleLowerCase("en").split(normalized).length - 1;
        return occurrences ? [{ ...provenance(candidate.pack, candidate.file), offset: candidate.offset, text: candidate.text, score: occurrences }] : [];
    });
    results.sort((a, b) => b.score - a.score || a.pack_digest.localeCompare(b.pack_digest, "en") || a.path.localeCompare(b.path, "en") || a.offset - b.offset);
    return { schema_version: 1, query, search_mode: "substring" as const, results: results.slice(0, options.limit ?? 20) };
}

export async function readVisibleContext(packSelector: string, path: string, options: { projectRoot?: string; projectId?: string; offset?: number; maxBytes?: number }) {
    const normalized = normalizePackPath(path);
    const visible = await visiblePackFiles(options);
    const matches = visible.filter(({ pack, file }) => (pack.digest === packSelector || pack.digest.startsWith(packSelector) || pack.manifest.id === packSelector) && file.path === normalized);
    if (matches.length !== 1) throw new Error(matches.length ? "Context pack selector is ambiguous." : "Context pack file is not enabled or approved.");
    const { pack, file } = matches[0];
    const bytes = await readFile(join(pack.root, file.path));
    const offset = options.offset ?? 0;
    const maxBytes = options.maxBytes ?? 8192;
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 8192) throw new Error("Invalid context pack read range.");
    const slice = utf8Slice(bytes, offset, maxBytes);
    return { schema_version: 1, ...provenance(pack, file), offset, text: slice.text, next_offset: offset + slice.bytes < bytes.length ? offset + slice.bytes : null };
}

export async function doctorContextPacks(): Promise<{ ok: boolean; objects: number; projects: number; issues: string[]; temporary_remnants: string[] }> {
    const issues: string[] = [];
    const remnants: string[] = [];
    let objects = 0;
    try { objects = (await listInstalledContextPacks()).length; } catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
    const findRemnants = async (directory: string): Promise<void> => {
        if (!existsSync(directory)) return;
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if ((entry.name.startsWith(".") && entry.name.endsWith(".tmp")) || entry.name.endsWith(".lock")) remnants.push(path);
            else if (entry.isDirectory()) await findRemnants(path);
        }
    };
    await findRemnants(packBaseDir());
    const sourceDirectory = join(packBaseDir(), "sources");
    if (existsSync(sourceDirectory)) {
        const directoryInfo = lstatSync(sourceDirectory);
        if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
            issues.push("Context pack source directory is unsafe.");
        } else {
            for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
                const match = /^([a-f0-9]{64})\.json$/.exec(entry.name);
                if (!entry.isFile() || entry.isSymbolicLink() || !match) {
                    issues.push(`Invalid context pack source index entry: ${entry.name}`);
                    continue;
                }
                if (!existsSync(objectRoot(match[1]))) issues.push(`Orphaned context pack source record: ${entry.name}`);
                try { readPackSource(match[1]); } catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
            }
        }
    }
    const pointers = await allPointers().catch((error) => { issues.push(error instanceof Error ? error.message : String(error)); return []; });
    for (const { path, pointer } of pointers) {
        const packs = new Map<string, ValidatedContextPack>();
        for (const enabled of pointer.enabled) {
            if (!existsSync(objectRoot(enabled.digest))) {
                issues.push(`Stale context pack pointer: ${path} -> ${enabled.digest}`);
                continue;
            }
            try {
                const pack = await validateContextPack(objectRoot(enabled.digest));
                packs.set(enabled.digest, pack);
                if (pack.digest !== enabled.digest || pack.manifest.id !== enabled.id || pack.manifest.version !== enabled.version) {
                    issues.push(`Mismatched context pack pointer: ${path} -> ${enabled.digest}`);
                }
            } catch (error) {
                issues.push(`Invalid context pack pointer target: ${path}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        for (const approval of pointer.skill_approvals) {
            const pack = packs.get(approval.pack_digest);
            const file = pack?.manifest.files.find((entry) => entry.path === approval.path && entry.kind === "skill");
            if (!file || file.sha256 !== approval.file_digest) issues.push(`Stale context pack skill approval: ${path} -> ${approval.path}`);
        }
    }
    return { ok: issues.length === 0 && remnants.length === 0, objects, projects: pointers.length, issues, temporary_remnants: remnants };
}

export async function inspectContextPackUpdate(selector: string, options: { projectRoot?: string; projectId?: string }): Promise<{ current_digest: string; candidate_digest: string; changed: boolean; source: PackSource }> {
    const pointer = readProjectPointer(options);
    const enabled = pointer.enabled.find((entry) => entry.id === selector || entry.digest === selector || entry.digest.startsWith(selector));
    if (!enabled) throw new Error("Context pack is not enabled for this project.");
    const sourceRecord = JSON.parse(await readFile(join(packBaseDir(), "sources", `${enabled.digest}.json`), "utf8")) as { source: PackSource };
    const source = sourceRecord.source;
    const materialized = await materializeSource(source.kind === "local" ? source.path : source.url, source.kind === "git" ? source.ref : undefined);
    try {
        const candidate = await validateContextPack(materialized.root);
        return { current_digest: enabled.digest, candidate_digest: candidate.digest, changed: candidate.digest !== enabled.digest, source: materialized.source };
    } finally {
        if (materialized.cleanup) await rm(materialized.cleanup, { recursive: true, force: true });
    }
}

export async function applyContextPackUpdate(selector: string, confirm: string, options: { projectRoot?: string; projectId?: string }) {
    const check = await inspectContextPackUpdate(selector, options);
    if (confirm !== check.candidate_digest) throw new Error("Update confirmation digest does not match the inspected context pack.");
    const installed = await installContextPack(check.source.kind === "local" ? check.source.path : check.source.url, check.source.kind === "git" ? { ref: check.source.ref } : {});
    if (installed.pack.digest !== confirm) throw new Error("Context pack changed after update inspection.");
    const pointer = await enableContextPack(installed.pack.digest, options);
    return { ...check, applied: true, pointer };
}

export async function initializeContextPack(directory: string, options: { id?: string; version?: string; title?: string; description?: string; license?: string }): Promise<ContextPackManifest> {
    const root = resolve(directory);
    await mkdir(root, { recursive: true, mode: 0o700 });
    const manifestPath = join(root, CONTEXT_PACK_MANIFEST);
    if (existsSync(manifestPath)) throw new Error("Context pack manifest already exists.");
    const id = options.id ?? basename(root).toLocaleLowerCase("en").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const files = (await walkFiles(root)).filter((path) => path !== CONTEXT_PACK_MANIFEST);
    const entries: ContextPackFile[] = [];
    for (const path of files) {
        const bytes = await readFile(join(root, path));
        assertUtf8(bytes, path);
        entries.push({ path, kind: "document", title: basename(path).replace(/\.[^.]+$/, ""), description: "", keywords: [], sha256: sha256(bytes) });
    }
    const manifest = contextPackManifestSchema.parse({ schema_version: 1, id, version: options.version ?? "0.1.0", title: options.title ?? id, description: options.description ?? `Context pack ${id}`, license: options.license ?? "UNLICENSED", files: entries });
    await atomicJson(manifestPath, manifest);
    return manifest;
}

export async function lockContextPack(directory: string): Promise<ContextPackManifest> {
    const path = join(resolve(directory), CONTEXT_PACK_MANIFEST);
    const value = contextPackManifestSchema.parse(JSON.parse(await readFile(path, "utf8")) as unknown);
    const files = [];
    for (const entry of value.files) {
        const normalized = normalizePackPath(entry.path);
        const bytes = await readFile(join(resolve(directory), normalized));
        assertUtf8(bytes, normalized);
        if (bytes.byteLength > CONTEXT_PACK_MAX_FILE_BYTES) throw new Error(`Context pack file is too large: ${normalized}`);
        files.push({ ...entry, sha256: sha256(bytes) });
    }
    const locked = { ...value, files };
    await atomicJson(path, locked);
    await validateContextPack(directory);
    return locked;
}

export function contextPacksEnabled(value = process.env.CAIRN_CONTEXT_PACKS): boolean {
    return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? "");
}

export function contextPackHttpEnabled(value = process.env.CAIRN_CONTEXT_PACK_HTTP): boolean {
    return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? "");
}

export function contextPackBaseDirectory(): string { return packBaseDir(); }
