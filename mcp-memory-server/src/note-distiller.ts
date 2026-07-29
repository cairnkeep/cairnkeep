import { createHash } from "node:crypto";

import { buildFailureSignature } from "./failure-signature.js";
import { enrichNoteEvidence } from "./note-enrichment.js";
import { isNoteDistillationEnabled, type NoteOccurrence } from "./note-schema.js";
import {
    applyDistilledSession,
    applyNoteEnrichment,
    getNoteEnrichmentEvidence,
    type DistilledFailure,
    type DistilledSuccess,
    type StoredNoteResult,
} from "./note-store.js";
import { listTrajectories, showTrajectory } from "./trajectory-store.js";
import type { TrajectoryEvent, TrajectorySession } from "./trajectory-schema.js";

type UnknownRecord = Record<string, unknown>;

export type DistillProjectResult = {
    schema_version: 1;
    enabled: boolean;
    project_id?: string;
    created: StoredNoteResult[];
    updated: StoredNoteResult[];
    already_processed: string[];
    enrichment_skipped: Array<{ id: string; reason: string }>;
    enrichment_failed: Array<{ id: string; error: string }>;
    failed: Array<{ session_id: string; error: string }>;
};

function object(value: unknown): UnknownRecord | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : undefined;
}

function string(value: unknown): string | undefined {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableValue);
    const record = object(value);
    if (!record) return value;
    return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
}

function hash(domain: string, value: unknown): string {
    return createHash("sha256").update(`cairnkeep:notes:v1:${domain}\0${JSON.stringify(stableValue(value))}`).digest("hex");
}

function validationKey(toolName: string, input: unknown): string {
    return hash("validation", { tool_name: toolName.trim().toLowerCase(), input });
}

function evidenceText(payload: UnknownRecord): string {
    for (const key of ["output", "message", "error", "stderr"]) {
        const value = string(payload[key]);
        if (value) return value.slice(0, 32768);
        if (payload[key] !== undefined && payload[key] !== null) return JSON.stringify(stableValue(payload[key])).slice(0, 32768);
    }
    return "Unknown structured failure";
}

function explicitFailure(payload: UnknownRecord): boolean {
    if (payload.is_error === true) return true;
    for (const key of ["exit_code", "status", "status_code"]) {
        const value = payload[key];
        if (typeof value === "number" && Number.isFinite(value) && value !== 0) return true;
    }
    return false;
}

function explicitSuccess(payload: UnknownRecord): boolean {
    if (payload.is_error === false) return true;
    for (const key of ["exit_code", "status", "status_code"]) if (payload[key] === 0) return true;
    return false;
}

function occurrence(
    session: TrajectorySession,
    sessionDigest: string,
    event: TrajectoryEvent,
    outcome: NoteOccurrence["outcome"],
    evidence: string,
    toolName?: string,
    key?: string,
): NoteOccurrence {
    return {
        session_id: session.session_id,
        session_digest: sessionDigest,
        ended_at: session.ended_at,
        sequence: event.sequence,
        outcome,
        ...(toolName ? { tool_name: toolName.slice(0, 256) } : {}),
        ...(key ? { validation_key: key } : {}),
        evidence: evidence.replace(/\s+/g, " ").trim().slice(0, 4096) || "Structured event",
    };
}

function extractSession(session: TrajectorySession): { digest: string; failures: DistilledFailure[]; successes: DistilledSuccess[] } {
    const sessionDigest = hash("trajectory", session);
    const invocations = new Map<string, { toolName: string; input: unknown; key: string }>();
    const failures: Array<DistilledFailure & { sequence: number }> = [];
    const successes: DistilledSuccess[] = [];

    for (const event of [...session.events].sort((a, b) => a.sequence - b.sequence)) {
        const payload = object(event.payload) ?? {};
        if (event.kind === "tool_invocation") {
            const callId = string(payload.call_id);
            const toolName = string(payload.tool_name);
            if (callId && toolName) invocations.set(callId, { toolName, input: payload.input, key: validationKey(toolName, payload.input) });
            continue;
        }
        if (event.kind === "tool_result") {
            const invocation = invocations.get(string(payload.call_id) ?? "");
            if (!invocation) continue;
            if (explicitFailure(payload)) {
                const raw = evidenceText(payload);
                const signature = buildFailureSignature(raw, { root: session.project_root });
                failures.push({
                    signature,
                    occurrence: occurrence(session, sessionDigest, event, "failure", signature.normalized_message, invocation.toolName, invocation.key),
                    sequence: event.sequence,
                });
            } else if (explicitSuccess(payload)) {
                successes.push({
                    validation_key: invocation.key,
                    occurrence: occurrence(session, sessionDigest, event, "resolution", "Equivalent validation invocation succeeded.", invocation.toolName, invocation.key),
                });
            }
            continue;
        }
        if (event.kind === "system_event" && payload.event === "model_error") {
            const raw = evidenceText(payload);
            const signature = buildFailureSignature(raw, { root: session.project_root, component: "model" });
            failures.push({
                signature,
                occurrence: occurrence(session, sessionDigest, event, "failure", signature.normalized_message),
                sequence: event.sequence,
            });
            continue;
        }
        if (event.kind === "model_output") {
            const text = string(payload.text)?.trim();
            if (!text || !/^(?:I am abandoning this approach|I will not pursue this strategy)\b/i.test(text)) continue;
            const latest = [...failures].reverse().find((failure) => failure.sequence < event.sequence && !failure.abandonment);
            if (latest) latest.abandonment = occurrence(session, sessionDigest, event, "abandonment", text);
        }
    }
    return { digest: sessionDigest, failures: failures.map(({ sequence: _sequence, ...failure }) => failure), successes };
}

export async function distillProject(options: { projectRoot: string; sessionId?: string }): Promise<DistillProjectResult> {
    if (!isNoteDistillationEnabled()) {
        return {
            schema_version: 1,
            enabled: false,
            created: [],
            updated: [],
            already_processed: [],
            enrichment_skipped: [],
            enrichment_failed: [],
            failed: [],
        };
    }

    const sessions = options.sessionId
        ? [await showTrajectory(options.sessionId, options.projectRoot)]
        : await (async () => {
            const listed = await listTrajectories(options.projectRoot);
            const selected = await Promise.all(listed.sessions.map((entry) => showTrajectory(entry.session_id, options.projectRoot)));
            return selected.sort((left, right) => left.ended_at.localeCompare(right.ended_at) || left.session_id.localeCompare(right.session_id));
        })();
    const result: DistillProjectResult = {
        schema_version: 1,
        enabled: true,
        created: [],
        updated: [],
        already_processed: [],
        enrichment_skipped: [],
        enrichment_failed: [],
        failed: [],
    };
    for (const session of sessions) {
        const extracted = extractSession(session);
        const stored = applyDistilledSession({
            projectRoot: options.projectRoot,
            sessionId: session.session_id,
            sessionDigest: extracted.digest,
            failures: extracted.failures,
            successes: extracted.successes,
        });
        result.created.push(...stored.created);
        result.updated.push(...stored.updated);
        result.already_processed.push(...stored.already_processed);
        for (const note of [...stored.created, ...stored.updated]) {
            const enriched = await enrichNoteEvidence(getNoteEnrichmentEvidence(note.id));
            if (enriched.status === "enriched") applyNoteEnrichment(note.id, enriched.enrichment);
            else if (enriched.status === "enrichment_skipped") result.enrichment_skipped.push({ id: note.id, reason: enriched.reason });
            else result.enrichment_failed.push({ id: note.id, error: enriched.error });
        }
        result.project_id ??= stored.created[0]?.project_id ?? stored.updated[0]?.project_id;
    }
    return result;
}
