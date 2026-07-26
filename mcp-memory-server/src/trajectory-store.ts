import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { AgentFS } from "agentfs-sdk";
import { z } from "zod";

import {
    TRAJECTORY_SCHEMA_VERSION,
    trajectorySessionSchema,
    type RedactedTrajectory,
    type TrajectoryLimits,
    type TrajectorySession,
} from "./trajectory-schema.js";

const META_KEY = "trajectory/meta/schema-version";
const SESSION_PREFIX = "trajectory/session/";
const INDEX_PREFIX = "trajectory/index/";

const indexSchema = z.object({
    schema_version: z.literal(TRAJECTORY_SCHEMA_VERSION),
    session_id: z.string(),
    harness: z.enum(["claude-code", "opencode", "pi"]),
    started_at: z.iso.datetime(),
    ended_at: z.iso.datetime(),
    event_count: z.number().int().nonnegative(),
    logical_bytes: z.number().int().nonnegative(),
    full_key: z.string(),
}).strict();

export type TrajectoryIndex = z.infer<typeof indexSchema>;

export type TrajectoryList = {
    schema_version: 1;
    sessions: TrajectoryIndex[];
    logical_bytes: number;
};

export type PruneResult = {
    schema_version: 1;
    dry_run: boolean;
    removed: Array<TrajectoryIndex & { reason: "age" | "store_budget" }>;
    remaining_sessions: number;
    logical_bytes: number;
};

export type TrajectoryDoctorResult = {
    schema_version: 1;
    exists: boolean;
    ok: boolean;
    repaired: boolean;
    integrity: "ok" | "failed" | "not_present";
    stored_schema_version?: number;
    valid_sessions: number;
    indexed_sessions: number;
    issues: string[];
};

function trajectoryDbPath(projectRoot = process.cwd()): string {
    return resolve(projectRoot, ".agentfs", "trajectory.db");
}

async function openTrajectoryStore(projectRoot: string, create: boolean): Promise<AgentFS | null> {
    const dbPath = trajectoryDbPath(projectRoot);
    if (!create && !existsSync(dbPath)) return null;
    if (create) mkdirSync(dirname(dbPath), { recursive: true });
    const agent = await AgentFS.open({ id: "trajectory", path: dbPath });
    if (create) {
        try {
            chmodSync(dbPath, 0o600);
        } catch (error) {
            await agent.close();
            throw error;
        }
    }
    return agent;
}

function sessionKey(sessionId: string): string {
    return `${SESSION_PREFIX}${sessionId}`;
}

function indexKey(endedAt: string, sessionId: string): string {
    const epoch = Date.parse(endedAt);
    if (!Number.isFinite(epoch)) throw new Error("Trajectory ended_at is invalid.");
    return `${INDEX_PREFIX}${String(epoch).padStart(16, "0")}/${sessionId}`;
}

function makeIndex(session: TrajectorySession): TrajectoryIndex {
    return {
        schema_version: TRAJECTORY_SCHEMA_VERSION,
        session_id: session.session_id,
        harness: session.harness,
        started_at: session.started_at,
        ended_at: session.ended_at,
        event_count: session.events.length,
        logical_bytes: Buffer.byteLength(JSON.stringify(session), "utf8"),
        full_key: sessionKey(session.session_id),
    };
}

async function inImmediateTransaction<T>(agent: AgentFS, operation: () => Promise<T>): Promise<T> {
    const transaction = agent.getDatabase().transaction(operation);
    const immediate = (transaction as typeof transaction & { immediate: typeof transaction }).immediate;
    return immediate();
}

async function readIndexes(agent: AgentFS): Promise<Array<{ key: string; value: TrajectoryIndex }>> {
    const rows = await agent.kv.list(INDEX_PREFIX);
    return rows.map(({ key, value }) => ({ key, value: indexSchema.parse(value) }));
}

async function assertCompatibleSchema(agent: AgentFS, allowMissing: boolean): Promise<void> {
    const version = await agent.kv.get<number>(META_KEY);
    if (version === undefined && allowMissing) return;
    if (version !== TRAJECTORY_SCHEMA_VERSION) {
        throw new Error(
            version === undefined
                ? "Trajectory store schema metadata is missing; run `cairn doctor` to repair it."
                : `Unsupported trajectory store schema version ${String(version)}; run \`cairn doctor\`.`,
        );
    }
}

async function deleteIndexAndSession(
    agent: AgentFS,
    entry: { key: string; value: TrajectoryIndex },
): Promise<void> {
    await agent.kv.delete(entry.key);
    await agent.kv.delete(entry.value.full_key);
}

function sortedIndexes(entries: Array<{ key: string; value: TrajectoryIndex }>): Array<{ key: string; value: TrajectoryIndex }> {
    return [...entries].sort((a, b) => {
        const ended = Date.parse(a.value.ended_at) - Date.parse(b.value.ended_at);
        return ended !== 0 ? ended : a.value.session_id.localeCompare(b.value.session_id);
    });
}

export async function putTrajectory(
    projectRoot: string,
    session: RedactedTrajectory,
    limits: TrajectoryLimits,
): Promise<TrajectoryIndex> {
    const parsed = trajectorySessionSchema.parse(session);
    const logicalBytes = Buffer.byteLength(JSON.stringify(parsed), "utf8");
    if (logicalBytes > limits.sessionMaxBytes) {
        throw new Error(`Trajectory exceeds the ${limits.sessionMaxBytes}-byte session limit.`);
    }
    if (logicalBytes > limits.storeMaxBytes) {
        throw new Error(`Trajectory exceeds the ${limits.storeMaxBytes}-byte store budget.`);
    }

    const agent = await openTrajectoryStore(projectRoot, true);
    if (!agent) throw new Error("Unable to open the local trajectory store.");
    const fullKey = sessionKey(parsed.session_id);
    const entry = makeIndex(parsed);

    try {
        await inImmediateTransaction(agent, async () => {
            await assertCompatibleSchema(agent, true);
            const existing = await readIndexes(agent);
            for (const prior of existing.filter(({ value }) => value.session_id === parsed.session_id)) {
                await deleteIndexAndSession(agent, prior);
            }

            const cutoff = Date.now() - limits.retentionDays * 86400000;
            const retained: Array<{ key: string; value: TrajectoryIndex }> = [];
            for (const prior of existing.filter(({ value }) => value.session_id !== parsed.session_id)) {
                if (Date.parse(prior.value.ended_at) < cutoff) await deleteIndexAndSession(agent, prior);
                else retained.push(prior);
            }

            await agent.kv.set(META_KEY, TRAJECTORY_SCHEMA_VERSION);
            await agent.kv.set(fullKey, parsed);
            const newIndexKey = indexKey(parsed.ended_at, parsed.session_id);
            await agent.kv.set(newIndexKey, entry);
            retained.push({ key: newIndexKey, value: entry });

            let total = retained.reduce((sum, item) => sum + item.value.logical_bytes, 0);
            for (const oldest of sortedIndexes(retained)) {
                if (total <= limits.storeMaxBytes) break;
                if (oldest.value.session_id === parsed.session_id) continue;
                await deleteIndexAndSession(agent, oldest);
                total -= oldest.value.logical_bytes;
            }
            if (total > limits.storeMaxBytes) throw new Error("Unable to satisfy the trajectory store budget.");
        });
        return entry;
    } finally {
        await agent.close();
    }
}

export async function listTrajectories(projectRoot = process.cwd()): Promise<TrajectoryList> {
    const agent = await openTrajectoryStore(projectRoot, false);
    if (!agent) return { schema_version: TRAJECTORY_SCHEMA_VERSION, sessions: [], logical_bytes: 0 };
    try {
        await assertCompatibleSchema(agent, false);
        const sessions = sortedIndexes(await readIndexes(agent)).reverse().map(({ value }) => value);
        return {
            schema_version: TRAJECTORY_SCHEMA_VERSION,
            sessions,
            logical_bytes: sessions.reduce((sum, item) => sum + item.logical_bytes, 0),
        };
    } finally {
        await agent.close();
    }
}

export async function showTrajectory(identifier: string, projectRoot = process.cwd()): Promise<TrajectorySession> {
    const listed = await listTrajectories(projectRoot);
    const matches = listed.sessions.filter(({ session_id }) => session_id === identifier || session_id.startsWith(identifier));
    if (matches.length === 0) throw new Error(`Trajectory session "${identifier}" not found.`);
    const exact = matches.find(({ session_id }) => session_id === identifier);
    if (!exact && matches.length > 1) {
        throw new Error(`Trajectory session prefix "${identifier}" is ambiguous: ${matches.map(({ session_id }) => session_id).join(", ")}`);
    }
    const selected = exact ?? matches[0];
    const agent = await openTrajectoryStore(projectRoot, false);
    if (!agent) throw new Error(`Trajectory session "${identifier}" not found.`);
    try {
        await assertCompatibleSchema(agent, false);
        const value = await agent.kv.get(selected.full_key);
        if (value === undefined) throw new Error(`Trajectory session "${selected.session_id}" is missing its full record; run \`cairn doctor\`.`);
        return trajectorySessionSchema.parse(value);
    } finally {
        await agent.close();
    }
}

export async function pruneTrajectories(
    projectRoot: string,
    limits: TrajectoryLimits,
    dryRun = false,
): Promise<PruneResult> {
    const agent = await openTrajectoryStore(projectRoot, false);
    if (!agent) {
        return { schema_version: TRAJECTORY_SCHEMA_VERSION, dry_run: dryRun, removed: [], remaining_sessions: 0, logical_bytes: 0 };
    }
    try {
        await assertCompatibleSchema(agent, false);
        return await inImmediateTransaction(agent, async () => {
            const sorted = sortedIndexes(await readIndexes(agent));
            const cutoff = Date.now() - limits.retentionDays * 86400000;
            const removed: PruneResult["removed"] = [];
            const retained: Array<{ key: string; value: TrajectoryIndex }> = [];
            for (const item of sorted) {
                if (Date.parse(item.value.ended_at) < cutoff) removed.push({ ...item.value, reason: "age" });
                else retained.push(item);
            }
            let total = retained.reduce((sum, item) => sum + item.value.logical_bytes, 0);
            while (total > limits.storeMaxBytes && retained.length > 0) {
                const item = retained.shift();
                if (!item) break;
                total -= item.value.logical_bytes;
                removed.push({ ...item.value, reason: "store_budget" });
            }
            if (!dryRun) {
                const bySession = new Map(sorted.map((item) => [item.value.session_id, item]));
                for (const item of removed) {
                    const stored = bySession.get(item.session_id);
                    if (stored) await deleteIndexAndSession(agent, stored);
                }
            }
            return {
                schema_version: TRAJECTORY_SCHEMA_VERSION,
                dry_run: dryRun,
                removed,
                remaining_sessions: retained.length,
                logical_bytes: total,
            };
        });
    } finally {
        await agent.close();
    }
}

export function getTrajectoryDbPath(projectRoot = process.cwd()): string {
    return trajectoryDbPath(projectRoot);
}

export async function doctorTrajectoryStore(
    projectRoot = process.cwd(),
    repair = false,
): Promise<TrajectoryDoctorResult> {
    const agent = await openTrajectoryStore(projectRoot, false);
    if (!agent) {
        return {
            schema_version: TRAJECTORY_SCHEMA_VERSION,
            exists: false,
            ok: true,
            repaired: false,
            integrity: "not_present",
            valid_sessions: 0,
            indexed_sessions: 0,
            issues: [],
        };
    }

    try {
        const integrityRows = await agent.getDatabase().pragma("integrity_check", {});
        const integrityOk = Array.isArray(integrityRows)
            && integrityRows.length > 0
            && integrityRows.every((row) => Object.values(row as Record<string, unknown>).includes("ok"));
        const storedVersion = await agent.kv.get<number>(META_KEY);
        const sessionRows = await agent.kv.list(SESSION_PREFIX);
        const validSessions: TrajectorySession[] = [];
        const issues: string[] = [];

        for (const row of sessionRows) {
            const parsed = trajectorySessionSchema.safeParse(row.value);
            if (parsed.success) validSessions.push(parsed.data);
            else issues.push(`invalid full record: ${row.key}`);
        }

        const indexRows = await agent.kv.list(INDEX_PREFIX);
        const validIndexes = new Map<string, TrajectoryIndex>();
        for (const row of indexRows) {
            const parsed = indexSchema.safeParse(row.value);
            if (!parsed.success) {
                issues.push(`invalid index record: ${row.key}`);
                continue;
            }
            validIndexes.set(row.key, parsed.data);
        }

        if (!integrityOk) issues.unshift("SQLite integrity check failed");
        if (storedVersion === undefined) issues.push("schema metadata is missing");
        else if (storedVersion !== TRAJECTORY_SCHEMA_VERSION) {
            issues.push(`unsupported schema version ${String(storedVersion)}`);
        }

        const expectedIndexes = new Map(validSessions.map((session) => {
            const value = makeIndex(session);
            return [indexKey(session.ended_at, session.session_id), value] as const;
        }));
        for (const [key, expected] of expectedIndexes) {
            const actual = validIndexes.get(key);
            if (!actual || JSON.stringify(actual) !== JSON.stringify(expected)) {
                issues.push(`missing or stale index: ${expected.session_id}`);
            }
        }
        for (const [key, actual] of validIndexes) {
            if (!expectedIndexes.has(key)) issues.push(`orphan index: ${actual.session_id}`);
        }

        const canRepair = integrityOk
            && (storedVersion === undefined || storedVersion === TRAJECTORY_SCHEMA_VERSION)
            && !issues.some((issue) => issue.startsWith("invalid full record:"));
        let repaired = false;
        if (repair && issues.length > 0 && canRepair) {
            await inImmediateTransaction(agent, async () => {
                for (const row of indexRows) await agent.kv.delete(row.key);
                await agent.kv.set(META_KEY, TRAJECTORY_SCHEMA_VERSION);
                for (const [key, value] of expectedIndexes) await agent.kv.set(key, value);
            });
            repaired = true;
            issues.length = 0;
        }

        return {
            schema_version: TRAJECTORY_SCHEMA_VERSION,
            exists: true,
            ok: integrityOk && issues.length === 0,
            repaired,
            integrity: integrityOk ? "ok" : "failed",
            ...(storedVersion === undefined && repaired
                ? { stored_schema_version: TRAJECTORY_SCHEMA_VERSION }
                : storedVersion === undefined
                    ? {}
                    : { stored_schema_version: storedVersion }),
            valid_sessions: validSessions.length,
            indexed_sessions: repaired ? expectedIndexes.size : validIndexes.size,
            issues,
        };
    } finally {
        await agent.close();
    }
}
