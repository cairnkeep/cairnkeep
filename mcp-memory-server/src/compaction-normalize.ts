import { redactLocalValue } from "./trajectory-redaction.js";

export const SUPPORTED_COMPACTION_ADAPTERS = [
    { harness: "claude-code", version: "2.1.219", event: "PostCompact" },
    { harness: "claude-code", version: "2.1.220", event: "PostCompact" },
    { harness: "opencode", version: "1.17.20", event: "session.compacted" },
] as const;

export type CompactionProjection = {
    task_goals: string[];
    decisions_made: string[];
    open_todos: string[];
    critical_error_traces: string[];
    completeness: {
        task_goals: "complete" | "partial" | "missing";
        decisions_made: "complete" | "partial" | "missing";
        open_todos: "complete" | "partial" | "missing";
        critical_error_traces: "complete" | "partial" | "missing";
    };
};

type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function string(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function cleanLine(value: string): string {
    return value.trim().replace(/^[-*+]\s+/, "").trim();
}

function stripLabel(value: string, label: "Decision" | "TODO" | "Error"): string | undefined {
    const cleaned = cleanLine(value);
    const match = new RegExp(`^${label}:\\s*(.+)$`, "i").exec(cleaned);
    return match?.[1]?.trim() || undefined;
}

export function projectCompactionSummary(
    summary: string,
    options: { template: "claude-code-2.1.219" | "claude-code-2.1.220" | "opencode-1.17.20" },
): CompactionProjection {
    const result: CompactionProjection = {
        task_goals: [],
        decisions_made: [],
        open_todos: [],
        critical_error_traces: [],
        completeness: {
            task_goals: "missing",
            decisions_made: "missing",
            open_todos: "missing",
            critical_error_traces: "missing",
        },
    };
    const claudeTemplate = options.template.startsWith("claude-code-");
    const headings: Map<string, keyof Omit<CompactionProjection, "completeness">> = claudeTemplate
        ? new Map([
            ["task goals", "task_goals"],
            ["decisions made", "decisions_made"],
            ["open todos", "open_todos"],
            ["critical error traces", "critical_error_traces"],
        ] as const)
        : new Map([
            ["objective", "task_goals"],
            ["next move", "open_todos"],
        ] as const);
    let section: keyof Omit<CompactionProjection, "completeness"> | undefined;
    const seen = new Set<keyof Omit<CompactionProjection, "completeness">>();
    for (const rawLine of summary.split(/\r?\n/)) {
        const heading = /^#{1,6}\s+(.+?)\s*$/.exec(rawLine)?.[1]?.toLowerCase();
        if (heading) {
            section = headings.get(heading);
            if (section) seen.add(section);
            continue;
        }
        const cleaned = cleanLine(rawLine);
        if (!cleaned) continue;
        const decision = stripLabel(cleaned, "Decision");
        const todo = stripLabel(cleaned, "TODO");
        const error = stripLabel(cleaned, "Error");
        if (decision) {
            result.decisions_made.push(decision);
            seen.add("decisions_made");
            continue;
        }
        if (todo) {
            result.open_todos.push(todo);
            seen.add("open_todos");
            continue;
        }
        if (error) {
            result.critical_error_traces.push(error);
            seen.add("critical_error_traces");
            continue;
        }
        if (section === "task_goals" || section === "open_todos") result[section].push(cleaned);
        else if (claudeTemplate && section) result[section].push(cleaned);
    }
    for (const key of ["task_goals", "decisions_made", "open_todos", "critical_error_traces"] as const) {
        result.completeness[key] = seen.has(key) ? "complete" : "missing";
    }
    return result;
}

function diagnostic(options: { recordDiagnostic?: (value: { code: string; count: number }) => void }): null {
    options.recordDiagnostic?.({ code: "unsupported_compaction_adapter", count: 1 });
    return null;
}

export function normalizeClaudePostCompact(raw: unknown, options: {
    harnessVersion: string;
    recordDiagnostic?: (value: { code: string; count: number }) => void;
}): {
    session_ref: string;
    harness: "claude-code";
    harness_version: string;
    source_event: "PostCompact";
    trigger: string;
    raw_summary: string;
    projection: CompactionProjection;
} | null {
    if (options.harnessVersion !== "2.1.219" && options.harnessVersion !== "2.1.220") return diagnostic(options);
    const candidate = object(raw);
    const expectedKeys = options.harnessVersion === "2.1.219"
        ? ["compact_summary", "cwd", "hook_event_name", "permission_mode", "session_id", "transcript_path", "trigger"]
        : ["compact_summary", "cwd", "hook_event_name", "prompt_id", "session_id", "transcript_path", "trigger"];
    if (!candidate || Object.keys(candidate).sort().join("|") !== expectedKeys.sort().join("|")) return diagnostic(options);
    const sessionId = string(candidate.session_id);
    const projectRoot = string(candidate.cwd);
    const rawSummary = string(candidate.compact_summary);
    const trigger = string(candidate.trigger);
    const versionField = options.harnessVersion === "2.1.219"
        ? string(candidate.permission_mode) : string(candidate.prompt_id);
    if (!sessionId || !projectRoot || !rawSummary || !trigger || !versionField
        || candidate.hook_event_name !== "PostCompact") return diagnostic(options);
    const redacted = redactLocalValue(candidate, projectRoot).value as UnknownRecord;
    const summary = String(redacted.compact_summary);
    return {
        session_ref: `claude-code:${String(redacted.session_id)}`,
        harness: "claude-code",
        harness_version: options.harnessVersion,
        source_event: "PostCompact",
        trigger: String(redacted.trigger),
        raw_summary: summary,
        projection: projectCompactionSummary(summary, { template: `claude-code-${options.harnessVersion}` }),
    };
}

export function selectOpenCodeCompactionSummary(
    eventRaw: unknown,
    sessionRaw: unknown,
    messagesRaw: unknown,
    options: { harnessVersion: string },
): { message_id: string; parent_id: string; completed_at: string; raw_summary: string } {
    if (options.harnessVersion !== "1.17.20") throw new Error("Unsupported OpenCode compaction adapter.");
    const event = object(eventRaw);
    const properties = object(event?.properties);
    const session = object(sessionRaw);
    const sessionId = string(session?.id);
    if (event?.type !== "session.compacted" || !sessionId || properties?.sessionID !== sessionId
        || session?.version !== "1.17.20" || session.parentID !== undefined || !Array.isArray(messagesRaw)) {
        throw new Error("OpenCode compaction shape is invalid.");
    }
    const compactionParents = new Set<string>();
    for (const rawMessage of messagesRaw) {
        const message = object(rawMessage);
        const info = object(message?.info);
        if (info?.role !== "user" || info.sessionID !== sessionId || !Array.isArray(message?.parts)) continue;
        if (message.parts.some((part) => object(part)?.type === "compaction")) {
            const id = string(info.id);
            if (id) compactionParents.add(id);
        }
    }
    const candidates: Array<{ message_id: string; parent_id: string; completed_at: string; time: number; raw_summary: string }> = [];
    for (const rawMessage of messagesRaw) {
        const message = object(rawMessage);
        const info = object(message?.info);
        const parentId = string(info?.parentID);
        const id = string(info?.id);
        const finish = string(info?.finish);
        if (info?.role !== "assistant" || info.sessionID !== sessionId || info.summary !== true || !finish
            || info.error !== undefined || !id || !parentId || !compactionParents.has(parentId) || !Array.isArray(message?.parts)) continue;
        const time = object(info.time);
        const timestamp = typeof time?.completed === "number" ? time.completed
            : typeof time?.created === "number" ? time.created : NaN;
        if (!Number.isFinite(timestamp)) continue;
        const texts = message.parts.flatMap((rawPart) => {
            const part = object(rawPart);
            return part?.type === "text" && part.ignored !== true && part.messageID === id && typeof part.text === "string"
                ? [part.text] : [];
        });
        if (texts.length === 0) continue;
        candidates.push({ message_id: id, parent_id: parentId, completed_at: new Date(timestamp).toISOString(), time: timestamp, raw_summary: texts.join("\n") });
    }
    candidates.sort((left, right) => right.time - left.time || right.message_id.localeCompare(left.message_id));
    const selected = candidates[0];
    if (!selected) throw new Error("OpenCode compaction did not contain a usable summary.");
    return {
        message_id: selected.message_id,
        parent_id: selected.parent_id,
        completed_at: selected.completed_at,
        raw_summary: selected.raw_summary,
    };
}

export function normalizeOpenCodeCompaction(
    eventRaw: unknown,
    sessionRaw: unknown,
    messagesRaw: unknown,
    options: {
        harnessVersion: string;
        recordDiagnostic?: (value: { code: string; count: number }) => void;
        unknownPayload?: unknown;
    },
): {
    session_ref: string;
    harness: "opencode";
    harness_version: string;
    source_event: "session.compacted";
    native_id: string;
    trigger: "native";
    raw_summary: string;
    projection: CompactionProjection;
} | null {
    if (options.harnessVersion !== "1.17.20") return diagnostic(options);
    const session = object(sessionRaw);
    const projectRoot = string(session?.directory);
    if (!projectRoot) return diagnostic(options);
    try {
        const redacted = redactLocalValue({ event: eventRaw, session: sessionRaw, messages: messagesRaw }, projectRoot).value as UnknownRecord;
        const redactedSession = object(redacted.session);
        const selected = selectOpenCodeCompactionSummary(redacted.event, redactedSession, redacted.messages, options);
        return {
            session_ref: `opencode:${String(redactedSession?.id)}`,
            harness: "opencode",
            harness_version: "1.17.20",
            source_event: "session.compacted",
            native_id: selected.message_id,
            trigger: "native",
            raw_summary: selected.raw_summary,
            projection: projectCompactionSummary(selected.raw_summary, { template: "opencode-1.17.20" }),
        };
    } catch {
        return diagnostic(options);
    }
}

export type CompactionRecovery = {
    artifact_id: string;
    source: "current_session" | "project_fallback";
    session_ref: string;
    revision: number;
    captured_at: string;
    age_seconds: number;
    harness: string;
    stale: boolean;
    projection: CompactionProjection;
};

export function selectCompactionRecovery(recordsRaw: unknown, options: {
    currentSessionRef?: string;
    now?: Date;
    staleAfterSeconds?: number;
    invalidArtifactIds?: string[];
    latestPointers?: { session?: string; project?: string };
} = {}): CompactionRecovery | null {
    if (!Array.isArray(recordsRaw)) return null;
    const invalid = new Set(options.invalidArtifactIds ?? []);
    const candidates = recordsRaw.flatMap((raw) => {
        const record = object(raw);
        const content = object(record?.content);
        const provenance = object(record?.provenance);
        const projection = content ? {
            task_goals: content.task_goals,
            decisions_made: content.decisions_made,
            open_todos: content.open_todos,
            critical_error_traces: content.critical_error_traces,
            completeness: content.completeness,
        } : undefined;
        const id = string(record?.artifact_id);
        const createdAt = string(record?.created_at);
        const sessionRef = string(record?.session_ref);
        if (!id || invalid.has(id) || record?.valid === false || record?.schema_version !== 1
            || record?.kind !== "compaction_summary" || !createdAt || !sessionRef || !Number.isFinite(Date.parse(createdAt))
            || typeof content?.revision !== "number" || !projection || !object(projection.completeness)
            || !Array.isArray(projection.task_goals) || !Array.isArray(projection.decisions_made)
            || !Array.isArray(projection.open_todos) || !Array.isArray(projection.critical_error_traces)) return [];
        return [{ record, id, createdAt, sessionRef, content, provenance, projection: projection as CompactionProjection }];
    }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id.localeCompare(left.id));
    const selected = candidates.find((candidate) => candidate.sessionRef === options.currentSessionRef) ?? candidates[0];
    if (!selected) return null;
    const now = options.now ?? new Date();
    const ageSeconds = Math.max(0, Math.floor((now.getTime() - Date.parse(selected.createdAt)) / 1000));
    return {
        artifact_id: selected.id,
        source: selected.sessionRef === options.currentSessionRef ? "current_session" : "project_fallback",
        session_ref: selected.sessionRef,
        revision: Number(selected.content.revision),
        captured_at: selected.createdAt,
        age_seconds: ageSeconds,
        harness: string(selected.provenance?.harness) ?? "unknown",
        stale: ageSeconds > (options.staleAfterSeconds ?? 86400),
        projection: selected.projection,
    };
}

function renderItems(items: string[]): string[] {
    return items.length > 0 ? items.map((item) => `- ${item}`) : ["(none captured)"];
}

export function renderCompactionRecovery(recovery: CompactionRecovery): string {
    const completeness = recovery.projection.completeness;
    const lines = [
        "## Compaction recovery",
        `Source: ${recovery.source}`,
        `Session: ${recovery.session_ref}`,
        `Revision: ${recovery.revision}`,
        `Captured: ${recovery.captured_at}`,
        `Age: ${recovery.age_seconds} seconds`,
        `Harness: ${recovery.harness}`,
        `Completeness: goals=${completeness.task_goals}, decisions=${completeness.decisions_made}, todos=${completeness.open_todos}, errors=${completeness.critical_error_traces}`,
    ];
    if (recovery.stale) lines.push("Warning: this state is stale; validate it against the current repository before relying on it.");
    lines.push(
        "", "### Task Goals", ...renderItems(recovery.projection.task_goals),
        "", "### Decisions Made", ...renderItems(recovery.projection.decisions_made),
        "", "### Open TODOs", ...renderItems(recovery.projection.open_todos),
        "", "### Critical Error Traces", ...renderItems(recovery.projection.critical_error_traces),
    );
    return `${lines.join("\n")}\n`;
}
