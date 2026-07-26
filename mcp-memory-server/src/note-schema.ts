import { z } from "zod";

export const NOTE_SCHEMA_VERSION = 1 as const;

export const failureFrameSchema = z.object({
    function: z.string().min(1).max(512),
    file: z.string().min(1).max(1024),
}).strict();

export const failureLookupKeysSchema = z.object({
    full: z.string().regex(/^v1:full:[a-f0-9]{64}$/),
    message_stack: z.string().regex(/^v1:message-stack:[a-f0-9]{64}$/),
    message_component: z.string().regex(/^v1:message-component:[a-f0-9]{64}$/),
    message: z.string().regex(/^v1:message:[a-f0-9]{64}$/),
}).strict();

export const failureSignatureSchema = z.object({
    signature_version: z.literal(NOTE_SCHEMA_VERSION),
    family: z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/),
    normalized_message: z.string().min(1).max(4096),
    stack_digest: z.union([z.literal(""), z.string().regex(/^[a-f0-9]{64}$/)]),
    component: z.string().max(1024),
    frames: z.array(failureFrameSchema).max(16),
    lookup_keys: failureLookupKeysSchema,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const noteOccurrenceSchema = z.object({
    session_id: z.string().min(1).max(256),
    session_digest: z.string().regex(/^[a-f0-9]{64}$/),
    ended_at: z.iso.datetime(),
    sequence: z.number().int().nonnegative(),
    outcome: z.enum(["failure", "resolution", "abandonment"]),
    tool_name: z.string().min(1).max(256).optional(),
    validation_key: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    evidence: z.string().min(1).max(4096),
}).strict();

export const noteNodeSchema = z.object({
    schema_version: z.literal(NOTE_SCHEMA_VERSION),
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,255}$/),
    title: z.string().min(1).max(512),
    description: z.string().min(1).max(4096),
    keywords: z.array(z.string().min(1).max(128)).max(64),
    node_type: z.enum(["hindsight", "knowledge", "shared", "provenance"]),
    tags: z.array(z.string().min(1).max(128)).max(64),
    project_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,255}$/).optional(),
    canonical_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,255}$/).optional(),
    status: z.enum(["unresolved", "resolved", "abandoned"]).optional(),
    signature: failureSignatureSchema.optional(),
    occurrences: z.array(noteOccurrenceSchema).max(1024),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
}).strict().superRefine((note, context) => {
    if (new Set(note.keywords).size !== note.keywords.length) {
        context.addIssue({ code: "custom", path: ["keywords"], message: "Keywords must be unique." });
    }
    if (new Set(note.tags).size !== note.tags.length) {
        context.addIssue({ code: "custom", path: ["tags"], message: "Tags must be unique." });
    }
    if (["hindsight", "provenance"].includes(note.node_type) && (!note.project_id || !note.signature || !note.status)) {
        context.addIssue({ code: "custom", message: "Project hindsight and provenance notes require project_id, signature, and status." });
    }
    if (note.node_type === "provenance" && !note.canonical_id) {
        context.addIssue({ code: "custom", message: "Provenance notes require canonical_id." });
    }
    if (note.node_type === "shared" && (!note.signature || !note.status)) {
        context.addIssue({ code: "custom", message: "Shared hindsight notes require signature and status." });
    }
});

export type FailureFrame = z.infer<typeof failureFrameSchema>;
export type FailureSignature = z.infer<typeof failureSignatureSchema>;
export type NoteOccurrence = z.infer<typeof noteOccurrenceSchema>;
export type NoteNode = z.infer<typeof noteNodeSchema>;

export function isNoteDistillationEnabled(value = process.env.CAIRN_NOTE_DISTILLATION): boolean {
    return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? "");
}
