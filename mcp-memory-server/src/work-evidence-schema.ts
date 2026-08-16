import { z } from "zod";

export const WORK_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const WORK_EVIDENCE_HARNESSES = ["claude", "opencode", "pi", "kimi", "qwen", "codex"] as const;
export const WORK_EVIDENCE_DEFAULT_RETENTION_DAYS = 30;
export const WORK_EVIDENCE_DEFAULT_STORE_MAX_BYTES = 64 * 1024 * 1024;
export const WORK_EVIDENCE_DEFAULT_MAX_TOUCHED_PATHS = 4096;
export const WORK_EVIDENCE_DEFAULT_PATCH_MAX_BYTES = 1024 * 1024;

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const commitSchema = z.string().regex(/^[a-f0-9]{40,64}$/);
const safeRefSchema = z.string().min(1).max(512).refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
const pathLabelSchema = z.string().min(1).max(4096).refine((value) => (
    !value.startsWith("/")
    && !value.includes("\\")
    && !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    && !/[\u0000-\u001f\u007f]/.test(value)
), "Touched paths must be safe repository-relative labels.");

export const workEvidenceIdSchema = z.string().regex(/^wev_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
export const workEvidenceHarnessSchema = z.enum(WORK_EVIDENCE_HARNESSES);

export const gitEvidenceSnapshotSchema = z.object({
    head_commit: commitSchema.nullable(),
    branch: safeRefSchema.nullable(),
    detached: z.boolean(),
    unborn: z.boolean(),
    dirty: z.boolean(),
    status_digest: digestSchema,
    workspace_diff_digest: digestSchema,
}).strict();

const pathFingerprintSchema = z.object({
    path: pathLabelSchema,
    state_digest: digestSchema,
}).strict();

export const pendingWorkEvidenceSchema = z.object({
    schema_version: z.literal(WORK_EVIDENCE_SCHEMA_VERSION),
    evidence_id: workEvidenceIdSchema,
    status: z.literal("pending"),
    harness: workEvidenceHarnessSchema,
    started_at: z.iso.datetime(),
    start: gitEvidenceSnapshotSchema,
    path_fingerprints: z.array(pathFingerprintSchema).max(WORK_EVIDENCE_DEFAULT_MAX_TOUCHED_PATHS),
}).strict();

export const workEvidencePatchSchema = z.object({
    requested: z.boolean(),
    scope: z.literal("end-worktree-vs-start-commit").nullable(),
    artifact_id: z.string().regex(/^art_[0-9a-f-]{36}$/i).nullable(),
    unavailable_reason: z.enum([
        "not-requested",
        "artifact-store-disabled",
        "unborn-start",
        "unchanged",
        "capture-failed",
    ]).nullable(),
}).strict();

export const completeWorkEvidenceSchema = z.object({
    schema_version: z.literal(WORK_EVIDENCE_SCHEMA_VERSION),
    evidence_id: workEvidenceIdSchema,
    status: z.literal("complete"),
    harness: workEvidenceHarnessSchema,
    started_at: z.iso.datetime(),
    ended_at: z.iso.datetime(),
    exit_status: z.number().int().min(0).max(255),
    start: gitEvidenceSnapshotSchema,
    end: gitEvidenceSnapshotSchema,
    touched_paths: z.array(pathLabelSchema).max(WORK_EVIDENCE_DEFAULT_MAX_TOUCHED_PATHS),
    omitted_touched_paths: z.number().int().nonnegative(),
    change_digest: digestSchema,
    patch: workEvidencePatchSchema,
}).strict();

export const workEvidenceLinkSchema = z.discriminatedUnion("kind", [
    z.object({
        schema_version: z.literal(WORK_EVIDENCE_SCHEMA_VERSION),
        link_id: digestSchema,
        evidence_id: workEvidenceIdSchema,
        kind: z.literal("trajectory"),
        created_at: z.iso.datetime(),
        trajectory_id: safeRefSchema,
    }).strict(),
    z.object({
        schema_version: z.literal(WORK_EVIDENCE_SCHEMA_VERSION),
        link_id: digestSchema,
        evidence_id: workEvidenceIdSchema,
        kind: z.literal("artifact"),
        created_at: z.iso.datetime(),
        artifact_id: z.string().regex(/^art_[0-9a-f-]{36}$/i),
    }).strict(),
    z.object({
        schema_version: z.literal(WORK_EVIDENCE_SCHEMA_VERSION),
        link_id: digestSchema,
        evidence_id: workEvidenceIdSchema,
        kind: z.literal("reviewed_memory"),
        created_at: z.iso.datetime(),
        scope: safeRefSchema,
        review_id: safeRefSchema,
        key: safeRefSchema,
    }).strict(),
]);

export const storedWorkEvidenceSchema = z.discriminatedUnion("status", [pendingWorkEvidenceSchema, completeWorkEvidenceSchema]);

export type GitEvidenceSnapshot = z.infer<typeof gitEvidenceSnapshotSchema>;
export type PendingWorkEvidence = z.infer<typeof pendingWorkEvidenceSchema>;
export type CompleteWorkEvidence = z.infer<typeof completeWorkEvidenceSchema>;
export type StoredWorkEvidence = z.infer<typeof storedWorkEvidenceSchema>;
export type WorkEvidenceLink = z.infer<typeof workEvidenceLinkSchema>;
export type WorkEvidenceHarness = z.infer<typeof workEvidenceHarnessSchema>;

export type WorkEvidenceLimits = {
    retentionDays: number;
    storeMaxBytes: number;
    maxTouchedPaths: number;
    patchMaxBytes: number;
};

function truthy(value: string | undefined): boolean {
    return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function integerSetting(name: string, fallback: number, minimum: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new Error(`${name} must be an integer greater than or equal to ${minimum}.`);
    }
    return value;
}

export function isWorkEvidenceEnabled(value = process.env.CAIRN_WORK_EVIDENCE): boolean {
    return truthy(value);
}

export function isWorkEvidencePatchEnabled(value = process.env.CAIRN_WORK_EVIDENCE_PATCH): boolean {
    return truthy(value);
}

export function getWorkEvidenceLimits(): WorkEvidenceLimits {
    return {
        retentionDays: integerSetting("CAIRN_WORK_EVIDENCE_RETENTION_DAYS", WORK_EVIDENCE_DEFAULT_RETENTION_DAYS, 0),
        storeMaxBytes: integerSetting("CAIRN_WORK_EVIDENCE_STORE_MAX_BYTES", WORK_EVIDENCE_DEFAULT_STORE_MAX_BYTES, 1024),
        maxTouchedPaths: Math.min(
            integerSetting("CAIRN_WORK_EVIDENCE_MAX_TOUCHED_PATHS", WORK_EVIDENCE_DEFAULT_MAX_TOUCHED_PATHS, 1),
            WORK_EVIDENCE_DEFAULT_MAX_TOUCHED_PATHS,
        ),
        patchMaxBytes: integerSetting("CAIRN_WORK_EVIDENCE_PATCH_MAX_BYTES", WORK_EVIDENCE_DEFAULT_PATCH_MAX_BYTES, 1024),
    };
}
