import { spawn } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";

import { AgentFS } from "agentfs-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import {
    EmbeddingCache,
    cosineSimilarity,
    embedTexts,
    getEmbeddingConfig,
    hashText,
} from "./embeddings.js";

type MemoryConfig = {
    scopes?: string[];
    anythingllm_workspaces?: string[];
};

type MemoryEntry = {
    scope: string;
    key: string;
    value: string;
};

type ExtractionCandidate = {
    key: string;
    value: string;
    category?: string;
    importance?: number;
};

type CommandResult = {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const infraRoot = resolve(moduleDir, "..", "..");
const anythingllmSyncScript = join(infraRoot, "anythingllm", "sync_to_anythingllm.py");
const HISTORY_NAMESPACE = "__history__";

function expandHome(value: string): string {
    if (value === "~") {
        return homedir();
    }

    if (value.startsWith("~/")) {
        return join(homedir(), value.slice(2));
    }

    return value;
}

function getBaseDir(): string {
    return resolve(expandHome(process.env.CAIRN_AGENTFS_BASE_DIR ?? "~/.cairnkeep"));
}

// Provider-neutral config resolution so the same server works under OpenCode,
// Claude Code, or any harness. First existing path wins. .opencode/memory.json
// is kept in the list for backward compatibility with existing repos.
function resolveMemoryConfigPath(cwd: string): string | undefined {
    const candidates = [
        process.env.AGENT_MEMORY_CONFIG,
        join(cwd, ".agent", "memory.json"),
        join(cwd, ".opencode", "memory.json"),
        join(cwd, ".claude", "memory.json"),
        join(cwd, "memory.json"),
    ];

    for (const candidate of candidates) {
        if (candidate && existsSync(candidate)) {
            return candidate;
        }
    }

    return undefined;
}

function getMemoryConfig(cwd: string = process.cwd()): MemoryConfig {
    const configPath = resolveMemoryConfigPath(cwd);

    if (!configPath) {
        return {
            scopes: ["identity"],
            anythingllm_workspaces: [],
        };
    }

    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as MemoryConfig;

    return {
        scopes: parsed.scopes?.length ? Array.from(new Set(parsed.scopes)) : ["identity"],
        anythingllm_workspaces: parsed.anythingllm_workspaces ?? [],
    };
}

function getSearchScopes(scope: string, config: MemoryConfig): string[] {
    if (scope === "all") {
        return config.scopes?.length ? config.scopes : ["identity"];
    }

    return [scope];
}

// Scopes name a single db file directly under the base dir, so they must be a
// bare kebab-case token. Rejecting separators, dots, and absolute paths here —
// the one chokepoint every tool resolves through — stops a `../` or absolute
// `scope` from escaping the base dir and reading/creating arbitrary .db files.
const SCOPE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function assertSafeScope(scope: string): void {
    if (scope === "project" || scope === "all") {
        return;
    }
    if (!SCOPE_PATTERN.test(scope)) {
        throw new Error(
            `Invalid scope "${scope}": must be kebab-case (^[a-z0-9][a-z0-9-]*$), "project", or "all".`,
        );
    }
}

function resolveScopePath(scope: string, cwd: string = process.cwd()): string {
    if (scope === "project") {
        return resolve(cwd, ".agentfs", "project.db");
    }

    assertSafeScope(scope);
    const baseDir = getBaseDir();
    const dbPath = resolve(baseDir, `${scope}.db`);
    // Defense in depth: even if the pattern is ever loosened, never resolve
    // outside the base dir. `relative` catches `..` escapes (which `join` would
    // silently normalize away) as well as absolute overrides.
    const rel = relative(baseDir, dbPath);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
        throw new Error(`Invalid scope "${scope}": resolves outside the base directory.`);
    }
    return dbPath;
}

function ensureParentDir(filePath: string): void {
    mkdirSync(dirname(filePath), { recursive: true });
}

function normalizeValue(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }

    if (value === undefined || value === null) {
        return "";
    }

    return JSON.stringify(value);
}

async function openScope(scope: string, create: boolean): Promise<AgentFS | null> {
    const dbPath = resolveScopePath(scope);

    if (!create && !existsSync(dbPath)) {
        return null;
    }

    if (create) {
        ensureParentDir(dbPath);
    }

    return AgentFS.open({ id: scope, path: dbPath });
}

function isHistoryKey(key: string): boolean {
    return key === HISTORY_NAMESPACE || key.startsWith(`${HISTORY_NAMESPACE}/`);
}

function historyPrefix(baseKey: string): string {
    return `${HISTORY_NAMESPACE}/${baseKey}/`;
}

function historySnapshotKey(baseKey: string, timestamp: string): string {
    return `${historyPrefix(baseKey)}${timestamp}`;
}

function visibleEntries(entries: MemoryEntry[], includeHistory: boolean): MemoryEntry[] {
    if (includeHistory) {
        return entries;
    }

    return entries.filter((entry) => !isHistoryKey(entry.key));
}

async function listEntries(
    scope: string,
    prefix: string = "",
    options: { includeHistory?: boolean } = {},
): Promise<MemoryEntry[]> {
    const agent = await openScope(scope, false);

    if (!agent) {
        return [];
    }

    try {
        const entries = await agent.kv.list(prefix);
        return visibleEntries(entries.map(({ key, value }) => ({
            scope,
            key,
            value: normalizeValue(value),
        })), options.includeHistory ?? false);
    } finally {
        await agent.close();
    }
}

async function readKey(scope: string, key: string): Promise<MemoryEntry[]> {
    const agent = await openScope(scope, false);

    if (!agent) {
        return [];
    }

    try {
        const value = await agent.kv.get(key);
        if (value === undefined) {
            return [];
        }

        return [{ scope, key, value: normalizeValue(value) }];
    } finally {
        await agent.close();
    }
}

function searchEntries(entries: MemoryEntry[], query: string): MemoryEntry[] {
    const needle = query.toLowerCase();
    return entries.filter(({ key, value }) => {
        return key.toLowerCase().includes(needle) || value.toLowerCase().includes(needle);
    });
}

function asToolText(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

function truncateOutput(value: string, maxLength: number = 12000): string {
    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]`;
}

function stripMarkdownFences(value: string): string {
    return value
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
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

function sanitizeExtractionCandidates(
    value: unknown,
    fallbackCategory?: string,
): ExtractionCandidate[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item): ExtractionCandidate | null => {
            if (!item || typeof item !== "object") {
                return null;
            }

            const raw = item as Record<string, unknown>;
            const key = typeof raw.key === "string" ? raw.key.trim() : "";
            const candidateValue = typeof raw.value === "string" ? raw.value.trim() : "";
            if (!key || !candidateValue) {
                return null;
            }

            const category = typeof raw.category === "string" && raw.category.trim()
                ? raw.category.trim()
                : fallbackCategory;
            const importance = typeof raw.importance === "number"
                ? Math.max(0, Math.min(1, raw.importance))
                : undefined;

            return {
                key,
                value: candidateValue,
                category,
                importance,
            };
        })
        .filter((candidate): candidate is ExtractionCandidate => candidate !== null);
}

async function extractMemoryCandidates(
    content: string,
    modelOverride?: string,
    category?: string,
): Promise<{ model: string; candidates: ExtractionCandidate[] }> {
    const apiKey = process.env.CAIRN_LLM_API_KEY;
    if (!apiKey) {
        throw new Error("CAIRN_LLM_API_KEY is not set.");
    }

    const rawUrl = process.env.CAIRN_LLM_API_URL;
    if (!rawUrl) {
        throw new Error("CAIRN_LLM_API_URL is not set.");
    }
    const apiUrl = rawUrl.trim().replace(/\/+$/, "");
    const model = (modelOverride ?? process.env.CAIRN_LLM_EXTRACTION_MODEL)?.trim();
    if (!model) {
        throw new Error("CAIRN_LLM_EXTRACTION_MODEL is not set.");
    }

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
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content },
            ],
            temperature: 0.1,
            max_tokens: 1200,
        }),
        signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Extraction request failed with ${response.status}: ${text}`);
    }

    const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
    };
    const rawContent = payload.choices?.[0]?.message?.content;
    if (!rawContent) {
        throw new Error("Extraction model returned no content.");
    }

    const parsed = parseJsonResponse<{ candidates?: unknown }>(rawContent);
    return {
        model,
        candidates: sanitizeExtractionCandidates(parsed.candidates, category),
    };
}

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, {
            cwd: infraRoot,
            env: process.env,
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
        }, timeoutMs);

        child.stdout?.on("data", (chunk: Buffer) => {
            stdout += chunk.toString("utf8");
        });

        child.stderr?.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
        });

        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });

        child.on("close", (exitCode) => {
            clearTimeout(timer);
            resolvePromise({
                exitCode,
                stdout: truncateOutput(stdout),
                stderr: truncateOutput(stderr),
                timedOut,
            });
        });
    });
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of input) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
}

function defaultAnythingLLMWorkspace(config: MemoryConfig): string | undefined {
    return config.anythingllm_workspaces?.find((workspace) => workspace !== "engineering-patterns");
}

async function callAnythingLLM(workspace: string, query: string): Promise<string> {
    const apiKey = process.env.ANYTHINGLLM_API_KEY;
    if (!apiKey) {
        throw new Error("ANYTHINGLLM_API_KEY is not set.");
    }

    const baseUrl = process.env.ANYTHINGLLM_BASE_URL ?? "http://localhost:3001";
    const response = await fetch(`${baseUrl}/api/v1/workspace/${encodeURIComponent(workspace)}/chat`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            message: query,
            mode: "query",
        }),
        signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`AnythingLLM request failed with ${response.status}: ${text}`);
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const directText = [
        payload.textResponse,
        payload.response,
        payload.message,
        payload.text,
    ].find((value) => typeof value === "string");

    if (typeof directText === "string") {
        return directText;
    }

    return JSON.stringify(payload, null, 2);
}

type ScoredEntry = MemoryEntry & { score: number };

function entryText(entry: MemoryEntry): string {
    return entry.value ? `${entry.key}\n${entry.value}` : entry.key;
}

function embeddingCachePath(scope: string): string {
    return join(getBaseDir(), ".embeddings", `${hashText(resolveScopePath(scope))}.json`);
}

async function semanticSearch(
    scope: string,
    query: string,
    topK: number,
    minScore: number,
): Promise<{ results: ScoredEntry[]; mode: "semantic" | "substring"; model?: string }> {
    const config = getMemoryConfig();
    const scopes = getSearchScopes(scope, config);
    const embeddingConfig = getEmbeddingConfig();

    const perScopeEntries = await Promise.all(
        scopes.map(async (candidate) => ({ scope: candidate, entries: await listEntries(candidate) })),
    );
    const allEntries = perScopeEntries.flatMap((group) => group.entries);

    if (allEntries.length === 0) {
        return { results: [], mode: embeddingConfig ? "semantic" : "substring" };
    }

    const substringFallback = (): { results: ScoredEntry[]; mode: "substring" } => ({
        results: searchEntries(allEntries, query)
            .map((entry) => ({ ...entry, score: 1 }))
            .slice(0, topK),
        mode: "substring",
    });

    if (!embeddingConfig) {
        return substringFallback();
    }

    try {
        const caches: EmbeddingCache[] = [];
        const vectors = new Map<MemoryEntry, number[]>();

        for (const group of perScopeEntries) {
            const cache = new EmbeddingCache(embeddingCachePath(group.scope), embeddingConfig.model);
            caches.push(cache);

            const misses: { entry: MemoryEntry; text: string; hash: string }[] = [];
            for (const entry of group.entries) {
                const text = entryText(entry);
                const contentHash = hashText(text);
                const cached = cache.get(entry.key, contentHash);
                if (cached) {
                    vectors.set(entry, cached);
                } else {
                    misses.push({ entry, text, hash: contentHash });
                }
            }

            if (misses.length) {
                const fresh = await embedTexts(embeddingConfig, misses.map((miss) => miss.text));
                misses.forEach((miss, index) => {
                    const vector = fresh[index];
                    if (vector) {
                        cache.set(miss.entry.key, miss.hash, vector);
                        vectors.set(miss.entry, vector);
                    }
                });
            }
        }

        const [queryVector] = await embedTexts(embeddingConfig, [query]);
        for (const cache of caches) {
            cache.save();
        }

        const ranked = allEntries
            .map((entry) => {
                const vector = vectors.get(entry);
                const score = vector && queryVector ? cosineSimilarity(queryVector, vector) : 0;
                return { ...entry, score };
            })
            .filter((entry) => entry.score >= minScore)
            .sort((left, right) => right.score - left.score)
            .slice(0, topK);

        return { results: ranked, mode: "semantic", model: embeddingConfig.model };
    } catch {
        // Embedding endpoint failure — degrade gracefully to substring matching.
        return substringFallback();
    }
}

// Factory: each MCP client/session needs its own McpServer instance (the SDK
// only allows one connected transport per server). All instances share the
// module-level helpers + AgentFS below. Enables a single long-lived process to
// serve many concurrent clients (centralized AgentFS on the VPS).
function createMemoryServer(): McpServer {
    const server = new McpServer({ name: "cairn-memory", version: "0.1.0" });

server.registerTool(
    "memory_read",
    {
        description: "Read an exact key or search memory entries across AgentFS scopes.",
        // Plain object schema — a .refine() wrapper (ZodEffects) makes the SDK
        // publish an empty JSON Schema, hiding the parameters from clients.
        inputSchema: z.object({
            scope: z.string(),
            key: z.string().optional(),
            query: z.string().optional(),
        }),
        annotations: {
            readOnlyHint: true,
            idempotentHint: true,
        },
    },
    async ({ scope, key, query }) => {
        if (Boolean(key) === Boolean(query)) {
            throw new Error("Provide exactly one of key or query.");
        }
        const config = getMemoryConfig();
        const scopes = getSearchScopes(scope, config);
        const results = key
            ? (await Promise.all(scopes.map((candidate) => readKey(candidate, key)))).flat()
            : searchEntries(
                (await Promise.all(scopes.map((candidate) => listEntries(candidate)))).flat(),
                query ?? "",
            );

        const sorted = results.sort((left, right) => {
            return `${left.scope}:${left.key}`.localeCompare(`${right.scope}:${right.key}`);
        });

        return {
            content: [{ type: "text", text: asToolText(sorted) }],
            structuredContent: { results: sorted },
        };
    },
);

server.registerTool(
    "memory_write",
    {
        description: "Write a memory entry to a scoped AgentFS database and optionally promote it.",
        inputSchema: z.object({
            scope: z.string(),
            key: z.string().min(1),
            value: z.string(),
            promote_to: z.string().optional(),
        }),
    },
    async ({ scope, key, value, promote_to }) => {
        if (isHistoryKey(key)) {
            throw new Error(`Keys under ${HISTORY_NAMESPACE}/ are reserved for memory history.`);
        }

        const targets = promote_to && promote_to !== scope ? [scope, promote_to] : [scope];
        // Collision-safe: in the unified store, writes from different repos/machines
        // can share a key. If a different value already exists, preserve the old one
        // into history before overwriting so no memory is ever lost. Identical-value
        // writes are a no-op. The response surfaces any collision so it can be
        // disambiguated (rename keys, memory_history to recover).
        const collisions: Array<{ scope: string; snapshot_key: string; previous_value: string }> = [];

        for (const target of targets) {
            const agent = await openScope(target, true);
            if (!agent) {
                throw new Error(`Unable to open scope ${target}.`);
            }

            try {
                const previous = await agent.kv.get(key);
                const previousNorm = previous === undefined ? undefined : normalizeValue(previous);
                if (previousNorm !== undefined && previousNorm !== value) {
                    const supersededAt = new Date().toISOString();
                    const snapshotKey = historySnapshotKey(key, supersededAt);
                    await agent.kv.set(snapshotKey, {
                        value: previousNorm,
                        superseded_at: supersededAt,
                        superseded_reason: "collision-safe write in unified store",
                    });
                    collisions.push({ scope: target, snapshot_key: snapshotKey, previous_value: previousNorm });
                }
                await agent.kv.set(key, value);
            } finally {
                await agent.close();
            }
        }

        const payload = { ok: true, scope, key, promote_to, collisions };
        return {
            content: [{ type: "text", text: asToolText(payload) }],
            structuredContent: payload,
        };
    },
);

server.registerTool(
    "memory_list",
    {
        description: "List keys from a scoped AgentFS database.",
        inputSchema: z.object({
            scope: z.string(),
            prefix: z.string().optional(),
        }),
        annotations: {
            readOnlyHint: true,
            idempotentHint: true,
        },
    },
    async ({ scope, prefix }) => {
        const entries = await listEntries(scope, prefix ?? "");
        const keys = entries.map((entry) => entry.key).sort();

        return {
            content: [{ type: "text", text: asToolText(keys) }],
            structuredContent: { keys },
        };
    },
);

server.registerTool(
    "memory_delete",
    {
        description: "Delete a key from a scoped AgentFS database.",
        inputSchema: z.object({
            scope: z.string(),
            key: z.string().min(1),
        }),
    },
    async ({ scope, key }) => {
        const agent = await openScope(scope, false);

        if (agent) {
            try {
                await agent.kv.delete(key);
            } finally {
                await agent.close();
            }
        }

        return {
            content: [{ type: "text", text: asToolText({ ok: true, scope, key }) }],
            structuredContent: { ok: true, scope, key },
        };
    },
);

server.registerTool(
    "memory_search",
    {
        description: "Semantic search across AgentFS memory scopes using the configured embedding endpoint, ranked by cosine similarity. Falls back to substring matching when embeddings are unavailable. Use this to find memory by meaning rather than by exact key.",
        inputSchema: z.object({
            scope: z.string(),
            query: z.string().min(1),
            top_k: z.number().int().min(1).max(50).optional(),
            min_score: z.number().min(0).max(1).optional(),
        }),
        annotations: {
            readOnlyHint: true,
        },
    },
    async ({ scope, query, top_k, min_score }) => {
        const { results, mode, model } = await semanticSearch(
            scope,
            query,
            top_k ?? 8,
            min_score ?? 0,
        );
        const payload = { mode, model, count: results.length, results };

        return {
            content: [{ type: "text", text: asToolText(payload) }],
            structuredContent: payload,
        };
    },
);

server.registerTool(
    "memory_extract",
    {
        description: "Extract durable memory candidates from a session summary or selected text. Review the returned candidates before writing them.",
        inputSchema: z.object({
            scope: z.string(),
            content: z.string().min(1),
            model: z.string().min(1).optional(),
            category: z.enum(["decision", "preference", "pattern", "pitfall", "constraint", "bug", "convention"]).optional(),
        }),
    },
    async ({ scope, content, model, category }) => {
        const extracted = await extractMemoryCandidates(content, model, category);
        const payload = {
            scope,
            model: extracted.model,
            count: extracted.candidates.length,
            candidates: extracted.candidates.map((candidate) => ({ scope, ...candidate })),
        };

        return {
            content: [{ type: "text", text: asToolText(payload) }],
            structuredContent: payload,
        };
    },
);

server.registerTool(
    "memory_supersede",
    {
        description: "Preserve the current value of a memory entry in hidden history, then write a new live value to the base key.",
        inputSchema: z.object({
            scope: z.string(),
            key: z.string().min(1),
            value: z.string(),
            reason: z.string().optional(),
        }),
    },
    async ({ scope, key, value, reason }) => {
        if (isHistoryKey(key)) {
            throw new Error(`Keys under ${HISTORY_NAMESPACE}/ are reserved for memory history.`);
        }

        const agent = await openScope(scope, true);
        if (!agent) {
            throw new Error(`Unable to open scope ${scope}.`);
        }

        try {
            const previous = await agent.kv.get(key);
            if (previous === undefined) {
                await agent.kv.set(key, value);
                const payload = { ok: true, scope, key, created: true, snapshot_key: null };
                return {
                    content: [{ type: "text", text: asToolText(payload) }],
                    structuredContent: payload,
                };
            }

            const supersededAt = new Date().toISOString();
            const snapshotKey = historySnapshotKey(key, supersededAt);
            await agent.kv.set(snapshotKey, {
                value: normalizeValue(previous),
                superseded_at: supersededAt,
                superseded_reason: reason ?? null,
            });
            await agent.kv.set(key, value);

            const payload = {
                ok: true,
                scope,
                key,
                created: false,
                snapshot_key: snapshotKey,
                previous_value: normalizeValue(previous),
            };
            return {
                content: [{ type: "text", text: asToolText(payload) }],
                structuredContent: payload,
            };
        } finally {
            await agent.close();
        }
    },
);

server.registerTool(
    "memory_history",
    {
        description: "Read prior versions of a memory entry from the hidden history namespace.",
        inputSchema: z.object({
            scope: z.string(),
            key: z.string().min(1),
        }),
        annotations: {
            readOnlyHint: true,
            idempotentHint: true,
        },
    },
    async ({ scope, key }) => {
        const current = await readKey(scope, key);
        const history = (await listEntries(scope, historyPrefix(key), { includeHistory: true }))
            .sort((left, right) => left.key.localeCompare(right.key));

        const payload = {
            scope,
            key,
            current: current[0]?.value ?? null,
            history,
        };

        return {
            content: [{ type: "text", text: asToolText(payload) }],
            structuredContent: payload,
        };
    },
);

server.registerTool(
    "domain_knowledge_query",
    {
        description: "Query an AnythingLLM workspace in query mode for domain knowledge.",
        inputSchema: z.object({
            workspace: z.string().min(1),
            query: z.string().min(1),
        }),
        annotations: {
            readOnlyHint: true,
        },
    },
    async ({ workspace, query }) => {
        const answer = await callAnythingLLM(workspace, query);

        return {
            content: [{ type: "text", text: answer }],
            structuredContent: { workspace, answer },
        };
    },
);

server.registerTool(
    "domain_knowledge_sync",
    {
        description: "Upload and embed configured project documentation into an AnythingLLM workspace. Uses anythingllm-projects.json so include/exclude rules are honored. Use mode='replace' with confirm_replace=true when stale workspace docs must be removed before re-embedding.",
        inputSchema: z.object({
            workspace: z.string().min(1).optional(),
            mode: z.enum(["incremental", "full", "replace"]).optional(),
            confirm_replace: z.boolean().optional(),
            timeout_seconds: z.number().int().min(30).max(3600).optional(),
        }),
    },
    async ({ workspace, mode, confirm_replace, timeout_seconds }) => {
        const syncMode = mode ?? "incremental";
        const config = getMemoryConfig();
        const workspaceSlug = workspace ?? defaultAnythingLLMWorkspace(config);

        if (!workspaceSlug) {
            throw new Error("No AnythingLLM workspace provided and no project workspace found in memory config.");
        }

        if (syncMode === "replace" && confirm_replace !== true) {
            throw new Error("mode='replace' removes currently embedded workspace docs. Set confirm_replace=true to proceed.");
        }

        const args = [
            anythingllmSyncScript,
            "--project", workspaceSlug,
        ];

        if (syncMode === "full") {
            args.push("--full");
        } else if (syncMode === "replace") {
            args.push("--replace");
        }

        const result = await runCommand("python3", args, (timeout_seconds ?? 900) * 1000);
        const ok = result.exitCode === 0 && !result.timedOut;

        return {
            content: [{
                type: "text",
                text: asToolText({
                    ok,
                    workspace: workspaceSlug,
                    mode: syncMode,
                    ...result,
                }),
            }],
            structuredContent: {
                ok,
                workspace: workspaceSlug,
                mode: syncMode,
                ...result,
            },
        };
    },
);

    return server;
}

// One-shot CLI: `node dist/index.js wakeup` prints project-scope memory for the
// SessionStart hook. Reads a file-snapshot copy of ./.agentfs/project.db so it
// never contends with a running cairn-memory MCP that holds the exclusive lock
// (AgentFS/Turso uses SQLite locking). Best-effort: silent + exit 0 on any
// error or outside a managed repo, so it is safe to call from anywhere.
const cliCommand = process.argv[2];
if (cliCommand === "wakeup") {
    try {
        const src = resolveScopePath("project");
        if (existsSync(src)) {
            const snapshotDir = mkdtempSync(join(tmpdir(), "wakeup-"));
            const copy = join(snapshotDir, "project.db");
            for (const suffix of ["", "-wal", "-shm"]) {
                if (existsSync(src + suffix)) {
                    copyFileSync(src + suffix, copy + suffix);
                }
            }
            const agent = await AgentFS.open({ id: "project", path: copy });
            try {
                const entries = await agent.kv.list("");
                const visible = entries.filter(({ key }) => !isHistoryKey(key));
                if (visible.length) {
                    // Compact index: key + one-line preview. The agent pulls full
                    // detail on demand with memory_read / memory_search, so this
                    // stays small even when the project DB holds many facts.
                    const lines = visible.map(({ key, value }) => {
                        const preview = normalizeValue(value).replace(/\s+/g, " ").slice(0, 100);
                        return `- ${key}: ${preview}`;
                    });
                    const header = `(${visible.length} project memory facts; use /recall or memory_read for full detail)`;
                    process.stdout.write(truncateOutput([header, ...lines].join("\n"), 4000) + "\n");
                }
            } finally {
                await agent.close();
                rmSync(snapshotDir, { recursive: true, force: true });
            }
        }
    } catch {
        // Best-effort wakeup: never fail a session start over memory retrieval.
    }
    process.exit(0);
}

if (cliCommand === "extract") {
    try {
        const model = process.argv[3]?.trim() || undefined;
        const category = process.argv[4]?.trim() || undefined;
        const content = (await readStdin()).trim();
        if (!content) {
            throw new Error("No input provided on stdin.");
        }

        const extracted = await extractMemoryCandidates(content, model, category);
        output.write(`${JSON.stringify({
            model: extracted.model,
            count: extracted.candidates.length,
            candidates: extracted.candidates,
        }, null, 2)}\n`);
        process.exit(0);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exit(1);
    }
}

const httpPort = parseInt(process.env.MCP_HTTP_PORT ?? "", 10);

if (httpPort > 0) {
    const httpHost = process.env.MCP_HTTP_HOST ?? "127.0.0.1";

    // HTTP mode exposes every memory tool over the network, so it is guarded:
    // a bearer token is mandatory (fail closed), CORS is opt-in per origin, and
    // the Host header is validated to block DNS-rebinding. See docs/operating.md.
    const httpToken = process.env.CAIRN_MEMORY_HTTP_TOKEN?.trim();
    if (!httpToken) {
        process.stderr.write(
            "cairn-memory: HTTP mode requires CAIRN_MEMORY_HTTP_TOKEN — refusing to start an unauthenticated network server.\n",
        );
        process.exit(1);
    }

    const allowedOrigins = (process.env.CAIRN_MEMORY_HTTP_ALLOWED_ORIGINS ?? "")
        .split(",").map((value) => value.trim()).filter(Boolean);
    const configuredHosts = (process.env.CAIRN_MEMORY_HTTP_ALLOWED_HOSTS ?? "")
        .split(",").map((value) => value.trim()).filter(Boolean);
    const allowedHosts = new Set(
        configuredHosts.length > 0
            ? configuredHosts
            : [`${httpHost}:${httpPort}`, `localhost:${httpPort}`, `127.0.0.1:${httpPort}`],
    );

    const tokenMatches = (header: string | undefined): boolean => {
        const prefix = "Bearer ";
        if (!header || !header.startsWith(prefix)) {
            return false;
        }
        const provided = Buffer.from(header.slice(prefix.length));
        const expected = Buffer.from(httpToken);
        // Length check first: timingSafeEqual throws on length mismatch.
        return provided.length === expected.length && timingSafeEqual(provided, expected);
    };
    const originAllowed = (origin: string | undefined): string | null =>
        origin && allowedOrigins.includes(origin) ? origin : null;

    // Session-based streamable HTTP: one transport per session, keyed by the
    // mcp-session-id header the client sends after initialize. This is how real
    // remote MCP servers work (e.g. context7). Lets a long-lived process serve
    // many clients/sessions against one AgentFS store.
    const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

    const handleWeb = async (request: Request): Promise<Response> => {
        const sessionId = request.headers.get("mcp-session-id") ?? undefined;
        const existing = sessionId ? sessions.get(sessionId) : undefined;
        if (existing) {
            return existing.handleRequest(request);
        }
        // New session (first request = initialize). The transport mints a session
        // id and the SDK returns it via the response header; client echoes it back.
        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: (): string => randomUUID(),
            onsessioninitialized: (id: string): void => { sessions.set(id, transport); },
            onsessionclosed: (id: string): void => { sessions.delete(id); },
        });
        const session = createMemoryServer();
        await session.connect(transport);
        return transport.handleRequest(request);
    };

    const httpServer = createServer(async (req, res) => {
        const allowOrigin = originAllowed(req.headers.origin);
        if (allowOrigin) {
            res.setHeader("Access-Control-Allow-Origin", allowOrigin);
            res.setHeader("Vary", "Origin");
            res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type, mcp-session-id, Accept, Authorization");
        }
        if (req.method === "OPTIONS") { res.writeHead(allowOrigin ? 204 : 403).end(); return; }

        // DNS-rebinding protection: only serve requests whose Host we expect.
        if (!req.headers.host || !allowedHosts.has(req.headers.host)) {
            res.writeHead(403).end("host not allowed");
            return;
        }
        // Authentication: a valid bearer token is mandatory on every request.
        if (!tokenMatches(req.headers.authorization)) {
            res.writeHead(401, { "WWW-Authenticate": "Bearer" }).end("unauthorized");
            return;
        }
        try {
            const headers = new Headers(req.headers as Record<string, string>);
            let body: BodyInit | null = null;
            if (req.method !== "GET" && req.method !== "DELETE") {
                const chunks: Buffer[] = [];
                for await (const chunk of req) chunks.push(chunk as Buffer);
                body = Buffer.concat(chunks);
            }
            const request = new Request(`http://${req.headers.host}${req.url}`, {
                method: req.method!,
                headers,
                body,
            });
            const response = await handleWeb(request);
            const outHeaders: Record<string, string> = {};
            response.headers.forEach((v: string, k: string) => { outHeaders[k] = v; });
            res.writeHead(response.status, outHeaders);
            res.end(Buffer.from(await response.arrayBuffer()));
        } catch (err) {
            res.writeHead(500).end(err instanceof Error ? err.message : String(err));
        }
    });

    httpServer.listen(httpPort, httpHost, () => {
        process.stderr.write(`cairn-memory MCP (streamable HTTP) listening on ${httpHost}:${httpPort}\n`);
    });
    process.on("SIGINT", async () => { httpServer.close(); for (const t of sessions.values()) { await t.close(); } process.exit(0); });
} else {
    const server = createMemoryServer();
    const transport = new StdioServerTransport();
    process.on("SIGINT", async () => {
        await server.close();
        process.exit(0);
    });
    await server.connect(transport);
}
