import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { AgentFS } from "agentfs-sdk";
import { z } from "zod";

import { hashText } from "./embeddings.js";
import { applyReviewedTypedNode, invalidateReviewedTypedNode } from "./node-store.js";
import {
    assertMemoryProposalCandidateConsistency,
    digestText,
    expectedMemoryProposalOperation,
    type MemoryProposalCandidate,
} from "./memory-proposal-schema.js";

export const HISTORY_NAMESPACE = "__history__";
export const REVIEWED_NAMESPACE = "__reviewed__";
export const REVIEW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SCOPE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const reviewedRecordSchema = z.object({
    schema_version: z.literal(1),
    review_id: z.string(),
    key: z.string(),
    value_hash: z.string(),
    state: z.enum(["active", "superseded", "invalidated"]),
    applied_at: z.string(),
    superseded_at: z.string().optional(),
    superseded_by: z.string().optional(),
    invalidated_at: z.string().optional(),
    invalidation_reason: z.string().optional(),
}).strict();
export type ReviewedRecord = z.infer<typeof reviewedRecordSchema>;

export type ReviewedMemoryOptions = {
    cwd?: string;
    projectId?: string;
    typed?: boolean;
};

function expandHome(value: string): string {
    if (value === "~") return homedir();
    return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

function baseDir(): string {
    return resolve(expandHome(process.env.CAIRN_AGENTFS_BASE_DIR ?? "~/.cairnkeep"));
}

export function resolveMemoryScopePath(scope: string, options: ReviewedMemoryOptions = {}): string {
    if (scope === "project") {
        return options.projectId
            ? resolve(baseDir(), "projects", `${options.projectId}.db`)
            : resolve(options.cwd ?? process.cwd(), ".agentfs", "project.db");
    }
    if (scope === "all") throw new Error('Scope "all" is read-only; choose one concrete scope.');
    if (!SCOPE_PATTERN.test(scope)) throw new Error(`Invalid scope "${scope}": must be a concrete kebab-case scope or "project".`);
    const root = baseDir();
    const dbPath = resolve(root, `${scope}.db`);
    const rel = relative(root, dbPath);
    if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Invalid scope "${scope}": resolves outside the base directory.`);
    return dbPath;
}

async function openMemoryScope(scope: string, create: boolean, options: ReviewedMemoryOptions = {}): Promise<AgentFS | null> {
    const path = resolveMemoryScopePath(scope, options);
    if (!create && !existsSync(path)) return null;
    if (create) mkdirSync(dirname(path), { recursive: true });
    return AgentFS.open({ id: scope, path });
}

function normalizeValue(value: unknown): string {
    if (typeof value === "string") return value;
    if (value === undefined || value === null) return "";
    return JSON.stringify(value);
}

export function assertWritableMemoryKey(key: string): void {
    if (key === HISTORY_NAMESPACE || key.startsWith(`${HISTORY_NAMESPACE}/`)
        || key === REVIEWED_NAMESPACE || key.startsWith(`${REVIEWED_NAMESPACE}/`)) {
        throw new Error(`Keys under ${HISTORY_NAMESPACE}/ and ${REVIEWED_NAMESPACE}/ are reserved.`);
    }
}

function historySnapshotKey(key: string, timestamp: string): string {
    return `${HISTORY_NAMESPACE}/${key}/${timestamp}-${randomUUID()}`;
}

function recordKey(reviewId: string): string {
    return `${REVIEWED_NAMESPACE}/${reviewId}`;
}

function parseRecord(value: unknown): ReviewedRecord {
    const parsed = reviewedRecordSchema.safeParse(value);
    if (!parsed.success) throw new Error("Stored reviewed-memory provenance is invalid; refusing to continue.");
    return parsed.data;
}

async function immediate<T>(agent: AgentFS, operation: () => Promise<T>): Promise<T> {
    const transaction = agent.getDatabase().transaction(operation);
    const run = (transaction as typeof transaction & { immediate: typeof transaction }).immediate;
    return run();
}

async function supersedeActiveRecord(agent: AgentFS, key: string, reviewId: string, at: string): Promise<void> {
    for (const entry of await agent.kv.list(`${REVIEWED_NAMESPACE}/`)) {
        const prior = parseRecord(entry.value);
        if (prior.state === "active" && prior.key === key && prior.review_id !== reviewId) {
            await agent.kv.set(entry.key, { ...prior, state: "superseded", superseded_at: at, superseded_by: reviewId } satisfies ReviewedRecord);
        }
    }
}

async function writeReviewed(
    agent: AgentFS,
    scope: string,
    reviewId: string,
    key: string,
    value: string,
    typed: boolean,
    appliedAt: string,
): Promise<string | null> {
    await supersedeActiveRecord(agent, key, reviewId, appliedAt);
    let snapshotKey: string | null = null;
    if (typed) {
        const changed = await applyReviewedTypedNode({
            agent, scope, review_id: reviewId, key, value, node_type: "memory", tags: [], in_transaction: true,
        });
        snapshotKey = changed.snapshot_key;
    } else {
        const previous = await agent.kv.get(key);
        const previousValue = previous === undefined ? undefined : normalizeValue(previous);
        if (previousValue !== undefined && previousValue !== value) {
            snapshotKey = historySnapshotKey(key, appliedAt);
            await agent.kv.set(snapshotKey, {
                value: previousValue,
                superseded_at: appliedAt,
                superseded_reason: `reviewed memory ${reviewId}`,
            });
        }
        await agent.kv.set(key, value);
    }
    await agent.kv.set(recordKey(reviewId), {
        schema_version: 1,
        review_id: reviewId,
        key,
        value_hash: hashText(value),
        state: "active",
        applied_at: appliedAt,
    } satisfies ReviewedRecord);
    return snapshotKey;
}

export async function applyReviewedMemory(
    scope: string,
    reviewId: string,
    key: string,
    value: string,
    options: ReviewedMemoryOptions = {},
): Promise<{ ok: true; scope: string; review_id: string; key: string; applied: boolean; idempotent: boolean; snapshot_key: string | null }> {
    assertWritableMemoryKey(key);
    if (!REVIEW_ID_PATTERN.test(reviewId)) throw new Error("Invalid review id.");
    const agent = await openMemoryScope(scope, true, options);
    if (!agent) throw new Error(`Unable to open scope ${scope}.`);
    try {
        return await immediate(agent, async () => {
            const stored = await agent.kv.get(recordKey(reviewId));
            const valueHash = hashText(value);
            if (stored !== undefined) {
                const existing = parseRecord(stored);
                if (existing.key !== key || existing.value_hash !== valueHash) throw new Error(`Review id ${reviewId} was already used with different content.`);
                if (existing.state !== "active") throw new Error(`Review id ${reviewId} is ${existing.state} and cannot be reapplied.`);
                return { ok: true, scope, review_id: reviewId, key, applied: false, idempotent: true, snapshot_key: null };
            }
            const snapshotKey = await writeReviewed(agent, scope, reviewId, key, value, options.typed ?? false, new Date().toISOString());
            return { ok: true, scope, review_id: reviewId, key, applied: true, idempotent: false, snapshot_key: snapshotKey };
        });
    } finally { await agent.close(); }
}

export async function invalidateReviewedMemory(
    scope: string,
    reviewId: string,
    key: string,
    reason: string | undefined,
    options: ReviewedMemoryOptions = {},
): Promise<Record<string, unknown>> {
    assertWritableMemoryKey(key);
    const agent = await openMemoryScope(scope, true, options);
    if (!agent) throw new Error(`Unable to open scope ${scope}.`);
    try {
        return await immediate(agent, async () => {
            const keyForRecord = recordKey(reviewId);
            const stored = await agent.kv.get(keyForRecord);
            if (stored === undefined) {
                const at = new Date().toISOString();
                await agent.kv.set(keyForRecord, { schema_version: 1, review_id: reviewId, key, value_hash: "", state: "invalidated", applied_at: at, invalidated_at: at, ...(reason ? { invalidation_reason: reason } : {}) } satisfies ReviewedRecord);
                return { ok: true, scope, review_id: reviewId, key, invalidated: true, idempotent: false, missing: true, removed: false, current_changed: false, snapshot_key: null };
            }
            const record = parseRecord(stored);
            if (record.key !== key) throw new Error(`Review id ${reviewId} belongs to a different memory key.`);
            if (record.state === "invalidated") return { ok: true, scope, review_id: reviewId, key: record.key, invalidated: false, idempotent: true, missing: record.value_hash === "", removed: false, current_changed: false, snapshot_key: null };
            const at = new Date().toISOString();
            let currentChanged = false;
            let removed = false;
            let snapshotKey: string | null = null;
            if (record.state === "active") {
                const current = await agent.kv.get(record.key);
                if (current !== undefined) {
                    const currentValue = normalizeValue(current);
                    if (hashText(currentValue) === record.value_hash) {
                        if (options.typed) {
                            const changed = await invalidateReviewedTypedNode({ agent, scope, review_id: reviewId, key: record.key, reason, in_transaction: true });
                            snapshotKey = changed.snapshot_key;
                        } else {
                            snapshotKey = historySnapshotKey(record.key, at);
                            await agent.kv.set(snapshotKey, { value: currentValue, superseded_at: at, superseded_reason: reason ?? `reviewed memory ${reviewId} invalidated` });
                            await agent.kv.delete(record.key);
                        }
                        removed = true;
                    } else currentChanged = true;
                }
            }
            await agent.kv.set(keyForRecord, { ...record, state: "invalidated", invalidated_at: at, ...(reason ? { invalidation_reason: reason } : {}) } satisfies ReviewedRecord);
            return { ok: true, scope, review_id: reviewId, key: record.key, invalidated: true, idempotent: false, missing: false, removed, current_changed: currentChanged, snapshot_key: snapshotKey };
        });
    } finally { await agent.close(); }
}

export async function readMemoryBaseHashes(
    scope: string,
    keys: string[],
    options: ReviewedMemoryOptions = {},
): Promise<Map<string, { value: string | null; hash: string | null }>> {
    const agent = await openMemoryScope(scope, false, options);
    const result = new Map<string, { value: string | null; hash: string | null }>();
    try {
        for (const key of keys) {
            assertWritableMemoryKey(key);
            const raw = agent ? await agent.kv.get(key) : undefined;
            const value = raw === undefined ? null : normalizeValue(raw);
            result.set(key, { value, hash: value === null ? null : digestText(value) });
        }
        return result;
    } finally { if (agent) await agent.close(); }
}

function proposalReviewId(digest: string, index: number): string {
    return `mp:${digest}:${index}`;
}

export async function applyProposalCandidates(
    scope: string,
    proposalDigest: string,
    candidates: MemoryProposalCandidate[],
    options: ReviewedMemoryOptions = {},
): Promise<{ ok: true; scope: string; proposal_digest: string; applied: boolean; idempotent: boolean; count: number; results: Array<Record<string, unknown>> }> {
    for (const candidate of candidates) assertMemoryProposalCandidateConsistency(candidate);
    const agent = await openMemoryScope(scope, true, options);
    if (!agent) throw new Error(`Unable to open scope ${scope}.`);
    try {
        return await immediate(agent, async () => {
            const existing: Array<ReviewedRecord | null> = [];
            for (let index = 0; index < candidates.length; index += 1) {
                const candidate = candidates[index];
                assertWritableMemoryKey(candidate.key);
                const stored = await agent.kv.get(recordKey(proposalReviewId(proposalDigest, index)));
                existing.push(stored === undefined ? null : parseRecord(stored));
            }
            if (existing.every((record) => record !== null)) {
                for (let index = 0; index < candidates.length; index += 1) {
                    const record = existing[index]!;
                    const candidate = candidates[index];
                    const current = await agent.kv.get(candidate.key);
                    if (record.state !== "active" || record.key !== candidate.key || record.value_hash !== hashText(candidate.value)
                        || current === undefined || digestText(normalizeValue(current)) !== candidate.value_hash) {
                        throw new Error("Proposal replay does not match current reviewed memory state.");
                    }
                }
                return { ok: true, scope, proposal_digest: proposalDigest, applied: false, idempotent: true, count: candidates.length, results: [] };
            }
            if (existing.some((record) => record !== null)) throw new Error("Proposal has partial reviewed provenance; refusing a non-atomic replay.");

            for (const candidate of candidates) {
                const current = await agent.kv.get(candidate.key);
                const currentValue = current === undefined ? null : normalizeValue(current);
                const currentHash = currentValue === null ? null : digestText(currentValue);
                if (currentHash !== candidate.base_hash) throw new Error(`Memory proposal is stale at key "${candidate.key}".`);
                const expectedOperation = expectedMemoryProposalOperation(currentHash, candidate.value_hash);
                if (candidate.operation !== expectedOperation) {
                    throw new Error(`Memory proposal operation is inconsistent at key "${candidate.key}".`);
                }
            }

            const at = new Date().toISOString();
            const results: Array<Record<string, unknown>> = [];
            for (let index = 0; index < candidates.length; index += 1) {
                const candidate = candidates[index];
                const reviewId = proposalReviewId(proposalDigest, index);
                const snapshotKey = await writeReviewed(agent, scope, reviewId, candidate.key, candidate.value, options.typed ?? false, at);
                results.push({ key: candidate.key, operation: candidate.operation, review_id: reviewId, snapshot_key: snapshotKey });
            }
            return { ok: true, scope, proposal_digest: proposalDigest, applied: true, idempotent: false, count: candidates.length, results };
        });
    } finally { await agent.close(); }
}
