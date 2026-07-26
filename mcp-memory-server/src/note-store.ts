import { createHash, randomBytes } from "node:crypto";
import {
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
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

const MANAGED_START = "<!-- cairnkeep:managed:v1:start -->";
const MANAGED_END = "<!-- cairnkeep:managed:v1:end -->";

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
        .filter(({ record }) => record.project_id === projectId)
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

export function doctorNoteStore(repair = false): { schema_version: 1; exists: boolean; ok: boolean; repaired: boolean; issues: string[] } {
    const notesRoot = join(baseDirectory(), "notes");
    if (!existsSync(notesRoot)) return { schema_version: NOTE_SCHEMA_VERSION, exists: false, ok: true, repaired: false, issues: [] };
    try {
        const manifest = loadManifest(notesRoot);
        if (repair) saveManifestAndIndexes(notesRoot, manifest, []);
        return { schema_version: NOTE_SCHEMA_VERSION, exists: true, ok: true, repaired: repair, issues: [] };
    } catch (error) {
        return { schema_version: NOTE_SCHEMA_VERSION, exists: true, ok: false, repaired: false, issues: [error instanceof Error ? error.message : String(error)] };
    }
}
