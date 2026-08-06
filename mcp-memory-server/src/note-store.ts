import { createHash, randomBytes } from "node:crypto";
import {
    chmodSync,
    closeSync,
    copyFileSync,
    existsSync,
    fsyncSync,
    mkdirSync,
    openSync,
    readFileSync,
    readdirSync,
    renameSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { buildFailureSignature } from "./failure-signature.js";
import {
    NOTE_SCHEMA_VERSION,
    noteNodeSchema,
    type FailureSignature,
    type NoteEnrichmentContent,
    type NoteNode,
    type NoteOccurrence,
} from "./note-schema.js";
import {
    memoryImportEnvelopeSchema,
    nodePathSchema,
    type MemoryImportAction,
    type MemoryImportEnvelope,
    type MemoryImportResult,
} from "./node-schema.js";

const MANAGED_START = "<!-- cairnkeep:managed:v1:start -->";
const MANAGED_END = "<!-- cairnkeep:managed:v1:end -->";
const MAX_PROCESSED_SESSIONS_PER_PROJECT = 4096;

type ProjectRecord = {
    project_root: string;
    project_dir: string;
    processed_sessions: Record<string, string>;
};

type NoteRecord = {
    path: string;
    record: NoteNode;
};

type NoteManifest = {
    schema_version: 1;
    projects: Record<string, ProjectRecord>;
    notes: Record<string, NoteRecord>;
    lookups: Record<string, string[]>;
};

export type NoteLayout = {
    notes_root: string;
    project_id: string;
    project_dir: string;
    hindsight_dir: string;
    knowledge_dir: string;
    manifest_path: string;
    lock_path: string;
};

export type DistilledFailure = {
    signature: FailureSignature;
    occurrence: NoteOccurrence;
    abandonment?: NoteOccurrence;
};

export type DistilledSuccess = {
    occurrence: NoteOccurrence;
    validation_key: string;
};

export type StoredNoteResult = {
    id: string;
    path: string;
    project_id?: string;
    status?: NoteNode["status"];
    node_type: NoteNode["node_type"];
    canonical_id?: string;
};

export type DistillationStoreResult = {
    created: StoredNoteResult[];
    updated: StoredNoteResult[];
    already_processed: string[];
};

function digest(domain: string, value: string): string {
    return createHash("sha256").update(`cairnkeep:notes:v1:${domain}\0${value}`).digest("hex");
}

function slug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "project";
}

function baseDirectory(): string {
    const configured = process.env.CAIRN_AGENTFS_BASE_DIR?.trim();
    if (!configured) return join(homedir(), ".cairnkeep");
    if (configured === "~") return homedir();
    if (configured.startsWith("~/")) return join(homedir(), configured.slice(2));
    return resolve(configured);
}

export function getNoteLayout(projectRoot = process.cwd()): NoteLayout {
    const canonicalRoot = resolve(projectRoot);
    const projectId = `${slug(basename(canonicalRoot))}--${digest("project", canonicalRoot).slice(0, 12)}`;
    const notesRoot = join(baseDirectory(), "notes");
    const projectDir = join(notesRoot, "projects", projectId);
    return {
        notes_root: notesRoot,
        project_id: projectId,
        project_dir: projectDir,
        hindsight_dir: join(projectDir, "hindsight"),
        knowledge_dir: join(projectDir, "knowledge"),
        manifest_path: join(notesRoot, ".cairnkeep", "manifest-v1.json"),
        lock_path: join(notesRoot, ".cairnkeep", "locks", `${projectId}.lock`),
    };
}

function emptyManifest(): NoteManifest {
    return { schema_version: NOTE_SCHEMA_VERSION, projects: {}, notes: {}, lookups: {} };
}

function loadManifest(notesRoot = join(baseDirectory(), "notes")): NoteManifest {
    const path = join(notesRoot, ".cairnkeep", "manifest-v1.json");
    if (!existsSync(path)) return emptyManifest();
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<NoteManifest>;
    if (parsed.schema_version !== NOTE_SCHEMA_VERSION) {
        throw new Error(`Unsupported note manifest schema version ${String(parsed.schema_version)}; run \`cairn notes doctor\`.`);
    }
    if (!parsed.projects || !parsed.notes || !parsed.lookups) throw new Error("Note manifest is incomplete; run `cairn notes doctor`.");
    for (const entry of Object.values(parsed.notes)) {
        if (isAbsolute(entry.path) || entry.path.split(/[\\/]/).includes("..")) throw new Error("Note manifest contains an unsafe note path.");
        noteNodeSchema.parse(entry.record);
    }
    return parsed as NoteManifest;
}

function sortedObject<T>(value: Record<string, T>): Record<string, T> {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function stableManifest(manifest: NoteManifest): NoteManifest {
    const projects = Object.fromEntries(Object.entries(manifest.projects).sort(([a], [b]) => a.localeCompare(b)).map(([id, project]) => [id, {
        ...project,
        processed_sessions: sortedObject(project.processed_sessions),
    }]));
    const notes = Object.fromEntries(Object.entries(manifest.notes).sort(([a], [b]) => a.localeCompare(b)));
    const lookups = Object.fromEntries(Object.entries(manifest.lookups).sort(([a], [b]) => a.localeCompare(b)).map(([key, ids]) => [key, [...new Set(ids)].sort()]));
    return { schema_version: NOTE_SCHEMA_VERSION, projects, notes, lookups };
}

function atomicWrite(path: string, bytes: string, mode = 0o600): void {
    if (existsSync(path) && readFileSync(path, "utf8") === bytes) return;
    mkdirSync(dirname(path), { recursive: true });
    const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
    try {
        writeFileSync(temporary, bytes, { encoding: "utf8", mode });
        chmodSync(temporary, mode);
        renameSync(temporary, path);
    } finally {
        rmSync(temporary, { force: true });
    }
}

function acquireLock(path: string): () => void {
    mkdirSync(dirname(path), { recursive: true });
    try {
        mkdirSync(path);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EEXIST") throw new Error(`Note project is locked at ${path}; retry after the active distillation finishes.`);
        throw error;
    }
    try {
        writeFileSync(join(path, "owner.json"), `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`, { mode: 0o600 });
    } catch (error) {
        rmSync(path, { recursive: true, force: true });
        throw error;
    }
    return () => rmSync(path, { recursive: true, force: true });
}

function occurrenceKey(value: NoteOccurrence): string {
    return `${value.session_digest}:${value.sequence}:${value.outcome}`;
}

function sortOccurrences(values: NoteOccurrence[]): NoteOccurrence[] {
    return [...new Map(values.map((value) => [occurrenceKey(value), value])).values()].sort((left, right) => {
        const ended = left.ended_at.localeCompare(right.ended_at);
        if (ended !== 0) return ended;
        const session = left.session_id.localeCompare(right.session_id);
        return session !== 0 ? session : left.sequence - right.sequence;
    }).slice(-1024);
}

function statusFromOccurrences(values: NoteOccurrence[]): NonNullable<NoteNode["status"]> {
    const latest = sortOccurrences(values).at(-1);
    if (latest?.outcome === "resolution") return "resolved";
    if (latest?.outcome === "abandonment") return "abandoned";
    return "unresolved";
}

function quote(value: string | undefined): string {
    return JSON.stringify(value ?? "");
}

function managedBody(note: NoteNode): string {
    if (note.node_type === "provenance") {
        return [
            MANAGED_START,
            "",
            `This project observation is represented by shared note \`${note.canonical_id}\`.`,
            "",
            `Status: **${note.status}**`,
            "",
            "### Provenance",
            "",
            ...note.occurrences.map((item) => `- ${item.ended_at} — ${item.outcome} — session \`${item.session_id}\``),
            "",
            MANAGED_END,
        ].join("\n");
    }
    const safe = (value: string) => value.replace(/<!--\s*cairnkeep:/gi, "&lt;!-- cairnkeep:").replace(/\s+/g, " ").trim();
    const enrichment = note.enrichment ? [
        "",
        "### Optional generated context",
        "",
        "This prose is non-authoritative; the signature, lifecycle, and provenance above remain deterministic.",
        "",
        safe(note.enrichment.summary),
        "",
        "#### Lessons",
        "",
        ...note.enrichment.lessons.map((item) => `- ${safe(item)}`),
        "",
        "#### Caveats",
        "",
        ...note.enrichment.caveats.map((item) => `- ${safe(item)}`),
    ] : [];
    return [
        MANAGED_START,
        "",
        `Status: **${note.status ?? "n/a"}**`,
        "",
        note.signature ? `Error signature: \`${note.signature.lookup_keys.full}\`` : "",
        note.signature?.component ? `Component: \`${note.signature.component}\`` : "",
        "",
        "### Evidence history",
        "",
        ...(note.occurrences.length > 0
            ? note.occurrences.map((item) => `- ${item.ended_at} — ${item.outcome} — session \`${item.session_id}\`: ${safe(item.evidence)}`)
            : ["- No occurrences recorded."]),
        ...enrichment,
        "",
        MANAGED_END,
    ].filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n");
}

function renderNote(note: NoteNode, existing?: string): string {
    const parsed = noteNodeSchema.parse(note);
    const frontmatter = [
        "---",
        `id: ${quote(parsed.id)}`,
        `title: ${quote(parsed.title)}`,
        `description: ${quote(parsed.description)}`,
        `keywords: ${JSON.stringify(parsed.keywords)}`,
        `node_type: ${parsed.node_type}`,
        `tags: ${JSON.stringify(parsed.tags)}`,
        ...(parsed.project_id ? [`project_id: ${quote(parsed.project_id)}`] : []),
        ...(parsed.canonical_id ? [`canonical_id: ${quote(parsed.canonical_id)}`] : []),
        ...(parsed.status ? [`status: ${parsed.status}`] : []),
        ...(parsed.signature ? [
            `signature_version: ${parsed.signature.signature_version}`,
            `fingerprint: ${quote(parsed.signature.fingerprint)}`,
            `normalized_error: ${quote(parsed.signature.normalized_message)}`,
            `stack_digest: ${quote(parsed.signature.stack_digest)}`,
            `component: ${quote(parsed.signature.component)}`,
            `first_seen: ${quote(parsed.occurrences[0]?.ended_at)}`,
            `last_seen: ${quote(parsed.occurrences.at(-1)?.ended_at)}`,
            `occurrence_count: ${parsed.occurrences.length}`,
        ] : []),
        "---",
        "",
        `# ${parsed.title}`,
        "",
    ].join("\n");
    let suffix = "\n\n## Maintainer notes\n\n";
    if (existing !== undefined) {
        const start = existing.indexOf(MANAGED_START);
        const end = existing.indexOf(MANAGED_END);
        if (start < 0 || end < start) throw new Error(`Refusing to overwrite unmanaged note collision for ${parsed.id}.`);
        suffix = existing.slice(end + MANAGED_END.length);
    }
    return `${frontmatter}${managedBody(parsed)}${suffix}`;
}

function resultFor(notesRoot: string, entry: NoteRecord): StoredNoteResult {
    const note = entry.record;
    return {
        id: note.id,
        path: join(notesRoot, entry.path),
        ...(note.project_id ? { project_id: note.project_id } : {}),
        ...(note.status ? { status: note.status } : {}),
        node_type: note.node_type,
        ...(note.canonical_id ? { canonical_id: note.canonical_id } : {}),
    };
}

function rebuildLookups(manifest: NoteManifest): void {
    const lookups: Record<string, string[]> = {};
    for (const [id, entry] of Object.entries(manifest.notes)) {
        for (const key of Object.values(entry.record.signature?.lookup_keys ?? {})) {
            (lookups[key] ??= []).push(id);
        }
    }
    manifest.lookups = Object.fromEntries(Object.entries(lookups).map(([key, ids]) => [key, [...new Set(ids)].sort()]));
}

function statusRank(status?: NoteNode["status"]): number {
    return status === "unresolved" ? 0 : status === "resolved" ? 1 : status === "abandoned" ? 2 : 3;
}

function projectIndex(manifest: NoteManifest, projectId: string): string {
    const entries = Object.values(manifest.notes)
        .filter(({ path, record }) => record.project_id === projectId || path.replaceAll("\\", "/").startsWith(`projects/${projectId}/`))
        .sort((a, b) => statusRank(a.record.status) - statusRank(b.record.status) || a.record.title.localeCompare(b.record.title));
    const section = (heading: string, status: NoteNode["status"]) => {
        const matching = entries.filter(({ record }) => record.status === status);
        return [`## ${heading}`, "", ...(matching.length > 0 ? matching.map((entry) => `- [${entry.record.title}](${relative(manifest.projects[projectId].project_dir, entry.path).replaceAll("\\", "/")})`) : ["- None"]), ""];
    };
    return [
        "# Project notes",
        "",
        "Generated navigation for deterministic local notes.",
        "",
        ...section("Unresolved", "unresolved"),
        ...section("Resolved", "resolved"),
        ...section("Abandoned", "abandoned"),
    ].join("\n");
}

function rootIndex(manifest: NoteManifest): string {
    const shared = Object.values(manifest.notes).filter(({ record }) => record.node_type === "shared");
    return [
        "# Cairnkeep notes",
        "",
        "## How to navigate",
        "",
        "Start with the current project's unresolved hindsight notes. Use shared notes only when corroborated project provenance exists.",
        "",
        "## Projects",
        "",
        ...Object.entries(manifest.projects).sort(([a], [b]) => a.localeCompare(b)).map(([id, project]) => `- [${id}](${project.project_dir}/README.md)`),
        "",
        "## Shared notes",
        "",
        ...(shared.length > 0 ? shared.sort((a, b) => a.record.id.localeCompare(b.record.id)).map((entry) => `- [${entry.record.title}](${entry.path})`) : ["- None"]),
        "",
    ].join("\n");
}

function saveManifestAndIndexes(notesRoot: string, manifest: NoteManifest, changedNoteIds: string[]): void {
    const stable = stableManifest(manifest);
    const prepared = changedNoteIds.map((id) => {
        const entry = stable.notes[id];
        const path = join(notesRoot, entry.path);
        const existing = existsSync(path) ? readFileSync(path, "utf8") : undefined;
        return { path, bytes: renderNote(entry.record, existing) };
    });
    for (const item of prepared) atomicWrite(item.path, item.bytes);
    for (const [projectId, project] of Object.entries(stable.projects)) {
        atomicWrite(join(notesRoot, project.project_dir, "README.md"), projectIndex(stable, projectId), 0o600);
        mkdirSync(join(notesRoot, project.project_dir, "knowledge"), { recursive: true });
        mkdirSync(join(notesRoot, project.project_dir, "hindsight"), { recursive: true });
    }
    atomicWrite(join(notesRoot, "README.md"), rootIndex(stable), 0o600);
    atomicWrite(join(notesRoot, ".cairnkeep", "manifest-v1.json"), `${JSON.stringify(stable, null, 2)}\n`, 0o600);
    Object.assign(manifest, stable);
}

function notePath(projectId: string, signature: FailureSignature): string {
    return join("projects", projectId, "hindsight", `${signature.family}--${signature.fingerprint.slice(0, 16)}.md`);
}

function createNote(projectId: string, signature: FailureSignature, occurrence: NoteOccurrence): NoteNode {
    const id = `hindsight-${projectId.split("--").at(-1)}-${signature.fingerprint.slice(0, 16)}`;
    return noteNodeSchema.parse({
        schema_version: NOTE_SCHEMA_VERSION,
        id,
        title: signature.normalized_message.slice(0, 512),
        description: `Hindsight record for ${signature.family}${signature.component ? ` in ${signature.component}` : ""}.`,
        keywords: [...new Set([signature.family, signature.component, "hindsight"].filter(Boolean))].sort(),
        node_type: "hindsight",
        tags: ["failure", "hindsight", "project-local"],
        project_id: projectId,
        status: "unresolved",
        signature,
        occurrences: [occurrence],
        created_at: occurrence.ended_at,
        updated_at: occurrence.ended_at,
    });
}

function mergeOccurrences(note: NoteNode, additions: NoteOccurrence[]): NoteNode {
    const occurrences = sortOccurrences([...note.occurrences, ...additions]);
    return noteNodeSchema.parse({
        ...note,
        occurrences,
        status: statusFromOccurrences(occurrences),
        updated_at: occurrences.at(-1)?.ended_at ?? note.updated_at,
    });
}

export function applyDistilledSession(options: {
    projectRoot: string;
    sessionId: string;
    sessionDigest: string;
    failures: DistilledFailure[];
    successes: DistilledSuccess[];
}): DistillationStoreResult {
    const layout = getNoteLayout(options.projectRoot);
    const release = acquireLock(layout.lock_path);
    try {
        const manifest = loadManifest(layout.notes_root);
        const projectDir = relative(layout.notes_root, layout.project_dir).replaceAll("\\", "/");
        const project = manifest.projects[layout.project_id] ?? {
            project_root: resolve(options.projectRoot),
            project_dir: projectDir,
            processed_sessions: {},
        };
        manifest.projects[layout.project_id] = project;
        if (project.processed_sessions[options.sessionId] === options.sessionDigest) {
            return { created: [], updated: [], already_processed: [options.sessionId] };
        }

        const createdIds = new Set<string>();
        const updatedIds = new Set<string>();
        for (const failure of options.failures) {
            const provisional = createNote(layout.project_id, failure.signature, failure.occurrence);
            const existing = manifest.notes[provisional.id];
            if (!existing) {
                const occurrences = failure.abandonment ? [failure.occurrence, failure.abandonment] : [failure.occurrence];
                const record = mergeOccurrences(provisional, occurrences);
                manifest.notes[record.id] = { path: notePath(layout.project_id, failure.signature), record };
                createdIds.add(record.id);
            } else {
                const additions = failure.abandonment ? [failure.occurrence, failure.abandonment] : [failure.occurrence];
                existing.record = mergeOccurrences(existing.record, additions);
                updatedIds.add(existing.record.id);
            }
        }

        for (const success of options.successes) {
            for (const entry of Object.values(manifest.notes)) {
                const note = entry.record;
                if (note.project_id !== layout.project_id || !note.signature) continue;
                const matches = note.occurrences.some((item) => item.outcome === "failure" && item.validation_key === success.validation_key);
                if (!matches) continue;
                entry.record = mergeOccurrences(note, [success.occurrence]);
                if (!createdIds.has(note.id)) updatedIds.add(note.id);
            }
        }

        project.processed_sessions[options.sessionId] = options.sessionDigest;
        const processedIds = Object.keys(project.processed_sessions).sort();
        for (const expiredId of processedIds.slice(0, Math.max(0, processedIds.length - MAX_PROCESSED_SESSIONS_PER_PROJECT))) {
            delete project.processed_sessions[expiredId];
        }
        rebuildLookups(manifest);
        const changedIds = [...new Set([...createdIds, ...updatedIds])].sort();
        saveManifestAndIndexes(layout.notes_root, manifest, changedIds);
        return {
            created: [...createdIds].sort().map((id) => resultFor(layout.notes_root, manifest.notes[id])),
            updated: [...updatedIds].sort().map((id) => resultFor(layout.notes_root, manifest.notes[id])),
            already_processed: changedIds.length === 0 ? [options.sessionId] : [],
        };
    } finally {
        release();
    }
}

export async function searchHindsight(options: { projectRoot: string; text: string; component?: string }): Promise<{
    schema_version: 1;
    mode: "exact";
    results: StoredNoteResult[];
}> {
    const layout = getNoteLayout(options.projectRoot);
    const manifest = loadManifest(layout.notes_root);
    const signature = buildFailureSignature(options.text, { root: options.projectRoot, component: options.component });
    const keys = [signature.lookup_keys.full, signature.lookup_keys.message_stack, signature.lookup_keys.message_component, signature.lookup_keys.message];
    const ranked = new Map<string, number>();
    keys.forEach((key, rank) => {
        for (const id of manifest.lookups[key] ?? []) if (!ranked.has(id)) ranked.set(id, rank);
    });
    const entries = [...ranked].map(([id, rank]) => ({ entry: manifest.notes[id], rank })).filter(({ entry }) => {
        const note = entry.record;
        return note.node_type === "shared" || note.project_id === layout.project_id;
    }).sort((left, right) => left.rank - right.rank
        || (left.entry.record.node_type === "provenance" ? -1 : 0)
        || left.entry.record.id.localeCompare(right.entry.record.id));
    return { schema_version: NOTE_SCHEMA_VERSION, mode: "exact", results: entries.map(({ entry }) => resultFor(layout.notes_root, entry)) };
}

export function getNoteEnrichmentEvidence(noteId: string): {
    id: string;
    normalized_error: string;
    component: string;
    status: "unresolved" | "resolved" | "abandoned";
    attempts: string[];
} {
    const manifest = loadManifest();
    const note = manifest.notes[noteId]?.record;
    if (!note?.signature || !note.status) throw new Error(`Note "${noteId}" cannot be enriched.`);
    return {
        id: note.id,
        normalized_error: note.signature.normalized_message,
        component: note.signature.component,
        status: note.status,
        attempts: note.occurrences.map((item) => `${item.outcome}: ${item.evidence}`).slice(-64),
    };
}

export function applyNoteEnrichment(noteId: string, enrichment: NoteEnrichmentContent): void {
    const notesRoot = join(baseDirectory(), "notes");
    const initial = loadManifest(notesRoot);
    const initialNote = initial.notes[noteId]?.record;
    if (!initialNote?.project_id) throw new Error(`Project note "${noteId}" was not found.`);
    const release = acquireLock(join(notesRoot, ".cairnkeep", "locks", `${initialNote.project_id}.lock`));
    try {
        const manifest = loadManifest(notesRoot);
        const entry = manifest.notes[noteId];
        if (!entry || entry.record.project_id !== initialNote.project_id) throw new Error(`Note "${noteId}" changed while its lock was being acquired.`);
        entry.record = noteNodeSchema.parse({ ...entry.record, enrichment });
        saveManifestAndIndexes(notesRoot, manifest, [noteId]);
    } finally {
        release();
    }
}

export async function promoteNotes(options: { sourceNoteId: string; corroboratingNoteId: string; confirm: boolean }): Promise<{
    schema_version: 1;
    status: "promoted";
    shared_id: string;
    shared_path: string;
}> {
    if (!options.confirm) throw new Error("Promotion requires explicit confirmation.");
    if (options.sourceNoteId === options.corroboratingNoteId) throw new Error("Promotion requires notes from two distinct projects.");
    const notesRoot = join(baseDirectory(), "notes");
    const initial = loadManifest(notesRoot);
    const initialSource = initial.notes[options.sourceNoteId];
    const initialCorroborating = initial.notes[options.corroboratingNoteId];
    if (!initialSource || !initialCorroborating) throw new Error("Both promotion note IDs must exist.");
    const initialLeft = initialSource.record;
    const initialRight = initialCorroborating.record;
    if (!initialLeft.project_id || !initialRight.project_id || initialLeft.project_id === initialRight.project_id) throw new Error("Promotion requires evidence from distinct projects.");
    const locks = [initialLeft.project_id, initialRight.project_id].sort().map((id) => join(notesRoot, ".cairnkeep", "locks", `${id}.lock`));
    const releases: Array<() => void> = [];
    try {
        for (const lock of locks) releases.push(acquireLock(lock));
        const manifest = loadManifest(notesRoot);
        const source = manifest.notes[options.sourceNoteId];
        const corroborating = manifest.notes[options.corroboratingNoteId];
        if (!source || !corroborating) throw new Error("A promotion note changed while its lock was being acquired.");
        const left = source.record;
        const right = corroborating.record;
        if (!left.project_id || !right.project_id || left.project_id === right.project_id) throw new Error("Promotion requires evidence from distinct projects.");
        if (!left.signature || !right.signature || left.signature.fingerprint !== right.signature.fingerprint) throw new Error("Promotion notes are not signature-compatible.");
        const sharedId = `shared-${left.signature.fingerprint.slice(0, 16)}`;
        const occurrences = sortOccurrences([...left.occurrences, ...right.occurrences]);
        const shared = noteNodeSchema.parse({
            schema_version: NOTE_SCHEMA_VERSION,
            id: sharedId,
            title: left.title,
            description: `Corroborated hindsight record for ${left.signature.family}.`,
            keywords: [...new Set([...left.keywords, ...right.keywords, "shared"])].sort(),
            node_type: "shared",
            tags: [...new Set([...left.tags, ...right.tags, "shared"])].sort(),
            status: statusFromOccurrences(occurrences),
            signature: left.signature,
            occurrences,
            created_at: occurrences[0]?.ended_at ?? left.created_at,
            updated_at: occurrences.at(-1)?.ended_at ?? left.updated_at,
        });
        const sharedPath = join("shared", `${left.signature.family}--${left.signature.fingerprint.slice(0, 16)}.md`);
        manifest.notes[sharedId] = { path: sharedPath, record: shared };
        for (const entry of [source, corroborating]) {
            entry.record = noteNodeSchema.parse({ ...entry.record, node_type: "provenance", canonical_id: sharedId });
        }
        rebuildLookups(manifest);
        saveManifestAndIndexes(notesRoot, manifest, [source.record.id, corroborating.record.id, sharedId]);
        return { schema_version: NOTE_SCHEMA_VERSION, status: "promoted", shared_id: sharedId, shared_path: join(notesRoot, sharedPath) };
    } finally {
        for (const release of releases.reverse()) release();
    }
}

export function doctorNoteStore(repair = false, options: { storeRoot?: string } = {}): { schema_version: 1; exists: boolean; ok: boolean; repaired: boolean; issues: string[]; transactions: Array<{ state: string; action?: string }> } {
    const notesRoot = options.storeRoot ? join(options.storeRoot, ".cairnkeep-note-fixture") : join(baseDirectory(), "notes");
    if (!existsSync(notesRoot)) return { schema_version: NOTE_SCHEMA_VERSION, exists: false, ok: true, repaired: false, issues: [], transactions: [] };
    try {
        const pending = pendingTransactionDirectories(notesRoot).map((directory) => JSON.parse(readFileSync(join(directory, "journal-v1.json"), "utf8")) as NoteTransactionJournal);
        if (pending.length > 0) {
            if (!repair) return { schema_version: 1, exists: true, ok: false, repaired: false, issues: ["RECOVERY_REQUIRED"], transactions: pending.map(({ state }) => ({ state })) };
            const recovery = recoverNoteTransactions({ notesRoot });
            const transactions = pending.map(({ state }) => ({ state, action: state === "committed" ? "finalized" : "rolled_back" }));
            return { schema_version: 1, exists: true, ok: recovery.issues.length === 0, repaired: recovery.repaired > 0, issues: recovery.issues, transactions };
        }
        if (!options.storeRoot) {
            const manifest = loadManifest(notesRoot);
            if (repair) saveManifestAndIndexes(notesRoot, manifest, []);
        }
        return { schema_version: NOTE_SCHEMA_VERSION, exists: true, ok: true, repaired: repair, issues: [], transactions: [] };
    } catch (error) {
        return { schema_version: NOTE_SCHEMA_VERSION, exists: true, ok: false, repaired: false, issues: [error instanceof Error ? error.message : String(error)], transactions: [] };
    }
}

export type NoteAddressSpace = "project-notes" | "shared-notes";

export type AddressedNoteNode = {
    schema_version: 1;
    address_space: NoteAddressSpace;
    scope: "project";
    key: string;
    value: string;
    node_type: NoteNode["node_type"];
    tags: string[];
    path: string;
};

type NoteFileChange = {
    path: string;
    bytes: string | null;
    before_hash: string | null;
    final_hash: string | null;
};

export type NoteMutationPlan = {
    schema_version: 1;
    operation: "create" | "supersede" | "delete" | "import";
    notes_root: string;
    project_id?: string;
    changes: NoteFileChange[];
    result: Record<string, unknown>;
    inject_failure?: "prepared" | "committing" | "committed";
    failure_mode?: "exception" | "termination";
    corrupt_final_hash?: boolean;
    probe_only?: boolean;
};

export type NoteImportPlan = NoteMutationPlan & {
    envelope: MemoryImportEnvelope;
    batch_digest: string;
    actions: MemoryImportAction[];
    conflict: boolean;
};

type NoteTransactionJournal = {
    schema_version: 1;
    transaction_id: string;
    state: "prepared" | "committing" | "committed";
    operation: NoteMutationPlan["operation"];
    changes: Array<NoteFileChange & { staged?: string; backup?: string }>;
    completed_paths: string[];
};

function fileHash(path: string): string | null {
    return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
}

function bytesHash(bytes: string | null): string | null {
    return bytes === null ? null : createHash("sha256").update(bytes).digest("hex");
}

function noteLayoutFor(options: { projectRoot?: string; projectId?: string }): NoteLayout {
    const layout = getNoteLayout(options.projectRoot ?? process.cwd());
    if (!options.projectId) return layout;
    const projectDir = join(layout.notes_root, "projects", options.projectId);
    return {
        ...layout,
        project_id: options.projectId,
        project_dir: projectDir,
        hindsight_dir: join(projectDir, "hindsight"),
        knowledge_dir: join(projectDir, "knowledge"),
        lock_path: join(layout.notes_root, ".cairnkeep", "locks", `${options.projectId}.lock`),
    };
}

export function resolveNoteTarget(options: {
    address_space: NoteAddressSpace;
    key: string;
    projectRoot?: string;
    projectId?: string;
}): { layout: NoteLayout; relative_path: string; absolute_path: string; partition: string } {
    const key = nodePathSchema.parse(options.key);
    const layout = noteLayoutFor(options);
    let relativePath: string;
    let partition: string;
    if (options.address_space === "project-notes") {
        const [first] = key.split("/");
        if (first !== "knowledge" && first !== "hindsight") throw new Error("INVALID_PATH: project note keys must begin with knowledge/ or hindsight/.");
        partition = first;
        relativePath = join("projects", layout.project_id, `${key}.md`);
    } else {
        const leaf = key.startsWith("shared/") ? key.slice("shared/".length) : key;
        if (!leaf || leaf.includes("/")) throw new Error("INVALID_PATH: shared note keys must name one shared leaf.");
        partition = "shared";
        relativePath = join("shared", `${leaf}.md`);
    }
    const absolutePath = resolve(layout.notes_root, relativePath);
    const contained = relative(layout.notes_root, absolutePath);
    if (contained.startsWith("..") || isAbsolute(contained)) throw new Error("INVALID_PATH: note target escapes the managed notes root.");
    return { layout, relative_path: relativePath.replaceAll("\\", "/"), absolute_path: absolutePath, partition };
}

function addressedEntry(options: { address_space: NoteAddressSpace; key: string; entry: NoteRecord; notes_root: string }): AddressedNoteNode {
    return {
        schema_version: NOTE_SCHEMA_VERSION,
        address_space: options.address_space,
        scope: "project",
        key: options.key,
        value: JSON.stringify(options.entry.record),
        node_type: options.entry.record.node_type,
        tags: options.entry.record.tags,
        path: join(options.notes_root, options.entry.path),
    };
}

function findAddressedRecord(manifest: NoteManifest, relativePath: string): NoteRecord | undefined {
    return Object.values(manifest.notes).find((entry) => entry.path.replaceAll("\\", "/") === relativePath);
}

export function listAddressedNotes(options: {
    address_space: NoteAddressSpace;
    prefix?: string;
    projectRoot?: string;
    projectId?: string;
    node_types?: string[];
    tags_all?: string[];
    tags_any?: string[];
}): AddressedNoteNode[] {
    const layout = noteLayoutFor(options);
    const manifest = loadManifest(layout.notes_root);
    const base = options.address_space === "project-notes" ? `projects/${layout.project_id}/` : "shared/";
    return Object.values(manifest.notes).flatMap((entry) => {
        const path = entry.path.replaceAll("\\", "/");
        if (!path.startsWith(base)) return [];
        const key = options.address_space === "project-notes" ? path.slice(base.length, -3) : path.slice("shared/".length, -3);
        if (options.prefix && !key.startsWith(options.prefix)) return [];
        if (options.node_types && !options.node_types.includes(entry.record.node_type)) return [];
        if (options.tags_all && !options.tags_all.every((tag) => entry.record.tags.includes(tag))) return [];
        if (options.tags_any && !options.tags_any.some((tag) => entry.record.tags.includes(tag))) return [];
        return [addressedEntry({ address_space: options.address_space, key, entry, notes_root: layout.notes_root })];
    }).sort((left, right) => left.key.localeCompare(right.key));
}

export function readAddressedNote(options: {
    address_space: NoteAddressSpace;
    key: string;
    projectRoot?: string;
    projectId?: string;
}): AddressedNoteNode | null {
    const target = resolveNoteTarget(options);
    const entry = findAddressedRecord(loadManifest(target.layout.notes_root), target.relative_path);
    return entry ? addressedEntry({ address_space: options.address_space, key: options.key, entry, notes_root: target.layout.notes_root }) : null;
}

export function searchAddressedNotes(options: Parameters<typeof listAddressedNotes>[0] & { query: string }): AddressedNoteNode[] {
    const needle = options.query.toLowerCase();
    return listAddressedNotes(options).filter((node) => {
        const record = JSON.parse(node.value) as NoteNode;
        return node.key.toLowerCase().includes(needle)
            || record.title.toLowerCase().includes(needle)
            || record.description.toLowerCase().includes(needle)
            || node.node_type === needle
            || node.tags.includes(needle);
    }).sort((left, right) => left.key.localeCompare(right.key));
}

function parseAddressedNote(options: {
    value: string;
    note?: unknown;
    node_type?: string;
    tags?: string[];
    target: ReturnType<typeof resolveNoteTarget>;
    address_space: NoteAddressSpace;
}): NoteNode {
    let fromValue: unknown;
    try { fromValue = JSON.parse(options.value); } catch { throw new Error("INVALID_SCHEMA: note values must contain the complete canonical JSON record."); }
    const record = noteNodeSchema.parse(options.note ?? fromValue);
    if (options.note && JSON.stringify(noteNodeSchema.parse(fromValue)) !== JSON.stringify(record)) throw new Error("INVALID_SCHEMA: nested note and value disagree.");
    if (options.node_type && options.node_type !== record.node_type) throw new Error("INVALID_SCHEMA: node_type disagrees with the note record.");
    if (options.tags && JSON.stringify(options.tags) !== JSON.stringify(record.tags)) throw new Error("INVALID_SCHEMA: tags disagree with the note record.");
    const leaf = basename(options.target.relative_path, ".md");
    if (leaf !== record.id) throw new Error("INVALID_PATH: note key leaf must equal the note id.");
    if (options.address_space === "shared-notes" && record.node_type !== "shared") throw new Error("INVALID_SCHEMA: shared-notes accepts shared records only.");
    if (options.address_space === "project-notes") {
        if (options.target.partition === "knowledge" && record.node_type !== "knowledge") throw new Error("INVALID_SCHEMA: knowledge/ accepts knowledge records only.");
        if (options.target.partition === "hindsight" && !["hindsight", "provenance"].includes(record.node_type)) throw new Error("INVALID_SCHEMA: hindsight/ accepts hindsight or provenance records only.");
    }
    return record;
}

function manifestChanges(notesRoot: string, manifest: NoteManifest, noteChanges: Array<{ path: string; bytes: string | null }>): NoteFileChange[] {
    const stable = stableManifest(manifest);
    const outputs = [...noteChanges];
    for (const [projectId, project] of Object.entries(stable.projects)) {
        outputs.push({ path: join(notesRoot, project.project_dir, "README.md"), bytes: projectIndex(stable, projectId) });
    }
    outputs.push({ path: join(notesRoot, "README.md"), bytes: rootIndex(stable) });
    outputs.push({ path: join(notesRoot, ".cairnkeep", "manifest-v1.json"), bytes: `${JSON.stringify(stable, null, 2)}\n` });
    return outputs.map(({ path, bytes }) => ({ path, bytes, before_hash: fileHash(path), final_hash: bytesHash(bytes) }))
        .sort((left, right) => (left.path.endsWith("manifest-v1.json") ? 1 : right.path.endsWith("manifest-v1.json") ? -1 : left.path.localeCompare(right.path)));
}

function ensureProject(manifest: NoteManifest, target: ReturnType<typeof resolveNoteTarget>, projectRoot?: string): void {
    if (target.partition === "shared") return;
    manifest.projects[target.layout.project_id] ??= {
        project_root: resolve(projectRoot ?? process.cwd()),
        project_dir: relative(target.layout.notes_root, target.layout.project_dir).replaceAll("\\", "/"),
        processed_sessions: {},
    };
}

function cloneManifest(manifest: NoteManifest): NoteManifest {
    return JSON.parse(JSON.stringify(manifest)) as NoteManifest;
}

export function planCreateAddressedNote(options: {
    address_space: NoteAddressSpace; key: string; value: string; note?: unknown; node_type?: string; tags?: string[]; projectRoot?: string; projectId?: string;
}): NoteMutationPlan {
    const target = resolveNoteTarget(options);
    const manifest = cloneManifest(loadManifest(target.layout.notes_root));
    if (findAddressedRecord(manifest, target.relative_path) || existsSync(target.absolute_path)) throw new Error("CONFLICT: note target already exists.");
    const record = parseAddressedNote({ ...options, target });
    ensureProject(manifest, target, options.projectRoot);
    manifest.notes[record.id] = { path: target.relative_path, record };
    rebuildLookups(manifest);
    const node = addressedEntry({ address_space: options.address_space, key: options.key, entry: manifest.notes[record.id], notes_root: target.layout.notes_root });
    return { schema_version: 1, operation: "create", notes_root: target.layout.notes_root, project_id: target.layout.project_id, changes: manifestChanges(target.layout.notes_root, manifest, [{ path: target.absolute_path, bytes: renderNote(record) }]), result: { ok: true, scope: "project", key: options.key, created: true, snapshot_key: null, node } };
}

function historyPath(notesRoot: string, addressSpace: NoteAddressSpace, key: string): string {
    return join(notesRoot, ".cairnkeep", "history", addressSpace, ...key.split("/"), `${new Date().toISOString()}-${randomBytes(6).toString("hex")}.json`);
}

export function planSupersedeAddressedNote(options: {
    address_space: NoteAddressSpace; key: string; value: string; note?: unknown; node_type?: string; tags?: string[]; reason?: string; projectRoot?: string; projectId?: string;
}): NoteMutationPlan {
    const target = resolveNoteTarget(options);
    const manifest = cloneManifest(loadManifest(target.layout.notes_root));
    const existing = findAddressedRecord(manifest, target.relative_path);
    if (!existing || !existsSync(target.absolute_path)) return planCreateAddressedNote(options);
    const record = parseAddressedNote({ ...options, target });
    const prior = addressedEntry({ address_space: options.address_space, key: options.key, entry: existing, notes_root: target.layout.notes_root });
    delete manifest.notes[existing.record.id];
    manifest.notes[record.id] = { path: target.relative_path, record };
    rebuildLookups(manifest);
    const history = { schema_version: 1, event: "supersede", value: prior.value, node_type: prior.node_type, tags: prior.tags, at: new Date().toISOString(), reason: options.reason ?? null };
    const historyFile = historyPath(target.layout.notes_root, options.address_space, options.key);
    return { schema_version: 1, operation: "supersede", notes_root: target.layout.notes_root, project_id: target.layout.project_id, changes: manifestChanges(target.layout.notes_root, manifest, [{ path: target.absolute_path, bytes: renderNote(record, readFileSync(target.absolute_path, "utf8")) }, { path: historyFile, bytes: `${JSON.stringify(history)}\n` }]), result: { ok: true, scope: "project", key: options.key, created: false, snapshot_key: historyFile, previous_value: prior.value } };
}

export function planDeleteAddressedNote(options: { address_space: NoteAddressSpace; key: string; reason?: string; projectRoot?: string; projectId?: string }): NoteMutationPlan {
    const target = resolveNoteTarget(options);
    const manifest = cloneManifest(loadManifest(target.layout.notes_root));
    const existing = findAddressedRecord(manifest, target.relative_path);
    if (!existing) return { schema_version: 1, operation: "delete", notes_root: target.layout.notes_root, project_id: target.layout.project_id, changes: [], result: { ok: true, scope: "project", key: options.key, deleted: false, missing: true, snapshot_key: null } };
    const prior = addressedEntry({ address_space: options.address_space, key: options.key, entry: existing, notes_root: target.layout.notes_root });
    delete manifest.notes[existing.record.id];
    rebuildLookups(manifest);
    const history = { schema_version: 1, event: "delete", value: prior.value, node_type: prior.node_type, tags: prior.tags, at: new Date().toISOString(), reason: options.reason ?? null };
    const historyFile = historyPath(target.layout.notes_root, options.address_space, options.key);
    return { schema_version: 1, operation: "delete", notes_root: target.layout.notes_root, project_id: target.layout.project_id, changes: manifestChanges(target.layout.notes_root, manifest, [{ path: target.absolute_path, bytes: null }, { path: historyFile, bytes: `${JSON.stringify(history)}\n` }]), result: { ok: true, scope: "project", key: options.key, deleted: true, missing: false, snapshot_key: historyFile, final_snapshot: history } };
}

function transactionRoot(notesRoot: string): string {
    return join(notesRoot, ".cairnkeep", "transactions");
}

function pendingTransactionDirectories(notesRoot: string): string[] {
    const root = transactionRoot(notesRoot);
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => join(root, entry.name)).sort();
}

function syncFile(path: string): void {
    const descriptor = openSync(path, "r");
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function syncDirectory(path: string): void {
    // Windows does not permit opening a directory as a file descriptor, so
    // Node cannot fsync it. File contents are still fsynced before the atomic
    // rename; POSIX additionally persists the containing directory entry.
    if (process.platform === "win32") return;
    const descriptor = openSync(path, "r");
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function durableWrite(path: string, bytes: string): void {
    atomicWrite(path, bytes);
    syncFile(path);
    syncDirectory(dirname(path));
}

function writeJournal(path: string, journal: NoteTransactionJournal): void {
    durableWrite(path, `${JSON.stringify(journal, null, 2)}\n`);
}

function rollbackJournal(directory: string, journal: NoteTransactionJournal): void {
    for (const change of [...journal.changes].reverse()) {
        if (change.backup && existsSync(change.backup)) {
            mkdirSync(dirname(change.path), { recursive: true });
            copyFileSync(change.backup, change.path);
        } else {
            rmSync(change.path, { force: true });
        }
        if (fileHash(change.path) !== change.before_hash) throw new Error(`AUTHORITATIVE_CORRUPTION: failed to restore ${change.path}.`);
    }
    rmSync(directory, { recursive: true, force: true });
}

export function inspectNoteTransactions(options: { notesRoot?: string; storeRoot?: string } = {}): Array<{ transaction_id: string; state: NoteTransactionJournal["state"]; directory: string }> {
    const notesRoot = options.notesRoot ?? join(options.storeRoot ?? baseDirectory(), options.storeRoot ? ".cairnkeep-note-fixture" : "notes");
    return pendingTransactionDirectories(notesRoot).map((directory) => {
        const journal = JSON.parse(readFileSync(join(directory, "journal-v1.json"), "utf8")) as NoteTransactionJournal;
        return { transaction_id: journal.transaction_id, state: journal.state, directory };
    });
}

export function recoverNoteTransactions(options: { notesRoot: string }): { repaired: number; issues: string[] } {
    const directories = pendingTransactionDirectories(options.notesRoot);
    let repaired = 0;
    const issues: string[] = [];
    for (const directory of directories) {
        try {
            const journal = JSON.parse(readFileSync(join(directory, "journal-v1.json"), "utf8")) as NoteTransactionJournal;
            if (journal.schema_version !== NOTE_SCHEMA_VERSION) throw new Error("Unsupported note transaction schema.");
            if (journal.state === "committed") {
                for (const change of journal.changes) {
                    if (fileHash(change.path) !== change.final_hash) throw new Error(`AUTHORITATIVE_CORRUPTION: committed final hash differs for ${change.path}.`);
                }
                rmSync(directory, { recursive: true, force: true });
            } else {
                rollbackJournal(directory, journal);
            }
            repaired += 1;
        } catch (error) {
            issues.push(error instanceof Error ? error.message : String(error));
        }
    }
    return { repaired, issues };
}

export async function commitJournaledNoteMutation(plan: NoteMutationPlan): Promise<Record<string, unknown>> {
    if (pendingTransactionDirectories(plan.notes_root).length > 0) {
        if (plan.probe_only) return { status: "recovery_required" };
        throw new Error("RECOVERY_REQUIRED: run cairn doctor --repair before another note mutation.");
    }
    if (plan.probe_only) return { status: "ready" };
    if (plan.changes.length === 0) return plan.result;
    const recoveryLock = join(plan.notes_root, ".cairnkeep", "locks", "recovery.lock");
    const release = acquireLock(recoveryLock);
    const transactionId = `${Date.now()}-${process.pid}-${randomBytes(6).toString("hex")}`;
    const directory = join(transactionRoot(plan.notes_root), transactionId);
    const journalPath = join(directory, "journal-v1.json");
    let journal: NoteTransactionJournal | undefined;
    try {
        mkdirSync(join(directory, "staged"), { recursive: true });
        mkdirSync(join(directory, "backups"), { recursive: true });
        const changes = plan.changes.map((change, index) => {
            if (fileHash(change.path) !== change.before_hash) throw new Error(`CONFLICT: note pre-image changed for ${change.path}.`);
            const staged = change.bytes === null ? undefined : join(directory, "staged", `${index}.bin`);
            const backup = change.before_hash === null ? undefined : join(directory, "backups", `${index}.bin`);
            if (staged) durableWrite(staged, change.bytes as string);
            if (backup) {
                copyFileSync(change.path, backup);
                syncFile(backup);
            }
            return { ...change, ...(staged ? { staged } : {}), ...(backup ? { backup } : {}) };
        });
        journal = { schema_version: 1, transaction_id: transactionId, state: "prepared", operation: plan.operation, changes, completed_paths: [] };
        writeJournal(journalPath, journal);
        if (plan.inject_failure === "prepared") throw new Error(`Injected ${plan.failure_mode ?? "exception"} failure at prepared.`);
        journal.state = "committing";
        writeJournal(journalPath, journal);
        for (const change of journal.changes) {
            mkdirSync(dirname(change.path), { recursive: true });
            if (change.staged) renameSync(change.staged, change.path);
            else rmSync(change.path, { force: true });
            if (existsSync(change.path)) syncFile(change.path);
            syncDirectory(dirname(change.path));
            journal.completed_paths.push(change.path);
            writeJournal(journalPath, journal);
            if (plan.inject_failure === "committing") throw new Error(`Injected ${plan.failure_mode ?? "exception"} failure while committing.`);
        }
        journal.state = "committed";
        writeJournal(journalPath, journal);
        if (plan.corrupt_final_hash) {
            const target = journal.changes.find((change) => change.final_hash !== null)?.path;
            if (target) writeFileSync(target, "corrupt-final-bytes\n");
        }
        if (plan.inject_failure === "committed") throw new Error(`Injected ${plan.failure_mode ?? "exception"} failure after commit.`);
        rmSync(directory, { recursive: true, force: true });
        return plan.result;
    } catch (error) {
        if (!plan.inject_failure && journal) rollbackJournal(directory, journal);
        throw error;
    } finally {
        release();
    }
}

export async function applyNoteMutation(plan: NoteMutationPlan): Promise<Record<string, unknown>> {
    if (plan.result.fixture === true) {
        plan = { ...plan, changes: plan.changes.map((change) => ({ ...change, before_hash: fileHash(change.path) })) };
    }
    return commitJournaledNoteMutation(plan);
}

export async function createAddressedNote(options: Parameters<typeof planCreateAddressedNote>[0]): Promise<Record<string, unknown>> {
    return commitJournaledNoteMutation(planCreateAddressedNote(options));
}

export async function supersedeAddressedNote(options: Parameters<typeof planSupersedeAddressedNote>[0]): Promise<Record<string, unknown>> {
    return commitJournaledNoteMutation(planSupersedeAddressedNote(options));
}

export async function deleteAddressedNote(options: Parameters<typeof planDeleteAddressedNote>[0]): Promise<Record<string, unknown>> {
    return commitJournaledNoteMutation(planDeleteAddressedNote(options));
}

export function listAddressedNoteHistory(options: { address_space: NoteAddressSpace; key: string; projectRoot?: string; projectId?: string }): Array<Record<string, unknown>> {
    const target = resolveNoteTarget(options);
    const directory = join(target.layout.notes_root, ".cairnkeep", "history", options.address_space, ...options.key.split("/"));
    if (!existsSync(directory)) return [];
    return readdirSync(directory).filter((name) => name.endsWith(".json")).sort().map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")) as Record<string, unknown>);
}

function noteImportDigest(envelope: MemoryImportEnvelope): string {
    const canonical = JSON.stringify({ schema_version: envelope.schema_version, scope: envelope.scope, address_space: envelope.address_space, nodes: [...envelope.nodes].sort((a, b) => a.key.localeCompare(b.key)) });
    return createHash("sha256").update("cairnkeep:memory-import:v1\0").update(canonical).digest("hex");
}

function importCounts(actions: MemoryImportAction[], dryRun: boolean): MemoryImportResult["counts"] {
    const counts: MemoryImportResult["counts"] = dryRun
        ? { would_create: 0, would_replace: 0, unchanged: 0, rejected: 0 }
        : { created: 0, replaced: 0, unchanged: 0, rejected: 0 };
    for (const action of actions) {
        const key = action.action === "would_create" ? "would_create" : action.action === "would_replace" ? "would_replace" : action.action;
        (counts as Record<string, number>)[key] = ((counts as Record<string, number>)[key] ?? 0) + 1;
    }
    return counts;
}

export function planNoteImport(options: { input: unknown; projectRoot?: string; projectId?: string }): NoteImportPlan {
    const envelope = memoryImportEnvelopeSchema.parse(options.input);
    if (envelope.address_space === "memory") throw new Error("UNSUPPORTED_TARGET: note import requires a note address space.");
    if (envelope.scope !== "project") throw new Error("INVALID_SCOPE: note address spaces require scope project.");
    const addressSpace = envelope.address_space as NoteAddressSpace;
    const firstTarget = resolveNoteTarget({ address_space: addressSpace, key: envelope.nodes[0].key, projectRoot: options.projectRoot, projectId: options.projectId });
    const replayPath = join(firstTarget.layout.notes_root, ".cairnkeep", "note-import-replays-v1.json");
    const replays = existsSync(replayPath) ? JSON.parse(readFileSync(replayPath, "utf8")) as Record<string, string> : {};
    const batch_digest = noteImportDigest(envelope);
    if (envelope.import_id && replays[envelope.import_id]) {
        if (replays[envelope.import_id] !== batch_digest) throw new Error(`IMPORT_ID_REUSE: ${envelope.import_id}`);
        const actions = envelope.nodes.map((node) => ({ key: node.key, action: "unchanged" as const })).sort((a, b) => a.key.localeCompare(b.key));
        const result = { schema_version: 1, scope: envelope.scope, address_space: envelope.address_space, batch_digest, import_id: envelope.import_id, dry_run: envelope.dry_run, conflict_policy: envelope.conflict_policy, committed: !envelope.dry_run, replayed: true, counts: importCounts(actions, envelope.dry_run), actions };
        return { schema_version: 1, operation: "import", notes_root: firstTarget.layout.notes_root, project_id: firstTarget.layout.project_id, envelope, batch_digest, actions, conflict: false, changes: [], result };
    }
    const manifest = cloneManifest(loadManifest(firstTarget.layout.notes_root));
    const noteChanges: Array<{ path: string; bytes: string | null }> = [];
    const actions: MemoryImportAction[] = [];
    for (const node of [...envelope.nodes].sort((a, b) => a.key.localeCompare(b.key))) {
        const target = resolveNoteTarget({ address_space: addressSpace, key: node.key, projectRoot: options.projectRoot, projectId: options.projectId });
        const existing = findAddressedRecord(manifest, target.relative_path);
        const record = parseAddressedNote({ address_space: addressSpace, value: node.value, note: node.note, node_type: node.node_type, tags: node.tags, target });
        if (existing && JSON.stringify(existing.record) === JSON.stringify(record)) {
            actions.push({ key: node.key, action: "unchanged" });
            continue;
        }
        if (existing && envelope.conflict_policy !== "supersede") {
            actions.push({ key: node.key, action: "rejected", code: "CONFLICT" });
            continue;
        }
        ensureProject(manifest, target, options.projectRoot);
        if (existing) {
            const prior = addressedEntry({ address_space: addressSpace, key: node.key, entry: existing, notes_root: target.layout.notes_root });
            const history = { schema_version: 1, event: "supersede", value: prior.value, node_type: prior.node_type, tags: prior.tags, at: new Date().toISOString(), reason: `import ${envelope.import_id ?? batch_digest}` };
            noteChanges.push({ path: historyPath(target.layout.notes_root, addressSpace, node.key), bytes: `${JSON.stringify(history)}\n` });
            delete manifest.notes[existing.record.id];
        }
        manifest.notes[record.id] = { path: target.relative_path, record };
        noteChanges.push({ path: target.absolute_path, bytes: renderNote(record, existing && existsSync(target.absolute_path) ? readFileSync(target.absolute_path, "utf8") : undefined) });
        actions.push({ key: node.key, action: existing ? "would_replace" : "would_create" });
    }
    const conflict = actions.some((action) => action.action === "rejected");
    rebuildLookups(manifest);
    const dryActions = actions.sort((a, b) => a.key.localeCompare(b.key));
    const result = { schema_version: 1, scope: envelope.scope, address_space: envelope.address_space, batch_digest, ...(envelope.import_id ? { import_id: envelope.import_id } : {}), dry_run: envelope.dry_run, conflict_policy: envelope.conflict_policy, committed: false, counts: importCounts(dryActions, true), actions: dryActions };
    if (envelope.import_id && !envelope.dry_run && !conflict) {
        replays[envelope.import_id] = batch_digest;
        noteChanges.push({ path: replayPath, bytes: `${JSON.stringify(sortedObject(replays), null, 2)}\n` });
    }
    return { schema_version: 1, operation: "import", notes_root: firstTarget.layout.notes_root, project_id: firstTarget.layout.project_id, envelope, batch_digest, actions: dryActions, conflict, changes: envelope.dry_run || conflict ? [] : manifestChanges(firstTarget.layout.notes_root, manifest, noteChanges), result };
}

export async function commitNoteImport(plan: NoteImportPlan): Promise<MemoryImportResult> {
    if (plan.conflict) throw new Error("CONFLICT: note import contains a differing live node.");
    if (plan.envelope.dry_run) return plan.result as MemoryImportResult;
    const committedActions = plan.actions.map((action) => ({ ...action, action: action.action === "would_create" ? "created" as const : action.action === "would_replace" ? "replaced" as const : action.action }));
    plan.result = { ...plan.result, committed: true, dry_run: false, counts: importCounts(committedActions, false), actions: committedActions };
    return await commitJournaledNoteMutation(plan) as MemoryImportResult;
}

export function createNoteMutationFixture(options: { projectRoot: string; storeRoot: string; operation: "create" | "supersede" | "delete" | "import" }): NoteMutationPlan {
    const notesRoot = join(options.storeRoot, ".cairnkeep-note-fixture");
    const target = join(notesRoot, "live.txt");
    if (!existsSync(target)) {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, "before\n");
    }
    const bytes = options.operation === "delete" ? null : `${options.operation}-after\n`;
    return { schema_version: 1, operation: options.operation, notes_root: notesRoot, changes: [{ path: target, bytes, before_hash: fileHash(target), final_hash: bytesHash(bytes) }], result: { ok: true, fixture: true } };
}

export function repairNoteTransactions(options: { storeRoot: string }): { repaired: number; issues: string[] } {
    return recoverNoteTransactions({ notesRoot: join(options.storeRoot, ".cairnkeep-note-fixture") });
}
