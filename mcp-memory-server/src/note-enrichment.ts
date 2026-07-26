import { z } from "zod";

import { isNoteDistillationEnabled, noteEnrichmentContentSchema, type NoteEnrichmentContent } from "./note-schema.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

const evidenceSchema = z.object({
    id: z.string().min(1).max(256),
    normalized_error: z.string().min(1).max(4096),
    component: z.string().max(1024),
    status: z.enum(["unresolved", "resolved", "abandoned"]),
    attempts: z.array(z.string().min(1).max(4096)).max(64),
}).strict();

export type NoteEnrichmentEvidence = z.infer<typeof evidenceSchema>;
export type NoteEnrichment = NoteEnrichmentContent;

export type NoteEnrichmentResult =
    | { status: "enriched"; enrichment: NoteEnrichment }
    | { status: "enrichment_skipped"; reason: string }
    | { status: "enrichment_failed"; error: string };

type EnrichmentConfig = { apiUrl: string; apiKey: string; model: string; timeoutMs: number };

function truthy(value: string | undefined): boolean {
    return /^(?:1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function config(): EnrichmentConfig | null {
    if (!isNoteDistillationEnabled() || !truthy(process.env.CAIRN_NOTE_ENRICHMENT)) return null;
    const apiKey = process.env.CAIRN_LLM_API_KEY?.trim();
    const rawUrl = process.env.CAIRN_LLM_API_URL?.trim();
    const model = process.env.CAIRN_NOTE_ENRICHMENT_MODEL?.trim();
    if (!apiKey || !rawUrl || !model) return null;
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error("CAIRN_LLM_API_URL must use http or https.");
    const rawTimeout = Number(process.env.CAIRN_NOTE_ENRICHMENT_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout >= 100 && rawTimeout <= 120_000
        ? Math.floor(rawTimeout)
        : DEFAULT_TIMEOUT_MS;
    return { apiUrl: rawUrl.replace(/\/+$/, ""), apiKey, model, timeoutMs };
}

function parseContent(value: string): NoteEnrichment {
    const stripped = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    return noteEnrichmentContentSchema.parse(JSON.parse(stripped));
}

async function request(configured: EnrichmentConfig, evidence: NoteEnrichmentEvidence): Promise<NoteEnrichment> {
    const response = await fetch(`${configured.apiUrl}/chat/completions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${configured.apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: configured.model,
            temperature: 0,
            max_tokens: 1000,
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: "Summarize the supplied already-redacted failure evidence. Return strict JSON with summary, lessons, and caveats. Do not infer failure identity, lifecycle, or provenance.",
                },
                { role: "user", content: JSON.stringify(evidence) },
            ],
        }),
        signal: AbortSignal.timeout(configured.timeoutMs),
    });
    if (!response.ok) throw new Error(`provider returned HTTP ${response.status}`);
    const raw = await response.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) throw new Error("provider response exceeded the local size limit");
    const outer = z.object({
        choices: z.array(z.object({ message: z.object({ content: z.string() }).passthrough() }).passthrough()).min(1),
    }).passthrough().parse(JSON.parse(raw));
    return parseContent(outer.choices[0].message.content);
}

export async function enrichNoteEvidence(rawEvidence: NoteEnrichmentEvidence): Promise<NoteEnrichmentResult> {
    let configured: EnrichmentConfig | null;
    try {
        configured = config();
    } catch (error) {
        return { status: "enrichment_failed", error: error instanceof Error ? error.message : "invalid enrichment configuration" };
    }
    if (!configured) return { status: "enrichment_skipped", reason: "optional enrichment is disabled or incompletely configured" };
    const parsed = evidenceSchema.safeParse(rawEvidence);
    if (!parsed.success) return { status: "enrichment_failed", error: "enrichment evidence failed local validation" };
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            return { status: "enriched", enrichment: await request(configured, parsed.data) };
        } catch (error) {
            if (attempt === 1) {
                const name = error instanceof Error ? error.name : "Error";
                return { status: "enrichment_failed", error: `optional enrichment failed locally (${name})` };
            }
        }
    }
    return { status: "enrichment_failed", error: "optional enrichment failed locally" };
}
