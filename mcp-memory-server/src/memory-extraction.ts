export type ExtractionCategory =
    | "decision"
    | "preference"
    | "pattern"
    | "pitfall"
    | "constraint"
    | "bug"
    | "convention";

export type ExtractionCandidate = {
    key: string;
    value: string;
    category?: string;
    importance?: number;
};

function truncateOutput(value: string, maxLength: number = 12000): string {
    return value.length <= maxLength
        ? value
        : `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]`;
}

function stripMarkdownFences(value: string): string {
    return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function parseJsonResponse<T>(value: string): T {
    const stripped = stripMarkdownFences(value);
    try {
        return JSON.parse(stripped) as T;
    } catch {
        const firstBrace = stripped.indexOf("{");
        const lastBrace = stripped.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace > firstBrace) {
            return JSON.parse(stripped.slice(firstBrace, lastBrace + 1)) as T;
        }
        throw new Error(`Failed to parse JSON response: ${truncateOutput(stripped, 1000)}`);
    }
}

export function sanitizeExtractionCandidates(
    value: unknown,
    fallbackCategory?: string,
): ExtractionCandidate[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item): ExtractionCandidate | null => {
            if (!item || typeof item !== "object") return null;
            const raw = item as Record<string, unknown>;
            const key = typeof raw.key === "string" ? raw.key.trim() : "";
            const candidateValue = typeof raw.value === "string" ? raw.value.trim() : "";
            if (!key || !candidateValue) return null;
            const category = typeof raw.category === "string" && raw.category.trim()
                ? raw.category.trim()
                : fallbackCategory;
            const importance = typeof raw.importance === "number"
                ? Math.max(0, Math.min(1, raw.importance))
                : undefined;
            return { key, value: candidateValue, category, importance };
        })
        .filter((candidate): candidate is ExtractionCandidate => candidate !== null);
}

export async function extractMemoryCandidates(
    content: string,
    modelOverride?: string,
    category?: string,
): Promise<{ model: string; candidates: ExtractionCandidate[] }> {
    const apiKey = process.env.CAIRN_LLM_API_KEY;
    if (!apiKey) throw new Error("CAIRN_LLM_API_KEY is not set.");
    const rawUrl = process.env.CAIRN_LLM_API_URL;
    if (!rawUrl) throw new Error("CAIRN_LLM_API_URL is not set.");
    const apiUrl = rawUrl.trim().replace(/\/+$/, "");
    const model = (modelOverride ?? process.env.CAIRN_LLM_EXTRACTION_MODEL)?.trim();
    if (!model) throw new Error("CAIRN_LLM_EXTRACTION_MODEL is not set.");

    const systemPrompt = [
        "You extract durable memory candidates from development notes.",
        "Return ONLY valid JSON, no markdown fences.",
        "Schema: {\"candidates\":[{\"key\":\"decisions/cache-rule\",\"value\":\"...\",\"category\":\"decision\",\"importance\":0.92}]}",
        "Only include genuinely reusable knowledge.",
        "Skip trivial status notes, temporary branch details, and duplicated points.",
        "Prefer short kebab-case keys with a useful prefix such as decisions/, pitfalls/, patterns/, bugs/, constraints/, preferences/, conventions/.",
        "Do not invent dates unless they are explicitly present in the source text.",
        category ? `Bias extraction toward category: ${category}.` : "",
    ].filter(Boolean).join(" ");

    const response = await fetch(`${apiUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model,
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content }],
            temperature: 0.1,
            max_tokens: 1200,
        }),
        signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Extraction request failed with ${response.status}: ${text}`);
    }
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const rawContent = payload.choices?.[0]?.message?.content;
    if (!rawContent) throw new Error("Extraction model returned no content.");
    const parsed = parseJsonResponse<{ candidates?: unknown }>(rawContent);
    return { model, candidates: sanitizeExtractionCandidates(parsed.candidates, category) };
}
