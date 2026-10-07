import { canonicalJson } from "./eval-schema.js";
import type { ProtocolSession } from "./eval-protocol.js";
import type { TrajectoryEvent } from "./trajectory-schema.js";

function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function invalid(): never { throw new Error("protocol_input_invalid_or_unsafe"); }
type ItemState = { type: string; identity: string; complete: boolean };

/** Explicit single-turn exec JSONL export; never an internal rollout reader. */
export function normalizeCodexExec(text: string): ProtocolSession {
    try {
        if (Buffer.byteLength(text, "utf8") > 16 * 1024 * 1024) invalid();
        const lines = text.split("\n");
        if (lines.at(-1) === "" || lines.at(-1) === "\r") lines.pop();
        if (!lines.length || lines.length > 50_000) invalid();
        const events: TrajectoryEvent[] = [];
        const items = new Map<string, ItemState>();
        let thread = false, turn = false, ended = false, gaps = 0, reasoning = 0;
        const emit = (kind: TrajectoryEvent["kind"], payload: Record<string, unknown>) => {
            events.push({ sequence: events.length, kind, payload });
        };
        const extra = (value: Record<string, unknown>, fields: string[]) => {
            if (Object.keys(value).some(key => !fields.includes(key))) gaps++;
        };
        for (const line of lines) {
            const event = record(JSON.parse(line));
            if (!event || typeof event.type !== "string") invalid();
            if (event.type === "thread.started") {
                if (thread || turn || ended || typeof event.thread_id !== "string" || !event.thread_id) invalid();
                thread = true; extra(event, ["type", "thread_id"]); continue;
            }
            if (event.type === "turn.started") {
                if (turn || ended) invalid();
                if (!thread) gaps++;
                turn = true; extra(event, ["type"]); continue;
            }
            if (event.type === "turn.completed" || event.type === "turn.failed") {
                if (ended) invalid();
                if (!turn || event.type === "turn.failed") gaps++;
                ended = true; extra(event, ["type", "usage", "error"]); continue;
            }
            if (event.type === "error") { gaps++; continue; }
            if (!["item.started", "item.updated", "item.completed"].includes(event.type)) { gaps++; continue; }
            if (ended) invalid();
            if (!turn) gaps++;
            extra(event, ["type", "item"]);
            const item = record(event.item);
            if (!item || typeof item.id !== "string" || !item.id || item.id.length > 1024 || typeof item.type !== "string") invalid();
            const id = item.id;
            const complete = event.type === "item.completed";
            const previous = items.get(id);
            if (previous && (previous.complete || previous.type !== item.type || event.type === "item.started")) invalid();
            const tool = ["mcp_tool_call", "command_execution", "file_change", "web_search"].includes(item.type);
            let identity = item.type;
            let name = item.type;
            let input: unknown = {};
            let output: unknown = null;
            if (item.type === "mcp_tool_call") {
                extra(item, ["id", "type", "server", "tool", "arguments", "result", "error", "status"]);
                if (typeof item.server !== "string" || !item.server || typeof item.tool !== "string" || !item.tool
                    || !record(item.arguments)) invalid();
                name = `mcp__${item.server}__${item.tool}`;
                input = item.arguments;
                identity = canonicalJson({ server: item.server, tool: item.tool, arguments: input });
                const result = record(item.result);
                if (result) {
                    extra(result, ["content", "structured_content", "_meta"]);
                    output = result.structured_content === undefined || result.structured_content === null
                        ? { content: result.content } : { structuredContent: result.structured_content };
                }
                // Native CLI snapshots serialize absent result/error as null.
                if (!complete && (item.result != null || item.error != null)) invalid();
            } else if (item.type === "command_execution") {
                extra(item, ["id", "type", "command", "aggregated_output", "exit_code", "status"]);
                if (typeof item.command !== "string") invalid();
                identity = canonicalJson({ command: item.command });
            } else if (item.type === "file_change") {
                extra(item, ["id", "type", "changes", "status"]);
                if (!Array.isArray(item.changes)) invalid();
            } else if (item.type === "web_search") {
                extra(item, ["id", "type", "query"]);
                if (typeof item.query !== "string") invalid();
            } else if (item.type === "agent_message" || item.type === "reasoning") {
                extra(item, ["id", "type", "text"]);
                if (typeof item.text !== "string") invalid();
                if (item.type === "reasoning" && !previous) reasoning++;
            } else if (item.type === "todo_list") {
                extra(item, ["id", "type", "items"]);
                if (!Array.isArray(item.items)) invalid();
            } else { gaps++; }
            if (previous && previous.identity !== identity) invalid();
            if (tool) {
                if (!previous) {
                    // MCP/command starts carry dispatch order. A terminal-only
                    // record cannot establish it, but must still expose writes.
                    if (["mcp_tool_call", "command_execution"].includes(item.type) && event.type !== "item.started") gaps++;
                    emit("tool_invocation", { call_id: id, tool_name: name, input });
                }
                if (["mcp_tool_call", "command_execution", "file_change"].includes(item.type)) {
                    if (complete ? !["completed", "failed"].includes(String(item.status)) : item.status !== "in_progress") invalid();
                }
                if (complete) emit("tool_result", { call_id: id, output, is_error: item.status === "failed" || item.error != null });
            }
            items.set(id, { type: item.type, identity, complete });
        }
        if (!thread || !turn || !ended || [...items.values()].some(item => !item.complete)) gaps++;
        if (events.length > 50_000) invalid();
        // Timestamps/project identity are not supplied by exec JSONL. These
        // placeholders are private adapter scaffolding, never output claims.
        const time = "1970-01-01T00:00:00.000Z";
        return { schema_version: 1, session_id: "codex-exec-export", harness: "codex", project_root: "not-supplied",
            started_at: time, ended_at: time, events,
            capture: { captured_at: time, omitted_reasoning_blocks: reasoning, omitted_unknown_records: gaps, truncated: false } };
    } catch { return invalid(); }
}
