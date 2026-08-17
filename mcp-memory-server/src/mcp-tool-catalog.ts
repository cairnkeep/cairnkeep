import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export type CairnToolMetadata = {
    title: string;
    annotations: Required<Pick<ToolAnnotations,
        "readOnlyHint" | "destructiveHint" | "idempotentHint" | "openWorldHint">>;
};

const observation = (title: string, openWorldHint = false): CairnToolMetadata => ({
    title,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint },
});
const additive = (title: string, openWorldHint = false): CairnToolMetadata => ({
    title,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint },
});
const mutation = (title: string, openWorldHint = false): CairnToolMetadata => ({
    title,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint },
});

// This is the authoritative MCP catalog. Adding a registered tool without an
// entry is a startup error, so clients can safely classify every Cairnkeep tool.
export const MCP_TOOL_CATALOG = {
    artifact_write: additive("Write artifact"),
    artifact_read: observation("Read artifact"),
    artifact_list: observation("List artifacts"),
    artifact_delete: mutation("Delete artifact"),
    memory_read: observation("Read memory"),
    memory_write: mutation("Write memory"),
    memory_list: observation("List memory"),
    memory_delete: mutation("Delete memory"),
    memory_search: observation("Search memory"),
    memory_extract: observation("Extract memory candidates", true),
    memory_supersede: mutation("Supersede memory"),
    memory_apply_reviewed: mutation("Apply reviewed memory"),
    memory_invalidate_reviewed: mutation("Invalidate reviewed memory"),
    memory_history: observation("Read memory history"),
    memory_import: mutation("Import memory"),
    domain_knowledge_query: observation("Query domain knowledge", true),
    domain_knowledge_sync: mutation("Synchronize domain knowledge", true),
    context_explore: observation("Explore repository context", true),
    route_check: observation("Check route", true),
    context_pack_list: observation("List context packs"),
    context_pack_search: observation("Search context packs"),
    context_pack_read: observation("Read context pack file"),
    context_pack_related: observation("Traverse context pack links"),
    work_evidence_list: observation("List work evidence"),
    work_evidence_read: observation("Read work evidence"),
} as const satisfies Record<string, CairnToolMetadata>;

export type CairnToolName = keyof typeof MCP_TOOL_CATALOG;
export const MCP_TOOL_NAMES = Object.freeze(Object.keys(MCP_TOOL_CATALOG) as CairnToolName[]);

export function isCairnToolName(value: string): value is CairnToolName {
    return Object.hasOwn(MCP_TOOL_CATALOG, value);
}

export function metadataForTool(name: string): CairnToolMetadata {
    if (!isCairnToolName(name)) throw new Error(`MCP tool ${name} has no annotation contract.`);
    return MCP_TOOL_CATALOG[name];
}
