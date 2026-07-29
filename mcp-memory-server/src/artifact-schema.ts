import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { z } from "zod";

import { nodePathSchema } from "./node-schema.js";

export const ARTIFACT_SCHEMA_VERSION = 1 as const;
export const ARTIFACT_KINDS = [
    "compaction_summary",
    "diff",
    "test_output",
    "generated_file",
] as const;

export const ARTIFACT_DEFAULT_MAX_BYTES = 1024 * 1024;
export const ARTIFACT_DEFAULT_SESSION_MAX_BYTES = 16 * 1024 * 1024;
export const ARTIFACT_DEFAULT_STORE_MAX_BYTES = 256 * 1024 * 1024;
export const ARTIFACT_DEFAULT_RETENTION_DAYS = 30;
export const COMPACTION_DEFAULT_MAX_REVISIONS = 8;
export const GENERATED_FILE_MAX_SNAPSHOT_BYTES = 256 * 1024;

const truthyPattern = /^(?:1|true|yes|on)$/i;
const safeIdentifierSchema = z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const boundedTextSchema = z.string().max(64 * 1024 * 1024);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const nonnegativeIntegerSchema = z.number().int().nonnegative();

export const artifactKindSchema = z.enum(ARTIFACT_KINDS);
export const artifactIdSchema = z.string().regex(/^art_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
export const artifactSessionRefSchema = safeIdentifierSchema;
export const artifactMediaTypeSchema = z.string().min(1).max(255).regex(/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+\/-]*$/);

export const artifactNodeRefSchema = z.object({
    scope: z.string().min(1).max(256).refine((value) => value !== "all", 'Node scope must be concrete; "all" is read-only.'),
    address_space: z.enum(["memory", "project-notes", "shared-notes"]),
    key: nodePathSchema,
}).strict();

export const artifactProvenanceSchema = z.object({
    producer: z.string().min(1).max(256).refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
    source_event: z.string().min(1).max(256).optional(),
    harness: z.enum(["claude-code", "opencode", "pi"]).optional(),
    harness_version: z.string().min(1).max(128).optional(),
    native_id: z.string().min(1).max(256).optional(),
}).strict();

export const compactionCompletenessSchema = z.object({
    task_goals: z.enum(["complete", "partial", "missing"]),
    decisions_made: z.enum(["complete", "partial", "missing"]),
    open_todos: z.enum(["complete", "partial", "missing"]),
    critical_error_traces: z.enum(["complete", "partial", "missing"]),
}).strict();

const compactionBase = {
    raw_summary: boundedTextSchema,
    task_goals: z.array(boundedTextSchema).max(256),
    decisions_made: z.array(boundedTextSchema).max(256),
    open_todos: z.array(boundedTextSchema).max(256),
    critical_error_traces: z.array(boundedTextSchema).max(256),
    completeness: compactionCompletenessSchema,
    trigger: z.string().min(1).max(128),
};

export const compactionSummaryInputContentSchema = z.object(compactionBase).strict();
export const compactionSummaryContentSchema = z.object({
    ...compactionBase,
    revision: z.number().int().positive(),
}).strict();

export const diffContentSchema = z.object({ text: boundedTextSchema }).strict();
export const testOutputContentSchema = z.object({
    text: boundedTextSchema,
    exit_code: z.number().int().optional(),
    status: z.enum(["passed", "failed", "unknown"]).optional(),
}).strict();

export const generatedFilePathLabelSchema = z.string().min(1).max(1024).superRefine((value, context) => {
    if (isAbsolute(value) || value.startsWith("/") || value.endsWith("/") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) {
        context.addIssue({ code: "custom", message: "Generated-file path label must be project-relative." });
        return;
    }
    const segments = value.split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
        context.addIssue({ code: "custom", message: "Generated-file path label contains an invalid segment." });
    }
});

export const generatedFileInputContentSchema = z.object({
    path_label: generatedFilePathLabelSchema,
    file_digest: digestSchema,
    logical_bytes: nonnegativeIntegerSchema,
    binary: z.boolean(),
    snapshot: boundedTextSchema.optional(),
}).strict();

export const generatedFileContentSchema = z.object({
    path_label: generatedFilePathLabelSchema,
    file_digest: digestSchema,
    logical_bytes: nonnegativeIntegerSchema,
    binary: z.boolean(),
    snapshot: boundedTextSchema.optional(),
    metadata_only: z.boolean().optional(),
}).strict();

const writeBase = {
    session_ref: artifactSessionRefSchema,
    node_ref: artifactNodeRefSchema.optional(),
    media_type: artifactMediaTypeSchema,
    provenance: artifactProvenanceSchema,
    supersedes: artifactIdSchema.optional(),
};

export const artifactWriteInputSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("compaction_summary"), ...writeBase, content: compactionSummaryInputContentSchema }).strict(),
    z.object({ kind: z.literal("diff"), ...writeBase, content: diffContentSchema }).strict(),
    z.object({ kind: z.literal("test_output"), ...writeBase, content: testOutputContentSchema }).strict(),
    z.object({ kind: z.literal("generated_file"), ...writeBase, content: generatedFileInputContentSchema }).strict(),
]);
export const artifactWriteSchema = artifactWriteInputSchema;

const envelopeBase = {
    schema_version: z.literal(ARTIFACT_SCHEMA_VERSION),
    artifact_id: artifactIdSchema,
    created_at: z.iso.datetime(),
    session_ref: artifactSessionRefSchema,
    node_ref: artifactNodeRefSchema.optional(),
    media_type: artifactMediaTypeSchema,
    logical_bytes: nonnegativeIntegerSchema,
    stored_bytes: nonnegativeIntegerSchema,
    content_digest: digestSchema,
    provenance: artifactProvenanceSchema,
    redaction: z.object({ applied: z.boolean(), replacement_count: nonnegativeIntegerSchema }).strict(),
    truncation: z.object({
        truncated: z.boolean(),
        reason: z.enum(["artifact_limit", "generated_file_metadata_only"]).optional(),
        original_bytes: nonnegativeIntegerSchema,
        stored_bytes: nonnegativeIntegerSchema,
    }).strict(),
    supersedes: artifactIdSchema.optional(),
};

export const artifactEnvelopeSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("compaction_summary"), ...envelopeBase, content: compactionSummaryContentSchema }).strict(),
    z.object({ kind: z.literal("diff"), ...envelopeBase, content: diffContentSchema }).strict(),
    z.object({ kind: z.literal("test_output"), ...envelopeBase, content: testOutputContentSchema }).strict(),
    z.object({ kind: z.literal("generated_file"), ...envelopeBase, content: generatedFileContentSchema }).strict(),
]);

export const artifactListOutputSchema = z.object({
    schema_version: z.literal(ARTIFACT_SCHEMA_VERSION),
    artifacts: z.array(artifactEnvelopeSchema),
    logical_bytes: nonnegativeIntegerSchema,
    next_cursor: z.string().optional(),
}).strict();

export const artifactDoctorOutputSchema = z.object({
    schema_version: z.literal(ARTIFACT_SCHEMA_VERSION),
    ok: z.boolean(),
    repaired: z.boolean(),
    integrity: z.enum(["ok", "failed"]),
    issues: z.array(z.string()),
}).strict();

export type ArtifactKind = z.infer<typeof artifactKindSchema>;
export type ArtifactNodeRef = z.infer<typeof artifactNodeRefSchema>;
export type ArtifactProvenance = z.infer<typeof artifactProvenanceSchema>;
export type ArtifactWriteInput = z.infer<typeof artifactWriteInputSchema>;
export type ArtifactEnvelope = z.infer<typeof artifactEnvelopeSchema>;
export type CompactionSummaryContent = z.infer<typeof compactionSummaryContentSchema>;

export type ArtifactLimits = {
    artifactMaxBytes: number;
    sessionMaxBytes: number;
    storeMaxBytes: number;
    retentionDays: number;
    compactionMaxRevisions: number;
    generatedFileSnapshotMaxBytes: number;
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

export function getArtifactLimits(): ArtifactLimits {
    const artifactMaxBytes = integerSetting("CAIRN_ARTIFACT_MAX_BYTES", ARTIFACT_DEFAULT_MAX_BYTES, 1024);
    const sessionMaxBytes = integerSetting("CAIRN_ARTIFACT_SESSION_MAX_BYTES", ARTIFACT_DEFAULT_SESSION_MAX_BYTES, 1024);
    const storeMaxBytes = integerSetting("CAIRN_ARTIFACT_STORE_MAX_BYTES", ARTIFACT_DEFAULT_STORE_MAX_BYTES, 1024);
    const retentionDays = integerSetting("CAIRN_ARTIFACT_RETENTION_DAYS", ARTIFACT_DEFAULT_RETENTION_DAYS, 0);
    const compactionMaxRevisions = integerSetting("CAIRN_COMPACTION_MAX_REVISIONS", COMPACTION_DEFAULT_MAX_REVISIONS, 1);
    const generatedFileSnapshotMaxBytes = integerSetting(
        "CAIRN_ARTIFACT_GENERATED_FILE_SNAPSHOT_MAX_BYTES",
        GENERATED_FILE_MAX_SNAPSHOT_BYTES,
        0,
    );
    if (sessionMaxBytes < artifactMaxBytes) {
        throw new Error("Artifact session maximum must be at least the per-artifact maximum.");
    }
    if (storeMaxBytes < sessionMaxBytes) {
        throw new Error("Artifact store maximum must be at least the per-session maximum.");
    }
    return {
        artifactMaxBytes,
        sessionMaxBytes,
        storeMaxBytes,
        retentionDays,
        compactionMaxRevisions,
        generatedFileSnapshotMaxBytes: Math.min(generatedFileSnapshotMaxBytes, artifactMaxBytes),
    };
}

export function isArtifactStoreEnabled(value = process.env.CAIRN_ARTIFACT_STORE): boolean {
    return truthyPattern.test(value?.trim() ?? "");
}

export function isArtifactHttpEnabled(value = process.env.CAIRN_ARTIFACT_HTTP): boolean {
    return truthyPattern.test(value?.trim() ?? "");
}

export function isCompactionCaptureEnabled(value = process.env.CAIRN_COMPACTION_CAPTURE): boolean {
    return truthyPattern.test(value?.trim() ?? "");
}

function sortCanonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortCanonical);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right, "en"))
            .map(([key, child]) => [key, sortCanonical(child)]));
    }
    return value;
}

export function canonicalJson(value: unknown): string {
    return JSON.stringify(sortCanonical(value));
}

export function canonicalBytes(value: unknown): Buffer {
    return Buffer.from(canonicalJson(value), "utf8");
}

export function sha256Hex(value: string | Buffer): string {
    return createHash("sha256").update(value).digest("hex");
}

export function truncateUtf8(value: string, maxBytes: number): { text: string; original_bytes: number; stored_bytes: number; truncated: boolean } {
    const originalBytes = Buffer.byteLength(value, "utf8");
    if (originalBytes <= maxBytes) {
        return { text: value, original_bytes: originalBytes, stored_bytes: originalBytes, truncated: false };
    }
    let storedBytes = 0;
    let text = "";
    for (const character of value) {
        const bytes = Buffer.byteLength(character, "utf8");
        if (storedBytes + bytes > maxBytes) break;
        text += character;
        storedBytes += bytes;
    }
    return { text, original_bytes: originalBytes, stored_bytes: storedBytes, truncated: true };
}
