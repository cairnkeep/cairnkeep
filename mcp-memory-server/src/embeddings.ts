import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type EmbeddingConfig = {
    apiUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: number;
};

const DEFAULT_EMBEDDING_TIMEOUT_MS = 15000;

// Resolve the embeddings endpoint from the environment. Returns null when the
// API key, URL, or model name is not configured, so callers can fall back to
// substring search. Point CAIRN_LLM_API_URL (or CAIRN_MEMORY_EMBEDDING_URL) at
// any OpenAI-compatible embeddings endpoint.
export function getEmbeddingConfig(): EmbeddingConfig | null {
    const apiKey = process.env.CAIRN_LLM_API_KEY;
    if (!apiKey) {
        return null;
    }

    const rawUrl =
        process.env.CAIRN_MEMORY_EMBEDDING_URL ?? process.env.CAIRN_LLM_API_URL;
    if (!rawUrl) {
        return null;
    }
    const apiUrl = rawUrl.trim().replace(/\/+$/, "");
    // The model name must be configured explicitly — the core ships no vendor
    // default. Unset means semantic search degrades to substring matching.
    const model = process.env.CAIRN_MEMORY_EMBEDDING_MODEL?.trim();
    if (!model) {
        return null;
    }

    const rawTimeout = Number(process.env.CAIRN_MEMORY_EMBEDDING_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout >= 100 && rawTimeout <= 120000
        ? Math.floor(rawTimeout)
        : DEFAULT_EMBEDDING_TIMEOUT_MS;

    return { apiUrl, apiKey, model, timeoutMs };
}

export function hashText(text: string): string {
    return createHash("sha1").update(text).digest("hex");
}

export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) {
        return 0;
    }

    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i += 1) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
        return 0;
    }

    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Embed an array of strings via the OpenAI-compatible /embeddings endpoint.
// Chunked so a large memory scope does not produce one oversized request.
export async function embedTexts(
    config: EmbeddingConfig,
    texts: string[],
    chunkSize: number = 64,
): Promise<number[][]> {
    if (texts.length === 0) {
        return [];
    }

    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += chunkSize) {
        const chunk = texts.slice(start, start + chunkSize);
        const response = await fetch(`${config.apiUrl}/embeddings`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ model: config.model, input: chunk }),
            signal: AbortSignal.timeout(config.timeoutMs),
        });

        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Embeddings request failed with ${response.status}: ${text}`);
        }

        const payload = (await response.json()) as {
            data?: Array<{ embedding: number[]; index: number }>;
        };
        const data = payload.data ?? [];
        // Order by index so vectors align with the input chunk even if the API reorders.
        const ordered = [...data].sort((left, right) => left.index - right.index);
        for (const item of ordered) {
            vectors.push(item.embedding);
        }
    }

    return vectors;
}

type CacheFile = {
    model: string;
    entries: Record<string, { hash: string; vector: number[] }>;
};

// Persistent per-scope embedding cache keyed by entry key + content hash. Invalidated
// automatically when the embedding model changes so vectors of differing dimensionality
// never get compared.
export class EmbeddingCache {
    private readonly path: string;
    private readonly model: string;
    private data: CacheFile;
    private dirty = false;

    constructor(path: string, model: string) {
        this.path = path;
        this.model = model;
        this.data = { model, entries: {} };

        if (existsSync(path)) {
            try {
                const parsed = JSON.parse(readFileSync(path, "utf8")) as CacheFile;
                if (parsed.model === model && parsed.entries) {
                    this.data = parsed;
                }
            } catch {
                // Corrupt or stale cache — start fresh.
                this.data = { model, entries: {} };
            }
        }
    }

    get(key: string, contentHash: string): number[] | undefined {
        const hit = this.data.entries[key];
        if (hit && hit.hash === contentHash) {
            return hit.vector;
        }
        return undefined;
    }

    set(key: string, contentHash: string, vector: number[]): void {
        this.data.entries[key] = { hash: contentHash, vector };
        this.dirty = true;
    }

    save(): void {
        if (!this.dirty) {
            return;
        }
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, JSON.stringify(this.data));
        this.dirty = false;
    }
}
