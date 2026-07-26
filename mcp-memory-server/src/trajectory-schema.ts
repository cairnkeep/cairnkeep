import { z } from "zod";

export const TRAJECTORY_SCHEMA_VERSION = 1 as const;
export const TRAJECTORY_DEFAULT_SESSION_MAX_BYTES = 5 * 1024 * 1024;
export const TRAJECTORY_DEFAULT_STORE_MAX_BYTES = 256 * 1024 * 1024;
export const TRAJECTORY_DEFAULT_RETENTION_DAYS = 30;

export const trajectoryUsageSchema = z.object({
    input_tokens: z.number().nonnegative().optional(),
    output_tokens: z.number().nonnegative().optional(),
    reasoning_tokens: z.number().nonnegative().optional(),
    cache_read_tokens: z.number().nonnegative().optional(),
    cache_write_tokens: z.number().nonnegative().optional(),
    cost: z.number().nonnegative().optional(),
}).strict();

export const trajectoryEventSchema = z.object({
    sequence: z.number().int().nonnegative(),
    kind: z.enum([
        "user_message",
        "model_output",
        "tool_invocation",
        "tool_result",
        "system_event",
        "usage",
    ]),
    timestamp: z.iso.datetime().optional(),
    native_id: z.string().optional(),
    parent_id: z.string().optional(),
    payload: z.record(z.string(), z.unknown()),
    truncation: z.object({
        original_bytes: z.number().int().nonnegative(),
        stored_bytes: z.number().int().nonnegative(),
    }).strict().optional(),
}).strict();

export const trajectorySessionSchema = z.object({
    schema_version: z.literal(TRAJECTORY_SCHEMA_VERSION),
    session_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/),
    harness: z.enum(["claude-code", "opencode", "pi"]),
    project_root: z.string().min(1),
    started_at: z.iso.datetime(),
    ended_at: z.iso.datetime(),
    usage: trajectoryUsageSchema.optional(),
    events: z.array(trajectoryEventSchema),
    capture: z.object({
        captured_at: z.iso.datetime(),
        omitted_reasoning_blocks: z.number().int().nonnegative(),
        omitted_unknown_records: z.number().int().nonnegative(),
        omitted_size_events: z.number().int().nonnegative().optional(),
        truncated: z.boolean(),
        original_bytes: z.number().int().nonnegative().optional(),
        stored_bytes: z.number().int().nonnegative().optional(),
    }).strict(),
}).strict();

export type TrajectoryUsage = z.infer<typeof trajectoryUsageSchema>;
export type TrajectoryEvent = z.infer<typeof trajectoryEventSchema>;
export type TrajectorySession = z.infer<typeof trajectorySessionSchema>;

declare const redactedTrajectoryBrand: unique symbol;
export type RedactedTrajectory = TrajectorySession & { readonly [redactedTrajectoryBrand]: true };

export type TrajectoryLimits = {
    sessionMaxBytes: number;
    storeMaxBytes: number;
    retentionDays: number;
};

function integerSetting(name: string, fallback: number, minimum: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
    }
    return value;
}

export function getTrajectoryLimits(): TrajectoryLimits {
    const sessionMaxBytes = integerSetting(
        "CAIRN_TRAJECTORY_SESSION_MAX_BYTES",
        TRAJECTORY_DEFAULT_SESSION_MAX_BYTES,
        1024,
    );
    const storeMaxBytes = integerSetting(
        "CAIRN_TRAJECTORY_STORE_MAX_BYTES",
        TRAJECTORY_DEFAULT_STORE_MAX_BYTES,
        1024,
    );
    const retentionDays = integerSetting(
        "CAIRN_TRAJECTORY_RETENTION_DAYS",
        TRAJECTORY_DEFAULT_RETENTION_DAYS,
        0,
    );
    if (storeMaxBytes < sessionMaxBytes) {
        throw new Error("CAIRN_TRAJECTORY_STORE_MAX_BYTES must be at least the session maximum.");
    }
    return { sessionMaxBytes, storeMaxBytes, retentionDays };
}

export function isTrajectoryCaptureEnabled(value = process.env.CAIRN_TRAJECTORY_CAPTURE): boolean {
    return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? "");
}
