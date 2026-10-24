import { z } from 'zod';

export type MemoryRerankerConfig = { apiUrl: string; model: string; apiKey?: string; timeoutMs: number };
const MAX_CANDIDATES = 50;
const MAX_TEXT_BYTES = 4096;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 64 * 1024;
const responseSchema = z.object({ results: z.array(z.object({
    index: z.number().int().min(0).max(MAX_CANDIDATES - 1),
    relevance_score: z.number().finite(),
})).max(MAX_CANDIDATES) });

/** Configuration alone never grants permission: explicit opt-in is required. */
export function getMemoryRerankerConfig(env: NodeJS.ProcessEnv = process.env): MemoryRerankerConfig | null {
    if (env.CAIRN_MEMORY_RERANK !== '1') return null;
    try {
        const url = new URL(env.CAIRN_MEMORY_RERANK_URL ?? '');
        const model = env.CAIRN_MEMORY_RERANK_MODEL?.trim();
        const rawTimeout = env.CAIRN_MEMORY_RERANK_TIMEOUT_MS ?? '2000';
        const timeoutMs = Number(rawTimeout);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
            || !model || Buffer.byteLength(model) > 256 || !/^\d+$/.test(rawTimeout)
            || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000) return null;
        const apiKey = env.CAIRN_MEMORY_RERANK_API_KEY?.trim();
        if (apiKey && (apiKey.length > 8192 || /[\r\n]/.test(apiKey))) return null;
        return { apiUrl: url.href.replace(/\/+$/, ''), model, ...(apiKey ? { apiKey } : {}), timeoutMs };
    } catch { return null; }
}

export function memoryRerankCandidateCount(topK: number, config: MemoryRerankerConfig | null): number {
    if (!Number.isInteger(topK) || topK < 1 || topK > MAX_CANDIDATES) throw new Error('Reranking requires a bounded result count.');
    return config ? Math.min(MAX_CANDIDATES, Math.max(32, topK * 4)) : topK;
}

function textPrefix(value: string, maxUnits: number): string {
    let end = Math.min(value.length, maxUnits);
    const last = value.charCodeAt(end - 1);
    if (end < value.length && last >= 0xD800 && last <= 0xDBFF) end--;
    return value.slice(0, end);
}

function rankingText(entry: { key: string; value: string }): string {
    // Bound allocation before UTF-8 encoding, then discard an incomplete final
    // code point rather than introducing replacement characters at the cutoff.
    const text = `${textPrefix(entry.key, 1024)}\n${textPrefix(entry.value, MAX_TEXT_BYTES)}`;
    const bytes = Buffer.from(text);
    return new TextDecoder().decode(bytes.subarray(0, MAX_TEXT_BYTES), { stream: true });
}

async function readRankingResponse(response: Response): Promise<unknown> {
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
        await response.body?.cancel(); throw new Error('Reranker response unavailable.');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_RESPONSE_BYTES) throw new Error('Reranker response exceeds limit.');
            chunks.push(value);
        }
        const bytes = Buffer.concat(chunks, size);
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Reorder admitted records only. No input object, score, scope or value is changed. */
export async function rerankMemoryResults<T extends { key: string; value: string }>(
    entries: T[], query: string, topK: number, config: MemoryRerankerConfig | null,
    pinned: (entry: T) => boolean = () => false,
): Promise<{ results: T[]; status: 'disabled' | 'skipped' | 'reranked' | 'failed' }> {
    const baseline = entries.slice(0, topK);
    if (!config) return { results: baseline, status: 'disabled' };
    if (entries.length < 2 || entries.length > MAX_CANDIDATES || !query.trim() || Buffer.byteLength(query) > MAX_TEXT_BYTES) {
        return { results: baseline, status: 'skipped' };
    }
    try {
        const body = JSON.stringify({ model: config.model, query, documents: entries.map(rankingText), top_n: entries.length });
        if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) return { results: baseline, status: 'skipped' };
        const response = await fetch(`${config.apiUrl}/rerank`, {
            method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(config.timeoutMs),
            headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
            body,
        });
        const parsed = responseSchema.parse(await readRankingResponse(response));
        if (parsed.results.length !== entries.length
            || new Set(parsed.results.map(row => row.index)).size !== entries.length
            || parsed.results.some(row => row.index >= entries.length)) throw new Error('Invalid ranking indices.');
        const scores = new Map(parsed.results.map(row => [row.index, row.relevance_score]));
        const ordered = entries.map((entry, index) => ({ entry, index, pinned: pinned(entry) }));
        ordered.sort((a, b) => Number(b.pinned) - Number(a.pinned)
            || scores.get(b.index)! - scores.get(a.index)! || a.index - b.index);
        return { results: ordered.slice(0, topK).map(row => row.entry), status: 'reranked' };
    } catch {
        // Never return endpoint errors, response bodies or credentials to clients.
        return { results: baseline, status: 'failed' };
    }
}
