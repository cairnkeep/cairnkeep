import { z } from "zod";

export const CAPABILITY_SCHEMA_VERSION = 1 as const;

export const CAPABILITY_IDS = [
    "memory.write",
    "memory.search",
    "notes.distill",
    "wiki",
    "graph",
    "security.audit",
    "route.check",
    "context.explore",
] as const;

export const CAPABILITY_KINDS = [
    "mcp-tool",
    "offline-job",
    "operating-workflow",
] as const;

export const CAPABILITY_SOURCES = [
    "environment",
    "project",
    "compatibility",
] as const;

export const CAPABILITY_ISSUE_CODES = [
    "invalid-config",
    "unknown-capability",
    "invalid-capability-value",
    "invalid-logging-value",
] as const;

export const capabilityIdSchema = z.enum(CAPABILITY_IDS);
export const capabilityKindSchema = z.enum(CAPABILITY_KINDS);
export const capabilitySourceSchema = z.enum(CAPABILITY_SOURCES);
export const capabilityIssueCodeSchema = z.enum(CAPABILITY_ISSUE_CODES);

export const capabilityOverridesSchema = z.partialRecord(
    capabilityIdSchema.or(z.never()),
    z.boolean(),
);

export const capabilityLoggingConfigSchema = z.strictObject({
    callbacks: z.boolean(),
});

export const capabilityManagedConfigSchema = z.strictObject({
    schema_version: z.literal(CAPABILITY_SCHEMA_VERSION),
    capabilities: capabilityOverridesSchema,
    logging: capabilityLoggingConfigSchema,
});

export const capabilityIssueSchema = z.strictObject({
    code: capabilityIssueCodeSchema,
    capability_id: capabilityIdSchema.optional(),
    setting: z.literal("logging.callbacks").optional(),
});

export const capabilityStatusRowSchema = z.strictObject({
    id: capabilityIdSchema,
    kind: capabilityKindSchema,
    enabled: z.boolean(),
    source: capabilitySourceSchema,
    restart_required: z.boolean(),
});

export const capabilityLoggingStatusSchema = z.strictObject({
    enabled: z.boolean(),
    source: capabilitySourceSchema,
});

export const capabilityStatusSchema = z.strictObject({
    schema_version: z.literal(CAPABILITY_SCHEMA_VERSION),
    contract_enabled: z.boolean(),
    logging: capabilityLoggingStatusSchema,
    configuration_digest: z.string().regex(/^[a-f0-9]{64}$/),
    capabilities: z.array(capabilityStatusRowSchema).length(CAPABILITY_IDS.length),
    issues: z.array(capabilityIssueSchema),
});

export type CapabilityId = z.infer<typeof capabilityIdSchema>;
export type CapabilityKind = z.infer<typeof capabilityKindSchema>;
export type CapabilitySource = z.infer<typeof capabilitySourceSchema>;
export type CapabilityIssueCode = z.infer<typeof capabilityIssueCodeSchema>;
export type CapabilityManagedConfig = z.infer<typeof capabilityManagedConfigSchema>;
export type CapabilityIssue = z.infer<typeof capabilityIssueSchema>;
export type CapabilityStatusRow = z.infer<typeof capabilityStatusRowSchema>;
export type CapabilityLoggingStatus = z.infer<typeof capabilityLoggingStatusSchema>;
export type CapabilityStatus = z.infer<typeof capabilityStatusSchema>;
