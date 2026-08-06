import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { z } from "zod";

import { CAPABILITY_IDS, capabilityIdSchema } from "./capability-schema.js";

export const EVAL_SCHEMA_VERSION = 1 as const;
export const EVAL_ADAPTER_RESULT_STATUSES = ["completed", "adapter_error"] as const;
export const EVAL_OBSERVATION_TERMINAL_STATES = [
    "completed",
    "verifier_failed",
    "timeout",
    "cancelled",
    "adapter_error",
    "invalid_result",
] as const;
export const EVAL_PASS_STATES = ["passed", "failed", "unknown"] as const;
export const EVAL_EXPERIMENT_KINDS = ["two_pass", "ablation", "skill_candidate"] as const;

const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_COMMAND_ARGS = 256;
const MAX_TASKS = 10_000;
const MAX_REFERENCES = 10_000;
const MAX_SNAPSHOT_FILES = 10_000;

const identifierSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const referenceSchema = z.string().min(1).max(1024)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
    .refine((value) => !value.includes("//") && !value.split("/").includes(".."), "Reference is not canonical.");
const valueFreeCodeSchema = z.string().min(1).max(128).regex(/^[a-z0-9][a-z0-9._-]*$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const commitSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const boundedTextSchema = z.string().max(MAX_TEXT_BYTES);
const nonnegativeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const evalRelativePathSchema = z.string().min(1).max(1024).superRefine((value, context) => {
    if (isAbsolute(value) || value.startsWith("/") || value.endsWith("/") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) {
        context.addIssue({ code: "custom", message: "Evaluation paths must be relative canonical paths." });
        return;
    }
    const segments = value.split("/");
    if (segments.some((segment) => segment === "" || segment === "..")) {
        context.addIssue({ code: "custom", message: "Evaluation path contains an invalid segment." });
    }
});

export const evalCommandSchema = z.strictObject({
    program: z.string().min(1).max(4096).refine((value) => !/[\u0000\r\n]/.test(value)),
    args: z.array(z.string().max(16_384).refine((value) => !value.includes("\u0000"))).max(MAX_COMMAND_ARGS),
});

export const evalLimitsSchema = z.strictObject({
    elapsed_ms: z.number().int().positive().max(86_400_000),
    stdout_bytes: z.number().int().positive().max(16 * 1024 * 1024),
});

const gitSourceSchema = z.strictObject({
    kind: z.literal("git"),
    repository: evalRelativePathSchema,
    revision: commitSchema,
});

const bundledFileSchema = z.strictObject({
    path: evalRelativePathSchema,
    content: z.string().max(256 * 1024),
});

const bundledFakeSourceSchema = z.strictObject({
    kind: z.literal("bundled_fake"),
    identifier: z.literal("cairn-offline-fake-v1"),
    files: z.array(bundledFileSchema).min(1).max(1024).superRefine((files, context) => {
        const seen = new Set<string>();
        for (const [index, file] of files.entries()) {
            if (seen.has(file.path)) {
                context.addIssue({ code: "custom", path: [index, "path"], message: "Bundled file paths must be unique." });
            }
            seen.add(file.path);
        }
    }),
});

export const evalTaskSourceSchema = z.discriminatedUnion("kind", [gitSourceSchema, bundledFakeSourceSchema]);

export const evalTaskSchema = z.strictObject({
    id: identifierSchema,
    input: boundedTextSchema,
    workspace: z.strictObject({ path: evalRelativePathSchema }),
    prepare: evalCommandSchema,
    verify: evalCommandSchema,
    limits: evalLimitsSchema,
});

export const evalTaskSetSchema = z.strictObject({
    schema_version: z.literal(EVAL_SCHEMA_VERSION),
    id: identifierSchema,
    source: evalTaskSourceSchema,
    tasks: z.array(evalTaskSchema).min(1).max(MAX_TASKS).superRefine((tasks, context) => {
        const seen = new Set<string>();
        for (const [index, task] of tasks.entries()) {
            if (seen.has(task.id)) {
                context.addIssue({ code: "custom", path: [index, "id"], message: "Evaluation task IDs must be unique." });
            }
            seen.add(task.id);
        }
    }),
});

export const evalAdapterConfigSchema = z.strictObject({
    schema_version: z.literal(EVAL_SCHEMA_VERSION),
    id: identifierSchema,
    command: evalCommandSchema,
    turn_semantics: z.strictObject({
        id: identifierSchema,
        description: z.string().min(1).max(1024),
    }),
});

const evalArmSchema = z.union([z.literal("baseline"), z.literal("treatment")]);
const evalPassSchema = z.union([z.literal("run1"), z.literal("run2")]);

export const evalAdapterRequestSchema = z.strictObject({
    schema_version: z.literal(EVAL_SCHEMA_VERSION),
    experiment_id: identifierSchema,
    task_id: identifierSchema,
    arm: evalArmSchema,
    repetition: nonnegativeIntegerSchema,
    pass: evalPassSchema,
    workspace_path: evalRelativePathSchema,
    notes_path: evalRelativePathSchema.nullable(),
    input: boundedTextSchema,
    limits: evalLimitsSchema,
    seed: z.string().min(1).max(256),
    expected_capability_digest: digestSchema,
    output_path: evalRelativePathSchema,
});

const usageSchema = z.strictObject({
    input_tokens: nonnegativeIntegerSchema.optional(),
    output_tokens: nonnegativeIntegerSchema.optional(),
    reasoning_tokens: nonnegativeIntegerSchema.optional(),
    cache_read_tokens: nonnegativeIntegerSchema.optional(),
    cache_write_tokens: nonnegativeIntegerSchema.optional(),
    total_tokens: nonnegativeIntegerSchema.optional(),
});

const componentIdentitySchema = z.strictObject({
    id: identifierSchema,
    version: z.string().min(1).max(128).optional(),
});

export const evalAdapterResultSchema = z.strictObject({
    schema_version: z.literal(EVAL_SCHEMA_VERSION),
    status: z.enum(EVAL_ADAPTER_RESULT_STATUSES),
    error_code: valueFreeCodeSchema.optional(),
    turns: z.strictObject({ value: nonnegativeIntegerSchema, semantics: identifierSchema }).optional(),
    usage: usageSchema.optional(),
    cost: z.strictObject({
        amount: z.number().finite().nonnegative(),
        currency: z.string().regex(/^[A-Z]{3}$/),
    }).optional(),
    harness: componentIdentitySchema.optional(),
    adapter: componentIdentitySchema.optional(),
    model: z.strictObject({
        id: identifierSchema,
        config_id: identifierSchema.optional(),
    }).optional(),
    observed_capability_digest: digestSchema.optional(),
    trajectory_ref: referenceSchema.optional(),
    artifact_refs: z.array(referenceSchema).max(MAX_REFERENCES).optional(),
});

const capabilityStateSchema = z.strictObject({ id: capabilityIdSchema, enabled: z.boolean() });
const capabilityStateListSchema = z.array(capabilityStateSchema).length(CAPABILITY_IDS.length).superRefine((rows, context) => {
    const expected = [...CAPABILITY_IDS];
    if (rows.some((row, index) => row.id !== expected[index])) {
        context.addIssue({ code: "custom", message: "Capability state rows must use canonical capability order." });
    }
});

const processObservationSchema = z.strictObject({
    exit_code: z.number().int().nullable(),
    signal: z.enum(["SIGTERM", "SIGKILL", "SIGINT", "SIGHUP"]).nullable(),
    error_code: valueFreeCodeSchema.nullable(),
    cleanup: z.enum(["pending", "closed", "terminated", "killed", "failed"]),
});

const verifierObservationSchema = z.strictObject({
    state: z.enum(["pending", "not_run", "completed", "error"]),
    reason: valueFreeCodeSchema.nullable(),
});

const noteSnapshotEntrySchema = z.strictObject({
    path: evalRelativePathSchema,
    digest: digestSchema,
    bytes: nonnegativeIntegerSchema,
});

const noteObservationSchema = z.strictObject({
    distiller_id: identifierSchema.nullable(),
    distiller_config_digest: digestSchema.nullable(),
    trajectory_ref: referenceSchema.nullable(),
    distillation_outcome: z.enum(["not_applicable", "success", "no_notes", "failed", "skipped"]),
    eligibility_reason: valueFreeCodeSchema,
    note_snapshot_digest: digestSchema.nullable(),
    note_snapshot_manifest: z.array(noteSnapshotEntrySchema).max(MAX_SNAPSHOT_FILES),
    notes_exposed: z.boolean(),
});

export const evalObservationSchema = z.strictObject({
    schema_version: z.literal(EVAL_SCHEMA_VERSION),
    observation_id: identifierSchema,
    task_id: identifierSchema,
    schedule_index: nonnegativeIntegerSchema,
    arm: evalArmSchema,
    disabled_capability: capabilityIdSchema.nullable(),
    arm_order: nonnegativeIntegerSchema,
    repetition: nonnegativeIntegerSchema,
    pass: evalPassSchema,
    seed: z.string().min(1).max(256),
    state: z.enum(["pending", "terminal"]),
    terminal_state: z.enum(EVAL_OBSERVATION_TERMINAL_STATES).nullable(),
    process: processObservationSchema,
    verifier: verifierObservationSchema,
    pass_state: z.enum(EVAL_PASS_STATES),
    expected_capabilities: capabilityStateListSchema,
    observed_capabilities: capabilityStateListSchema,
    expected_capability_digest: digestSchema,
    observed_capability_digest: digestSchema.nullable(),
    capability_status: z.enum(["pending", "valid", "mismatch", "unavailable"]),
    capability_digest_match: z.boolean().nullable(),
    four_cell_id: identifierSchema,
    notes: noteObservationSchema,
    result: evalAdapterResultSchema.nullable(),
    missing_reasons: z.array(valueFreeCodeSchema).max(256),
});

const nullableMetricSchema = z.number().finite().nullable();
const populationSchema = z.strictObject({
    full: nonnegativeIntegerSchema,
    executed: nonnegativeIntegerSchema,
    eligible: nonnegativeIntegerSchema,
    paired: nonnegativeIntegerSchema,
    note_eligible: nonnegativeIntegerSchema,
});
const missingnessSummarySchema = z.strictObject({
    count: nonnegativeIntegerSchema,
    reasons: z.array(valueFreeCodeSchema).max(256),
});

const conditionPopulationSchema = z.strictObject({
    full: nonnegativeIntegerSchema,
    executed: nonnegativeIntegerSchema,
    eligible: nonnegativeIntegerSchema,
});

function conditionLevelSchema(arm: "baseline" | "treatment", pass: "run1" | "run2") {
    return z.strictObject({
        arm: z.literal(arm),
        pass: z.literal(pass),
        value: nullableMetricSchema,
        valid_task_ids: z.array(identifierSchema).max(MAX_TASKS),
        valid_task_count: nonnegativeIntegerSchema,
        population: conditionPopulationSchema,
        missing: missingnessSummarySchema,
    });
}

const aggregateCommonShape = {
    metric_id: identifierSchema,
    direction: identifierSchema,
    semantics: identifierSchema.nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    estimate: nullableMetricSchema,
    within_arm: z.strictObject({ baseline: nullableMetricSchema, treatment: nullableMetricSchema }),
    endpoint_delta: nullableMetricSchema,
    difference_in_differences: nullableMetricSchema,
    uncertainty: z.strictObject({
        algorithm: z.literal("paired-bootstrap"),
        version: z.literal(1),
        seed: z.string().min(1).max(256),
        stream: z.string().min(1).max(512),
        iterations: positiveIntegerSchema.max(1_000_000),
        confidence: z.number().gt(0).lt(1),
        quantile: z.literal("percentile-nearest-rank-v1"),
        interval: z.strictObject({ low: z.number().finite(), high: z.number().finite() }).nullable(),
        null_reason: valueFreeCodeSchema.nullable(),
    }),
    warnings: z.array(valueFreeCodeSchema).max(256),
    valid_task_ids: z.array(identifierSchema).max(MAX_TASKS),
    valid_pair_count: nonnegativeIntegerSchema,
    population: populationSchema,
    missing: missingnessSummarySchema,
};

const baselineRun1LevelSchema = conditionLevelSchema("baseline", "run1");
const baselineRun2LevelSchema = conditionLevelSchema("baseline", "run2");
const treatmentRun1LevelSchema = conditionLevelSchema("treatment", "run1");
const treatmentRun2LevelSchema = conditionLevelSchema("treatment", "run2");

export const evalAggregateSchema = z.discriminatedUnion("comparison_id", [
    z.strictObject({
        comparison_id: z.literal("memory-baseline"),
        ...aggregateCommonShape,
        condition_levels: z.tuple([baselineRun1LevelSchema, baselineRun2LevelSchema]),
    }),
    z.strictObject({
        comparison_id: z.literal("memory-treatment"),
        ...aggregateCommonShape,
        condition_levels: z.tuple([treatmentRun1LevelSchema, treatmentRun2LevelSchema]),
    }),
    z.strictObject({
        comparison_id: z.literal("endpoint-treatment-minus-baseline"),
        ...aggregateCommonShape,
        condition_levels: z.tuple([baselineRun2LevelSchema, treatmentRun2LevelSchema]),
    }),
    z.strictObject({
        comparison_id: z.literal("difference-in-differences"),
        ...aggregateCommonShape,
        condition_levels: z.tuple([
            baselineRun1LevelSchema,
            baselineRun2LevelSchema,
            treatmentRun1LevelSchema,
            treatmentRun2LevelSchema,
        ]),
    }),
]);

const scheduleRowSchema = z.strictObject({
    observation_id: identifierSchema,
    task_id: identifierSchema,
    arm: evalArmSchema,
    repetition: nonnegativeIntegerSchema,
    pass: evalPassSchema,
    seed: z.string().min(1).max(256),
});

const evidenceProvenanceSchema = z.strictObject({
    schema_version: z.literal(EVAL_SCHEMA_VERSION),
    evidence_scope: z.enum(["offline-framework", "live-evaluation"]),
    source_commit: commitSchema,
    package_version: z.string().min(1).max(128),
    runtime_id: identifierSchema,
    task_set_digest: digestSchema,
    mcp_tool_profile_digest: digestSchema.optional(),
    report_digest: digestSchema,
    schema_digests: z.array(digestSchema).length(2),
    note_snapshot_digests: z.array(digestSchema).max(MAX_TASKS),
    missingness_digest: digestSchema,
    claim_anchors: z.array(referenceSchema).max(256),
});

export const evalReportSchema = z.strictObject({
    schema_version: z.literal(EVAL_SCHEMA_VERSION),
    experiment_id: identifierSchema,
    status: z.enum(["partial", "final"]),
    experiment_kind: z.enum(EVAL_EXPERIMENT_KINDS),
    task_set_digest: digestSchema,
    adapter_config_digest: digestSchema,
    source_revision: commitSchema,
    schedule_digest: digestSchema,
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
    runtime: z.strictObject({
        platform: identifierSchema,
        arch: identifierSchema,
        node: z.string().min(1).max(128),
        cairnkeep: z.string().min(1).max(128),
    }),
    schedule: z.array(scheduleRowSchema).max(MAX_TASKS * 100),
    observations: z.array(evalObservationSchema).max(MAX_TASKS * 100),
    aggregates: z.array(evalAggregateSchema).max(10_000),
    missingness: z.strictObject({ digest: digestSchema, count: nonnegativeIntegerSchema, reasons: z.array(valueFreeCodeSchema).max(256) }),
    warnings: z.array(valueFreeCodeSchema).max(256),
    evidence: evidenceProvenanceSchema,
});

export type EvalCommand = z.infer<typeof evalCommandSchema>;
export type EvalLimits = z.infer<typeof evalLimitsSchema>;
export type EvalTaskSet = z.infer<typeof evalTaskSetSchema>;
export type EvalAdapterConfig = z.infer<typeof evalAdapterConfigSchema>;
export type EvalAdapterRequest = z.infer<typeof evalAdapterRequestSchema>;
export type EvalAdapterResult = z.infer<typeof evalAdapterResultSchema>;
export type EvalObservation = z.infer<typeof evalObservationSchema>;
export type EvalAggregate = z.infer<typeof evalAggregateSchema>;
export type EvalReport = z.infer<typeof evalReportSchema>;

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

export function canonicalDigest(value: unknown): string {
    return sha256Hex(canonicalBytes(value));
}

export const evalReportRuntimeContract = z.toJSONSchema(evalReportSchema, {
    target: "draft-2020-12",
    io: "input",
});

export const evalReportRuntimeContractDigest = canonicalDigest(evalReportRuntimeContract);
