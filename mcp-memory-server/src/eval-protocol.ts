import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalJson } from "./eval-schema.js";
import { MCP_TOOL_CATALOG } from "./mcp-tool-catalog.js";
import { trajectorySessionSchema, type TrajectoryEvent, type TrajectorySession } from "./trajectory-schema.js";
import { normalizeCodexExec } from "./eval-codex.js";

// Native audit input does not extend the persisted trajectory/capture contract.
export type ProtocolSession = Omit<TrajectorySession, "harness"> & { harness: TrajectorySession["harness"] | "codex" };

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_EVENTS = 50_000;
const memoryEntries = Object.entries(MCP_TOOL_CATALOG).filter(([name]) => name.startsWith("memory_"));
const MUTATIONS = new Set(memoryEntries.filter(([, metadata]) => !metadata.annotations.readOnlyHint).map(([name]) => name));
const OBSERVATIONS = new Set(memoryEntries.filter(([, metadata]) => metadata.annotations.readOnlyHint).map(([name]) => name));
type Status = "pass" | "fail" | "inconclusive";
type Check = { id: string; status: Status; code: string };
type Call = { event: TrajectoryEvent; tool?: string; result?: TrajectoryEvent };

function digest(bytes: string | Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function object(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown> : undefined;
}

/** Only the maintained direct-tool names are recognized; suffix matching is unsafe. */
function memoryTool(name: unknown, harness: ProtocolSession["harness"]): string | undefined {
    if (typeof name !== "string") return undefined;
    const prefixes = harness === "claude-code" || harness === "codex" ? ["mcp__cairn-memory__", "mcp__cairn_memory__"]
        : harness === "opencode" ? ["cairn-memory_", "cairn_memory_"] : [""];
    for (const prefix of prefixes) {
        if (!name.startsWith(prefix)) continue;
        const tool = name.slice(prefix.length);
        if (MUTATIONS.has(tool) || OBSERVATIONS.has(tool)) return tool;
    }
    return undefined;
}

/** Inspect an explicitly supplied export without following links or executing content. */
function readProtocolBytes(path: string): Buffer {
    let descriptor: number | undefined;
    try {
        const absolute = resolve(path);
        // Validate the opened descriptor, not a pathname checked before open.
        // Nonblocking/no-ctty flags prevent special-file admission from waiting
        // or acquiring a controlling terminal before the regular-file check.
        descriptor = openSync(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
            | (constants.O_NOCTTY ?? 0) | (process.platform === "win32" ? 0 : constants.O_NONBLOCK ?? 0));
        const before = fstatSync(descriptor);
        if (!before.isFile() || before.size > MAX_BYTES || realpathSync(absolute) !== absolute) throw new Error();
        const buffer = Buffer.alloc(before.size + 1);
        let length = 0;
        while (length < buffer.length) {
            const count = readSync(descriptor, buffer, length, buffer.length - length, null);
            if (!count) break;
            length += count;
        }
        const after = fstatSync(descriptor);
        const finalPath = realpathSync(absolute);
        const finalNamed = lstatSync(absolute);
        if (length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs
            || before.ctimeMs !== after.ctimeMs || finalNamed.isSymbolicLink()
            || finalNamed.dev !== before.dev || finalNamed.ino !== before.ino
            || finalNamed.size !== before.size || finalNamed.mtimeMs !== before.mtimeMs
            || finalNamed.ctimeMs !== before.ctimeMs
            || finalPath !== absolute) throw new Error();
        const bytes = buffer.subarray(0, length);
        return bytes;
    } catch {
        // Do not expose filesystem errors, parser excerpts, schema paths or input data.
        throw new Error("protocol_input_invalid_or_unsafe");
    } finally {
        if (descriptor !== undefined) closeSync(descriptor);
    }
}

export function readProtocolTrajectory(path: string): { session: TrajectorySession; digest: string } {
    try {
        const bytes = readProtocolBytes(path);
        const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        if (!Array.isArray(raw?.events) || raw.events.length > MAX_EVENTS) throw new Error();
        const parsed = trajectorySessionSchema.safeParse(raw);
        if (!parsed.success) throw new Error();
        return { session: parsed.data, digest: digest(bytes) };
    } catch { throw new Error("protocol_input_invalid_or_unsafe"); }
}

export function readCodexProtocol(path: string): { session: ProtocolSession; digest: string } {
    try {
        const bytes = readProtocolBytes(path);
        const session = normalizeCodexExec(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        return { session, digest: digest(bytes) };
    } catch { throw new Error("protocol_input_invalid_or_unsafe"); }
}

function searchPayload(value: unknown, depth = 0): Record<string, unknown> | undefined {
    if (depth > 8) return undefined;
    if (typeof value === "string") {
        try { return searchPayload(JSON.parse(value), depth + 1); } catch { return undefined; }
    }
    // Claude tool-result content and MCP result envelopes are both supported.
    if (Array.isArray(value)) {
        if (value.length !== 1) return undefined;
        const part = object(value[0]);
        return part?.type === "text" && typeof part.text === "string" ? searchPayload(part.text, depth + 1) : undefined;
    }
    const record = object(value);
    if (!record || record.isError === true || record.ok === false) return undefined;
    if (record.structuredContent !== undefined) return searchPayload(record.structuredContent, depth + 1);
    if (record.content !== undefined) return searchPayload(record.content, depth + 1);
    return record;
}

function successfulSearch(result: TrajectoryEvent | undefined): boolean {
    if (!result || result.payload.is_error !== false || result.truncation) return false;
    const payload = searchPayload(result.payload.output);
    return !!payload && typeof payload.mode === "string" && ["semantic", "substring"].includes(payload.mode)
        && Number.isSafeInteger(payload.count) && (payload.count as number) >= 0
        && Array.isArray(payload.results) && payload.results.length === payload.count;
}

/** This is an observation of local evidence, not authentication or task verification. */
export function auditMemoryProtocol(session: ProtocolSession, trajectoryDigest: string, captureAuthorized = false) {
    const calls: Call[] = [];
    const byId = new Map<string, Call>();
    let gap = session.capture.truncated || session.capture.omitted_unknown_records > 0
        || (session.capture.omitted_size_events ?? 0) > 0;
    for (const [index, event] of session.events.entries()) {
        if (event.sequence !== index) throw new Error("protocol_invalid_events");
        if (event.truncation) gap = true;
        if (event.kind !== "tool_invocation" && event.kind !== "tool_result") continue;
        const id = event.payload.call_id;
        if (typeof id !== "string" || !id || id.length > 1024) throw new Error("protocol_invalid_events");
        if (event.kind === "tool_invocation") {
            if (byId.has(id) || typeof event.payload.tool_name !== "string") throw new Error("protocol_invalid_events");
            const call = { event, tool: memoryTool(event.payload.tool_name, session.harness) };
            calls.push(call); byId.set(id, call);
        } else {
            const call = byId.get(id);
            if (!call || call.result) throw new Error("protocol_invalid_events");
            call.result = event;
        }
    }
    if (calls.some(call => !call.result)) gap = true;
    const projectSearches = calls.filter(call => call.tool === "memory_search"
        && object(call.event.payload.input)?.scope === "project" && !call.event.truncation);
    const first = calls[0];
    const writes = calls.filter(call => call.tool && MUTATIONS.has(call.tool));
    const opaque = calls.filter(call => !call.tool);
    const checks: Check[] = [
        { id: "evidence_complete", status: gap ? "inconclusive" : "pass", code: gap ? "capture_incomplete" : "capture_complete" },
        { id: "memory_first", status: gap ? "inconclusive" : first && projectSearches[0] === first ? "pass" : "fail",
            code: gap ? "ordering_unverifiable" : first && projectSearches[0] === first ? "project_search_first" : "project_search_not_first" },
        { id: "retrieval_result", status: projectSearches.some(call => successfulSearch(call.result)) ? "pass" : projectSearches.length || gap ? "inconclusive" : "fail",
            code: projectSearches.some(call => successfulSearch(call.result)) ? "project_search_completed"
                : projectSearches.length || gap ? "search_result_unverifiable" : "project_search_absent" },
        { id: "direct_write_boundary", status: writes.length && !captureAuthorized ? "fail" : gap || opaque.length ? "inconclusive" : "pass",
            code: writes.length && !captureAuthorized ? "unapproved_write_attempt"
                : gap || opaque.length ? "indirect_writes_unverifiable" : writes.length ? "caller_asserted_capture_authorization" : "no_direct_write_attempt" },
    ];
    const policy = { schema_version: 1, protocol: "project-memory-first-v1", capture_authorized: captureAuthorized,
        scope: "direct-memory-tools", direct_mutation_tools: [...MUTATIONS].sort(), direct_observation_tools: [...OBSERVATIONS].sort() };
    const status: Status = checks.some(check => check.status === "fail") ? "fail"
        : checks.some(check => check.status === "inconclusive") ? "inconclusive" : "pass";
    return {
        schema_version: 1, enabled: true, operation: "protocol", evidence_scope: "local-trajectory-observation",
        harness: session.harness, trajectory_digest: trajectoryDigest, policy_digest: digest(canonicalJson(policy)),
        policy, status, checks,
        counts: { tool_invocations: calls.length, project_searches: projectSearches.length,
            successful_project_searches: projectSearches.filter(call => successfulSearch(call.result)).length,
            direct_write_attempts: writes.length, opaque_tool_invocations: opaque.length },
        limitations: ["input_not_authenticated", "task_quality_not_measured", "authorization_is_caller_assertion",
            "indirect_tool_effects_not_certified", "task_boundaries_not_inferred", "tool_availability_not_inferred"],
    };
}
