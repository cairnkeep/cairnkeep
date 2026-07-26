import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentFS } from "agentfs-sdk";

import {
    NODE_SCHEMA_VERSION,
    canonicalTagsSchema,
    memoryImportEnvelopeSchema,
    nodeMetadataSchema,
    nodeTypeSchema,
    type MemoryImportAction,
    type MemoryImportEnvelope,
    type MemoryImportNode,
    type MemoryImportResult,
    type NodeMetadata as SchemaNodeMetadata,
    type NodeType,
} from "./node-schema.js";

export type NodeMetadata = SchemaNodeMetadata;

export type TypedMemoryNode = {
    schema_version: 1;
    address_space: "memory";
    scope: string;
    key: string;
    value: string;
    node_type: NodeType;
    tags: string[];
};

export type TypedHistorySnapshot = {
    schema_version: 1;
    event: "supersede" | "delete";
    value: string;
    node_type: NodeType;
    tags: string[];
    at: string;
    reason: string | null;
};

export type TypedNodeMutationResult = {
    ok: true;
    scope: string;
    key: string;
    created?: boolean;
    deleted?: boolean;
    missing?: boolean;
    snapshot_key: string | null;
    previous_value?: string;
    final_snapshot?: TypedHistorySnapshot;
};

type DatabaseRow = Record<string, unknown>;

const METADATA_TABLE = "cairn_node_metadata_v1";
const REPLAY_TABLE = "cairn_node_import_replays_v1";
const HISTORY_NAMESPACE = "__history__";
const REVIEWED_NAMESPACE = "__reviewed__";
const DEFAULT_METADATA: NodeMetadata = { schema_version: NODE_SCHEMA_VERSION, node_type: "memory", tags: [] };
let lastMutationTime = 0;

function mutationTimestamp(): string {
    const now = Date.now();
    lastMutationTime = Math.max(now, lastMutationTime + 1);
    return new Date(lastMutationTime).toISOString();
}

function normalizeValue(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === undefined || value === null) return "";
    return JSON.stringify(value);
}

function normalizedMetadata(nodeType: NodeType = "memory", tags: string[] = []): NodeMetadata {
    return nodeMetadataSchema.parse({ schema_version: NODE_SCHEMA_VERSION, node_type: nodeType, tags });
}

function historyPrefix(key: string): string {
    return `${HISTORY_NAMESPACE}/${key}/`;
}

function historyKey(key: string, at: string): string {
    return `${historyPrefix(key)}${at}-${randomUUID()}`;
}

function injectMutationFailure(stage: string): void {
    if (process.env.CAIRN_TEST_FAIL_NODE_MUTATION === stage) throw new Error(`Injected node mutation failure at ${stage}.`);
}

async function tableExists(agent: AgentFS, table: string): Promise<boolean> {
    const row = await agent.getDatabase().prepare("SELECT name FROM sqlite_master WHERE type = ? AND name = ?").get("table", table) as DatabaseRow | undefined;
    return row?.name === table;
}

async function ensureTables(agent: AgentFS): Promise<void> {
    await agent.getDatabase().exec(`
        CREATE TABLE IF NOT EXISTS ${METADATA_TABLE} (
            key TEXT PRIMARY KEY,
            schema_version INTEGER NOT NULL,
            node_type TEXT NOT NULL,
            tags_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS ${REPLAY_TABLE} (
            import_id TEXT PRIMARY KEY,
            batch_digest TEXT NOT NULL,
            committed_at TEXT NOT NULL
        );
    `);
}

async function storedMetadata(agent: AgentFS, key: string): Promise<NodeMetadata | undefined> {
    if (!await tableExists(agent, METADATA_TABLE)) return undefined;
    const row = await agent.getDatabase().prepare(
        `SELECT schema_version, node_type, tags_json FROM ${METADATA_TABLE} WHERE key = ?`,
    ).get(key) as DatabaseRow | undefined;
    if (!row) return undefined;
    return nodeMetadataSchema.parse({
        schema_version: Number(row.schema_version),
        node_type: row.node_type,
        tags: JSON.parse(String(row.tags_json)),
    });
}

async function setMetadata(agent: AgentFS, key: string, metadata: NodeMetadata, at: string): Promise<void> {
    await agent.getDatabase().prepare(`
        INSERT INTO ${METADATA_TABLE}(key, schema_version, node_type, tags_json, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            schema_version = excluded.schema_version,
            node_type = excluded.node_type,
            tags_json = excluded.tags_json,
            updated_at = excluded.updated_at
    `).run(key, metadata.schema_version, metadata.node_type, JSON.stringify(metadata.tags), at);
}

export async function inImmediateNodeTransaction<T>(agent: AgentFS, operation: () => Promise<T>): Promise<T> {
    const transaction = agent.getDatabase().transaction(operation);
    const immediate = (transaction as typeof transaction & { immediate: typeof transaction }).immediate;
    return immediate();
}

export async function getNodeMetadata(agent: AgentFS, key: string): Promise<NodeMetadata> {
    return await storedMetadata(agent, key) ?? { ...DEFAULT_METADATA, tags: [] };
}

export async function attachNodeMetadata(
    agent: AgentFS,
    scope: string,
    entry: { key: string; value: unknown },
): Promise<TypedMemoryNode> {
    const metadata = await getNodeMetadata(agent, entry.key);
    return {
        schema_version: NODE_SCHEMA_VERSION,
        address_space: "memory",
        scope,
        key: entry.key,
        value: normalizeValue(entry.value),
        node_type: metadata.node_type,
        tags: metadata.tags,
    };
}

export async function getTypedNode(agent: AgentFS, scope: string, key: string): Promise<TypedMemoryNode | null> {
    const value = await agent.kv.get(key);
    return value === undefined ? null : attachNodeMetadata(agent, scope, { key, value });
}

export async function createTypedNode(options: {
    agent: AgentFS;
    scope: string;
    key: string;
    value: string;
    node_type?: NodeType;
    tags?: string[];
}): Promise<TypedNodeMutationResult> {
    const metadata = normalizedMetadata(options.node_type, options.tags);
    return inImmediateNodeTransaction(options.agent, async () => {
        await ensureTables(options.agent);
        const current = await options.agent.kv.get(options.key);
        if (current !== undefined) {
            const currentNode = await attachNodeMetadata(options.agent, options.scope, { key: options.key, value: current });
            if (currentNode.value === options.value && currentNode.node_type === metadata.node_type && JSON.stringify(currentNode.tags) === JSON.stringify(metadata.tags)) {
                return { ok: true, scope: options.scope, key: options.key, created: false, snapshot_key: null };
            }
            throw new Error(`NODE_EXISTS: ${options.key} differs; use memory_supersede.`);
        }
        const at = mutationTimestamp();
        await options.agent.kv.set(options.key, options.value);
        injectMutationFailure("after-value");
        await setMetadata(options.agent, options.key, metadata, at);
        return { ok: true, scope: options.scope, key: options.key, created: true, snapshot_key: null };
    });
}

export async function supersedeTypedNode(options: {
    agent: AgentFS;
    scope: string;
    key: string;
    value?: string;
    node_type?: NodeType;
    tags?: string[];
    reason?: string;
}): Promise<TypedNodeMutationResult> {
    return inImmediateNodeTransaction(options.agent, async () => {
        await ensureTables(options.agent);
        const current = await options.agent.kv.get(options.key);
        if (current === undefined) {
            const metadata = normalizedMetadata(options.node_type, options.tags);
            const value = options.value ?? "";
            const at = mutationTimestamp();
            await options.agent.kv.set(options.key, value);
            injectMutationFailure("after-value");
            await setMetadata(options.agent, options.key, metadata, at);
            return { ok: true, scope: options.scope, key: options.key, created: true, snapshot_key: null };
        }
        const previous = await attachNodeMetadata(options.agent, options.scope, { key: options.key, value: current });
        const metadata = normalizedMetadata(options.node_type ?? previous.node_type, options.tags ?? previous.tags);
        const value = options.value ?? previous.value;
        const at = mutationTimestamp();
        const snapshot: TypedHistorySnapshot = {
            schema_version: NODE_SCHEMA_VERSION,
            event: "supersede",
            value: previous.value,
            node_type: previous.node_type,
            tags: previous.tags,
            at,
            reason: options.reason ?? null,
        };
        const snapshot_key = historyKey(options.key, at);
        await options.agent.kv.set(snapshot_key, snapshot);
        await options.agent.kv.set(options.key, value);
        injectMutationFailure("after-value");
        await setMetadata(options.agent, options.key, metadata, at);
        return { ok: true, scope: options.scope, key: options.key, created: false, snapshot_key, previous_value: previous.value };
    });
}

export async function deleteTypedNode(options: {
    agent: AgentFS;
    scope: string;
    key: string;
    reason?: string;
}): Promise<TypedNodeMutationResult> {
    return inImmediateNodeTransaction(options.agent, async () => {
        await ensureTables(options.agent);
        const current = await options.agent.kv.get(options.key);
        if (current === undefined) return { ok: true, scope: options.scope, key: options.key, deleted: false, missing: true, snapshot_key: null };
        const node = await attachNodeMetadata(options.agent, options.scope, { key: options.key, value: current });
        const at = mutationTimestamp();
        const snapshot: TypedHistorySnapshot = {
            schema_version: NODE_SCHEMA_VERSION,
            event: "delete",
            value: node.value,
            node_type: node.node_type,
            tags: node.tags,
            at,
            reason: options.reason ?? null,
        };
        const snapshot_key = historyKey(options.key, at);
        await options.agent.kv.set(snapshot_key, snapshot);
        await options.agent.kv.delete(options.key);
        injectMutationFailure("after-value");
        await options.agent.getDatabase().prepare(`DELETE FROM ${METADATA_TABLE} WHERE key = ?`).run(options.key);
        return { ok: true, scope: options.scope, key: options.key, deleted: true, missing: false, snapshot_key, final_snapshot: snapshot };
    });
}

export async function listTypedHistory(agent: AgentFS, key: string): Promise<Array<TypedHistorySnapshot & { key: string }>> {
    const entries = await agent.kv.list(historyPrefix(key));
    return entries.map((entry) => {
        const value = entry.value as Partial<TypedHistorySnapshot>;
        if (value?.schema_version === NODE_SCHEMA_VERSION && (value.event === "supersede" || value.event === "delete")) {
            return { key: entry.key, ...value } as TypedHistorySnapshot & { key: string };
        }
        return {
            key: entry.key,
            schema_version: NODE_SCHEMA_VERSION,
            event: "supersede",
            value: normalizeValue((value as { value?: unknown })?.value ?? entry.value),
            node_type: "memory",
            tags: [],
            at: String((value as { superseded_at?: unknown })?.superseded_at ?? ""),
            reason: (value as { superseded_reason?: string | null })?.superseded_reason ?? null,
        } satisfies TypedHistorySnapshot & { key: string };
    }).sort((left, right) => left.key.localeCompare(right.key));
}

export async function applyReviewedTypedNode(options: {
    agent: AgentFS;
    scope: string;
    review_id: string;
    key: string;
    value: string;
    node_type?: NodeType;
    tags?: string[];
}): Promise<TypedNodeMutationResult> {
    return supersedeTypedNode({ ...options, reason: `reviewed memory ${options.review_id}` });
}

export async function invalidateReviewedTypedNode(options: {
    agent: AgentFS;
    scope: string;
    review_id: string;
    key: string;
    reason?: string;
}): Promise<TypedNodeMutationResult> {
    return deleteTypedNode({ ...options, reason: options.reason ?? `reviewed memory ${options.review_id} invalidated` });
}

export type MemoryImportPlan = {
    envelope: MemoryImportEnvelope;
    batch_digest: string;
    actions: MemoryImportAction[];
    conflict: boolean;
};

function canonicalBatch(envelope: MemoryImportEnvelope): string {
    return JSON.stringify({
        schema_version: envelope.schema_version,
        scope: envelope.scope,
        address_space: envelope.address_space,
        nodes: envelope.nodes.map((node) => ({
            key: node.key,
            value: node.value,
            node_type: node.node_type,
            tags: node.tags,
            ...(node.note ? { note: node.note } : {}),
        })).sort((left, right) => left.key.localeCompare(right.key)),
    });
}

function batchDigest(envelope: MemoryImportEnvelope): string {
    return createHash("sha256").update("cairnkeep:memory-import:v1\0").update(canonicalBatch(envelope)).digest("hex");
}

async function classifyImportNode(agent: AgentFS | null, scope: string, node: MemoryImportNode, policy: MemoryImportEnvelope["conflict_policy"]): Promise<MemoryImportAction> {
    if (!agent) return { key: node.key, action: "would_create" };
    const current = await getTypedNode(agent, scope, node.key);
    if (!current) return { key: node.key, action: "would_create" };
    const same = current.value === node.value && current.node_type === node.node_type && JSON.stringify(current.tags) === JSON.stringify(node.tags);
    if (same) return { key: node.key, action: "unchanged" };
    return policy === "supersede"
        ? { key: node.key, action: "would_replace" }
        : { key: node.key, action: "rejected", code: "CONFLICT" };
}

export async function planMemoryImport(agent: AgentFS | null, input: unknown): Promise<MemoryImportPlan> {
    const envelope = memoryImportEnvelopeSchema.parse(input);
    if (envelope.address_space !== "memory") throw new Error("ADDRESS_SPACE_UNSUPPORTED: node-store accepts memory imports only.");
    const actions = [] as MemoryImportAction[];
    for (const node of [...envelope.nodes].sort((left, right) => left.key.localeCompare(right.key))) {
        actions.push(await classifyImportNode(agent, envelope.scope, node, envelope.conflict_policy));
    }
    return { envelope, batch_digest: batchDigest(envelope), actions, conflict: actions.some((action) => action.action === "rejected") };
}

function counts(actions: MemoryImportAction[], dryRun: boolean): MemoryImportResult["counts"] {
    const result: MemoryImportResult["counts"] = { unchanged: 0, rejected: 0 };
    if (dryRun) {
        result.would_create = 0;
        result.would_replace = 0;
    } else {
        result.created = 0;
        result.replaced = 0;
    }
    for (const action of actions) {
        if (action.action === "would_create") result.would_create = (result.would_create ?? 0) + 1;
        else if (action.action === "would_replace") result.would_replace = (result.would_replace ?? 0) + 1;
        else if (action.action === "created") result.created = (result.created ?? 0) + 1;
        else if (action.action === "replaced") result.replaced = (result.replaced ?? 0) + 1;
        else if (action.action === "unchanged") result.unchanged += 1;
        else result.rejected += 1;
    }
    return result;
}

export async function commitMemoryImport(agent: AgentFS, inputPlan: MemoryImportPlan): Promise<MemoryImportResult> {
    if (inputPlan.envelope.dry_run) {
        return {
            schema_version: NODE_SCHEMA_VERSION,
            scope: inputPlan.envelope.scope,
            address_space: inputPlan.envelope.address_space,
            batch_digest: inputPlan.batch_digest,
            ...(inputPlan.envelope.import_id ? { import_id: inputPlan.envelope.import_id } : {}),
            dry_run: true,
            conflict_policy: inputPlan.envelope.conflict_policy,
            committed: false,
            counts: counts(inputPlan.actions, true),
            actions: inputPlan.actions,
        };
    }
    return inImmediateNodeTransaction(agent, async () => {
        await ensureTables(agent);
        const { envelope, batch_digest } = inputPlan;
        if (envelope.import_id) {
            const replay = await agent.getDatabase().prepare(`SELECT batch_digest FROM ${REPLAY_TABLE} WHERE import_id = ?`).get(envelope.import_id) as DatabaseRow | undefined;
            if (replay && replay.batch_digest !== batch_digest) throw new Error(`IMPORT_ID_REUSE: ${envelope.import_id}`);
            if (replay) {
                const actions = envelope.nodes.map((node) => ({ key: node.key, action: "unchanged" as const })).sort((a, b) => a.key.localeCompare(b.key));
                return {
                    schema_version: NODE_SCHEMA_VERSION,
                    scope: envelope.scope,
                    address_space: envelope.address_space,
                    batch_digest,
                    import_id: envelope.import_id,
                    dry_run: false,
                    conflict_policy: envelope.conflict_policy,
                    committed: true,
                    replayed: true,
                    counts: counts(actions, false),
                    actions,
                };
            }
        }
        const currentPlan = await planMemoryImport(agent, envelope);
        if (currentPlan.conflict) throw new Error("CONFLICT: import contains a differing live node.");
        const committedActions: MemoryImportAction[] = [];
        let mutations = 0;
        for (const planned of currentPlan.actions) {
            const node = envelope.nodes.find((candidate) => candidate.key === planned.key) as MemoryImportNode;
            if (planned.action === "unchanged") {
                committedActions.push(planned);
                continue;
            }
            const existing = await getTypedNode(agent, envelope.scope, node.key);
            if (existing) {
                const at = mutationTimestamp();
                const snapshot: TypedHistorySnapshot = { schema_version: 1, event: "supersede", value: existing.value, node_type: existing.node_type, tags: existing.tags, at, reason: `import ${envelope.import_id ?? batch_digest}` };
                await agent.kv.set(historyKey(node.key, at), snapshot);
                await agent.kv.set(node.key, node.value);
                await setMetadata(agent, node.key, normalizedMetadata(node.node_type, node.tags), at);
                committedActions.push({ key: node.key, action: "replaced" });
            } else {
                const at = mutationTimestamp();
                await agent.kv.set(node.key, node.value);
                await setMetadata(agent, node.key, normalizedMetadata(node.node_type, node.tags), at);
                committedActions.push({ key: node.key, action: "created" });
            }
            mutations += 1;
            if (Number(process.env.CAIRN_TEST_FAIL_IMPORT_AFTER) === mutations) throw new Error("Injected import failure.");
        }
        if (envelope.import_id) {
            await agent.getDatabase().prepare(`INSERT INTO ${REPLAY_TABLE}(import_id, batch_digest, committed_at) VALUES (?, ?, ?)`).run(envelope.import_id, batch_digest, new Date().toISOString());
        }
        committedActions.sort((left, right) => left.key.localeCompare(right.key));
        return {
            schema_version: NODE_SCHEMA_VERSION,
            scope: envelope.scope,
            address_space: envelope.address_space,
            batch_digest,
            ...(envelope.import_id ? { import_id: envelope.import_id } : {}),
            dry_run: false,
            conflict_policy: envelope.conflict_policy,
            committed: true,
            counts: counts(committedActions, false),
            actions: committedActions,
        };
    });
}

export type TypedNodeDoctorResult = { schema_version: 1; exists: boolean; ok: boolean; repaired: boolean; issues: string[] };

export async function doctorTypedNodeStore(options: { scope: string; baseDir: string; repair?: boolean }): Promise<TypedNodeDoctorResult> {
    const dbPath = join(options.baseDir, `${options.scope}.db`);
    if (!existsSync(dbPath)) return { schema_version: 1, exists: false, ok: true, repaired: false, issues: [] };
    // AgentFS opens databases in read-write WAL mode, which can checkpoint the
    // WAL even when the caller only reads. Inspect an exact disposable copy so
    // a non-repair doctor run is byte-pure for the authoritative store.
    const scratch = mkdtempSync(join(tmpdir(), "cairn-node-doctor-"));
    const scratchPath = join(scratch, `${options.scope}.db`);
    for (const suffix of ["", "-wal", "-shm"]) {
        if (existsSync(`${dbPath}${suffix}`)) copyFileSync(`${dbPath}${suffix}`, `${scratchPath}${suffix}`);
    }
    const inspectionAgent = await AgentFS.open({ id: options.scope, path: scratchPath });
    const issues: string[] = [];
    const orphanKeys: string[] = [];
    try {
        if (await tableExists(inspectionAgent, METADATA_TABLE)) {
            const rows = await inspectionAgent.getDatabase().prepare(`SELECT key, schema_version, node_type, tags_json FROM ${METADATA_TABLE} ORDER BY key`).all() as DatabaseRow[];
            for (const row of rows) {
                try {
                    nodeMetadataSchema.parse({ schema_version: Number(row.schema_version), node_type: row.node_type, tags: JSON.parse(String(row.tags_json)) });
                } catch {
                    issues.push(`Invalid authoritative metadata for ${String(row.key)}.`);
                    continue;
                }
                if (await inspectionAgent.kv.get(String(row.key)) === undefined) {
                    issues.push(`Orphan metadata for ${String(row.key)}.`);
                    orphanKeys.push(String(row.key));
                }
            }
        }
        if (await tableExists(inspectionAgent, REPLAY_TABLE)) {
            const rows = await inspectionAgent.getDatabase().prepare(`SELECT import_id, batch_digest FROM ${REPLAY_TABLE} ORDER BY import_id`).all() as DatabaseRow[];
            for (const row of rows) {
                if (!/^[a-f0-9]{64}$/.test(String(row.batch_digest))) issues.push(`Invalid authoritative replay digest for ${String(row.import_id)}.`);
            }
        }
    } finally {
        await inspectionAgent.close();
        rmSync(scratch, { recursive: true, force: true });
    }
    const onlyOrphans = issues.length > 0 && issues.every((issue) => issue.startsWith("Orphan metadata"));
    if (options.repair && onlyOrphans) {
        const agent = await AgentFS.open({ id: options.scope, path: dbPath });
        try {
            await inImmediateNodeTransaction(agent, async () => {
                for (const key of orphanKeys) await agent.getDatabase().prepare(`DELETE FROM ${METADATA_TABLE} WHERE key = ?`).run(key);
            });
        } finally {
            await agent.close();
        }
        return { schema_version: 1, exists: true, ok: true, repaired: true, issues: [] };
    }
    return { schema_version: 1, exists: true, ok: issues.length === 0, repaired: false, issues };
}

export const doctorNodeStore = doctorTypedNodeStore;

export async function createNodeDoctorFixture(options: { root: string; kind: "malformed_type" | "malformed_tags" | "orphan_metadata" | "divergent_replay" }): Promise<{ root: string }> {
    mkdirSync(options.root, { recursive: true });
    const agent = await AgentFS.open({ id: "identity", path: join(options.root, "identity.db") });
    try {
        await ensureTables(agent);
        if (options.kind !== "orphan_metadata") await agent.kv.set("knowledge/doctor", "doctor fixture");
        if (options.kind === "malformed_type") {
            await agent.getDatabase().prepare(`INSERT INTO ${METADATA_TABLE}(key,schema_version,node_type,tags_json,updated_at) VALUES (?,?,?,?,?)`).run("knowledge/doctor", 1, "invalid", "[]", new Date().toISOString());
        } else if (options.kind === "malformed_tags") {
            await agent.getDatabase().prepare(`INSERT INTO ${METADATA_TABLE}(key,schema_version,node_type,tags_json,updated_at) VALUES (?,?,?,?,?)`).run("knowledge/doctor", 1, "knowledge", "not-json", new Date().toISOString());
        } else if (options.kind === "orphan_metadata") {
            await agent.getDatabase().prepare(`INSERT INTO ${METADATA_TABLE}(key,schema_version,node_type,tags_json,updated_at) VALUES (?,?,?,?,?)`).run("knowledge/orphan", 1, "knowledge", "[]", new Date().toISOString());
        } else {
            await agent.getDatabase().prepare(`INSERT INTO ${REPLAY_TABLE}(import_id,batch_digest,committed_at) VALUES (?,?,?)`).run("doctor-replay", "invalid", new Date().toISOString());
        }
    } finally {
        await agent.close();
    }
    return { root: options.root };
}

export const INTERNAL_NODE_TABLES = { metadata: METADATA_TABLE, replays: REPLAY_TABLE } as const;
export const INTERNAL_NODE_NAMESPACES = { history: HISTORY_NAMESPACE, reviewed: REVIEWED_NAMESPACE } as const;
