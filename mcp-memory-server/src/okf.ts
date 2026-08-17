import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";

import { parseDocument, stringify } from "yaml";
import { z } from "zod";

import { hardenPrivatePath } from "./platform-security.js";
import { readSharedNoteForExport, type SharedNoteExport } from "./note-store.js";
import { redactLocalValue } from "./trajectory-redaction.js";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ENTRIES = 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_FRONTMATTER_BYTES = 64 * 1024;
const DIGEST = /^[a-f0-9]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RESERVED = new Set(["index.md", "log.md"]);

const sourceSchema = z.object({
    resource: z.string().min(1).max(4096),
    id: z.string().min(1).max(256).optional(),
    title: z.string().min(1).max(1024).optional(),
    author: z.string().min(1).max(256).optional(),
    usage_count: z.number().nonnegative().finite().optional(),
    last_modified: z.string().regex(DATE).optional(),
    usage_window: z.object({ from: z.string().regex(DATE), to: z.string().regex(DATE) }).strict().optional(),
}).passthrough();
const actorEventSchema = z.object({
    by: z.string().min(1).max(256),
    at: z.string().min(1).max(128).optional(),
}).strict();
const frontmatterSchema = z.object({
    type: z.string().min(1).max(256),
    title: z.string().min(1).max(1024).optional(),
    description: z.string().min(1).max(4096).optional(),
    resource: z.string().min(1).max(4096).optional(),
    tags: z.array(z.string().min(1).max(128)).max(64).optional(),
    sources: z.array(sourceSchema).max(64).optional(),
    usage_window: z.object({ from: z.string().regex(DATE), to: z.string().regex(DATE) }).strict().optional(),
    generated: actorEventSchema.optional(),
    verified: z.union([actorEventSchema, z.array(actorEventSchema).max(64)]).optional(),
    status: z.enum(["draft", "stable", "deprecated"]).optional(),
    stale_after: z.string().regex(DATE).optional(),
    timestamp: z.string().min(1).max(128).optional(),
}).passthrough();

export type OkfDiagnostic = {
    severity: "warning";
    code: "broken-link" | "deprecated" | "missing-description" | "missing-sources" | "stale" | "unverified" | "unsupported-version";
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
    generated: { by: string; at?: string } | null;
    verified: Array<{ by: string; at?: string }>;
    trust_tier: "unverified" | "machine-confirmed" | "human-reviewed";
    status: "draft" | "stable" | "deprecated";
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
    if (!value || value.includes("\\") || isAbsolute(value)
        || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
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

async function walk(root: string, directory = root): Promise<string[]> {
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("OKF bundles may not contain symlink directories.");
    const files: string[] = [];
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
        if (directory === root && entry.name === ".git") {
            if (entry.isSymbolicLink()) throw new Error("OKF repository metadata may not be a symlink.");
            if (entry.isDirectory() || entry.isFile()) continue;
        }
        const absolute = join(directory, entry.name);
        const path = relative(root, absolute).split(sep).join("/");
        if (entry.isSymbolicLink()) throw new Error(`OKF bundles may not contain symlinks: ${path}`);
        if (entry.isDirectory()) files.push(...await walk(root, absolute));
        else if (entry.isFile()) files.push(normalizedPath(path));
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

function conceptFrom(path: string, parsed: ParsedFrontmatter): OkfConcept {
    const value = frontmatterSchema.parse(parsed.value);
    const verified = !value.verified ? [] : Array.isArray(value.verified) ? value.verified : [value.verified];
    const trustTier = verified.some(({ by }) => by.startsWith("human:"))
        ? "human-reviewed" as const
        : verified.length ? "machine-confirmed" as const : "unverified" as const;
    const stale = Boolean(value.stale_after && new Date().toISOString().slice(0, 10) >= value.stale_after);
    return {
        concept_id: path.slice(0, -3),
        type: value.type,
        title: value.title ?? titleFrom(path, parsed.body),
        description: value.description ?? null,
        resource: value.resource ?? null,
        tags: value.tags ?? [],
        sources: (value.sources ?? []) as Array<Record<string, unknown>>,
        generated: value.generated ?? null,
        verified,
        trust_tier: trustTier,
        status: value.status ?? "stable",
        stale_after: value.stale_after ?? null,
        stale,
        timestamp: value.timestamp ?? null,
        metadata: value,
    };
}

function localLinkTarget(from: string, raw: string): string | null {
    const withoutTitle = raw.trim().replace(/\s+["'][\s\S]*["']$/, "");
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
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = localLinkTarget(from, match[1]);
        if (target) links.push(target);
    }
    return [...new Set(links)].sort((a, b) => a.localeCompare(b, "en"));
}

function frontmatterLinks(value: Record<string, unknown>, from: string): string[] {
    const candidates: unknown[] = [value.resource, value.computation];
    if (Array.isArray(value.sources)) {
        for (const source of value.sources) {
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
        const target = localLinkTarget(from, candidate);
        if (target) links.push(target);
    }
    return [...new Set(links)].sort((a, b) => a.localeCompare(b, "en"));
}

function diagnosticsFor(path: string, concept: OkfConcept): OkfDiagnostic[] {
    const diagnostics: OkfDiagnostic[] = [];
    if (!concept.description) diagnostics.push({ severity: "warning", code: "missing-description", path, message: "Concept has no description." });
    if (!concept.sources.length) diagnostics.push({ severity: "warning", code: "missing-sources", path, message: "Concept declares no sources." });
    if (!concept.verified.length) diagnostics.push({ severity: "warning", code: "unverified", path, message: "Concept has not been verified." });
    if (concept.status === "deprecated") diagnostics.push({ severity: "warning", code: "deprecated", path, message: "Concept is deprecated." });
    if (concept.stale) diagnostics.push({ severity: "warning", code: "stale", path, message: `Concept became stale on ${concept.stale_after}.` });
    return diagnostics;
}

export async function indexOkfBundle(directory: string, selectedPaths?: string[], declaredVersion?: string): Promise<OkfIndex> {
    const requested = resolve(directory);
    const requestedInfo = lstatSync(requested);
    if (!requestedInfo.isDirectory() || requestedInfo.isSymbolicLink()) throw new Error("OKF source must be a real directory.");
    const root = requested;
    const paths = selectedPaths ? selectedPaths.map(normalizedPath).sort((a, b) => a.localeCompare(b, "en")) : await walk(root);
    const existing = new Set(paths);
    const files: OkfIndexedFile[] = [];
    const diagnostics: OkfDiagnostic[] = [];
    let version = declaredVersion ?? "";
    let sawV02 = false;
    for (const path of paths) {
        const absolute = resolve(root, ...path.split("/"));
        if (!contained(root, absolute)) throw new Error(`Unsafe OKF path: ${path}`);
        const info = lstatSync(absolute);
        if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) throw new Error(`OKF file is unsafe or too large: ${path}`);
        const bytes = await readFile(absolute);
        const text = utf8(bytes, path);
        const name = basename(path);
        const markdown = extname(path).toLowerCase() === ".md";
        const role = !markdown ? "reference" as const : name === "index.md" ? "index" as const : name === "log.md" ? "log" as const : "concept" as const;
        const parsed = markdown ? parseFrontmatter(text, path, role === "concept") : null;
        if (role === "index" && parsed) {
            if (path !== "index.md") throw new Error(`Only the root OKF index may contain frontmatter: ${path}`);
            const keys = Object.keys(parsed.value);
            if (keys.some((key) => key !== "okf_version") || typeof parsed.value.okf_version !== "string") {
                throw new Error("The root OKF index frontmatter may contain only okf_version.");
            }
            version = parsed.value.okf_version;
        }
        if (role === "log" && parsed) throw new Error(`OKF log files may not contain frontmatter: ${path}`);
        const concept = role === "concept" && parsed ? conceptFrom(path, parsed) : null;
        if (concept && (concept.generated || concept.verified.length || concept.stale_after || concept.sources.length || concept.status !== "stable")) sawV02 = true;
        if (concept) diagnostics.push(...diagnosticsFor(path, concept));
        const body = parsed?.body ?? text;
        const requestedLinks = [...new Set([
            ...markdownLinks(body, path),
            ...(parsed ? frontmatterLinks(parsed.value, path) : []),
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
            title: concept?.title ?? titleFrom(path, body),
            description: concept?.description ?? `${role[0].toUpperCase()}${role.slice(1)} file from an Open Knowledge Format bundle.`,
            keywords: concept?.tags ?? [], concept,
            outbound: [...new Set(outbound)].sort((a, b) => a.localeCompare(b, "en")),
            broken_links: broken,
        });
    }
    if (!version) version = sawV02 ? "0.2" : "0.1";
    if (!/^0\.(?:1|2)$/.test(version)) diagnostics.unshift({ severity: "warning", code: "unsupported-version", path: "index.md", message: `OKF version ${version} is not explicitly supported; consumed on a best-effort basis.` });
    return { schema_version: 1, version, files, diagnostics };
}

export async function validateOkfBundle(directory: string): Promise<ValidatedOkfBundle> {
    const root = resolve(directory);
    const index = await indexOkfBundle(root);
    const totalBytes = index.files.reduce((sum, file) => sum + file.bytes, 0);
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("OKF bundle exceeds the total size limit.");
    return { ...index, root, concepts: index.files.flatMap((file) => file.concept ? [file.concept] : []), total_bytes: totalBytes };
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
        const sourceInfo = lstatSync(absolute);
        if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.size > MAX_FILE_BYTES) throw new Error(`OKF export source is unsafe or too large: ${source}`);
        const bytes = await readFile(absolute);
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
