import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { z } from "zod";

import { isTrajectoryCaptureEnabled } from "./trajectory-schema.js";
import {
    CAPABILITY_CALLBACK_SCHEMA_VERSION,
    appendCapabilityRecord,
    type CapabilityCallbackErrorCode,
    type CapabilityCallbackOutcome,
    type CapabilityCallbackRecord,
} from "./capability-store.js";
import {
    capabilityIdSchema,
    capabilitySourceSchema,
    type CapabilityId,
    type CapabilityStatus,
} from "./capability-schema.js";

const MAX_TRACKED_OPERATING_INVOCATIONS = 10_000;

const correlationIdSchema = z.string()
    .min(1)
    .max(256)
    .regex(/^(?:cairn:)?[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/)
    .refine((value) => value !== "unknown");
const invocationIdSchema = z.string().regex(
    /^cap:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const capabilityAdapterClassificationSchema = z.strictObject({
    harness: z.enum(["claude-code", "opencode", "pi", "other"]),
    source: z.enum(["mcp", "notes-cli", "audit-timer", "operating-command", "operating-workflow"]),
    transport: z.enum(["stdio", "http", "local-process", "harness-command"]),
});

export const operatingCapabilityHandleSchema = z.strictObject({
    schema_version: z.literal(CAPABILITY_CALLBACK_SCHEMA_VERSION),
    capability_id: capabilityIdSchema,
    invocation_id: invocationIdSchema,
    correlation_id: correlationIdSchema,
    harness: capabilityAdapterClassificationSchema.shape.harness,
    source: capabilityAdapterClassificationSchema.shape.source,
    transport: capabilityAdapterClassificationSchema.shape.transport,
    started_at: z.iso.datetime(),
    state_source: capabilitySourceSchema,
    configuration_digest: digestSchema,
});

export const operatingCapabilityDisabledResultSchema = z.strictObject({
    schema_version: z.literal(CAPABILITY_CALLBACK_SCHEMA_VERSION),
    capability_id: capabilityIdSchema,
    disabled: z.literal(true),
    measured: z.literal(false),
});

export const operatingCapabilityBypassResultSchema = z.strictObject({
    schema_version: z.literal(CAPABILITY_CALLBACK_SCHEMA_VERSION),
    capability_id: capabilityIdSchema,
    disabled: z.literal(false),
    measured: z.literal(false),
});

export const operatingCapabilityFinishInputSchema = z.strictObject({
    outcome: z.enum(["success", "error", "timeout"]),
});

export const operatingCapabilityFinishResultSchema = z.strictObject({
    schema_version: z.literal(CAPABILITY_CALLBACK_SCHEMA_VERSION),
    invocation_id: invocationIdSchema,
    finalized: z.boolean(),
});

export type CapabilityAdapterClassification = z.infer<typeof capabilityAdapterClassificationSchema>;
export type OperatingCapabilityHandle = z.infer<typeof operatingCapabilityHandleSchema>;
export type OperatingCapabilityDisabledResult = z.infer<typeof operatingCapabilityDisabledResultSchema>;
export type OperatingCapabilityBypassResult = z.infer<typeof operatingCapabilityBypassResultSchema>;
export type OperatingCapabilityStartResult = OperatingCapabilityHandle
    | OperatingCapabilityDisabledResult
    | OperatingCapabilityBypassResult;
export type OperatingCapabilityFinishInput = z.infer<typeof operatingCapabilityFinishInputSchema>;
export type OperatingCapabilityFinishResult = z.infer<typeof operatingCapabilityFinishResultSchema>;

type CapabilitySnapshot = Pick<
    CapabilityStatus,
    "contract_enabled" | "logging" | "configuration_digest" | "capabilities"
>;

type StoreFault = "open" | "lock" | "schema" | "write";

export type CapabilityAdapterOptions = {
    projectRoot: string;
    snapshot: CapabilitySnapshot;
    capabilityId: CapabilityId;
    classification: CapabilityAdapterClassification;
    correlationId?: string;
    testStoreFault?: StoreFault;
};

let fallbackCorrelationId: string | undefined;
const operatingStarts = new Map<string, number>();
const finalizedOperatingInvocations = new Set<string>();

function resolvedCapability(options: CapabilityAdapterOptions): CapabilitySnapshot["capabilities"][number] | undefined {
    return options.snapshot.capabilities.find(({ id }) => id === options.capabilityId);
}

function hasLoggingConsent(options: CapabilityAdapterOptions): boolean {
    return options.snapshot.contract_enabled
        && options.snapshot.logging.enabled
        && options.classification.transport !== "http"
        && isTrajectoryCaptureEnabled();
}

function isMeasuredCapabilityEnabled(options: CapabilityAdapterOptions): boolean {
    return resolvedCapability(options)?.enabled === true;
}

function correlationId(explicit?: string): string {
    const parsed = correlationIdSchema.safeParse(explicit);
    if (parsed.success) return parsed.data;
    fallbackCorrelationId ??= `cairn:${randomUUID()}`;
    return fallbackCorrelationId;
}

function invocationId(): string {
    return `cap:${randomUUID()}`;
}

function rememberOperatingStart(id: string, monotonicStart: number): void {
    operatingStarts.set(id, monotonicStart);
    while (operatingStarts.size > MAX_TRACKED_OPERATING_INVOCATIONS) {
        const oldest = operatingStarts.keys().next().value as string | undefined;
        if (!oldest) break;
        operatingStarts.delete(oldest);
    }
}

function rememberFinalized(id: string): void {
    finalizedOperatingInvocations.add(id);
    while (finalizedOperatingInvocations.size > MAX_TRACKED_OPERATING_INVOCATIONS) {
        const oldest = finalizedOperatingInvocations.values().next().value as string | undefined;
        if (!oldest) break;
        finalizedOperatingInvocations.delete(oldest);
    }
}

function returnedOutcome(result: unknown): {
    outcome: CapabilityCallbackOutcome;
    errorCode?: CapabilityCallbackErrorCode;
} {
    if (!result || typeof result !== "object" || Array.isArray(result)) return { outcome: "success" };
    const root = result as Record<string, unknown>;
    const structured = root.structuredContent;
    const value = structured && typeof structured === "object" && !Array.isArray(structured)
        ? structured as Record<string, unknown>
        : root;
    if (value.timedOut === true || value.timed_out === true) {
        return { outcome: "timeout", errorCode: "result-timeout" };
    }
    if (value.ok === false) return { outcome: "error", errorCode: "result-error" };
    return { outcome: "success" };
}

function thrownOutcome(error: unknown): {
    outcome: "error" | "timeout";
    errorCode: "callback-error" | "callback-timeout";
} {
    const name = error && typeof error === "object" && "name" in error
        ? (error as { name?: unknown }).name
        : undefined;
    if (name === "TimeoutError" || name === "AbortError") {
        return { outcome: "timeout", errorCode: "callback-timeout" };
    }
    return { outcome: "error", errorCode: "callback-error" };
}

function finalRecord(
    options: CapabilityAdapterOptions,
    handle: OperatingCapabilityHandle,
    finishedAt: string,
    durationMs: number,
    outcome: CapabilityCallbackOutcome,
    errorCode?: CapabilityCallbackErrorCode,
): CapabilityCallbackRecord {
    return {
        schema_version: CAPABILITY_CALLBACK_SCHEMA_VERSION,
        capability_id: handle.capability_id,
        invocation_id: handle.invocation_id,
        correlation_id: handle.correlation_id,
        harness: handle.harness,
        source: handle.source,
        transport: handle.transport,
        started_at: handle.started_at,
        finished_at: finishedAt,
        duration_ms: durationMs,
        outcome,
        ...(errorCode === undefined ? {} : { error_code: errorCode }),
        state_source: handle.state_source,
        configuration_digest: handle.configuration_digest,
    };
}

async function persistFinal(
    options: CapabilityAdapterOptions,
    record: CapabilityCallbackRecord,
): Promise<void> {
    try {
        await appendCapabilityRecord(options.projectRoot, record, {
            ...(options.testStoreFault === undefined ? {} : { testStoreFault: options.testStoreFault }),
        });
    } catch {
        // Callback measurement is fail-open by contract.
    }
}

function createHandle(options: CapabilityAdapterOptions, startedAt: string): OperatingCapabilityHandle {
    const classification = capabilityAdapterClassificationSchema.parse(options.classification);
    const state = resolvedCapability(options);
    if (!state) throw new Error("Capability state is missing from the resolved snapshot.");
    return operatingCapabilityHandleSchema.parse({
        schema_version: CAPABILITY_CALLBACK_SCHEMA_VERSION,
        capability_id: options.capabilityId,
        invocation_id: invocationId(),
        correlation_id: correlationId(options.correlationId),
        ...classification,
        started_at: startedAt,
        state_source: state.source,
        configuration_digest: options.snapshot.configuration_digest,
    });
}

export function withCapability<TArguments extends unknown[], TResult>(
    options: CapabilityAdapterOptions,
    callback: (...args: TArguments) => Promise<TResult>,
): (...args: TArguments) => Promise<TResult> {
    if (!options.snapshot.contract_enabled
        || !options.snapshot.logging.enabled
        || options.classification.transport === "http"
        || !isMeasuredCapabilityEnabled(options)) {
        return callback;
    }

    return async function measuredCallback(this: unknown, ...args: TArguments): Promise<TResult> {
        if (!isTrajectoryCaptureEnabled()) return callback.apply(this, args);

        const monotonicStart = performance.now();
        const startedAt = new Date().toISOString();
        const handle = createHandle(options, startedAt);
        try {
            const result = await callback.apply(this, args);
            const finishedAt = new Date().toISOString();
            const durationMs = Math.max(0, performance.now() - monotonicStart);
            const classified = returnedOutcome(result);
            await persistFinal(
                options,
                finalRecord(options, handle, finishedAt, durationMs, classified.outcome, classified.errorCode),
            );
            return result;
        } catch (error) {
            const finishedAt = new Date().toISOString();
            const durationMs = Math.max(0, performance.now() - monotonicStart);
            const classified = thrownOutcome(error);
            await persistFinal(
                options,
                finalRecord(options, handle, finishedAt, durationMs, classified.outcome, classified.errorCode),
            );
            throw error;
        }
    };
}

export async function startOperatingCapability(
    options: CapabilityAdapterOptions,
): Promise<OperatingCapabilityStartResult> {
    const state = resolvedCapability(options);
    const disabled = options.snapshot.contract_enabled && state?.enabled === false;
    if (disabled) {
        const result = operatingCapabilityDisabledResultSchema.parse({
            schema_version: CAPABILITY_CALLBACK_SCHEMA_VERSION,
            capability_id: options.capabilityId,
            disabled: true,
            measured: false,
        });
        if (!hasLoggingConsent(options)) return result;

        const monotonicStart = performance.now();
        const startedAt = new Date().toISOString();
        const handle = createHandle(options, startedAt);
        const finishedAt = new Date().toISOString();
        await persistFinal(options, finalRecord(
            options,
            handle,
            finishedAt,
            Math.max(0, performance.now() - monotonicStart),
            "disabled",
            "capability-disabled",
        ));
        rememberFinalized(handle.invocation_id);
        return result;
    }

    if (!hasLoggingConsent(options) || !isMeasuredCapabilityEnabled(options)) {
        return operatingCapabilityBypassResultSchema.parse({
            schema_version: CAPABILITY_CALLBACK_SCHEMA_VERSION,
            capability_id: options.capabilityId,
            disabled: false,
            measured: false,
        });
    }

    const monotonicStart = performance.now();
    const handle = createHandle(options, new Date().toISOString());
    rememberOperatingStart(handle.invocation_id, monotonicStart);
    return handle;
}

export async function finishOperatingCapability(
    projectRoot: string,
    rawHandle: OperatingCapabilityHandle,
    rawFinish: OperatingCapabilityFinishInput,
): Promise<OperatingCapabilityFinishResult> {
    const handle = operatingCapabilityHandleSchema.parse(rawHandle);
    const finish = operatingCapabilityFinishInputSchema.parse(rawFinish);
    if (finalizedOperatingInvocations.has(handle.invocation_id)) {
        return operatingCapabilityFinishResultSchema.parse({
            schema_version: CAPABILITY_CALLBACK_SCHEMA_VERSION,
            invocation_id: handle.invocation_id,
            finalized: false,
        });
    }
    rememberFinalized(handle.invocation_id);

    const finishedAt = new Date().toISOString();
    const monotonicStart = operatingStarts.get(handle.invocation_id);
    operatingStarts.delete(handle.invocation_id);
    const durationMs = monotonicStart === undefined
        ? Math.max(0, Date.parse(finishedAt) - Date.parse(handle.started_at))
        : Math.max(0, performance.now() - monotonicStart);
    const errorCode: CapabilityCallbackErrorCode | undefined = finish.outcome === "error"
        ? "callback-error"
        : finish.outcome === "timeout"
            ? "callback-timeout"
            : undefined;
    const options: CapabilityAdapterOptions = {
        projectRoot,
        snapshot: {
            contract_enabled: true,
            logging: { enabled: true, source: handle.state_source },
            configuration_digest: handle.configuration_digest,
            capabilities: [{
                id: handle.capability_id,
                kind: "operating-workflow",
                enabled: true,
                source: handle.state_source,
                restart_required: false,
            }],
        },
        capabilityId: handle.capability_id,
        classification: {
            harness: handle.harness,
            source: handle.source,
            transport: handle.transport,
        },
        correlationId: handle.correlation_id,
    };
    if (handle.transport !== "http" && isTrajectoryCaptureEnabled()) {
        await persistFinal(options, finalRecord(
            options,
            handle,
            finishedAt,
            durationMs,
            finish.outcome,
            errorCode,
        ));
    }
    return operatingCapabilityFinishResultSchema.parse({
        schema_version: CAPABILITY_CALLBACK_SCHEMA_VERSION,
        invocation_id: handle.invocation_id,
        finalized: true,
    });
}
