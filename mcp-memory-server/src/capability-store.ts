import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { AgentFS } from "agentfs-sdk";
import { z } from "zod";

import {
    capabilityIdSchema,
    capabilitySourceSchema,
} from "./capability-schema.js";
import { getTrajectoryLimits } from "./trajectory-schema.js";

export const CAPABILITY_CALLBACK_SCHEMA_VERSION = 1 as const;
export const CAPABILITY_CALLBACK_RECORD_PREFIX = "capability-callback/v1/record/";
export const CAPABILITY_CALLBACK_PENDING_PREFIX = "capability-callback/v1/pending/";
export const CAPABILITY_CALLBACK_RECORD_MAX_COUNT = 10_000;

const META_KEY = "capability-callback/meta/schema-version";
const DAY_MS = 86_400_000;

export const CAPABILITY_CALLBACK_OUTCOMES = [
    "success",
    "error",
    "timeout",
    "disabled",
] as const;

export const CAPABILITY_CALLBACK_ERROR_CODES = [
    "callback-error",
    "callback-timeout",
    "result-error",
    "result-timeout",
    "capability-disabled",
] as const;

export const capabilityCallbackOutcomeSchema = z.enum(CAPABILITY_CALLBACK_OUTCOMES);
export const capabilityCallbackErrorCodeSchema = z.enum(CAPABILITY_CALLBACK_ERROR_CODES);

const invocationIdSchema = z.string().regex(
    /^cap:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
);
const correlationIdSchema = z.string()
    .min(1)
    .max(256)
    .regex(/^(?:cairn:)?[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/)
    .refine((value) => value !== "unknown");

const operatingCapabilityIssuanceSchema = z.strictObject({
    schema_version: z.literal(CAPABILITY_CALLBACK_SCHEMA_VERSION),
    capability_id: capabilityIdSchema,
    invocation_id: invocationIdSchema,
    correlation_id: correlationIdSchema,
    harness: z.enum(["claude-code", "opencode", "pi", "other"]),
    source: z.enum(["mcp", "notes-cli", "audit-timer", "operating-command", "operating-workflow"]),
    transport: z.enum(["stdio", "http", "local-process", "harness-command"]),
    started_at: z.iso.datetime(),
    state_source: capabilitySourceSchema,
    configuration_digest: z.string().regex(/^[a-f0-9]{64}$/),
});

export const capabilityCallbackRecordSchema = z.strictObject({
    schema_version: z.literal(CAPABILITY_CALLBACK_SCHEMA_VERSION),
    capability_id: capabilityIdSchema,
    invocation_id: invocationIdSchema,
    correlation_id: correlationIdSchema,
    harness: z.enum(["claude-code", "opencode", "pi", "other"]),
    source: z.enum(["mcp", "notes-cli", "audit-timer", "operating-command", "operating-workflow"]),
    transport: z.enum(["stdio", "http", "local-process", "harness-command"]),
    started_at: z.iso.datetime(),
    finished_at: z.iso.datetime(),
    duration_ms: z.number().nonnegative().finite(),
    outcome: capabilityCallbackOutcomeSchema,
    error_code: capabilityCallbackErrorCodeSchema.optional(),
    state_source: capabilitySourceSchema,
    configuration_digest: z.string().regex(/^[a-f0-9]{64}$/),
}).superRefine((record, context) => {
    if (record.outcome === "success" && record.error_code !== undefined) {
        context.addIssue({ code: "custom", path: ["error_code"], message: "Success records cannot have an error code." });
        return;
    }
    if (record.outcome !== "success" && record.error_code === undefined) {
        context.addIssue({ code: "custom", path: ["error_code"], message: "Non-success records require an error code." });
        return;
    }
    if (record.outcome === "disabled" && record.error_code !== "capability-disabled") {
        context.addIssue({ code: "custom", path: ["error_code"], message: "Disabled records require the disabled code." });
    }
});

export type CapabilityCallbackRecord = z.infer<typeof capabilityCallbackRecordSchema>;
export type CapabilityCallbackOutcome = z.infer<typeof capabilityCallbackOutcomeSchema>;
export type CapabilityCallbackErrorCode = z.infer<typeof capabilityCallbackErrorCodeSchema>;
type OperatingCapabilityIssuance = z.infer<typeof operatingCapabilityIssuanceSchema>;

export type CapabilityRecordList = {
    schema_version: typeof CAPABILITY_CALLBACK_SCHEMA_VERSION;
    records: CapabilityCallbackRecord[];
};

export type CapabilityRecordDoctor = {
    schema_version: typeof CAPABILITY_CALLBACK_SCHEMA_VERSION;
    exists: boolean;
    ok: boolean;
    integrity: "ok" | "failed" | "not_present";
    stored_schema_version?: number;
    valid_records: number;
    issues: Array<"sqlite-integrity-failed" | "schema-missing" | "schema-unsupported" | "invalid-record">;
};

type StoreFault = "open" | "lock" | "schema" | "write";

type AppendCapabilityRecordOptions = {
    testMaxRecords?: number;
    testStoreFault?: StoreFault;
    nowMs?: number;
};

type OperatingCapabilityStoreOptions = Pick<AppendCapabilityRecordOptions, "testStoreFault" | "nowMs">;

function capabilityDbPath(projectRoot = process.cwd()): string {
    return resolve(projectRoot, ".agentfs", "trajectory.db");
}

async function openCapabilityStore(
    projectRoot: string,
    create: boolean,
    fault?: StoreFault,
): Promise<AgentFS | null> {
    if (fault === "open") throw new Error("Injected capability store open fault.");
    const dbPath = capabilityDbPath(projectRoot);
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

function recordKey(record: CapabilityCallbackRecord): string {
    const epoch = Date.parse(record.finished_at);
    if (!Number.isFinite(epoch)) throw new Error("Capability callback finish time is invalid.");
    return `${CAPABILITY_CALLBACK_RECORD_PREFIX}${String(epoch).padStart(16, "0")}/${record.invocation_id}`;
}

function pendingKey(issuance: OperatingCapabilityIssuance): string {
    return `${CAPABILITY_CALLBACK_PENDING_PREFIX}${issuance.invocation_id}`;
}

async function inImmediateTransaction<T>(agent: AgentFS, operation: () => Promise<T>): Promise<T> {
    const transaction = agent.getDatabase().transaction(operation);
    const immediate = (transaction as typeof transaction & { immediate: typeof transaction }).immediate;
    return immediate();
}

function sortedRecordRows(rows: Awaited<ReturnType<AgentFS["kv"]["list"]>>): Array<{ key: string; record: CapabilityCallbackRecord }> {
    return rows.map(({ key, value }) => ({ key, record: capabilityCallbackRecordSchema.parse(value) }))
        .sort((left, right) => left.key.localeCompare(right.key));
}

function sortedPendingRows(rows: Awaited<ReturnType<AgentFS["kv"]["list"]>>): Array<{ key: string; issuance: OperatingCapabilityIssuance }> {
    return rows.map(({ key, value }) => ({ key, issuance: operatingCapabilityIssuanceSchema.parse(value) }))
        .sort((left, right) => {
            const byStart = left.issuance.started_at.localeCompare(right.issuance.started_at);
            return byStart === 0 ? left.key.localeCompare(right.key) : byStart;
        });
}

function sameIssuance(left: OperatingCapabilityIssuance, right: OperatingCapabilityIssuance): boolean {
    return left.schema_version === right.schema_version
        && left.capability_id === right.capability_id
        && left.invocation_id === right.invocation_id
        && left.correlation_id === right.correlation_id
        && left.harness === right.harness
        && left.source === right.source
        && left.transport === right.transport
        && left.started_at === right.started_at
        && left.state_source === right.state_source
        && left.configuration_digest === right.configuration_digest;
}

function recordMatchesIssuance(record: CapabilityCallbackRecord, issuance: OperatingCapabilityIssuance): boolean {
    return record.schema_version === issuance.schema_version
        && record.capability_id === issuance.capability_id
        && record.invocation_id === issuance.invocation_id
        && record.correlation_id === issuance.correlation_id
        && record.harness === issuance.harness
        && record.source === issuance.source
        && record.transport === issuance.transport
        && record.started_at === issuance.started_at
        && record.state_source === issuance.state_source
        && record.configuration_digest === issuance.configuration_digest;
}

async function assertCompatibleSchema(agent: AgentFS, allowMissing: boolean): Promise<void> {
    const version = await agent.kv.get<number>(META_KEY);
    if (version === undefined && allowMissing) return;
    if (version !== CAPABILITY_CALLBACK_SCHEMA_VERSION) {
        throw new Error("Capability callback store schema is incompatible; run `cairn doctor`.");
    }
}

function recordLimit(value: number | undefined): number {
    const maxRecords = value ?? CAPABILITY_CALLBACK_RECORD_MAX_COUNT;
    if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > CAPABILITY_CALLBACK_RECORD_MAX_COUNT) {
        throw new Error("Capability callback record limit is invalid.");
    }
    return maxRecords;
}

async function appendParsedRecord(
    agent: AgentFS,
    parsed: CapabilityCallbackRecord,
    maxRecords: number,
    cutoff: number,
    fault?: StoreFault,
): Promise<void> {
    const rows = sortedRecordRows(await agent.kv.list(CAPABILITY_CALLBACK_RECORD_PREFIX));
    if (rows.some(({ record: existing }) => existing.invocation_id === parsed.invocation_id)) return;

    const retained: typeof rows = [];
    for (const row of rows) {
        if (Date.parse(row.record.finished_at) < cutoff) await agent.kv.delete(row.key);
        else retained.push(row);
    }

    if (fault === "write") throw new Error("Injected capability store write fault.");
    await agent.kv.set(META_KEY, CAPABILITY_CALLBACK_SCHEMA_VERSION);
    if (Date.parse(parsed.finished_at) >= cutoff) {
        const key = recordKey(parsed);
        await agent.kv.set(key, parsed);
        retained.push({ key, record: parsed });
    }
    retained.sort((left, right) => left.key.localeCompare(right.key));
    while (retained.length > maxRecords) {
        const oldest = retained.shift();
        if (oldest) await agent.kv.delete(oldest.key);
    }
}

export async function appendCapabilityRecord(
    projectRoot: string,
    record: CapabilityCallbackRecord,
    options: AppendCapabilityRecordOptions = {},
): Promise<void> {
    const parsed = capabilityCallbackRecordSchema.parse(record);
    const maxRecords = recordLimit(options.testMaxRecords);
    const agent = await openCapabilityStore(projectRoot, true, options.testStoreFault);
    if (!agent) throw new Error("Unable to open the local capability callback store.");
    try {
        if (options.testStoreFault === "lock") throw new Error("Injected capability store lock fault.");
        await inImmediateTransaction(agent, async () => {
            await assertCompatibleSchema(agent, true);
            if (options.testStoreFault === "schema") throw new Error("Injected capability store schema fault.");

            const cutoff = (options.nowMs ?? Date.now()) - getTrajectoryLimits().retentionDays * DAY_MS;
            await appendParsedRecord(agent, parsed, maxRecords, cutoff, options.testStoreFault);
        });
    } finally {
        await agent.close();
    }
}

export async function issueOperatingCapability(
    projectRoot: string,
    rawIssuance: OperatingCapabilityIssuance,
    options: OperatingCapabilityStoreOptions = {},
): Promise<boolean> {
    try {
        const issuance = operatingCapabilityIssuanceSchema.parse(rawIssuance);
        const agent = await openCapabilityStore(projectRoot, true, options.testStoreFault);
        if (!agent) return false;
        try {
            if (options.testStoreFault === "lock") throw new Error("Injected capability store lock fault.");
            return await inImmediateTransaction(agent, async () => {
                await assertCompatibleSchema(agent, true);
                if (options.testStoreFault === "schema") throw new Error("Injected capability store schema fault.");

                const cutoff = (options.nowMs ?? Date.now()) - getTrajectoryLimits().retentionDays * DAY_MS;
                const rows = sortedPendingRows(await agent.kv.list(CAPABILITY_CALLBACK_PENDING_PREFIX));
                const retained: typeof rows = [];
                for (const row of rows) {
                    if (Date.parse(row.issuance.started_at) < cutoff) await agent.kv.delete(row.key);
                    else retained.push(row);
                }
                if (retained.some(({ issuance: existing }) => existing.invocation_id === issuance.invocation_id)) {
                    return false;
                }
                if (options.testStoreFault === "write") throw new Error("Injected capability store write fault.");
                await agent.kv.set(META_KEY, CAPABILITY_CALLBACK_SCHEMA_VERSION);
                if (Date.parse(issuance.started_at) < cutoff) return false;
                const key = pendingKey(issuance);
                await agent.kv.set(key, issuance);
                retained.push({ key, issuance });
                retained.sort((left, right) => {
                    const byStart = left.issuance.started_at.localeCompare(right.issuance.started_at);
                    return byStart === 0 ? left.key.localeCompare(right.key) : byStart;
                });
                while (retained.length > CAPABILITY_CALLBACK_RECORD_MAX_COUNT) {
                    const oldest = retained.shift();
                    if (oldest) await agent.kv.delete(oldest.key);
                }
                return retained.some(({ issuance: retainedIssuance }) => retainedIssuance.invocation_id === issuance.invocation_id);
            });
        } finally {
            await agent.close();
        }
    } catch {
        return false;
    }
}

export async function settleOperatingCapability(
    projectRoot: string,
    rawIssuance: OperatingCapabilityIssuance,
    rawRecord?: CapabilityCallbackRecord,
    options: OperatingCapabilityStoreOptions = {},
): Promise<boolean> {
    try {
        const issuance = operatingCapabilityIssuanceSchema.parse(rawIssuance);
        const record = rawRecord === undefined ? undefined : capabilityCallbackRecordSchema.parse(rawRecord);
        if (record !== undefined && !recordMatchesIssuance(record, issuance)) return false;
        const agent = await openCapabilityStore(projectRoot, false, options.testStoreFault);
        if (!agent) return false;
        try {
            if (options.testStoreFault === "lock") throw new Error("Injected capability store lock fault.");
            return await inImmediateTransaction(agent, async () => {
                await assertCompatibleSchema(agent, false);
                if (options.testStoreFault === "schema") throw new Error("Injected capability store schema fault.");
                const key = pendingKey(issuance);
                const stored = operatingCapabilityIssuanceSchema.safeParse(await agent.kv.get<unknown>(key));
                if (!stored.success || !sameIssuance(stored.data, issuance)) return false;

                if (options.testStoreFault === "write") throw new Error("Injected capability store write fault.");
                const cutoff = (options.nowMs ?? Date.now()) - getTrajectoryLimits().retentionDays * DAY_MS;
                await agent.kv.delete(key);
                if (Date.parse(stored.data.started_at) < cutoff) return false;
                if (record !== undefined) {
                    await appendParsedRecord(agent, record, CAPABILITY_CALLBACK_RECORD_MAX_COUNT, cutoff);
                }
                return true;
            });
        } finally {
            await agent.close();
        }
    } catch {
        return false;
    }
}

export async function listCapabilityRecords(
    projectRoot = process.cwd(),
): Promise<CapabilityRecordList> {
    const agent = await openCapabilityStore(projectRoot, false);
    if (!agent) return { schema_version: CAPABILITY_CALLBACK_SCHEMA_VERSION, records: [] };
    try {
        const rows = await agent.kv.list(CAPABILITY_CALLBACK_RECORD_PREFIX);
        if (rows.length === 0) return { schema_version: CAPABILITY_CALLBACK_SCHEMA_VERSION, records: [] };
        await assertCompatibleSchema(agent, false);
        return {
            schema_version: CAPABILITY_CALLBACK_SCHEMA_VERSION,
            records: sortedRecordRows(rows).reverse().map(({ record }) => record),
        };
    } finally {
        await agent.close();
    }
}

export function getCapabilityDbPath(projectRoot = process.cwd()): string {
    return capabilityDbPath(projectRoot);
}

export async function doctorCapabilityRecords(
    projectRoot = process.cwd(),
): Promise<CapabilityRecordDoctor> {
    const agent = await openCapabilityStore(projectRoot, false);
    if (!agent) {
        return {
            schema_version: CAPABILITY_CALLBACK_SCHEMA_VERSION,
            exists: false,
            ok: true,
            integrity: "not_present",
            valid_records: 0,
            issues: [],
        };
    }
    try {
        const integrityRows = await agent.getDatabase().pragma("integrity_check", {});
        const integrityOk = Array.isArray(integrityRows)
            && integrityRows.length > 0
            && integrityRows.every((row) => Object.values(row as Record<string, unknown>).includes("ok"));
        const storedVersion = await agent.kv.get<number>(META_KEY);
        const rows = await agent.kv.list(CAPABILITY_CALLBACK_RECORD_PREFIX);
        let validRecords = 0;
        let invalidRecords = 0;
        for (const { value } of rows) {
            if (capabilityCallbackRecordSchema.safeParse(value).success) validRecords += 1;
            else invalidRecords += 1;
        }
        const issues: CapabilityRecordDoctor["issues"] = [];
        if (!integrityOk) issues.push("sqlite-integrity-failed");
        if (storedVersion === undefined && rows.length > 0) issues.push("schema-missing");
        else if (storedVersion !== undefined && storedVersion !== CAPABILITY_CALLBACK_SCHEMA_VERSION) issues.push("schema-unsupported");
        if (invalidRecords > 0) issues.push("invalid-record");
        return {
            schema_version: CAPABILITY_CALLBACK_SCHEMA_VERSION,
            exists: true,
            ok: issues.length === 0,
            integrity: integrityOk ? "ok" : "failed",
            ...(storedVersion === undefined ? {} : { stored_schema_version: storedVersion }),
            valid_records: validRecords,
            issues,
        };
    } finally {
        await agent.close();
    }
}
