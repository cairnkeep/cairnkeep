import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";

import { parseDocument, stringify } from "yaml";
import { z } from "zod";
import { portablePathCollisionKey, portableRelativePathIssue } from "./path-security.js";

import { hardenPrivatePath } from "./platform-security.js";
import { readSharedNoteForExport, type SharedNoteExport } from "./note-store.js";
import { redactLocalValue } from "./trajectory-redaction.js";
import { readStableFile } from "./stable-file.js";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ENTRIES = 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_FRONTMATTER_BYTES = 64 * 1024;
const DIGEST = /^[a-f0-9]{64}$/;
const RESERVED = new Set(["index.md", "log.md"]);

function optionalValue<T extends z.ZodTypeAny>(schema: T) {
    return z.preprocess((value) => value === null || value === "" || (Array.isArray(value) && !value.length) ? undefined : value, schema.optional());
}

function optionalList<T extends z.ZodTypeAny>(schema: T, maximum: number) {
    return optionalValue(z.preprocess((value) => Array.isArray(value) ? value : [value], z.array(schema).max(maximum)));
}

const optionalText = (maximum: number) => optionalValue(z.string().min(1).max(maximum));
const windowSchema = z.object({ from: optionalText(128), to: optionalText(128) }).passthrough();
const sourceSchema = z.object({
    resource: optionalText(4096),
    id: optionalText(256),
    title: optionalText(1024),
    author: optionalText(256),
    usage_count: optionalValue(z.number().nonnegative().finite()),
    last_modified: optionalText(128),
    usage_window: optionalValue(windowSchema),
}).passthrough();
const actorEventSchema = z.object({
    by: optionalText(256),
    at: optionalText(128),
}).passthrough();
const frontmatterSchema = z.object({
    type: z.string().min(1).max(256),
    title: optionalText(1024),
    description: optionalText(4096),
    resource: optionalText(4096),
    tags: optionalList(z.string().min(1).max(128), 64),
    sources: optionalList(sourceSchema, 64),
    usage_window: optionalValue(windowSchema),
    generated: optionalValue(actorEventSchema),
    verified: optionalList(actorEventSchema, 64),
    status: optionalText(256),
    stale_after: optionalText(128),
    timestamp: optionalText(128),
}).passthrough();

export type OkfDiagnostic = {
    severity: "warning";
    code: "broken-link" | "deprecated" | "missing-description" | "missing-sources" | "stale" | "unverified" | "unsupported-version" | "ignored-file" | "invalid-metadata" | "unknown-status";
    path: string;
    message: string;
    target?: string;
};

export type OkfConcept = {
    concept_id: string;
    type: string;
    title: string;
    description: string | null;
    resource: string | null;
    tags: string[];
    sources: Array<Record<string, unknown>>;
    generated: ({ by: string; at?: string } & Record<string, unknown>) | null;
    verified: Array<{ by: string; at: string } & Record<string, unknown>>;
    trust_tier: "unverified" | "machine-confirmed" | "human-reviewed";
    status: string;
    stale_after: string | null;
    stale: boolean;
    timestamp: string | null;
    metadata: Record<string, unknown>;
};

export type OkfIndexedFile = {
    path: string;
    role: "concept" | "index" | "log" | "reference";
    sha256: string;
    bytes: number;
    title: string;
    description: string;
    keywords: string[];
    concept: OkfConcept | null;
    outbound: string[];
    broken_links: string[];
};

export type OkfIndex = {
    schema_version: 1;
    version: string;
    files: OkfIndexedFile[];
    diagnostics: OkfDiagnostic[];
};

export type ValidatedOkfBundle = OkfIndex & {
    root: string;
    concepts: OkfConcept[];
    total_bytes: number;
};
const okfIndexContent = new WeakMap<OkfIndex, ReadonlyMap<string, Buffer>>();
const validatedOkfContent = new WeakMap<ValidatedOkfBundle, ReadonlyMap<string, Buffer>>();

export type OkfExportOptions = {
    projectRoot: string;
    outputDirectory: string;
    files: string[];
    noteIds?: string[];
};

export type OkfExportPlan = {
    schema_version: 1;
    okf_version: "0.2";
    confirmation_digest: string;
    project_digest: string;
    output_files: Array<{
        kind: "file" | "shared-note" | "index";
        source: string;
        path: string;
        source_digest: string;
        output_digest: string;
    }>;
    redaction_replacements: number;
};

type ParsedFrontmatter = { value: Record<string, unknown>; body: string };
type ExportMaterial = { plan: OkfExportPlan; content: Map<string, string> };

function sha256(value: string | Buffer): string {
    return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b, "en"))
            .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

function normalizedPath(value: string): string {
    if (portableRelativePathIssue(value)) {
        throw new Error(`Unsafe OKF path: ${value}`);
    }
    return value;
}

function contained(root: string, candidate: string): boolean {
    const rel = relative(root, candidate);
    return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function utf8(bytes: Buffer, path: string): string {
    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        throw new Error(`OKF file is not UTF-8: ${path}`);
    }
    if (Buffer.from(text, "utf8").compare(bytes) !== 0) throw new Error(`OKF file is not canonical UTF-8: ${path}`);
    return text;
}

type PhysicalOkfFile = { path: string; raw_path: string };

async function walk(root: string, directory = root): Promise<PhysicalOkfFile[]> {
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("OKF bundles may not contain symlink directories.");
    const files: PhysicalOkfFile[] = [];
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
        if (directory === root && entry.name === ".git") {
            if (entry.isSymbolicLink()) throw new Error("OKF repository metadata may not be a symlink.");
            if (entry.isDirectory() || entry.isFile()) continue;
        }
        if (entry.name.startsWith(".")) continue;
        const absolute = join(directory, entry.name);
        const rawPath = relative(root, absolute).split(sep).join("/");
        const path = rawPath.normalize("NFC");
        if (entry.isSymbolicLink()) throw new Error(`OKF bundles may not contain symlinks: ${path}`);
        if (entry.isDirectory()) files.push(...await walk(root, absolute));
        else if (entry.isFile()) files.push({ path: normalizedPath(path), raw_path: rawPath });
        else throw new Error(`OKF bundles may contain regular files only: ${path}`);
        if (files.length > MAX_ENTRIES) throw new Error("OKF bundle exceeds the entry limit.");
    }
    return files;
}

function parseFrontmatter(text: string, path: string, required: boolean): ParsedFrontmatter | null {
    const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
    if (!match) {
        if (required) throw new Error(`OKF concept requires YAML frontmatter with a type: ${path}`);
        return null;
    }
    if (Buffer.byteLength(match[1], "utf8") > MAX_FRONTMATTER_BYTES) throw new Error(`OKF frontmatter is too large: ${path}`);
    const document = parseDocument(match[1], { prettyErrors: false, strict: true, uniqueKeys: true });
    if (document.errors.length) throw new Error(`Invalid OKF YAML frontmatter in ${path}: ${document.errors[0].message}`);
    let value: unknown;
    try {
        value = document.toJS({ maxAliasCount: 0 });
    } catch (error) {
        throw new Error(`OKF YAML aliases are not allowed in ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`OKF frontmatter must be a mapping: ${path}`);
    return { value: value as Record<string, unknown>, body: text.slice(match[0].length) };
}

function titleFrom(path: string, body: string): string {
    const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
    if (heading) return heading.slice(0, 1024);
    return basename(path, extname(path)).replace(/[-_]+/g, " ").replace(/\b\w/g, (value) => value.toUpperCase()).slice(0, 1024);
}

// Parse only absolute RFC 3339 instants. Date.parse alone normalizes impossible
// calendar dates and accepts zone-less timestamps using the machine's timezone.
function timestampMillis(value: string | undefined): number | null {
    if (!value) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:\d{2}))?$/.exec(value);
    if (!match) return null;
    const [, year, month, day, hour, minute, second, zone] = match;
    const y = Number(year), m = Number(month), d = Number(day);
    const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (m < 1 || m > 12 || d < 1 || d > days[m - 1]) return null;
    if (hour && (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59)) return null;
    if (zone && zone !== "Z" && zone !== "z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return null;
    const instant = Date.parse(hour ? value : `${value}T00:00:00Z`);
    return Number.isFinite(instant) ? instant : null;
}

export function okfStale(staleAfter: string | null, now = Date.now()): boolean {
    if (!staleAfter) return false;
    const deadline = timestampMillis(staleAfter);
    return deadline === null || now > deadline || (now === deadline && !/[1-9]/.test(submillisecondDigits(staleAfter)));
}

function submillisecondDigits(value: string): string {
    // Metadata strings are capped at 128 bytes. Preserve RFC 3339 precision
    // beyond Date.parse's milliseconds rather than rounding an older review up.
    return (/\.(\d+)/.exec(value)?.[1] ?? "").slice(3).padEnd(128, "0");
}

function timestampAtOrAfter(candidate: string, reference: string | undefined): boolean {
    const candidateMillis = timestampMillis(candidate), referenceMillis = timestampMillis(reference);
    return candidateMillis !== null && referenceMillis !== null && (candidateMillis > referenceMillis
        || (candidateMillis === referenceMillis && submillisecondDigits(candidate) >= submillisecondDigits(reference!)));
}

function conceptFrom(path: string, parsed: ParsedFrontmatter): OkfConcept {
    const value = frontmatterSchema.parse(parsed.value);
    const verified = (value.verified ?? []).filter((event): event is { by: string; at: string } & Record<string, unknown> => Boolean(event.by && event.at && timestampMillis(event.at) !== null));
    const current = verified.filter(({ at }) => !value.generated || timestampAtOrAfter(at, value.generated.at));
    const trustTier = current.some(({ by }) => by.startsWith("human:") && by.length > "human:".length)
        ? "human-reviewed" as const
        : current.length ? "machine-confirmed" as const : "unverified" as const;
    return {
        concept_id: path.slice(0, -3),
        type: value.type,
        title: value.title ?? titleFrom(path, parsed.body),
        description: value.description ?? null,
        resource: value.resource ?? null,
        tags: value.tags ?? [],
        sources: (value.sources ?? []).filter(({ resource }) => Boolean(resource)) as Array<Record<string, unknown>>,
        generated: value.generated?.by ? { ...value.generated, by: value.generated.by } : null,
        verified,
        trust_tier: trustTier,
        status: value.status ?? "stable",
        stale_after: value.stale_after ?? null,
        stale: okfStale(value.stale_after ?? null),
        timestamp: value.timestamp ?? null,
        metadata: parsed.value,
    };
}

function localLinkTarget(from: string, raw: string): string | null {
    if (raw.length > 4096) return "!unsafe-path";
    const trimmed = raw.trim();
    const titleStart = trimmed.search(/\s["']/);
    const withoutTitle = titleStart >= 0 && /["']$/.test(trimmed) ? trimmed.slice(0, titleStart).trimEnd() : trimmed;
    const withoutFragment = withoutTitle.split("#", 1)[0].split("?", 1)[0];
    if (!withoutFragment || withoutFragment.startsWith("#") || withoutFragment.startsWith("//")
        || /^[a-z][a-z0-9+.-]*:/i.test(withoutFragment)) return null;
    let decoded: string;
    try {
        decoded = decodeURIComponent(withoutFragment);
    } catch {
        return "!invalid-uri";
    }
    if (decoded.includes("\\")) return "!unsafe-path";
    const joined = decoded.startsWith("/") ? decoded.slice(1) : posix.join(posix.dirname(from), decoded);
    const normalized = posix.normalize(joined);
    if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../") || normalized.startsWith("/")) return "!unsafe-path";
    return normalized.endsWith("/") ? `${normalized}index.md` : normalized;
}

function markdownLinks(text: string, from: string): string[] {
    const links: string[] = [];
    for (const match of text.matchAll(/!?\[[^\[\]\n]*\]\(([^()[\]\n]+)\)/g)) {
        const target = localLinkTarget(from, match[1]);
        if (target) links.push(target);
    }
    const label = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
    const definitions = new Map<string, string>();
    for (const match of text.matchAll(/^ {0,3}\[([^\[\]\n]+)\]:[ \t]*(?:<([^>\n]+)>|(\S+))/gm)) {
        if (!match[1].startsWith("^") && !definitions.has(label(match[1]))) definitions.set(label(match[1]), match[2] ?? match[3]);
    }
    for (const match of text.matchAll(/!?\[([^\[\]\n]+)\](?:\[([^\[\]\n]*)\])?/g)) {
        // An inline link or an unused definition is not a reference use.
        const next = text[(match.index ?? 0) + match[0].length];
        if (next === "(" || next === ":") continue;
        const raw = definitions.get(label(match[2] || match[1]));
        const target = raw ? localLinkTarget(from, raw) : null;
        if (target) links.push(target);
    }
    return [...new Set(links)].sort((a, b) => a.localeCompare(b, "en"));
}

function frontmatterLinks(value: Record<string, unknown>, from: string, version: string, existing: Set<string>): string[] {
    const candidates: unknown[] = [value.resource, value.computation, ...(value.status === "deprecated" ? [value.superseded_by] : [])];
    if (value.sources) {
        for (const source of Array.isArray(value.sources) ? value.sources : [value.sources]) {
            if (source && typeof source === "object" && !Array.isArray(source)) candidates.push((source as Record<string, unknown>).resource);
        }
    }
    for (const key of ["executor", "attester"] as const) {
        const entry = value[key];
        if (entry && typeof entry === "object" && !Array.isArray(entry)) candidates.push((entry as Record<string, unknown>).resource);
    }
    const links: string[] = [];
    for (const candidate of candidates) {
        if (typeof candidate !== "string" || /\s/.test(candidate)) continue;
        let target = localLinkTarget(from, candidate);
        if (target && !target.startsWith("!") && !existing.has(target) && !candidate.startsWith("/") && (!version || /^0\.[12]$/.test(version))) {
            const fallback = localLinkTarget("index.md", candidate);
            if (fallback && existing.has(fallback)) target = fallback;
        }
        if (target) links.push(target);
    }
    return [...new Set(links)].sort((a, b) => a.localeCompare(b, "en"));
}

function diagnosticsFor(path: string, concept: OkfConcept): OkfDiagnostic[] {
    const diagnostics: OkfDiagnostic[] = [];
    if (!concept.description) diagnostics.push({ severity: "warning", code: "missing-description", path, message: "Concept has no description." });
    if (!concept.sources.length) diagnostics.push({ severity: "warning", code: "missing-sources", path, message: "Concept declares no sources." });
    if (concept.trust_tier === "unverified") diagnostics.push({ severity: "warning", code: "unverified", path, message: "Concept has no current valid verification." });
    if (!["draft", "stable", "deprecated"].includes(concept.status)) diagnostics.push({ severity: "warning", code: "unknown-status", path, message: "Unknown lifecycle status is preserved, not treated as stable." });
    if (concept.stale_after && timestampMillis(concept.stale_after) === null) diagnostics.push({ severity: "warning", code: "invalid-metadata", path, message: "Malformed stale_after is not fresh." });
    const metadata = concept.metadata;
    if (metadata.verified && (Array.isArray(metadata.verified) ? metadata.verified.length : 1) !== concept.verified.length) diagnostics.push({ severity: "warning", code: "invalid-metadata", path, message: "Incomplete or malformed verification events were ignored; original metadata is retained." });
    if (concept.status === "deprecated") diagnostics.push({ severity: "warning", code: "deprecated", path, message: "Concept is deprecated." });
    if (concept.stale) diagnostics.push({ severity: "warning", code: "stale", path, message: `Concept became stale on ${concept.stale_after}.` });
    return diagnostics;
}

export async function indexOkfBundle(directory: string, selectedPaths?: string[], declaredVersion?: string): Promise<OkfIndex> {
    const requested = resolve(directory);
    const requestedInfo = lstatSync(requested);
    if (!requestedInfo.isDirectory() || requestedInfo.isSymbolicLink()) throw new Error("OKF source must be a real directory.");
    const root = requested;
    const entries = selectedPaths
        ? selectedPaths.map(normalizedPath).filter((path) => !path.split("/").some((part) => part.startsWith("."))).sort((a, b) => a.localeCompare(b, "en")).map((path) => ({ path, raw_path: path }))
        : await walk(root);
    if (entries.length > MAX_ENTRIES) throw new Error("OKF bundle exceeds the entry limit.");
    const portablePaths = new Set<string>();
    for (const entry of entries) {
        const key = portablePathCollisionKey(entry.path);
        if (portablePaths.has(key)) throw new Error(`Duplicate portable OKF path: ${entry.path}`);
        portablePaths.add(key);
    }
    const paths = entries.map(({ path }) => path);
    const existing = new Set(paths);
    const files: OkfIndexedFile[] = [];
    const content = new Map<string, Buffer>();
    const diagnostics: OkfDiagnostic[] = [];
    let version = declaredVersion ?? "";
    let sawV02 = false;
    let totalBytes = 0;
    // Read once, then interpret. Root version must be known before resolving any
    // concept's legacy path fields, regardless of directory sorting order.
    for (const entry of entries) {
        const path = entry.path;
        const absolute = resolve(root, ...entry.raw_path.split("/"));
        if (!contained(root, absolute)) throw new Error(`Unsafe OKF path: ${path}`);
        const { bytes } = readStableFile(absolute, { label: "OKF file", maxBytes: MAX_FILE_BYTES });
        content.set(path, bytes);
        totalBytes += bytes.length;
        if (totalBytes > MAX_TOTAL_BYTES) throw new Error("OKF bundle exceeds the total size limit.");
    }
    const parsedFiles = new Map<string, ParsedFrontmatter | null>();
    for (const { path } of entries) {
        if (extname(path).toLowerCase() !== ".md") continue;
        const parsed = parseFrontmatter(utf8(content.get(path)!, path), path, false);
        parsedFiles.set(path, parsed);
        if (!RESERVED.has(basename(path)) && (!parsed || typeof parsed.value.type !== "string" || !parsed.value.type.trim())) existing.delete(path);
    }
    const bundleMetadata = parsedFiles.get("index.md")?.value;
    if (bundleMetadata) {
        const metadata = z.object({ okf_version: optionalText(128), title: optionalText(1024), description: optionalText(4096), license: optionalText(1024) }).passthrough().parse(bundleMetadata);
        if (metadata.okf_version && declaredVersion && metadata.okf_version !== declaredVersion) throw new Error("OKF bundle version does not match its pinned manifest.");
        version = metadata.okf_version ?? version;
    }
    for (const entry of entries) {
        const path = entry.path;
        const bytes = content.get(path)!;
        const text = utf8(bytes, path);
        const name = basename(path);
        const markdown = extname(path).toLowerCase() === ".md";
        const role = !markdown ? "reference" as const : name === "index.md" ? "index" as const : name === "log.md" ? "log" as const : "concept" as const;
        const parsed = parsedFiles.get(path) ?? null;
        if (role === "index" && parsed) {
            if (path !== "index.md") throw new Error(`Only the root OKF index may contain frontmatter: ${path}`);
        }
        if (role === "log" && parsed) throw new Error(`OKF log files may not contain frontmatter: ${path}`);
        if (role === "concept" && (!parsed || typeof parsed.value.type !== "string" || !parsed.value.type.trim())) {
            diagnostics.push({ severity: "warning", code: "ignored-file", path, message: "Markdown without a non-empty concept type is excluded from context." });
            continue;
        }
        const concept = role === "concept" && parsed ? conceptFrom(path, parsed) : null;
        if (concept && (concept.generated || concept.verified.length || concept.stale_after || concept.sources.length || concept.status !== "stable")) sawV02 = true;
        if (concept) diagnostics.push(...diagnosticsFor(path, concept));
        const body = parsed?.body ?? text;
        const requestedLinks = [...new Set([
            ...markdownLinks(body, path),
            ...(parsed ? frontmatterLinks(parsed.value, path, version, existing) : []),
        ])].sort((a, b) => a.localeCompare(b, "en"));
        const outbound: string[] = [];
        const broken: string[] = [];
        for (const target of requestedLinks) {
            if (target.startsWith("!") || !existing.has(target)) {
                broken.push(target);
                diagnostics.push({ severity: "warning", code: "broken-link", path, target, message: `Link target is not present in the bundle: ${target}` });
            } else if (!RESERVED.has(basename(target))) outbound.push(target);
        }
        files.push({
            path, role, sha256: sha256(bytes), bytes: bytes.byteLength,
            title: concept?.title ?? (path === "index.md" && typeof bundleMetadata?.title === "string" && bundleMetadata.title ? bundleMetadata.title : titleFrom(path, body)),
            description: concept?.description ?? (path === "index.md" && typeof bundleMetadata?.description === "string" && bundleMetadata.description ? bundleMetadata.description : `${role[0].toUpperCase()}${role.slice(1)} file from an Open Knowledge Format bundle.`),
            keywords: concept?.tags ?? [], concept,
            outbound: [...new Set(outbound)].sort((a, b) => a.localeCompare(b, "en")),
            broken_links: broken,
        });
    }
    if (!version) version = sawV02 ? "0.2" : "0.1";
    if (!/^0\.[123]$/.test(version)) diagnostics.unshift({ severity: "warning", code: "unsupported-version", path: "index.md", message: `OKF version ${version} is not explicitly supported; consumed on a best-effort basis.` });
    const index = { schema_version: 1 as const, version, files, diagnostics };
    okfIndexContent.set(index, content);
    return index;
}

export async function validateOkfBundle(directory: string): Promise<ValidatedOkfBundle> {
    const root = resolve(directory);
    const index = await indexOkfBundle(root);
    const totalBytes = index.files.reduce((sum, file) => sum + file.bytes, 0);
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("OKF bundle exceeds the total size limit.");
    const bundle = { ...index, root, concepts: index.files.flatMap((file) => file.concept ? [file.concept] : []), total_bytes: totalBytes };
    validatedOkfContent.set(bundle, okfIndexContent.get(index) ?? new Map());
    return bundle;
}

export function validatedOkfFileContent(bundle: ValidatedOkfBundle, path: string): Buffer {
    const bytes = validatedOkfContent.get(bundle)?.get(path);
    if (!bytes) throw new Error(`Validated OKF bytes are unavailable: ${path}`);
    return bytes;
}

function normalizeExportSource(value: string): string {
    const path = normalizedPath(value.replaceAll("\\", "/"));
    const parts = path.split("/");
    if ([".agentfs", ".ai", ".git", "node_modules"].includes(parts[0])
        || (parts[0] === ".planning" && parts[1] !== "wiki")) {
        throw new Error(`Private or sensitive project path cannot be exported: ${path}`);
    }
    if (extname(path).toLowerCase() !== ".md") throw new Error(`OKF export accepts explicit Markdown files only: ${path}`);
    if (RESERVED.has(basename(path))) throw new Error(`Reserved OKF filenames cannot be exported as concepts: ${path}`);
    return path;
}

function exportTarget(source: string): string {
    return source.startsWith(".planning/wiki/") ? `wiki/${source.slice(".planning/wiki/".length)}` : source;
}

function exportDescription(content: string): string {
    const paragraph = content.split(/\n\s*\n/).map((value) => value.trim()).find((value) => value && !value.startsWith("#"));
    return (paragraph ?? "Explicitly selected reviewed project knowledge.").replace(/\s+/g, " ").slice(0, 512);
}

function renderConcept(path: string, content: string, kind: "file" | "shared-note", note?: SharedNoteExport): string {
    const frontmatter = stringify({
        type: kind === "shared-note" ? "Cairnkeep Shared Note" : "Cairnkeep Reference",
        title: note?.title ?? titleFrom(path, content),
        description: note?.description ?? exportDescription(content),
        tags: [...new Set(["cairnkeep", kind === "shared-note" ? "shared-note" : "reviewed-export", ...(note?.tags ?? [])])].sort(),
        generated: { by: "process:cairnkeep-export" },
        ...(note ? { verified: { by: "process:cairnkeep-promotion", at: note.updated_at } } : {}),
    }).trimEnd();
    return `---\n${frontmatter}\n---\n${content.startsWith("\n") ? "" : "\n"}${content}`;
}

async function exportMaterial(options: OkfExportOptions): Promise<ExportMaterial> {
    const projectRoot = resolve(options.projectRoot);
    const info = lstatSync(projectRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("OKF export project must be a real directory.");
    const requested = [...new Set(options.files.map(normalizeExportSource))].sort((a, b) => a.localeCompare(b, "en"));
    const noteIds = [...new Set(options.noteIds ?? [])].sort((a, b) => a.localeCompare(b, "en"));
    if (!requested.length && !noteIds.length) throw new Error("OKF export requires at least one explicit --file or --note selection.");
    const content = new Map<string, string>();
    const rows: OkfExportPlan["output_files"] = [];
    let replacements = 0;
    for (const source of requested) {
        const absolute = resolve(projectRoot, ...source.split("/"));
        if (!contained(projectRoot, absolute)) throw new Error(`Unsafe OKF export source: ${source}`);
        const { bytes } = readStableFile(absolute, { label: "OKF export source", maxBytes: MAX_FILE_BYTES });
        const text = utf8(bytes, source);
        const redacted = redactLocalValue(text, projectRoot);
        replacements += redacted.replacement_count;
        const target = normalizedPath(exportTarget(source));
        if (content.has(target)) throw new Error(`Multiple OKF export selections map to ${target}.`);
        const rendered = renderConcept(target, redacted.value, "file");
        content.set(target, rendered);
        rows.push({ kind: "file", source, path: target, source_digest: sha256(bytes), output_digest: sha256(rendered) });
    }
    for (const noteId of noteIds) {
        if (!/^[a-z0-9][a-z0-9-]{0,255}$/.test(noteId)) throw new Error(`Invalid shared note ID: ${noteId}`);
        const note = readSharedNoteForExport(noteId);
        const redacted = redactLocalValue(note.content, projectRoot);
        replacements += redacted.replacement_count;
        const target = normalizedPath(`notes/${note.id}.md`);
        if (content.has(target)) throw new Error(`Multiple OKF export selections map to ${target}.`);
        const rendered = renderConcept(target, redacted.value, "shared-note", note);
        content.set(target, rendered);
        rows.push({ kind: "shared-note", source: `shared-note:${note.id}`, path: target, source_digest: sha256(note.content), output_digest: sha256(rendered) });
    }
    const indexBody = [
        "---", 'okf_version: "0.2"', "---", "# Exported Cairnkeep knowledge", "",
        ...rows.map((row) => `* [${titleFrom(row.path, content.get(row.path) ?? "")}](./${row.path}) - Explicitly selected and redacted knowledge.`),
        "",
    ].join("\n");
    content.set("index.md", indexBody);
    rows.unshift({ kind: "index", source: "generated", path: "index.md", source_digest: sha256("okf-export-index-v1"), output_digest: sha256(indexBody) });
    const core = {
        schema_version: 1 as const,
        okf_version: "0.2" as const,
        project_digest: sha256(projectRoot),
        output_files: rows,
        redaction_replacements: replacements,
    };
    return { plan: { ...core, confirmation_digest: sha256(canonical(core)) }, content };
}

export async function planOkfExport(options: OkfExportOptions): Promise<OkfExportPlan> {
    return (await exportMaterial(options)).plan;
}

export async function applyOkfExport(options: OkfExportOptions, confirmation: string): Promise<OkfExportPlan & { applied: true; output_directory: string }> {
    if (!DIGEST.test(confirmation)) throw new Error("OKF export confirmation must be a SHA-256 digest.");
    const material = await exportMaterial(options);
    if (material.plan.confirmation_digest !== confirmation) throw new Error("OKF export confirmation digest does not match the inspected export.");
    const output = resolve(options.outputDirectory);
    if (existsSync(output)) throw new Error("OKF export output already exists; refusing to replace it.");
    const parent = dirname(output);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const temporary = await mkdtemp(join(parent, `.${basename(output)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp-`));
    try {
        for (const [path, value] of material.content) {
            const target = resolve(temporary, ...path.split("/"));
            if (!contained(temporary, target)) throw new Error(`Unsafe OKF export target: ${path}`);
            await mkdir(dirname(target), { recursive: true, mode: 0o700 });
            await writeFile(target, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
            hardenPrivatePath(target);
        }
        await validateOkfBundle(temporary);
        hardenPrivatePath(temporary);
        if (existsSync(output)) throw new Error("OKF export output appeared while publishing; refusing to replace it.");
        await rename(temporary, output);
    } catch (error) {
        await rm(temporary, { recursive: true, force: true });
        throw error;
    }
    return { ...material.plan, applied: true, output_directory: output };
}
