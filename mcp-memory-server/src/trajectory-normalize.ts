import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

import {
    TRAJECTORY_SCHEMA_VERSION,
    trajectorySessionSchema,
    type TrajectoryEvent,
    type TrajectorySession,
    type TrajectoryUsage,
} from "./trajectory-schema.js";

type UnknownRecord = Record<string, unknown>;

type CaptureState = {
    events: TrajectoryEvent[];
    usage: TrajectoryUsage;
    timestamps: string[];
    omittedReasoning: number;
    omittedUnknown: number;
};

function object(value: unknown): UnknownRecord | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as UnknownRecord
        : undefined;
}

function array(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function number(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isoTimestamp(value: unknown): string | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
    if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
    return new Date(value).toISOString();
}

function addUsage(total: TrajectoryUsage, usage: TrajectoryUsage): void {
    for (const key of Object.keys(usage) as Array<keyof TrajectoryUsage>) {
        const value = usage[key];
        if (value === undefined) continue;
        total[key] = (total[key] ?? 0) + value;
    }
}

function compactUsage(value: TrajectoryUsage): TrajectoryUsage | undefined {
    return Object.values(value).some((item) => item !== undefined) ? value : undefined;
}

function usageFromClaude(value: unknown): TrajectoryUsage | undefined {
    const usage = object(value);
    if (!usage) return undefined;
    return compactUsage({
        input_tokens: number(usage.input_tokens),
        output_tokens: number(usage.output_tokens),
        cache_read_tokens: number(usage.cache_read_input_tokens),
        cache_write_tokens: number(usage.cache_creation_input_tokens),
    });
}

function usageFromOpenCode(value: unknown, cost?: unknown): TrajectoryUsage | undefined {
    const usage = object(value);
    if (!usage && number(cost) === undefined) return undefined;
    const cache = object(usage?.cache);
    return compactUsage({
        input_tokens: number(usage?.input),
        output_tokens: number(usage?.output),
        reasoning_tokens: number(usage?.reasoning),
        cache_read_tokens: number(cache?.read),
        cache_write_tokens: number(cache?.write),
        cost: number(cost),
    });
}

function createState(): CaptureState {
    return { events: [], usage: {}, timestamps: [], omittedReasoning: 0, omittedUnknown: 0 };
}

function pushEvent(
    state: CaptureState,
    kind: TrajectoryEvent["kind"],
    payload: Record<string, unknown>,
    timestamp?: string,
    nativeId?: string,
    parentId?: string,
): void {
    if (timestamp) state.timestamps.push(timestamp);
    state.events.push({
        sequence: state.events.length,
        kind,
        ...(timestamp ? { timestamp } : {}),
        ...(nativeId ? { native_id: nativeId } : {}),
        ...(parentId ? { parent_id: parentId } : {}),
        payload,
    });
}

function pushUsage(state: CaptureState, usage: TrajectoryUsage, timestamp?: string, nativeId?: string): void {
    addUsage(state.usage, usage);
    pushEvent(state, "usage", usage, timestamp, nativeId);
}

function finalize(
    state: CaptureState,
    sessionId: string,
    harness: TrajectorySession["harness"],
    projectRoot: string,
    explicitStart?: string,
    explicitEnd?: string,
): TrajectorySession {
    const sorted = [...state.timestamps].sort();
    const now = new Date().toISOString();
    const startedAt = explicitStart ?? sorted[0] ?? now;
    const endedAt = explicitEnd ?? sorted.at(-1) ?? startedAt;
    return trajectorySessionSchema.parse({
        schema_version: TRAJECTORY_SCHEMA_VERSION,
        session_id: sessionId,
        harness,
        project_root: resolve(projectRoot),
        started_at: startedAt,
        ended_at: endedAt,
        ...(compactUsage(state.usage) ? { usage: state.usage } : {}),
        events: state.events.map((event, sequence) => ({ ...event, sequence })),
        capture: {
            captured_at: now,
            omitted_reasoning_blocks: state.omittedReasoning,
            omitted_unknown_records: state.omittedUnknown,
            truncated: false,
        },
    });
}

export async function normalizeClaudeTranscript(transcriptPath: string, projectRoot: string): Promise<TrajectorySession> {
    const state = createState();
    let sessionId: string | undefined;
    let pendingUsage: { usage: TrajectoryUsage; timestamp?: string; nativeId?: string } | undefined;
    const lines = createInterface({ input: createReadStream(transcriptPath, { encoding: "utf8" }), crlfDelay: Infinity });

    const flushPendingUsage = () => {
        if (!pendingUsage) return;
        pushUsage(state, pendingUsage.usage, pendingUsage.timestamp, pendingUsage.nativeId);
        pendingUsage = undefined;
    };

    for await (const line of lines) {
        if (!line.trim()) continue;
        let row: UnknownRecord;
        try {
            row = object(JSON.parse(line)) ?? {};
        } catch {
            state.omittedUnknown += 1;
            continue;
        }
        sessionId ??= string(row.sessionId);
        const type = string(row.type);
        const timestamp = isoTimestamp(row.timestamp);
        const nativeId = string(row.uuid);
        const parentId = string(row.parentUuid);

        if (type === "system") {
            flushPendingUsage();
            pushEvent(state, "system_event", { event: string(row.subtype) ?? "system" }, timestamp, nativeId, parentId);
            continue;
        }
        if (type !== "user" && type !== "assistant") {
            state.omittedUnknown += 1;
            continue;
        }

        const message = object(row.message);
        const content = array(message?.content);
        const isAssistant = type === "assistant";
        let emittedToolInvocation = false;
        let emittedToolResult = false;

        const hasToolResult = !isAssistant && content.some((item) => string(object(item)?.type) === "tool_result");
        if (!isAssistant && !hasToolResult) flushPendingUsage();
        for (const item of content) {
            const part = object(item);
            const partType = string(part?.type);
            if (partType === "thinking" || partType === "reasoning") {
                state.omittedReasoning += 1;
                continue;
            }
            if (partType === "text") {
                const text = string(part?.text);
                if (text) pushEvent(state, isAssistant ? "model_output" : "user_message", { text }, timestamp, nativeId, parentId);
                continue;
            }
            if (partType === "tool_use" && isAssistant) {
                emittedToolInvocation = true;
                pushEvent(state, "tool_invocation", {
                    call_id: string(part?.id) ?? "",
                    tool_name: string(part?.name) ?? "unknown",
                    input: part?.input ?? null,
                }, timestamp, nativeId, parentId);
                continue;
            }
            if (partType === "tool_result") {
                emittedToolResult = true;
                pushEvent(state, "tool_result", {
                    call_id: string(part?.tool_use_id) ?? "",
                    output: part?.content ?? null,
                    is_error: part?.is_error === true,
                }, timestamp, nativeId, parentId);
                continue;
            }
            state.omittedUnknown += 1;
        }

        const usage = usageFromClaude(message?.usage);
        if (usage) {
            if (emittedToolInvocation && !emittedToolResult) pendingUsage = { usage, timestamp, nativeId };
            else pushUsage(state, usage, timestamp, nativeId);
        }
        if (emittedToolResult) flushPendingUsage();
    }
    flushPendingUsage();

    if (!sessionId) throw new Error("Claude transcript did not contain a session ID.");
    return finalize(state, sessionId, "claude-code", projectRoot);
}

export function normalizeOpenCodeSession(raw: unknown, projectRoot: string): TrajectorySession {
    const root = object(raw);
    const session = object(root?.session);
    const sessionId = string(session?.id);
    if (!sessionId) throw new Error("OpenCode session did not contain an ID.");
    const sessionTime = object(session?.time);
    const explicitStart = isoTimestamp(sessionTime?.created);
    const explicitEnd = isoTimestamp(sessionTime?.updated);
    const state = createState();

    pushEvent(state, "system_event", { event: "session_start" }, explicitStart);
    for (const rawMessage of array(root?.messages)) {
        const message = object(rawMessage);
        const info = object(message?.info);
        const role = string(info?.role);
        if (role !== "user" && role !== "assistant") {
            state.omittedUnknown += 1;
            continue;
        }
        const time = object(info?.time);
        const timestamp = isoTimestamp(time?.created);
        const nativeId = string(info?.id);
        let emittedStepUsage = false;

        for (const rawPart of array(message?.parts)) {
            const part = object(rawPart);
            const partType = string(part?.type);
            if (partType === "reasoning" || partType === "thinking") {
                state.omittedReasoning += 1;
                continue;
            }
            if (partType === "text") {
                const text = string(part?.text);
                if (text) pushEvent(state, role === "assistant" ? "model_output" : "user_message", { text }, timestamp, nativeId);
                continue;
            }
            if (partType === "tool" && role === "assistant") {
                const toolState = object(part?.state);
                const callId = string(part?.callID) ?? "";
                const toolTimestamp = isoTimestamp(object(toolState?.time)?.start) ?? timestamp;
                pushEvent(state, "tool_invocation", {
                    call_id: callId,
                    tool_name: string(part?.tool) ?? "unknown",
                    input: toolState?.input ?? null,
                }, toolTimestamp, string(part?.id), nativeId);
                if (toolState && ("output" in toolState || "error" in toolState)) {
                    pushEvent(state, "tool_result", {
                        call_id: callId,
                        output: toolState.output ?? toolState.error ?? null,
                        is_error: toolState.status === "error" || "error" in toolState,
                    }, isoTimestamp(object(toolState.time)?.end) ?? timestamp, string(part?.id), nativeId);
                }
                continue;
            }
            if (partType === "step-finish") {
                const usage = usageFromOpenCode(part?.tokens, part?.cost);
                if (usage) {
                    pushUsage(state, usage, timestamp, string(part?.id));
                    emittedStepUsage = true;
                }
                continue;
            }
            state.omittedUnknown += 1;
        }

        if (role === "assistant" && !emittedStepUsage) {
            const usage = usageFromOpenCode(info?.tokens, info?.cost);
            if (usage) pushUsage(state, usage, isoTimestamp(time?.completed) ?? timestamp, nativeId);
        }
    }
    return finalize(state, sessionId, "opencode", projectRoot, explicitStart, explicitEnd);
}

function truncateUtf8(value: string, maxBytes: number): string {
    const bytes = Buffer.from(value, "utf8");
    if (bytes.length <= maxBytes) return value;
    let result = bytes.subarray(0, Math.max(0, maxBytes)).toString("utf8");
    while (result.endsWith("\uFFFD")) result = result.slice(0, -1);
    return result;
}

function truncateValue(value: unknown, maxStringBytes: number): unknown {
    if (typeof value === "string") return truncateUtf8(value, maxStringBytes);
    if (Array.isArray(value)) return value.map((item) => truncateValue(item, maxStringBytes));
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, truncateValue(child, maxStringBytes)]));
    }
    return value;
}

export function fitTrajectoryToBytes<T extends TrajectorySession>(session: T, maxBytes: number): T {
    const originalBytes = Buffer.byteLength(JSON.stringify(session), "utf8");
    if (originalBytes <= maxBytes) return session;

    const result = structuredClone(session) as T;
    result.capture.truncated = true;
    result.capture.original_bytes = originalBytes;
    result.capture.omitted_size_events = 0;
    const maxStringBytes = Math.max(64, Math.min(1024, Math.floor(maxBytes / Math.max(8, result.events.length * 2))));
    result.events = result.events.map((event) => {
        const before = Buffer.byteLength(JSON.stringify(event.payload), "utf8");
        const payload = truncateValue(event.payload, maxStringBytes) as Record<string, unknown>;
        const after = Buffer.byteLength(JSON.stringify(payload), "utf8");
        return before === after ? event : { ...event, payload, truncation: { original_bytes: before, stored_bytes: after } };
    });

    while (result.events.length > 0 && Buffer.byteLength(JSON.stringify(result), "utf8") > maxBytes) {
        result.events.pop();
        result.capture.omitted_size_events = (result.capture.omitted_size_events ?? 0) + 1;
    }
    result.events = result.events.map((event, sequence) => ({ ...event, sequence }));
    let storedBytes = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        result.capture.stored_bytes = storedBytes;
        const next = Buffer.byteLength(JSON.stringify(result), "utf8");
        if (next === storedBytes) break;
        storedBytes = next;
    }
    result.capture.stored_bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > maxBytes) {
        throw new Error(`Trajectory metadata exceeds the ${maxBytes}-byte session limit.`);
    }
    return trajectorySessionSchema.parse(result) as T;
}
