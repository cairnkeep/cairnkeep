import { z } from "zod";

export const SKILL_SCHEMA_VERSION = 1 as const;
export const MAX_SKILL_BYTES = 256 * 1024;
export const MAX_SKILL_EDITS = 16;

const identifierSchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const timestampSchema = z.iso.datetime();
const boundedTextSchema = z.string().max(4096);

const canonicalRelativePathSchema = z.string().min(1).max(1024).superRefine((value, context) => {
    if (value.startsWith("/") || value.endsWith("/") || value.includes("\\")
        || /[\u0000-\u001f\u007f]/.test(value)) {
        context.addIssue({ code: "custom", message: "Skill paths must be relative canonical paths." });
        return;
    }
    const segments = value.split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
        context.addIssue({ code: "custom", message: "Skill paths contain an invalid segment." });
    }
});

export const skillRelativePathSchema = canonicalRelativePathSchema.refine(
    (value) => value.split("/").at(-1) === "SKILL.md",
    "Skill targets must be existing files named SKILL.md.",
);

export const skillEvidenceOccurrenceSchema = z.strictObject({
    session_id: z.string().min(1).max(256),
    session_digest: digestSchema,
    ended_at: timestampSchema,
    outcome: z.enum(["failure", "resolution", "abandonment"]),
    tool_name: z.string().min(1).max(256).optional(),
    evidence: boundedTextSchema,
});

export const skillCandidateSchema = z.strictObject({
    schema_version: z.literal(SKILL_SCHEMA_VERSION),
    id: identifierSchema,
    project_id: identifierSchema,
    status: z.enum(["pending_review", "approved"]),
    note_id: identifierSchema,
    source_digest: digestSchema,
    title: z.string().min(1).max(512),
    description: boundedTextSchema,
    failure_family: identifierSchema,
    failure_count: z.number().int().min(2).max(1024),
    resolution_count: z.number().int().min(1).max(1024),
    occurrences: z.array(skillEvidenceOccurrenceSchema).min(2).max(64),
    lessons: z.array(z.string().min(1).max(1024)).max(16),
    caveats: z.array(z.string().min(1).max(1024)).max(16),
    created_at: timestampSchema,
    reviewed_at: timestampSchema.nullable(),
});

export const skillEditSchema = z.strictObject({
    operation: z.enum(["add", "replace", "delete"]),
    anchor: z.string().min(1).max(16 * 1024).nullable(),
    content: z.string().max(64 * 1024),
    rationale: z.string().min(1).max(2048),
}).superRefine((edit, context) => {
    if (edit.operation !== "add" && edit.anchor === null) {
        context.addIssue({ code: "custom", path: ["anchor"], message: "Replace and delete edits require an anchor." });
    }
    if (edit.operation === "delete" && edit.content !== "") {
        context.addIssue({ code: "custom", path: ["content"], message: "Delete edits require empty content." });
    }
    if (edit.operation !== "delete" && edit.content.length === 0) {
        context.addIssue({ code: "custom", path: ["content"], message: "Add and replace edits require content." });
    }
});

export const skillAdapterConfigSchema = z.strictObject({
    schema_version: z.literal(SKILL_SCHEMA_VERSION),
    id: identifierSchema,
    command: z.strictObject({
        program: z.string().min(1).max(4096),
        args: z.array(z.string().max(16 * 1024)).max(128),
    }),
    environment_allowlist: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/)).max(64).default([]),
    limits: z.strictObject({
        elapsed_ms: z.number().int().positive().max(3_600_000),
        stdout_bytes: z.number().int().positive().max(4 * 1024 * 1024),
    }),
});

export const skillProposalRequestSchema = z.strictObject({
    schema_version: z.literal(SKILL_SCHEMA_VERSION),
    operation: z.literal("propose"),
    candidate: skillCandidateSchema.refine((candidate) => candidate.status === "approved", "Candidate must be approved."),
    candidate_digest: digestSchema,
    target: z.strictObject({
        path: skillRelativePathSchema,
        baseline_digest: digestSchema,
        content: z.string().max(MAX_SKILL_BYTES),
    }),
    edit_budget: z.number().int().positive().max(MAX_SKILL_EDITS),
});

export const skillProposalResponseSchema = z.strictObject({
    schema_version: z.literal(SKILL_SCHEMA_VERSION),
    status: z.enum(["completed", "adapter_error"]),
    error_code: identifierSchema.optional(),
    edits: z.array(skillEditSchema).max(MAX_SKILL_EDITS).default([]),
}).superRefine((response, context) => {
    if (response.status === "completed" && response.edits.length === 0) {
        context.addIssue({ code: "custom", path: ["edits"], message: "A completed proposal requires at least one edit." });
    }
    if (response.status === "adapter_error" && !response.error_code) {
        context.addIssue({ code: "custom", path: ["error_code"], message: "Adapter errors require an error code." });
    }
});

export const skillProposalSchema = z.strictObject({
    schema_version: z.literal(SKILL_SCHEMA_VERSION),
    id: identifierSchema,
    candidate_id: identifierSchema,
    candidate_digest: digestSchema,
    target_path: skillRelativePathSchema,
    baseline_digest: digestSchema,
    candidate_content_digest: digestSchema,
    candidate_content: z.string().max(MAX_SKILL_BYTES),
    target_mode: z.number().int().min(0).max(0o777),
    adapter_id: identifierSchema,
    adapter_config_digest: digestSchema,
    adapter_program_digest: digestSchema,
    edits: z.array(skillEditSchema).min(1).max(MAX_SKILL_EDITS),
    created_at: timestampSchema,
});

const skillEvaluationSummarySchema = z.strictObject({
    task_set_digest: digestSchema,
    report_digest: digestSchema,
    experiment_id: z.string().min(1).max(128),
    baseline_passed: z.number().int().nonnegative(),
    candidate_passed: z.number().int().nonnegative(),
    eligible_pairs: z.number().int().nonnegative(),
    improvements: z.number().int().nonnegative(),
    regressions: z.number().int().nonnegative(),
    unknown: z.number().int().nonnegative(),
});

export const skillEvaluationSchema = z.strictObject({
    schema_version: z.literal(SKILL_SCHEMA_VERSION),
    id: identifierSchema,
    proposal_id: identifierSchema,
    proposal_digest: digestSchema,
    binding_digest: digestSchema,
    evaluation_adapter_program_digest: digestSchema,
    status: z.enum(["eligible", "rejected", "inconclusive"]),
    minimum_improvement: z.number().int().positive().max(10_000),
    exploration: skillEvaluationSummarySchema,
    confirmation: skillEvaluationSummarySchema.nullable(),
    reasons: z.array(identifierSchema).max(64),
    created_at: timestampSchema,
}).superRefine((evaluation, context) => {
    if (evaluation.status === "eligible" && (evaluation.confirmation === null || evaluation.reasons.length > 0)) {
        context.addIssue({ code: "custom", message: "Eligible evaluations require confirmation and no rejection reasons." });
    }
    if (evaluation.status !== "eligible" && evaluation.reasons.length === 0) {
        context.addIssue({ code: "custom", path: ["reasons"], message: "Non-eligible evaluations require at least one reason." });
    }
});

export const skillApplicationSchema = z.strictObject({
    schema_version: z.literal(SKILL_SCHEMA_VERSION),
    id: identifierSchema,
    proposal_id: identifierSchema,
    proposal_digest: digestSchema,
    evaluation_id: identifierSchema,
    evaluation_digest: digestSchema,
    target_path: skillRelativePathSchema,
    before_digest: digestSchema,
    applied_digest: digestSchema,
    backup_path: canonicalRelativePathSchema,
    target_mode: z.number().int().min(0).max(0o777),
    state: z.enum(["applied", "rolled_back"]),
    applied_at: timestampSchema,
    rolled_back_at: timestampSchema.nullable(),
});

export type SkillCandidate = z.infer<typeof skillCandidateSchema>;
export type SkillEdit = z.infer<typeof skillEditSchema>;
export type SkillAdapterConfig = z.infer<typeof skillAdapterConfigSchema>;
export type SkillProposalRequest = z.infer<typeof skillProposalRequestSchema>;
export type SkillProposalResponse = z.infer<typeof skillProposalResponseSchema>;
export type SkillProposal = z.infer<typeof skillProposalSchema>;
export type SkillEvaluation = z.infer<typeof skillEvaluationSchema>;
export type SkillApplication = z.infer<typeof skillApplicationSchema>;
