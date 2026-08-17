import { z } from "zod";

export const PLAYBOOK_SCHEMA_VERSION = 1 as const;

export const PLAYBOOK_PROFILES = ["minimal", "balanced", "strict"] as const;
export const PLAYBOOK_MODES = ["must", "should", "may", "off"] as const;
export const PLAYBOOK_EVENTS = ["start", "check", "finish"] as const;
export const PLAYBOOK_COMPLEXITIES = ["trivial", "standard", "complex"] as const;
export const PLAYBOOK_FAMILIARITIES = ["known", "mixed", "unfamiliar"] as const;
export const PLAYBOOK_RISKS = ["low", "normal", "high", "security"] as const;
export const PLAYBOOK_CHANGE_TYPES = ["code", "tests", "docs", "config", "dependencies", "security"] as const;
export const PLAYBOOK_OUTCOMES = ["completed", "skipped", "failed"] as const;
export const PLAYBOOK_ACTOR_KINDS = ["user", "agent", "service"] as const;

export const PLAYBOOK_ACTION_IDS = [
    "context.recall",
    "context.explore",
    "work.plan",
    "verify.tests",
    "review.repository",
    "review.security",
    "docs.update",
    "learning.capture",
] as const;

export const playbookProfileSchema = z.enum(PLAYBOOK_PROFILES);
export const playbookModeSchema = z.enum(PLAYBOOK_MODES);
export const playbookEventSchema = z.enum(PLAYBOOK_EVENTS);
export const playbookComplexitySchema = z.enum(PLAYBOOK_COMPLEXITIES);
export const playbookFamiliaritySchema = z.enum(PLAYBOOK_FAMILIARITIES);
export const playbookRiskSchema = z.enum(PLAYBOOK_RISKS);
export const playbookChangeTypeSchema = z.enum(PLAYBOOK_CHANGE_TYPES);
export const playbookOutcomeSchema = z.enum(PLAYBOOK_OUTCOMES);
export const playbookActorKindSchema = z.enum(PLAYBOOK_ACTOR_KINDS);
export const playbookActionIdSchema = z.enum(PLAYBOOK_ACTION_IDS);

export const playbookOverridesSchema = z.partialRecord(
    playbookActionIdSchema.or(z.never()),
    playbookModeSchema,
);

export const playbookConfigSchema = z.strictObject({
    schema_version: z.literal(PLAYBOOK_SCHEMA_VERSION),
    profile: playbookProfileSchema,
    overrides: playbookOverridesSchema,
});

export const playbookActorSchema = z.strictObject({
    id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/),
    kind: playbookActorKindSchema,
    authenticated: z.literal(false),
});

export const playbookReasonSchema = z.string().max(512).refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    "Playbook reasons must not contain control characters.",
);

export const playbookEvidenceSchema = z.strictObject({
    action: playbookActionIdSchema,
    outcome: playbookOutcomeSchema,
    reason: playbookReasonSchema,
});

export const playbookSignalsSchema = z.strictObject({
    complexity: playbookComplexitySchema,
    familiarity: playbookFamiliaritySchema,
    risk: playbookRiskSchema,
    public_change: z.boolean(),
    changed_paths: z.array(z.string().min(1).max(512)).max(256),
    change_types: z.array(playbookChangeTypeSchema).max(PLAYBOOK_CHANGE_TYPES.length),
});

export type PlaybookProfile = z.infer<typeof playbookProfileSchema>;
export type PlaybookMode = z.infer<typeof playbookModeSchema>;
export type PlaybookEvent = z.infer<typeof playbookEventSchema>;
export type PlaybookComplexity = z.infer<typeof playbookComplexitySchema>;
export type PlaybookFamiliarity = z.infer<typeof playbookFamiliaritySchema>;
export type PlaybookRisk = z.infer<typeof playbookRiskSchema>;
export type PlaybookChangeType = z.infer<typeof playbookChangeTypeSchema>;
export type PlaybookOutcome = z.infer<typeof playbookOutcomeSchema>;
export type PlaybookActorKind = z.infer<typeof playbookActorKindSchema>;
export type PlaybookActionId = z.infer<typeof playbookActionIdSchema>;
export type PlaybookConfig = z.infer<typeof playbookConfigSchema>;
export type PlaybookActor = z.infer<typeof playbookActorSchema>;
export type PlaybookEvidence = z.infer<typeof playbookEvidenceSchema>;
export type PlaybookSignals = z.infer<typeof playbookSignalsSchema>;
