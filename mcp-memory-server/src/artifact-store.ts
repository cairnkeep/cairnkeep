import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { AgentFS } from "agentfs-sdk";

import {
    ARTIFACT_SCHEMA_VERSION,
    artifactEnvelopeSchema,
    artifactWriteInputSchema,
    canonicalBytes,
    canonicalJson,
    getArtifactLimits,
    sha256Hex,
    truncateUtf8,
    type ArtifactEnvelope,
    type ArtifactKind,
    type ArtifactLimits,
    type ArtifactNodeRef,
    type ArtifactWriteInput,
} from "./artifact-schema.js";
import { redactLocalValue } from "./trajectory-redaction.js";
import { atomicReplace } from "./platform-security.js";

const META_KEY = "artifact/meta/schema-version";
const FULL_PREFIX = "artifact/full/";
const INDEX_PREFIX = "artifact/index/";
const DEDUPE_PREFIX = "artifact/index/dedupe/";
const SESSION_LATEST_PREFIX = "compaction/latest/session/";
const PROJECT_LATEST_KEY = "compaction/latest/project";
const SEQUENCE_PREFIX = "compaction/sequence/";
const DIAGNOSTIC_PREFIX = "artifact/meta/unsupported-adapter/";
const MAX_DIAGNOSTICS = 32;

const mutationQueues = new Map<string, Promise<void>>();

type ArtifactIndex = {
    schema_version: 1;
    artifact_id: string;
    kind: ArtifactKind;
    created_at: string;
    session_ref: string;
    node_ref?: ArtifactNodeRef;
    logical_bytes: number;
    content_digest: string;
    full_key: string;
};

export type ArtifactList = {
    schema_version: 1;
    artifacts: ArtifactEnvelope[];
    logical_bytes: number;
    next_cursor?: string;
};

export type ArtifactPruneResult = {
    schema_version: 1;
    dry_run: boolean;
    removed: Array<ArtifactIndex & { reason: "age" | "revision" | "session_budget" | "store_budget" }>;
    remaining_artifacts: number;
    logical_bytes: number;
};

export type ArtifactDoctorResult = {
    schema_version: 1;
    exists: boolean;
    ok: boolean;
    repaired: boolean;
    integrity: "ok" | "failed" | "not_present";
    valid_artifacts: number;
    indexed_artifacts: number;
    issues: string[];
};

type MutationOptions = { now?: Date; fault?: "after-full-write" };
type PruneOptions = { dryRun?: boolean; includeProtected?: boolean; now?: Date };

export function getArtifactDbPath(projectRoot = process.cwd()): string {
    return resolve(projectRoot, ".agentfs", "artifacts.db");
}

export function resolveArtifactDbPath(projectRoot = process.cwd()): string {
    return getArtifactDbPath(projectRoot);
}

export function resolveRemoteArtifactProjectRoot(baseDirectory: string, projectId: string): string {
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(projectId)) {
        throw new Error("Remote artifact project identity is invalid.");
    }
    const base = resolve(baseDirectory);
    const candidate = resolve(base, projectId);
    const rel = relative(base, candidate);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Remote artifact path escapes its configured base directory.");
    return candidate;
}

export function resolveRemoteArtifactDbPath(baseDirectory: string, projectId: string): string {
    return getArtifactDbPath(resolveRemoteArtifactProjectRoot(baseDirectory, projectId));
}

async function openArtifactStore(projectRoot: string, create: boolean): Promise<AgentFS | null> {
    const path = getArtifactDbPath(projectRoot);
    if (!create && !existsSync(path)) return null;
    if (create) mkdirSync(dirname(path), { recursive: true });
    const agent = await AgentFS.open({ id: "artifacts", path });
    if (create) {
        try {
            chmodSync(path, 0o600);
        } catch (error) {
            await agent.close();
            throw error;
        }
    }
    return agent;
}

async function inImmediateTransaction<T>(agent: AgentFS, operation: () => Promise<T>): Promise<T> {
    const transaction = agent.getDatabase().transaction(operation);
    const immediate = (transaction as typeof transaction & { immediate: typeof transaction }).immediate;
    return immediate();
}

async function withMutationLock<T>(projectRoot: string, operation: () => Promise<T>): Promise<T> {
    const path = getArtifactDbPath(projectRoot);
    const prior = mutationQueues.get(path) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    const queued = prior.then(() => current);
    mutationQueues.set(path, queued);
    await prior;
    try {
        return await operation();
    } finally {
        release();
        if (mutationQueues.get(path) === queued) mutationQueues.delete(path);
    }
}

function fullKey(id: string): string {
    return `${FULL_PREFIX}${id}`;
}

function paddedEpoch(createdAt: string): string {
    const epoch = Date.parse(createdAt);
    if (!Number.isFinite(epoch)) throw new Error("Artifact creation timestamp is invalid.");
    return String(epoch).padStart(16, "0");
}

function indexEntries(artifact: ArtifactEnvelope): Array<[string, ArtifactIndex]> {
    const epoch = paddedEpoch(artifact.created_at);
    const index: ArtifactIndex = {
        schema_version: ARTIFACT_SCHEMA_VERSION,
        artifact_id: artifact.artifact_id,
        kind: artifact.kind,
        created_at: artifact.created_at,
        session_ref: artifact.session_ref,
        ...(artifact.node_ref ? { node_ref: artifact.node_ref } : {}),
        logical_bytes: artifact.logical_bytes,
        content_digest: artifact.content_digest,
        full_key: fullKey(artifact.artifact_id),
    };
    return [
        [`artifact/index/created/${epoch}/${artifact.artifact_id}`, index],
        [`artifact/index/session/${artifact.session_ref}/${epoch}/${artifact.artifact_id}`, index],
        [`artifact/index/kind/${artifact.kind}/${epoch}/${artifact.artifact_id}`, index],
    ];
}

async function assertCompatibleSchema(agent: AgentFS, allowMissing: boolean): Promise<void> {
    const version = await agent.kv.get<number>(META_KEY);
    if (version === undefined && allowMissing) return;
    if (version !== ARTIFACT_SCHEMA_VERSION) {
        throw new Error("Artifact store schema is missing or unsupported; run `cairn artifact doctor`.");
    }
}

async function readFullArtifacts(agent: AgentFS): Promise<ArtifactEnvelope[]> {
    const rows = await agent.kv.list(FULL_PREFIX);
    return rows.map((row) => artifactEnvelopeSchema.parse(row.value));
}

function sortedOldest(artifacts: ArtifactEnvelope[]): ArtifactEnvelope[] {
    return [...artifacts].sort((left, right) => {
        const time = Date.parse(left.created_at) - Date.parse(right.created_at);
        return time !== 0 ? time : left.artifact_id.localeCompare(right.artifact_id);
    });
}

function contentWithTruncation(input: ArtifactWriteInput, limits: ArtifactLimits): {
    content: Record<string, unknown>;
    logicalBytes: number;
    storedBytes: number;
    truncated: boolean;
    reason?: "artifact_limit" | "generated_file_metadata_only";
} {
    let content = structuredClone(input.content) as Record<string, unknown>;
    const logicalBytes = canonicalBytes(content).byteLength;
    let metadataOnly = false;
    if (input.kind === "generated_file") {
        const snapshot = typeof content.snapshot === "string" ? content.snapshot : undefined;
        if (content.binary === true
            || Number(content.logical_bytes) > limits.generatedFileSnapshotMaxBytes
            || (snapshot !== undefined && Buffer.byteLength(snapshot, "utf8") > limits.generatedFileSnapshotMaxBytes)) {
            delete content.snapshot;
            content.metadata_only = true;
            metadataOnly = true;
        }
    }

    const textSlots: Array<{ get: () => string; set: (value: string) => void }> = [];
    for (const key of ["text", "raw_summary", "snapshot"] as const) {
        if (typeof content[key] === "string") {
            textSlots.push({ get: () => String(content[key]), set: (value) => { content[key] = value; } });
        }
    }
    for (const key of ["task_goals", "decisions_made", "open_todos", "critical_error_traces"] as const) {
        const entries = content[key];
        if (!Array.isArray(entries)) continue;
        entries.forEach((_, index) => textSlots.push({
            get: () => String((content[key] as unknown[])[index] ?? ""),
            set: (value) => { (content[key] as unknown[])[index] = value; },
        }));
    }

    let storedBytes = canonicalBytes(content).byteLength;
    for (const slot of textSlots) {
        if (storedBytes <= limits.artifactMaxBytes) break;
        const overage = storedBytes - limits.artifactMaxBytes;
        const current = slot.get();
        const currentBytes = Buffer.byteLength(current, "utf8");
        slot.set(truncateUtf8(current, Math.max(0, currentBytes - overage)).text);
        storedBytes = canonicalBytes(content).byteLength;
    }
    if (storedBytes > limits.artifactMaxBytes) {
        throw new Error("Artifact metadata exceeds the configured per-artifact byte limit.");
    }
    return {
        content,
        logicalBytes,
        storedBytes,
        truncated: metadataOnly || storedBytes < logicalBytes,
        ...(metadataOnly ? { reason: "generated_file_metadata_only" as const }
            : storedBytes < logicalBytes ? { reason: "artifact_limit" as const } : {}),
    };
}

function requestDigestFor(input: {
    kind: ArtifactKind;
    session_ref: string;
    node_ref?: ArtifactNodeRef;
    media_type: string;
    provenance: ArtifactEnvelope["provenance"];
    supersedes?: string;
    content: unknown;
}): string {
    return sha256Hex(canonicalBytes({
        schema_version: ARTIFACT_SCHEMA_VERSION,
        kind: input.kind,
        session_ref: input.session_ref,
        ...(input.node_ref ? { node_ref: input.node_ref } : {}),
        media_type: input.media_type,
        provenance: input.provenance,
        ...(input.supersedes ? { supersedes: input.supersedes } : {}),
        content: input.content,
    }));
}

function prepareInput(projectRoot: string, candidate: unknown, limits: ArtifactLimits): {
    input: ArtifactWriteInput;
    content: Record<string, unknown>;
    logicalBytes: number;
    storedBytes: number;
    truncationReason?: "artifact_limit" | "generated_file_metadata_only";
    redaction: { applied: boolean; replacement_count: number };
    requestDigest: string;
} {
    let redacted;
    try {
        redacted = redactLocalValue(candidate, projectRoot);
    } catch {
        throw new Error("Artifact candidate failed privacy validation.");
    }
    let input: ArtifactWriteInput;
    try {
        input = artifactWriteInputSchema.parse(redacted.value);
    } catch {
        throw new Error("Artifact input is invalid.");
    }
    if (input.session_ref === "unknown") throw new Error("Artifact session reference must not be unknown.");
    if (input.node_ref?.key.toLowerCase().split(/[\/_-]/).includes("secret")) {
        throw new Error("Artifact node reference is invalid.");
    }
    const prepared = contentWithTruncation(input, limits);
    const requestDigest = requestDigestFor({
        kind: input.kind,
        session_ref: input.session_ref,
        ...(input.node_ref ? { node_ref: input.node_ref } : {}),
        media_type: input.media_type,
        provenance: input.provenance,
        ...(input.supersedes ? { supersedes: input.supersedes } : {}),
        content: prepared.content,
    });
    return {
        input,
        content: prepared.content,
        logicalBytes: prepared.logicalBytes,
        storedBytes: prepared.storedBytes,
        ...(prepared.reason ? { truncationReason: prepared.reason } : {}),
        redaction: { applied: redacted.applied, replacement_count: redacted.replacement_count },
        requestDigest,
    };
}

async function findByIdentifier(agent: AgentFS, identifier: string): Promise<ArtifactEnvelope> {
    const rows = await readFullArtifacts(agent);
    const matches = rows.filter((artifact) => artifact.artifact_id === identifier || artifact.artifact_id.startsWith(identifier));
    if (matches.length === 0) throw new Error("Artifact not found.");
    const exact = matches.find((artifact) => artifact.artifact_id === identifier);
    if (!exact && matches.length > 1) throw new Error("Artifact ID prefix is ambiguous.");
    return exact ?? matches[0];
}

function newestCompaction(artifacts: ArtifactEnvelope[], sessionRef?: string): ArtifactEnvelope | null {
    const candidates = artifacts.filter((artifact) => artifact.kind === "compaction_summary"
        && (!sessionRef || artifact.session_ref === sessionRef));
    return sortedOldest(candidates).at(-1) ?? null;
}

async function writeDerivedRows(agent: AgentFS, artifact: ArtifactEnvelope, requestDigest: string): Promise<void> {
    await agent.kv.set(fullKey(artifact.artifact_id), artifact);
    for (const [key, value] of indexEntries(artifact)) await agent.kv.set(key, value);
    await agent.kv.set(`${DEDUPE_PREFIX}${requestDigest}`, artifact.artifact_id);
    if (artifact.kind === "compaction_summary") {
        await agent.kv.set(`${SESSION_LATEST_PREFIX}${artifact.session_ref}`, artifact.artifact_id);
        await agent.kv.set(PROJECT_LATEST_KEY, artifact.artifact_id);
    }
}

async function deleteArtifactRows(agent: AgentFS, artifact: ArtifactEnvelope): Promise<void> {
    const rows = await agent.kv.list("");
    for (const row of rows) {
        const containsId = row.key === fullKey(artifact.artifact_id)
            || row.key.endsWith(`/${artifact.artifact_id}`)
            || row.value === artifact.artifact_id
            || canonicalJson(row.value).includes(artifact.artifact_id);
        if (containsId) await agent.kv.delete(row.key);
    }
}

async function rebuildPointers(agent: AgentFS): Promise<void> {
    for (const row of await agent.kv.list("compaction/latest/")) await agent.kv.delete(row.key);
    const artifacts = sortedOldest(await readFullArtifacts(agent));
    const bySession = new Map<string, ArtifactEnvelope>();
    for (const artifact of artifacts) if (artifact.kind === "compaction_summary") bySession.set(artifact.session_ref, artifact);
    for (const [session, artifact] of bySession) await agent.kv.set(`${SESSION_LATEST_PREFIX}${session}`, artifact.artifact_id);
    const latest = newestCompaction(artifacts);
    if (latest) await agent.kv.set(PROJECT_LATEST_KEY, latest.artifact_id);
}

async function rewriteArtifactDatabase(projectRoot: string, rows: Array<{ key: string; value: unknown }>): Promise<void> {
    const dbPath = getArtifactDbPath(projectRoot);
    const rewritePath = `${dbPath}.rewrite-${randomUUID()}`;
    const rewrite = await AgentFS.open({ id: "artifacts", path: rewritePath });
    try {
        await inImmediateTransaction(rewrite, async () => {
            for (const row of rows) await rewrite.kv.set(row.key, row.value);
        });
        await rewrite.getDatabase().exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
        await rewrite.close();
    }
    chmodSync(rewritePath, 0o600);
    for (const suffix of ["-wal", "-shm"]) {
        rmSync(`${rewritePath}${suffix}`, { force: true });
        rmSync(`${dbPath}${suffix}`, { force: true });
    }
    await atomicReplace(rewritePath, dbPath);
}

function planPrune(artifacts: ArtifactEnvelope[], limits: ArtifactLimits, options: Required<PruneOptions>): ArtifactPruneResult["removed"] {
    const sorted = sortedOldest(artifacts);
    const protectedId = options.includeProtected ? undefined : newestCompaction(sorted)?.artifact_id;
    const removed = new Map<string, ArtifactPruneResult["removed"][number]>();
    const mark = (artifact: ArtifactEnvelope, reason: ArtifactPruneResult["removed"][number]["reason"]): void => {
        if (artifact.artifact_id === protectedId || removed.has(artifact.artifact_id)) return;
        const index = indexEntries(artifact)[0][1];
        removed.set(artifact.artifact_id, { ...index, reason });
    };

    if (limits.retentionDays >= 0) {
        const cutoff = options.now.getTime() - limits.retentionDays * 86400000;
        for (const artifact of sorted) if (Date.parse(artifact.created_at) < cutoff) mark(artifact, "age");
    }
    const sessions = new Map<string, ArtifactEnvelope[]>();
    for (const artifact of sorted.filter((item) => item.kind === "compaction_summary" && !removed.has(item.artifact_id))) {
        const entries = sessions.get(artifact.session_ref) ?? [];
        entries.push(artifact);
        sessions.set(artifact.session_ref, entries);
    }
    for (const entries of sessions.values()) {
        const excess = Math.max(0, entries.length - limits.compactionMaxRevisions);
        entries.slice(0, excess).forEach((artifact) => mark(artifact, "revision"));
    }
    for (const session of new Set(sorted.map((artifact) => artifact.session_ref))) {
        const retained = sorted.filter((artifact) => artifact.session_ref === session && !removed.has(artifact.artifact_id));
        let total = retained.reduce((sum, artifact) => sum + artifact.logical_bytes, 0);
        for (const artifact of retained) {
            if (total <= limits.sessionMaxBytes) break;
            if (artifact.artifact_id === protectedId) continue;
            mark(artifact, "session_budget");
            total -= artifact.logical_bytes;
        }
    }
    const retained = sorted.filter((artifact) => !removed.has(artifact.artifact_id));
    let total = retained.reduce((sum, artifact) => sum + artifact.logical_bytes, 0);
    for (const artifact of retained) {
        if (total <= limits.storeMaxBytes) break;
        if (artifact.artifact_id === protectedId) continue;
        mark(artifact, "store_budget");
        total -= artifact.logical_bytes;
    }
    return sorted.filter((artifact) => removed.has(artifact.artifact_id)).map((artifact) => removed.get(artifact.artifact_id)!);
}

async function pruneInTransaction(agent: AgentFS, limits: ArtifactLimits, options: Required<PruneOptions>): Promise<ArtifactPruneResult> {
    const artifacts = await readFullArtifacts(agent);
    const removed = planPrune(artifacts, limits, options);
    if (!options.dryRun) {
        const byId = new Map(artifacts.map((artifact) => [artifact.artifact_id, artifact]));
        for (const item of removed) {
            const artifact = byId.get(item.artifact_id);
            if (artifact) await deleteArtifactRows(agent, artifact);
        }
        await rebuildPointers(agent);
    }
    const removedIds = new Set(removed.map((item) => item.artifact_id));
    const retained = artifacts.filter((artifact) => !removedIds.has(artifact.artifact_id));
    return {
        schema_version: ARTIFACT_SCHEMA_VERSION,
        dry_run: options.dryRun,
        removed,
        remaining_artifacts: retained.length,
        logical_bytes: retained.reduce((sum, artifact) => sum + artifact.logical_bytes, 0),
    };
}

export async function putArtifact(
    projectRoot: string,
    candidate: unknown,
    limits: ArtifactLimits = getArtifactLimits(),
    options: MutationOptions = {},
): Promise<{ schema_version: 1; artifact: ArtifactEnvelope; idempotent: boolean }> {
    const prepared = prepareInput(projectRoot, candidate, limits);
    return withMutationLock(projectRoot, async () => {
        const agent = await openArtifactStore(projectRoot, true);
        if (!agent) throw new Error("Unable to open the local artifact store.");
        try {
            return await inImmediateTransaction(agent, async () => {
                await assertCompatibleSchema(agent, true);
                const priorId = await agent.kv.get<string>(`${DEDUPE_PREFIX}${prepared.requestDigest}`);
                if (priorId) {
                    const prior = await agent.kv.get(fullKey(priorId));
                    if (prior !== undefined) {
                        return { schema_version: ARTIFACT_SCHEMA_VERSION, artifact: artifactEnvelopeSchema.parse(prior), idempotent: true };
                    }
                }
                if (prepared.input.supersedes) {
                    const superseded = await findByIdentifier(agent, prepared.input.supersedes);
                    if (superseded.session_ref !== prepared.input.session_ref) throw new Error("Superseded artifact must belong to the same session.");
                    if (superseded.kind !== prepared.input.kind) throw new Error("Superseded artifact must have the same kind.");
                }
                let content = prepared.content;
                if (prepared.input.kind === "compaction_summary") {
                    const sequenceKey = `${SEQUENCE_PREFIX}${prepared.input.session_ref}`;
                    const revision = (await agent.kv.get<number>(sequenceKey) ?? 0) + 1;
                    await agent.kv.set(sequenceKey, revision);
                    content = { ...content, revision };
                }
                const storedBytes = canonicalBytes(content).byteLength;
                const artifact = artifactEnvelopeSchema.parse({
                    schema_version: ARTIFACT_SCHEMA_VERSION,
                    artifact_id: `art_${randomUUID()}`,
                    kind: prepared.input.kind,
                    created_at: (options.now ?? new Date()).toISOString(),
                    session_ref: prepared.input.session_ref,
                    ...(prepared.input.node_ref ? { node_ref: prepared.input.node_ref } : {}),
                    media_type: prepared.input.media_type,
                    logical_bytes: Math.max(prepared.logicalBytes, storedBytes),
                    stored_bytes: storedBytes,
                    content_digest: sha256Hex(canonicalBytes(content)),
                    provenance: prepared.input.provenance,
                    redaction: prepared.redaction,
                    truncation: {
                        truncated: Boolean(prepared.truncationReason),
                        ...(prepared.truncationReason ? { reason: prepared.truncationReason } : {}),
                        original_bytes: Math.max(prepared.logicalBytes, storedBytes),
                        stored_bytes: storedBytes,
                    },
                    ...(prepared.input.supersedes ? { supersedes: prepared.input.supersedes } : {}),
                    content,
                });
                await agent.kv.set(META_KEY, ARTIFACT_SCHEMA_VERSION);
                await writeDerivedRows(agent, artifact, prepared.requestDigest);
                if (options.fault === "after-full-write") throw new Error("Injected artifact transaction fault.");
                await pruneInTransaction(agent, limits, {
                    dryRun: false,
                    includeProtected: false,
                    now: options.now ?? new Date(),
                });
                return { schema_version: ARTIFACT_SCHEMA_VERSION, artifact, idempotent: false };
            });
        } finally {
            await agent.close();
        }
    });
}

export async function putCompactionArtifact(projectRoot: string, candidate: unknown, limits = getArtifactLimits(), options: MutationOptions = {}) {
    const parsed = artifactWriteInputSchema.parse(candidate);
    if (parsed.kind !== "compaction_summary") throw new Error("Compaction artifact input has the wrong kind.");
    return putArtifact(projectRoot, parsed, limits, options);
}

export async function readArtifact(identifier: string, projectRoot = process.cwd()): Promise<ArtifactEnvelope> {
    const agent = await openArtifactStore(projectRoot, false);
    if (!agent) throw new Error("Artifact not found.");
    try {
        await assertCompatibleSchema(agent, false);
        return await findByIdentifier(agent, identifier);
    } finally {
        await agent.close();
    }
}

export async function listArtifacts(projectRoot = process.cwd(), filters: {
    kind?: ArtifactKind;
    session_ref?: string;
    node_ref?: ArtifactNodeRef;
    limit?: number;
    cursor?: string;
} = {}): Promise<ArtifactList> {
    const agent = await openArtifactStore(projectRoot, false);
    if (!agent) return { schema_version: ARTIFACT_SCHEMA_VERSION, artifacts: [], logical_bytes: 0 };
    try {
        await assertCompatibleSchema(agent, false);
        let artifacts = sortedOldest(await readFullArtifacts(agent)).reverse();
        if (filters.kind) artifacts = artifacts.filter((artifact) => artifact.kind === filters.kind);
        if (filters.session_ref) artifacts = artifacts.filter((artifact) => artifact.session_ref === filters.session_ref);
        if (filters.node_ref) artifacts = artifacts.filter((artifact) => canonicalJson(artifact.node_ref) === canonicalJson(filters.node_ref));
        const start = filters.cursor ? Number(Buffer.from(filters.cursor, "base64url").toString("utf8")) : 0;
        if (!Number.isSafeInteger(start) || start < 0) throw new Error("Artifact list cursor is invalid.");
        const limit = filters.limit ?? 50;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Artifact list limit must be between 1 and 100.");
        const page = artifacts.slice(start, start + limit);
        return {
            schema_version: ARTIFACT_SCHEMA_VERSION,
            artifacts: page,
            logical_bytes: artifacts.reduce((sum, artifact) => sum + artifact.logical_bytes, 0),
            ...(start + limit < artifacts.length ? { next_cursor: Buffer.from(String(start + limit)).toString("base64url") } : {}),
        };
    } finally {
        await agent.close();
    }
}

export async function readLatestCompaction(projectRoot = process.cwd(), sessionRef?: string): Promise<ArtifactEnvelope | null> {
    const agent = await openArtifactStore(projectRoot, false);
    if (!agent) return null;
    try {
        await assertCompatibleSchema(agent, false);
        const pointer = await agent.kv.get<string>(sessionRef ? `${SESSION_LATEST_PREFIX}${sessionRef}` : PROJECT_LATEST_KEY);
        if (pointer) {
            const stored = await agent.kv.get(fullKey(pointer));
            const parsed = artifactEnvelopeSchema.safeParse(stored);
            if (parsed.success && parsed.data.kind === "compaction_summary") return parsed.data;
        }
        return newestCompaction(await readFullArtifacts(agent), sessionRef);
    } finally {
        await agent.close();
    }
}

export const selectRecoveryArtifact = readLatestCompaction;

export async function deleteArtifact(identifier: string, projectRoot = process.cwd(), options: { dryRun?: boolean } = {}) {
    return withMutationLock(projectRoot, async () => {
        const agent = await openArtifactStore(projectRoot, false);
        if (!agent) throw new Error("Artifact not found.");
        let retainedRows: Array<{ key: string; value: unknown }> | undefined;
        let result;
        try {
            await assertCompatibleSchema(agent, false);
            const artifact = await findByIdentifier(agent, identifier);
            if (!options.dryRun) {
                await inImmediateTransaction(agent, async () => {
                    await deleteArtifactRows(agent, artifact);
                    await rebuildPointers(agent);
                });
                await agent.getDatabase().exec("PRAGMA wal_checkpoint(TRUNCATE)");
                retainedRows = await agent.kv.list("");
            }
            result = {
                schema_version: ARTIFACT_SCHEMA_VERSION,
                artifact_id: artifact.artifact_id,
                deleted: !options.dryRun,
                dry_run: Boolean(options.dryRun),
            };
        } finally {
            await agent.close();
        }
        if (retainedRows) await rewriteArtifactDatabase(projectRoot, retainedRows);
        return result;
    });
}

export async function pruneArtifacts(projectRoot: string, limits = getArtifactLimits(), options: PruneOptions = {}): Promise<ArtifactPruneResult> {
    return withMutationLock(projectRoot, async () => {
        const agent = await openArtifactStore(projectRoot, false);
        if (!agent) {
            return { schema_version: 1, dry_run: Boolean(options.dryRun), removed: [], remaining_artifacts: 0, logical_bytes: 0 };
        }
        let retainedRows: Array<{ key: string; value: unknown }> | undefined;
        let result: ArtifactPruneResult;
        try {
            await assertCompatibleSchema(agent, false);
            const resolved = {
                dryRun: options.dryRun ?? false,
                includeProtected: options.includeProtected ?? false,
                now: options.now ?? new Date(),
            };
            result = await inImmediateTransaction(agent, () => pruneInTransaction(agent, limits, resolved));
            if (!resolved.dryRun && result.removed.length > 0) {
                await agent.getDatabase().exec("PRAGMA wal_checkpoint(TRUNCATE)");
                retainedRows = await agent.kv.list("");
            }
        } finally {
            await agent.close();
        }
        if (retainedRows) await rewriteArtifactDatabase(projectRoot, retainedRows);
        return result;
    });
}

export async function recordUnsupportedCompactionAdapter(
    projectRoot: string,
    diagnostic: { harness?: string; harness_version?: string; reason?: string } = {},
): Promise<void> {
    await withMutationLock(projectRoot, async () => {
        const agent = await openArtifactStore(projectRoot, true);
        if (!agent) return;
        try {
            await inImmediateTransaction(agent, async () => {
                await assertCompatibleSchema(agent, true);
                if (await agent.kv.get<number>(META_KEY) === undefined) {
                    await agent.kv.set(META_KEY, ARTIFACT_SCHEMA_VERSION);
                }
                const rows = await agent.kv.list(DIAGNOSTIC_PREFIX);
                for (const row of rows.slice(0, Math.max(0, rows.length - MAX_DIAGNOSTICS + 1))) await agent.kv.delete(row.key);
                await agent.kv.set(`${DIAGNOSTIC_PREFIX}${String(Date.now()).padStart(16, "0")}-${randomUUID()}`, {
                    schema_version: 1,
                    harness_known: Boolean(diagnostic.harness),
                    version_known: Boolean(diagnostic.harness_version),
                    reason: ["unsupported_version", "invalid_shape", "no_summary"].includes(diagnostic.reason ?? "")
                        ? diagnostic.reason : "invalid_shape",
                });
            });
        } finally {
            await agent.close();
        }
    });
}

type DoctorDerivedState = {
    issues: string[];
    unsafeSequenceIssues: string[];
    expectedIndexes: Map<string, ArtifactIndex>;
    expectedDedupe: Map<string, string>;
    sequenceRepairs: Map<string, number>;
    actualIndexCount: number;
    repairNeeded: boolean;
};

function addIssue(issues: string[], issue: string): void {
    if (!issues.includes(issue)) issues.push(issue);
}

function requestDigestForArtifact(artifact: ArtifactEnvelope): string {
    const content = artifact.kind === "compaction_summary"
        ? Object.fromEntries(Object.entries(artifact.content).filter(([key]) => key !== "revision"))
        : artifact.content;
    return requestDigestFor({
        kind: artifact.kind,
        session_ref: artifact.session_ref,
        ...(artifact.node_ref ? { node_ref: artifact.node_ref } : {}),
        media_type: artifact.media_type,
        provenance: artifact.provenance,
        ...(artifact.supersedes ? { supersedes: artifact.supersedes } : {}),
        content,
    });
}

async function inspectDoctorDerivedState(agent: AgentFS, artifacts: ArtifactEnvelope[]): Promise<DoctorDerivedState> {
    const issues: string[] = [];
    const unsafeSequenceIssues: string[] = [];
    let repairNeeded = false;

    const expectedIndexes = new Map(artifacts.flatMap((artifact) => indexEntries(artifact)));
    const actualIndexes = new Map((await agent.kv.list(INDEX_PREFIX))
        .filter((row) => !row.key.startsWith(DEDUPE_PREFIX))
        .map((row) => [row.key, row.value]));
    for (const [key, value] of expectedIndexes) {
        if (canonicalJson(actualIndexes.get(key)) !== canonicalJson(value)) {
            addIssue(issues, "Missing or stale artifact index.");
            repairNeeded = true;
        }
    }
    for (const key of actualIndexes.keys()) {
        if (!expectedIndexes.has(key)) {
            addIssue(issues, "Orphan artifact index.");
            repairNeeded = true;
        }
    }

    const expectedDedupe = new Map<string, string>();
    for (const artifact of artifacts) {
        expectedDedupe.set(`${DEDUPE_PREFIX}${requestDigestForArtifact(artifact)}`, artifact.artifact_id);
    }
    const actualDedupe = new Map((await agent.kv.list(DEDUPE_PREFIX)).map((row) => [row.key, row.value]));
    for (const [key, value] of expectedDedupe) {
        if (actualDedupe.get(key) !== value) {
            addIssue(issues, "Missing or stale artifact dedupe binding.");
            repairNeeded = true;
        }
    }
    for (const key of actualDedupe.keys()) {
        if (!expectedDedupe.has(key)) {
            addIssue(issues, "Orphan artifact dedupe binding.");
            repairNeeded = true;
        }
    }

    const expectedPointers = new Map<string, string>();
    for (const artifact of sortedOldest(artifacts)) {
        if (artifact.kind === "compaction_summary") {
            expectedPointers.set(`${SESSION_LATEST_PREFIX}${artifact.session_ref}`, artifact.artifact_id);
        }
    }
    const latest = newestCompaction(artifacts);
    if (latest) expectedPointers.set(PROJECT_LATEST_KEY, latest.artifact_id);
    const actualPointers = new Map((await agent.kv.list("compaction/latest/")).map((row) => [row.key, row.value]));
    for (const [key, value] of expectedPointers) {
        if (actualPointers.get(key) !== value) {
            addIssue(issues, "Missing or stale compaction pointer.");
            repairNeeded = true;
        }
    }
    for (const key of actualPointers.keys()) {
        if (!expectedPointers.has(key)) {
            addIssue(issues, "Orphan compaction pointer.");
            repairNeeded = true;
        }
    }

    const retainedMaximums = new Map<string, number>();
    for (const artifact of artifacts) {
        if (artifact.kind !== "compaction_summary") continue;
        retainedMaximums.set(
            artifact.session_ref,
            Math.max(retainedMaximums.get(artifact.session_ref) ?? 0, artifact.content.revision),
        );
    }
    const sequenceRows = new Map((await agent.kv.list(SEQUENCE_PREFIX)).map((row) => [row.key, row.value]));
    const sequenceRepairs = new Map<string, number>();
    for (const [sessionRef, maximum] of retainedMaximums) {
        const key = `${SEQUENCE_PREFIX}${sessionRef}`;
        const value = sequenceRows.get(key);
        if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) < maximum) {
            addIssue(issues, "Missing or regressed compaction sequence.");
            sequenceRepairs.set(key, maximum);
            repairNeeded = true;
        }
    }
    for (const [key, value] of sequenceRows) {
        const sessionRef = key.slice(SEQUENCE_PREFIX.length);
        if (retainedMaximums.has(sessionRef)) continue;
        if (!sessionRef || !Number.isSafeInteger(value) || Number(value) <= 0) {
            addIssue(unsafeSequenceIssues, "Invalid non-derivable compaction sequence.");
        }
    }

    return {
        issues,
        unsafeSequenceIssues,
        expectedIndexes,
        expectedDedupe,
        sequenceRepairs,
        actualIndexCount: actualIndexes.size,
        repairNeeded,
    };
}

function inspectRetentionState(artifacts: ArtifactEnvelope[], limits: ArtifactLimits): string[] {
    const issues: string[] = [];
    const planned = planPrune(artifacts, limits, {
        dryRun: true,
        includeProtected: false,
        now: new Date(),
    });
    for (const item of planned) {
        if (item.reason === "age") addIssue(issues, "Artifact retention age limit exceeded.");
        if (item.reason === "revision") addIssue(issues, "Compaction revision retention limit exceeded.");
        if (item.reason === "session_budget") addIssue(issues, "Artifact session logical byte limit exceeded.");
        if (item.reason === "store_budget") addIssue(issues, "Artifact store logical byte limit exceeded.");
    }
    return issues;
}

export async function doctorArtifactStore(projectRoot = process.cwd(), repair = false, limits = getArtifactLimits()): Promise<ArtifactDoctorResult> {
    const dbPath = getArtifactDbPath(projectRoot);
    if (!existsSync(dbPath)) {
        return { schema_version: 1, exists: false, ok: true, repaired: false, integrity: "not_present", valid_artifacts: 0, indexed_artifacts: 0, issues: [] };
    }
    const sqliteHeader = readFileSync(dbPath).subarray(0, 16).toString("binary");
    if (sqliteHeader !== "SQLite format 3\0") {
        return { schema_version: 1, exists: true, ok: false, repaired: false, integrity: "failed", valid_artifacts: 0, indexed_artifacts: 0, issues: ["SQLite integrity check failed."] };
    }
    let agent: AgentFS | null = null;
    try {
        agent = await openArtifactStore(projectRoot, false);
        if (!agent) throw new Error("Artifact store is absent.");
        const integrityRows = await agent.getDatabase().pragma("integrity_check", {});
        const integrityOk = Array.isArray(integrityRows) && integrityRows.length > 0
            && integrityRows.every((row) => Object.values(row as Record<string, unknown>).includes("ok"));
        if (!integrityOk) {
            return { schema_version: 1, exists: true, ok: false, repaired: false, integrity: "failed", valid_artifacts: 0, indexed_artifacts: 0, issues: ["SQLite integrity check failed."] };
        }

        const authoritativeIssues: string[] = [];
        const version = await agent.kv.get<number>(META_KEY);
        if (version !== ARTIFACT_SCHEMA_VERSION) authoritativeIssues.push("Artifact schema metadata is missing or unsupported.");
        const artifacts: ArtifactEnvelope[] = [];
        for (const row of await agent.kv.list(FULL_PREFIX)) {
            const parsed = artifactEnvelopeSchema.safeParse(row.value);
            if (!parsed.success) {
                addIssue(authoritativeIssues, "Invalid authoritative full record.");
                continue;
            }
            if (sha256Hex(canonicalBytes(parsed.data.content)) !== parsed.data.content_digest) {
                addIssue(authoritativeIssues, "Authoritative full record digest mismatch.");
                continue;
            }
            artifacts.push(parsed.data);
        }

        let derived = await inspectDoctorDerivedState(agent, artifacts);
        const retentionIssues = inspectRetentionState(artifacts, limits);
        let repaired = false;
        if (repair
            && derived.repairNeeded
            && authoritativeIssues.length === 0
            && derived.unsafeSequenceIssues.length === 0) {
            const repairAgent = agent;
            await inImmediateTransaction(repairAgent, async () => {
                for (const row of await repairAgent.kv.list(INDEX_PREFIX)) await repairAgent.kv.delete(row.key);
                for (const [key, value] of derived.expectedIndexes) await repairAgent.kv.set(key, value);
                for (const [key, value] of derived.expectedDedupe) await repairAgent.kv.set(key, value);
                await rebuildPointers(repairAgent);
                for (const [key, value] of derived.sequenceRepairs) await repairAgent.kv.set(key, value);
            });
            repaired = true;
            derived = await inspectDoctorDerivedState(agent, artifacts);
        }
        const issues = [
            ...authoritativeIssues,
            ...derived.issues,
            ...derived.unsafeSequenceIssues,
            ...retentionIssues,
        ];
        return {
            schema_version: 1,
            exists: true,
            ok: issues.length === 0,
            repaired,
            integrity: "ok",
            valid_artifacts: artifacts.length,
            indexed_artifacts: derived.actualIndexCount,
            issues,
        };
    } catch {
        return { schema_version: 1, exists: true, ok: false, repaired: false, integrity: "failed", valid_artifacts: 0, indexed_artifacts: 0, issues: ["SQLite integrity or authoritative store open failed."] };
    } finally {
        if (agent) await agent.close().catch(() => undefined);
    }
}
