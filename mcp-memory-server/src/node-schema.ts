import { z } from "zod";

export const NODE_SCHEMA_VERSION = 1 as const;
export const MAX_IMPORT_NODES = 256;
export const MAX_NODE_VALUE_BYTES = 256 * 1024;
export const MAX_IMPORT_VALUE_BYTES = 5 * 1024 * 1024;

const truthyPattern = /^(?:1|true|yes|on)$/i;

export const coreNodeTypeSchema = z.enum(["memory", "knowledge", "hindsight", "shared", "provenance"]);
export const noteNodeTypeSchema = z.enum(["hindsight", "knowledge", "shared", "provenance"]);
const extensionNodeTypeSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}:[a-z0-9][a-z0-9-]{0,63}$/);
export const nodeTypeSchema = z.union([coreNodeTypeSchema, extensionNodeTypeSchema]);

function normalizeTag(value: string): string {
    return value.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-");
}

export const canonicalTagSchema = z.string().transform(normalizeTag).pipe(
    z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/),
);

export const canonicalTagsSchema = z.array(canonicalTagSchema).max(64).transform((values) =>
    [...new Set(values)].sort(),
);

export const nodePathSchema = z.string().min(1).max(1024).superRefine((value, context) => {
    if (value.startsWith("/") || value.endsWith("/") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) {
        context.addIssue({ code: "custom", message: "Node path must be a relative slash-separated path." });
        return;
    }
    const segments = value.split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
        context.addIssue({ code: "custom", message: "Node path contains an invalid segment." });
    }
    if (segments[0]?.startsWith("__") || segments[0]?.startsWith(".cairnkeep")) {
        context.addIssue({ code: "custom", message: "Node path uses a reserved namespace." });
    }
});

export const nodeMetadataSchema = z.object({
    schema_version: z.literal(NODE_SCHEMA_VERSION),
    node_type: nodeTypeSchema,
    tags: canonicalTagsSchema,
}).strict();

export const nodeSummarySchema = z.object({
    schema_version: z.literal(NODE_SCHEMA_VERSION),
    address_space: z.enum(["memory", "project-notes", "shared-notes"]),
    scope: z.string(),
    key: nodePathSchema,
    node_type: nodeTypeSchema,
    tags: canonicalTagsSchema,
}).strict();

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
    signature_version: z.literal(NODE_SCHEMA_VERSION),
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

export const noteEnrichmentContentSchema = z.object({
    summary: z.string().min(1).max(4096),
    lessons: z.array(z.string().min(1).max(1024)).max(16),
    caveats: z.array(z.string().min(1).max(1024)).max(16),
}).strict();

export const noteNodeSchema = z.object({
    schema_version: z.literal(NODE_SCHEMA_VERSION),
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,255}$/),
    title: z.string().min(1).max(512),
    description: z.string().min(1).max(4096),
    keywords: z.array(z.string().min(1).max(128)).max(64),
    node_type: noteNodeTypeSchema,
    tags: canonicalTagsSchema,
    project_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,255}$/).optional(),
    canonical_id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,255}$/).optional(),
    status: z.enum(["unresolved", "resolved", "abandoned"]).optional(),
    signature: failureSignatureSchema.optional(),
    enrichment: noteEnrichmentContentSchema.optional(),
    occurrences: z.array(noteOccurrenceSchema).max(1024),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
}).strict().superRefine((note, context) => {
    if (new Set(note.keywords).size !== note.keywords.length) {
        context.addIssue({ code: "custom", path: ["keywords"], message: "Keywords must be unique." });
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

export const memoryImportNodeSchema = z.object({
    key: nodePathSchema,
    value: z.string().refine((value) => Buffer.byteLength(value, "utf8") <= MAX_NODE_VALUE_BYTES, "Node value exceeds 256 KiB."),
    node_type: nodeTypeSchema,
    tags: canonicalTagsSchema,
    note: noteNodeSchema.optional(),
}).strict();

export const memoryImportEnvelopeSchema = z.object({
    schema_version: z.literal(NODE_SCHEMA_VERSION),
    scope: z.string().min(1).refine((value) => value !== "all", 'Import scope must be concrete; "all" is read-only.'),
    address_space: z.enum(["memory", "project-notes", "shared-notes"]).default("memory"),
    import_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/).optional(),
    conflict_policy: z.enum(["reject", "supersede"]).default("reject"),
    dry_run: z.boolean().default(false),
    nodes: z.array(memoryImportNodeSchema).min(1).max(MAX_IMPORT_NODES),
}).strict().superRefine((envelope, context) => {
    const keys = new Set<string>();
    let totalBytes = 0;
    envelope.nodes.forEach((node, index) => {
        totalBytes += Buffer.byteLength(node.value, "utf8");
        if (keys.has(node.key)) context.addIssue({ code: "custom", path: ["nodes", index, "key"], message: "Import keys must be unique." });
        keys.add(node.key);
        if (envelope.address_space !== "memory") {
            const noteRequired = ["hindsight", "shared", "provenance"].includes(node.node_type);
            if (noteRequired && !node.note) context.addIssue({ code: "custom", path: ["nodes", index, "note"], message: "This note type requires a complete note record." });
            if (node.note && (node.note.node_type !== node.node_type || JSON.stringify(node.note.tags) !== JSON.stringify(node.tags))) {
                context.addIssue({ code: "custom", path: ["nodes", index], message: "Import envelope type/tags must agree with note front matter." });
            }
        }
    });
    if (totalBytes > MAX_IMPORT_VALUE_BYTES) context.addIssue({ code: "custom", path: ["nodes"], message: "Aggregate node values exceed 5 MiB." });
});

export const memoryImportActionSchema = z.object({
    key: nodePathSchema,
    action: z.enum(["would_create", "would_replace", "created", "replaced", "unchanged", "rejected"]),
    code: z.string().optional(),
}).strict();

export const memoryImportCountsSchema = z.object({
    created: z.number().int().nonnegative().optional(),
    replaced: z.number().int().nonnegative().optional(),
    would_create: z.number().int().nonnegative().optional(),
    would_replace: z.number().int().nonnegative().optional(),
    unchanged: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
}).strict();

export const memoryImportResultSchema = z.object({
    schema_version: z.literal(NODE_SCHEMA_VERSION),
    scope: z.string(),
    address_space: z.enum(["memory", "project-notes", "shared-notes"]),
    batch_digest: z.string().regex(/^[a-f0-9]{64}$/),
    import_id: z.string().optional(),
    dry_run: z.boolean(),
    conflict_policy: z.enum(["reject", "supersede"]),
    committed: z.boolean(),
    replayed: z.boolean().optional(),
    counts: memoryImportCountsSchema,
    actions: z.array(memoryImportActionSchema).max(MAX_IMPORT_NODES),
}).strict();

export type NodeType = z.infer<typeof nodeTypeSchema>;
export type NoteNodeType = z.infer<typeof noteNodeTypeSchema>;
export type NodeMetadata = z.infer<typeof nodeMetadataSchema>;
export type NodeSummary = z.infer<typeof nodeSummarySchema>;
export type FailureFrame = z.infer<typeof failureFrameSchema>;
export type FailureSignature = z.infer<typeof failureSignatureSchema>;
export type NoteOccurrence = z.infer<typeof noteOccurrenceSchema>;
export type NoteEnrichmentContent = z.infer<typeof noteEnrichmentContentSchema>;
export type NoteNode = z.infer<typeof noteNodeSchema>;
export type MemoryImportNode = z.infer<typeof memoryImportNodeSchema>;
export type MemoryImportEnvelope = z.infer<typeof memoryImportEnvelopeSchema>;
export type MemoryImportAction = z.infer<typeof memoryImportActionSchema>;
export type MemoryImportResult = z.infer<typeof memoryImportResultSchema>;

export function isTypedMemoryNodesEnabled(value = process.env.CAIRN_TYPED_MEMORY_NODES): boolean {
    return truthyPattern.test(value?.trim() ?? "");
}
