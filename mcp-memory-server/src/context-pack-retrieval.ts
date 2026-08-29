import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ContextRetrievalStrategy = "flat" | "hierarchical";
export type ContextRetrievalDetail = "abstract" | "overview" | "content";

export type ProgressiveContextFileInput = {
    pack_id: string;
    version: string;
    pack_digest: string;
    pack_title: string;
    pack_description: string;
    path: string;
    kind: "document" | "skill";
    title: string;
    description: string;
    keywords: string[];
    file_digest: string;
    text: string;
};

export type ProgressiveContextFile = ProgressiveContextFileInput & {
    abstract: string;
    overview: string;
};

export type ProgressiveDirectory = {
    type: "directory";
    path: string;
    title: string;
    abstract: string;
    overview: string;
    children: Array<ProgressiveDirectory | ProgressiveContextFile>;
};

export type ProgressivePack = {
    pack_id: string;
    version: string;
    pack_digest: string;
    title: string;
    abstract: string;
    overview: string;
    files: ProgressiveContextFile[];
    tree: ProgressiveDirectory;
};

function isDirectory(node: ProgressiveDirectory | ProgressiveContextFile): node is ProgressiveDirectory {
    return "type" in node && node.type === "directory";
}

export type RetrievalTraceEvent = {
    phase: "pack" | "directory" | "file" | "fallback";
    pack_digest?: string;
    path?: string;
    score?: number;
    reason: string;
};

const CACHE_SCHEMA_VERSION = 1;
const DERIVATION_ALGORITHM = "deterministic-progressive-v1";
const ABSTRACT_MAX_BYTES = 512;
const OVERVIEW_MAX_BYTES = 2048;
const MAX_TRACE_EVENTS = 64;
const MAX_SELECTED_FILES = 32;
const MAX_SELECTED_DIRECTORIES = 12;

function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function compact(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function boundedUtf8(value: string, maximum: number): string {
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length <= maximum) return value;
    const suffix = Buffer.from("…", "utf8");
    if (suffix.length > maximum) return "";
    let end = maximum - suffix.length;
    while (end > 0) {
        try {
            return `${new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end)).trimEnd()}…`;
        } catch {
            end -= 1;
        }
    }
    return "";
}

function fileAbstract(file: ProgressiveContextFileInput): string {
    const metadata = [file.title, file.description, file.keywords.join(", ")].map(compact).filter(Boolean);
    return boundedUtf8(metadata.join(" — "), ABSTRACT_MAX_BYTES);
}

function fileOverview(file: ProgressiveContextFileInput, abstract: string): string {
    const headings = [...file.text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => compact(match[1])).filter(Boolean);
    const paragraphs = file.text
        .split(/\n\s*\n/g)
        .map((paragraph) => compact(paragraph.replace(/^#{1,6}\s+/, "")))
        .filter(Boolean)
        .slice(0, 4);
    const pieces = [abstract, headings.length ? `Sections: ${headings.join("; ")}` : "", ...paragraphs].filter(Boolean);
    return boundedUtf8([...new Set(pieces)].join("\n"), OVERVIEW_MAX_BYTES);
}

function visibleSetDigest(files: ProgressiveContextFileInput[]): string {
    return sha256([
        DERIVATION_ALGORITHM,
        ...files.map(({ path, file_digest }) => `${path}\0${file_digest}`).sort((left, right) => left.localeCompare(right, "en")),
    ].join("\n"));
}

type CacheRecord = {
    schema_version: 1;
    algorithm: typeof DERIVATION_ALGORITHM;
    pack_digest: string;
    visible_set_digest: string;
    files: Array<Pick<ProgressiveContextFile, "path" | "file_digest" | "abstract" | "overview">>;
};

function validCache(value: unknown, packDigest: string, setDigest: string, files: ProgressiveContextFileInput[]): value is CacheRecord {
    if (!value || typeof value !== "object") return false;
    const row = value as Partial<CacheRecord>;
    if (row.schema_version !== CACHE_SCHEMA_VERSION || row.algorithm !== DERIVATION_ALGORITHM || row.pack_digest !== packDigest || row.visible_set_digest !== setDigest || !Array.isArray(row.files)) return false;
    const expected = new Map(files.map((file) => [file.path, file.file_digest]));
    return row.files.length === files.length && row.files.every((file) =>
        file && typeof file.path === "string" && expected.get(file.path) === file.file_digest
        && typeof file.abstract === "string" && Buffer.byteLength(file.abstract) <= ABSTRACT_MAX_BYTES
        && typeof file.overview === "string" && Buffer.byteLength(file.overview) <= OVERVIEW_MAX_BYTES);
}

async function writeCache(path: string, record: CacheRecord): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        try {
            await rename(temporary, path);
        } catch (error) {
            // Concurrent deterministic builders may publish the same record.
            try {
                await readFile(path);
            } catch {
                throw error;
            }
        }
    } finally {
        await rm(temporary, { force: true });
    }
}

async function enrichPackFiles(files: ProgressiveContextFileInput[], cacheBaseDirectory: string): Promise<ProgressiveContextFile[]> {
    const packDigest = files[0].pack_digest;
    const setDigest = visibleSetDigest(files);
    const cachePath = join(cacheBaseDirectory, packDigest, `${setDigest}.json`);
    let cached: CacheRecord | undefined;
    try {
        const parsed: unknown = JSON.parse(await readFile(cachePath, "utf8"));
        if (validCache(parsed, packDigest, setDigest, files)) cached = parsed;
    } catch {
        // Missing or corrupt derived data is rebuilt deterministically.
    }
    if (!cached) {
        cached = {
            schema_version: CACHE_SCHEMA_VERSION,
            algorithm: DERIVATION_ALGORITHM,
            pack_digest: packDigest,
            visible_set_digest: setDigest,
            files: files.map((file) => {
                const abstract = fileAbstract(file);
                return { path: file.path, file_digest: file.file_digest, abstract, overview: fileOverview(file, abstract) };
            }),
        };
        await writeCache(cachePath, cached);
    }
    const summaries = new Map(cached.files.map((file) => [file.path, file]));
    return files.map((file) => ({ ...file, ...summaries.get(file.path)! }));
}

type MutableDirectory = Omit<ProgressiveDirectory, "children"> & { children: Array<MutableDirectory | ProgressiveContextFile> };

function buildTree(pack: { title: string; description: string }, files: ProgressiveContextFile[]): ProgressiveDirectory {
    const root: MutableDirectory = { type: "directory", path: "", title: pack.title, abstract: "", overview: "", children: [] };
    for (const file of files) {
        const segments = file.path.split("/");
        let current = root;
        for (let index = 0; index < segments.length - 1; index += 1) {
            const path = segments.slice(0, index + 1).join("/");
            let child = current.children.find((candidate): candidate is MutableDirectory => isDirectory(candidate) && candidate.path === path);
            if (!child) {
                child = { type: "directory", path, title: segments[index], abstract: "", overview: "", children: [] };
                current.children.push(child);
            }
            current = child;
        }
        current.children.push(file);
    }
    const summarize = (directory: MutableDirectory): void => {
        for (const child of directory.children) if (isDirectory(child)) summarize(child);
        directory.children.sort((left, right) => {
            const leftDirectory = isDirectory(left);
            const rightDirectory = isDirectory(right);
            if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;
            const leftPath = leftDirectory ? left.path : left.path;
            const rightPath = rightDirectory ? right.path : right.path;
            return leftPath.localeCompare(rightPath, "en");
        });
        const childAbstracts = directory.children.map((child) => child.abstract);
        directory.abstract = boundedUtf8(`${directory.title}: ${childAbstracts.join(" | ")}`, ABSTRACT_MAX_BYTES);
        directory.overview = boundedUtf8([directory.abstract, ...directory.children.map((child) => child.overview)].join("\n"), OVERVIEW_MAX_BYTES);
    };
    summarize(root);
    root.abstract = boundedUtf8(`${pack.title}: ${pack.description} — ${root.abstract}`, ABSTRACT_MAX_BYTES);
    root.overview = boundedUtf8(`${root.abstract}\n${root.overview}`, OVERVIEW_MAX_BYTES);
    return root;
}

export async function loadProgressiveContext(files: ProgressiveContextFileInput[], cacheBaseDirectory: string): Promise<ProgressivePack[]> {
    const grouped = new Map<string, ProgressiveContextFileInput[]>();
    for (const file of files) grouped.set(file.pack_digest, [...(grouped.get(file.pack_digest) ?? []), file]);
    const packs: ProgressivePack[] = [];
    for (const [packDigest, packFiles] of grouped) {
        packFiles.sort((left, right) => left.path.localeCompare(right.path, "en"));
        const enriched = await enrichPackFiles(packFiles, cacheBaseDirectory);
        const first = packFiles[0];
        const tree = buildTree({ title: first.pack_title, description: first.pack_description }, enriched);
        packs.push({
            pack_id: first.pack_id,
            version: first.version,
            pack_digest: packDigest,
            title: first.pack_title,
            abstract: tree.abstract,
            overview: tree.overview,
            files: enriched,
            tree,
        });
    }
    return packs.sort((left, right) => left.pack_digest.localeCompare(right.pack_digest, "en"));
}

function normalizedTokens(value: string): string[] {
    return [...new Set(value.toLocaleLowerCase("en").match(/[\p{L}\p{N}._/-]+/gu) ?? [])].slice(0, 24);
}

function matchScore(query: string, text: string): number {
    const normalizedText = text.toLocaleLowerCase("en");
    let score = normalizedText.includes(query) ? 20 : 0;
    for (const token of normalizedTokens(query)) if (token.length > 1 && normalizedText.includes(token)) score += 1;
    return score;
}

export function selectHierarchicalFiles(query: string, packs: ProgressivePack[]): {
    files: ProgressiveContextFile[];
    exactLeafBypass: boolean;
    events: RetrievalTraceEvent[];
} {
    const normalized = query.trim().toLocaleLowerCase("en");
    const allFiles = packs.flatMap((pack) => pack.files);
    const exact = allFiles.filter((file) => file.path.toLocaleLowerCase("en") === normalized || file.title.toLocaleLowerCase("en") === normalized);
    if (exact.length) {
        return {
            files: exact.slice(0, MAX_SELECTED_FILES),
            exactLeafBypass: true,
            events: exact.slice(0, MAX_TRACE_EVENTS).map((file) => ({ phase: "file", pack_digest: file.pack_digest, path: file.path, score: 100, reason: "exact-leaf-bypass" })),
        };
    }
    const events: RetrievalTraceEvent[] = [];
    const rankedPacks = packs.map((pack) => ({ pack, score: matchScore(normalized, `${pack.title}\n${pack.abstract}\n${pack.overview}`) }))
        .sort((left, right) => right.score - left.score || left.pack.pack_digest.localeCompare(right.pack.pack_digest, "en"));
    for (const { pack, score } of rankedPacks.slice(0, MAX_TRACE_EVENTS)) {
        events.push({ phase: "pack", pack_digest: pack.pack_digest, score, reason: score ? "summary-match" : "summary-miss" });
    }
    const matchingPackDigests = new Set(rankedPacks.filter(({ score }) => score > 0).map(({ pack }) => pack.pack_digest));
    const packCandidates = matchingPackDigests.size ? allFiles.filter((file) => matchingPackDigests.has(file.pack_digest)) : allFiles;

    const directories: Array<{ pack_digest: string; node: ProgressiveDirectory; score: number }> = [];
    const visit = (packDigest: string, node: ProgressiveDirectory): void => {
        if (node.path) directories.push({ pack_digest: packDigest, node, score: matchScore(normalized, `${node.path}\n${node.abstract}\n${node.overview}`) });
        for (const child of node.children) if (isDirectory(child)) visit(packDigest, child);
    };
    for (const pack of rankedPacks.map(({ pack }) => pack)) {
        if (!matchingPackDigests.size || matchingPackDigests.has(pack.pack_digest)) visit(pack.pack_digest, pack.tree);
    }
    directories.sort((left, right) => right.score - left.score || left.pack_digest.localeCompare(right.pack_digest, "en") || left.node.path.localeCompare(right.node.path, "en"));
    const selectedDirectories = directories.filter(({ score }) => score > 0).slice(0, MAX_SELECTED_DIRECTORIES);
    for (const { pack_digest, node, score } of selectedDirectories) {
        if (events.length >= MAX_TRACE_EVENTS) break;
        events.push({ phase: "directory", pack_digest, path: node.path, score, reason: "selected-summary-match" });
    }
    const directoryCandidates = selectedDirectories.length
        ? packCandidates.filter((file) => selectedDirectories.some(({ pack_digest, node }) => file.pack_digest === pack_digest && (file.path === node.path || file.path.startsWith(`${node.path}/`))))
        : packCandidates;
    const ranked = directoryCandidates.map((file) => ({ file, score: matchScore(normalized, `${file.path}\n${file.abstract}\n${file.overview}`) }))
        .sort((left, right) => right.score - left.score || left.file.pack_digest.localeCompare(right.file.pack_digest, "en") || left.file.path.localeCompare(right.file.path, "en"));
    let selected = ranked.filter(({ score }) => score > 0).slice(0, MAX_SELECTED_FILES);
    if (!selected.length) {
        selected = ranked.slice(0, MAX_SELECTED_FILES);
        events.push({ phase: "fallback", reason: "no-summary-match" });
    }
    for (const { file, score } of selected) {
        if (events.length >= MAX_TRACE_EVENTS) break;
        events.push({ phase: "file", pack_digest: file.pack_digest, path: file.path, score, reason: score ? "selected-summary-match" : "selected-fallback" });
    }
    return { files: selected.map(({ file }) => file), exactLeafBypass: false, events: events.slice(0, MAX_TRACE_EVENTS) };
}

export function publicTree(pack: ProgressivePack, detail: Exclude<ContextRetrievalDetail, "content">): Record<string, unknown> {
    const project = (node: ProgressiveDirectory | ProgressiveContextFile): Record<string, unknown> => {
        if (isDirectory(node)) {
            return { type: "directory", path: node.path, title: node.title, [detail]: node[detail], children: node.children.map(project) };
        }
        return {
            type: "file",
            pack_id: node.pack_id,
            version: node.version,
            pack_digest: node.pack_digest,
            path: node.path,
            kind: node.kind,
            file_digest: node.file_digest,
            title: node.title,
            [detail]: node[detail],
        };
    };
    return {
        pack_id: pack.pack_id,
        version: pack.version,
        pack_digest: pack.pack_digest,
        title: pack.title,
        [detail]: pack[detail],
        tree: project(pack.tree),
    };
}

const CACHE_DIGEST = /^[a-f0-9]{64}$/;
const CACHE_RECORD_MAX_BYTES = 4 * 1024 * 1024;
const CACHE_MAX_FILES = 1024;

export type ProgressiveContextCachePack = {
    pack_digest: string;
    files: ProgressiveContextFileInput[];
};

export type ProgressiveContextCacheDoctorResult = {
    ok: boolean;
    issues: string[];
    temporary_remnants: string[];
    repaired: string[];
};

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
    const actual = Object.keys(value).sort((left, right) => left.localeCompare(right, "en"));
    const wanted = [...expected].sort((left, right) => left.localeCompare(right, "en"));
    return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function safeCachedPath(value: string): boolean {
    return value.length > 0
        && !value.includes("\\")
        && !value.startsWith("/")
        && !value.split("/").some((part) => part === "" || part === "." || part === "..");
}

function validateCacheRecord(
    value: unknown,
    directoryDigest: string,
    fileDigest: string,
    installedFiles: ReadonlyMap<string, ProgressiveContextFileInput>,
): string | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "record is not an object";
    const record = value as Record<string, unknown>;
    if (!exactKeys(record, ["schema_version", "algorithm", "pack_digest", "visible_set_digest", "files"])) return "record has unknown or missing fields";
    if (record.schema_version !== 1 || record.algorithm !== DERIVATION_ALGORITHM || record.pack_digest !== directoryDigest || record.visible_set_digest !== fileDigest) return "record identity or algorithm does not match its path";
    if (!Array.isArray(record.files) || record.files.length > CACHE_MAX_FILES) return "record files are invalid or oversized";

    const seen = new Set<string>();
    const visibleFiles: ProgressiveContextFileInput[] = [];
    for (const value of record.files) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return "record contains a non-object file";
        const file = value as Record<string, unknown>;
        if (!exactKeys(file, ["path", "file_digest", "abstract", "overview"])) return "record file has unknown or missing fields";
        if (typeof file.path !== "string" || !safeCachedPath(file.path) || seen.has(file.path)) return "record contains an unsafe or duplicate path";
        if (typeof file.file_digest !== "string" || !CACHE_DIGEST.test(file.file_digest)) return "record contains an invalid file digest";
        const source = installedFiles.get(file.path);
        if (!source || source.file_digest !== file.file_digest) return "record is not bound to installed pack content";
        if (typeof file.abstract !== "string" || Buffer.byteLength(file.abstract, "utf8") > ABSTRACT_MAX_BYTES) return "record abstract is invalid or oversized";
        if (typeof file.overview !== "string" || Buffer.byteLength(file.overview, "utf8") > OVERVIEW_MAX_BYTES) return "record overview is invalid or oversized";
        const expectedAbstract = fileAbstract(source);
        if (file.abstract !== expectedAbstract || file.overview !== fileOverview(source, expectedAbstract)) return "record summaries do not match immutable pack content";
        seen.add(file.path);
        visibleFiles.push({ pack_digest: directoryDigest, path: file.path, file_digest: file.file_digest } as ProgressiveContextFileInput);
    }
    if (visibleSetDigest(visibleFiles) !== fileDigest) return "record visibility digest does not match its file set";
    return null;
}

/**
 * Validate the mutable, derived progressive-context cache. Cached records are
 * addressed by both immutable pack digest and the exact visible file set, so a
 * revoked skill can never be loaded through a document-only cache key.
 *
 * Repair is intentionally limited to deleting invalid derived entries. The
 * next hierarchical read deterministically rebuilds them from immutable pack
 * objects and the current project pointer.
 */
export async function doctorProgressiveContextCache(
    cacheBaseDirectory: string,
    packs: ProgressiveContextCachePack[],
    options: { repair?: boolean } = {},
): Promise<ProgressiveContextCacheDoctorResult> {
    const issues: string[] = [];
    const temporaryRemnants: string[] = [];
    const repaired: string[] = [];
    const installed = new Map(packs.map((pack) => [
        pack.pack_digest,
        new Map(pack.files.map((file) => [file.path, file])),
    ]));

    const removeDerived = async (path: string, label: string): Promise<void> => {
        if (!options.repair) return;
        await rm(path, { recursive: true, force: true });
        repaired.push(label);
    };

    let rootInfo;
    try {
        rootInfo = await lstat(cacheBaseDirectory);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return { ok: true, issues, temporary_remnants: temporaryRemnants, repaired };
        }
        issues.push(`Unable to inspect progressive context cache: ${error instanceof Error ? error.message : String(error)}`);
        return { ok: false, issues, temporary_remnants: temporaryRemnants, repaired };
    }
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
        issues.push("Progressive context cache root is not a regular directory.");
        await removeDerived(cacheBaseDirectory, "cache/context");
        if (options.repair) issues.length = 0;
        return { ok: issues.length === 0, issues, temporary_remnants: temporaryRemnants, repaired };
    }

    for (const packEntry of (await readdir(cacheBaseDirectory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
        const packPath = join(cacheBaseDirectory, packEntry.name);
        const packInfo = await lstat(packPath);
        if (packEntry.name.endsWith(".tmp")) {
            temporaryRemnants.push(`cache/context/${packEntry.name}`);
            await removeDerived(packPath, `cache/context/${packEntry.name}`);
            continue;
        }
        const installedFiles = installed.get(packEntry.name);
        if (!CACHE_DIGEST.test(packEntry.name) || !packInfo.isDirectory() || packInfo.isSymbolicLink() || !installedFiles) {
            issues.push(`Invalid progressive context cache pack entry: ${packEntry.name}`);
            await removeDerived(packPath, `cache/context/${packEntry.name}`);
            continue;
        }

        for (const cacheEntry of (await readdir(packPath, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name, "en"))) {
            const cachePath = join(packPath, cacheEntry.name);
            const relative = `cache/context/${packEntry.name}/${cacheEntry.name}`;
            const cacheInfo = await lstat(cachePath);
            if (cacheEntry.name.endsWith(".tmp")) {
                temporaryRemnants.push(relative);
                await removeDerived(cachePath, relative);
                continue;
            }
            const match = /^([a-f0-9]{64})\.json$/.exec(cacheEntry.name);
            if (!match || !cacheInfo.isFile() || cacheInfo.isSymbolicLink() || cacheInfo.size > CACHE_RECORD_MAX_BYTES) {
                issues.push(`Invalid progressive context cache entry: ${relative}`);
                await removeDerived(cachePath, relative);
                continue;
            }
            try {
                const value = JSON.parse(await readFile(cachePath, "utf8")) as unknown;
                const invalid = validateCacheRecord(value, packEntry.name, match[1], installedFiles);
                if (invalid) throw new Error(invalid);
            } catch (error) {
                issues.push(`Invalid progressive context cache record: ${relative}: ${error instanceof Error ? error.message : String(error)}`);
                await removeDerived(cachePath, relative);
            }
        }
    }

    if (options.repair) {
        issues.length = 0;
        temporaryRemnants.length = 0;
    }
    return { ok: issues.length === 0 && temporaryRemnants.length === 0, issues, temporary_remnants: temporaryRemnants, repaired };
}
