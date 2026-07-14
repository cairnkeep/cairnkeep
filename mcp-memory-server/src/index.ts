import { execFileSync, spawn } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
import {
    type ExploreEvidence,
    computeRepoState,
    exploreCacheKey,
    normalizeExploreQuery,
    readExploreCache,
    writeExploreCache,
} from "./explore-cache.js";

const MINIMUM_NODE_MAJOR = 22;
const nodeMajor = Number.parseInt(process.versions.node, 10);
if (!Number.isInteger(nodeMajor) || nodeMajor < MINIMUM_NODE_MAJOR) {
    process.stderr.write(
        `cairn-memory requires Node.js ${MINIMUM_NODE_MAJOR} or newer; found ${process.versions.node}\n`,
    );
    process.exit(1);
}

type MemoryConfig = {
    scopes?: string[];
    anythingllm_workspaces?: string[];
};

type ServerContext = {
    projectId?: string;
    memoryConfig?: MemoryConfig;
};

class ClientContextError extends Error {}

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
// Path to the bundled deployment-neutral sync script. An overlay can replace it
// with a deployment-specific implementation.
const anythingllmSyncScript = process.env.CAIRN_ANYTHINGLLM_SYNC_SCRIPT
    ? resolve(expandHome(process.env.CAIRN_ANYTHINGLLM_SYNC_SCRIPT))
    : join(infraRoot, "examples", "anythingllm", "sync_to_anythingllm.py");
const HISTORY_NAMESPACE = "__history__";
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const WORKSPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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
    if (scope === "project") {
        return;
    }
    if (!SCOPE_PATTERN.test(scope)) {
        throw new Error(
            `Invalid scope "${scope}": must be kebab-case (^[a-z0-9][a-z0-9-]*$), "project", or "all".`,
        );
    }
}

function parseHeaderList(
    headers: Headers,
    name: string,
    validate: (value: string) => boolean,
): string[] | undefined {
    const raw = headers.get(name)?.trim();
    if (!raw) {
        return undefined;
    }
    if (raw.length > 4096) {
        throw new ClientContextError(`${name} is too long.`);
    }

    const values = Array.from(new Set(raw.split(",").map((value) => value.trim()).filter(Boolean)));
    if (values.length > 32 || values.some((value) => !validate(value))) {
        throw new ClientContextError(`${name} contains an invalid value.`);
    }
    return values;
}

function parseServerContext(headers: Headers): ServerContext {
    const rawProjectId = headers.get("x-cairn-project")?.trim();
    if (rawProjectId && !PROJECT_ID_PATTERN.test(rawProjectId)) {
        throw new ClientContextError("X-Cairn-Project must be a kebab-case identifier of at most 64 characters.");
    }

    const scopes = parseHeaderList(
        headers,
        "X-Cairn-Scopes",
        (value) => value !== "all" && (value === "project" || SCOPE_PATTERN.test(value)),
    );
    const anythingllmWorkspaces = parseHeaderList(
        headers,
        "X-Cairn-AnythingLLM-Workspaces",
        (value) => WORKSPACE_PATTERN.test(value),
    );
    const memoryConfig = scopes || anythingllmWorkspaces
        ? {
            scopes: scopes ?? ["identity"],
            anythingllm_workspaces: anythingllmWorkspaces ?? [],
        }
        : undefined;

    return {
        projectId: rawProjectId || undefined,
        memoryConfig,
    };
}

function resolveScopePath(
    scope: string,
    options: { cwd?: string; projectId?: string } = {},
): string {
    if (scope === "project") {
        if (options.projectId) {
            return resolve(getBaseDir(), "projects", `${options.projectId}.db`);
        }
        return resolve(options.cwd ?? process.cwd(), ".agentfs", "project.db");
    }

    // "all" is a read-only virtual scope: memory_read/memory_search fan it out
    // over the configured scopes (via getSearchScopes) before resolving. It has
    // no db file of its own, so resolving it directly — which only the write,
    // list, delete, supersede, and history paths do — is a bug: it would create
    // or read a literal `all.db` invisible to the fan-out readers. Reject it.
    if (scope === "all") {
        throw new Error(
            'Scope "all" fans out over configured scopes for reads only (memory_read / memory_search); '
                + "name a concrete scope for writes, lists, deletes, supersedes, and history.",
        );
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

async function openScope(
    scope: string,
    create: boolean,
    options: { cwd?: string; projectId?: string } = {},
): Promise<AgentFS | null> {
    const dbPath = resolveScopePath(scope, options);

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
    options: { includeHistory?: boolean; cwd?: string; projectId?: string } = {},
): Promise<MemoryEntry[]> {
    const agent = await openScope(scope, false, options);

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

async function readKey(
    scope: string,
    key: string,
    options: { projectId?: string } = {},
): Promise<MemoryEntry[]> {
    const agent = await openScope(scope, false, options);

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

async function runCommand(
    command: string,
    args: string[],
    timeoutMs: number,
    env: NodeJS.ProcessEnv = process.env,
): Promise<CommandResult> {
    return new Promise((resolvePromise, reject) => {
        const child = spawn(command, args, {
            cwd: infraRoot,
            env,
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

function embeddingCachePath(scope: string, projectId?: string): string {
    return join(getBaseDir(), ".embeddings", `${hashText(resolveScopePath(scope, { projectId }))}.json`);
}

async function semanticSearch(
    scope: string,
    query: string,
    topK: number,
    minScore: number,
    config: MemoryConfig = getMemoryConfig(),
    projectId?: string,
): Promise<{ results: ScoredEntry[]; mode: "semantic" | "substring"; model?: string }> {
    const scopes = getSearchScopes(scope, config);
    const embeddingConfig = getEmbeddingConfig();

    const perScopeEntries = await Promise.all(
        scopes.map(async (candidate) => ({
            scope: candidate,
            entries: await listEntries(candidate, "", { projectId }),
        })),
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
            const cache = new EmbeddingCache(embeddingCachePath(group.scope, projectId), embeddingConfig.model);
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

// Confines a candidate wiki source file to inside `<repoRoot>/.planning/wiki/sources`
// via relative()-based containment (Phase 2 SEC-0001 idiom, reused from
// opencode/plugins/memory-recall.ts) — `resolve() === join()` misses `../`
// traversal, so this checks the relative path instead.
function isContained(baseDir: string, candidate: string): boolean {
    const rel = relative(baseDir, candidate);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

const CROSSREF_MIN_STEM_LENGTH = 4;

// Basename minus extension, lowercased. Mirrors memory-recall.sh's stem
// derivation (Security V12): a citation path is used ONLY to derive this
// search token, never concatenated into a filesystem read path.
function citationStem(citationPath: string): string {
    const base = citationPath.split("/").pop() ?? citationPath;
    const dot = base.lastIndexOf(".");
    return (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
}

type EnrichedCitation = ExploreEvidence["citations"][number] & {
    memory_refs?: string[];
    wiki_refs?: string[];
};

// Cross-ref enrichment (D-01/D-02/D-04, CTX-08): per-citation deterministic
// stem match against the EXPLORED repo's project memory + wiki -- never the
// server's own cwd (Pitfall 2, hence the cwd passthrough into listEntries).
// Wrapped end-to-end in try/catch: any failure (missing db, missing wiki
// dir, read error) returns the citations unchanged with no refs -- fail-open,
// never degrades or fails the exploration result itself.
async function crossReferenceCitations(
    citations: ExploreEvidence["citations"],
    repoRoot: string,
): Promise<EnrichedCitation[]> {
    try {
        const stemByPath = new Map<string, string>();
        for (const citation of citations) {
            const stem = citationStem(citation.path);
            if (stem.length >= CROSSREF_MIN_STEM_LENGTH) {
                stemByPath.set(citation.path, stem);
            }
        }

        if (stemByPath.size === 0) {
            return citations;
        }

        let memoryEntries: MemoryEntry[] = [];
        try {
            memoryEntries = await listEntries("project", "", { cwd: repoRoot });
        } catch {
            memoryEntries = [];
        }

        let wikiPages: Array<{ name: string; content: string }> = [];
        try {
            const wikiDir = join(repoRoot, ".planning", "wiki", "sources");
            wikiPages = readdirSync(wikiDir)
                .filter((name) => name.endsWith(".md"))
                .map((name) => join(wikiDir, name))
                .filter((fullPath) => isContained(wikiDir, fullPath))
                .map((fullPath) => ({ name: fullPath.split("/").pop() as string, content: readFileSync(fullPath, "utf8") }));
        } catch {
            wikiPages = [];
        }

        return citations.map((citation): EnrichedCitation => {
            const stem = stemByPath.get(citation.path);
            if (!stem) {
                return citation;
            }

            const memoryRefs = memoryEntries
                .filter((entry) => entry.key.toLowerCase().includes(stem) || entry.value.toLowerCase().includes(stem))
                .map((entry) => entry.key);
            const wikiRefs = wikiPages
                .filter((page) => page.name.toLowerCase().includes(stem) || page.content.toLowerCase().includes(stem))
                .map((page) => page.name);

            const enriched: EnrichedCitation = { ...citation };
            if (memoryRefs.length > 0) {
                enriched.memory_refs = memoryRefs;
            }
            if (wikiRefs.length > 0) {
                enriched.wiki_refs = wikiRefs;
            }
            return enriched;
        });
    } catch {
        return citations;
    }
}

// Compact marker appended to a citation's rendered line only when it has at
// least one memory or wiki ref (D-03) -- a ref-less citation's rendering is
// byte-for-byte unchanged from the pre-phase output.
function renderCrossRefMarker(memoryRefs?: string[], wikiRefs?: string[]): string {
    const parts: string[] = [];
    if (memoryRefs && memoryRefs.length > 0) {
        parts.push(`memory: ${memoryRefs.join(", ")}`);
    }
    if (wikiRefs && wikiRefs.length > 0) {
        parts.push(`wiki: ${wikiRefs.join(", ")}`);
    }
    return parts.length > 0 ? ` <- ${parts.join(" - ")}` : "";
}

// Compact citation rendering (D-02): reduce the full Evidence.citations array
// to the lean `path:start-end` text list — the actual token-economy payoff of
// this tool. Empty citations from a successful run are first-class (D-04),
// never conflated with failure; surface turns/tool_calls for transparency
// (Pitfall #1 — an unreachable-but-configured endpoint looks identical).
function renderCitations(evidence: {
    citations: Array<{ path: string; start_line: number; end_line: number; memory_refs?: string[]; wiki_refs?: string[] }>;
    stats: { turns: number; tool_calls: number };
}): string {
    if (evidence.citations.length === 0) {
        return `(no citations found; turns=${evidence.stats.turns}, ` +
            `tool_calls=${evidence.stats.tool_calls})`;
    }
    return evidence.citations
        .map((c) => `${c.path}:${c.start_line}-${c.end_line}${renderCrossRefMarker(c.memory_refs, c.wiki_refs)}`)
        .join("\n");
}

// Shared handler body for context_explore (D-06): both the registered MCP
// tool callback and the `explore` CLI subcommand call this, so cache (CTX-10)
// behaves identically from either invocation path. `repoRoot` passed in is
// ALREADY the resolved absolute path -- callers own resolving repo_root from
// their own param/env/cwd conventions before calling this.
async function runContextExplore(args: {
    query: string;
    repoRoot: string;
    timeoutSeconds?: number;
}): Promise<{ payload: Record<string, unknown>; text: string }> {
    const { query, repoRoot, timeoutSeconds } = args;

    // --- Precondition tier: throw (config/environment problems, D-04) ---
    const binaryPath = process.env.CAIRN_EXPLORE_BINARY;
    if (!binaryPath) {
        throw new Error("CAIRN_EXPLORE_BINARY is not set.");
    }
    if (!existsSync(binaryPath)) {
        throw new Error(`CAIRN_EXPLORE_BINARY does not exist: ${binaryPath}`);
    }
    if (!existsSync(repoRoot)) {
        throw new Error(`repo_root does not exist: ${repoRoot}`);
    }

    // --- Cache check (D-09/CTX-10): wraps the spawn, BEFORE it happens.
    // CAIRN_EXPLORE_CACHE=0 is the kill-switch (always spawn, cached:false).
    // Cache key/read/write errors fail open to a normal spawn -- never throw
    // into the execution tier below.
    const cacheEnabled = process.env.CAIRN_EXPLORE_CACHE !== "0";
    let probe: { key: string; head: string; dirtyHash: string } | undefined;
    if (cacheEnabled) {
        try {
            const normalizedQuery = normalizeExploreQuery(query);
            const { head, dirtyHash } = computeRepoState(repoRoot);
            probe = { key: exploreCacheKey(normalizedQuery, repoRoot, head, dirtyHash), head, dirtyHash };
        } catch {
            probe = undefined;
        }
    }

    let evidence: ExploreEvidence | undefined;
    let cached = false;
    if (probe) {
        const hit = readExploreCache(probe.key);
        if (hit) {
            evidence = hit.evidence;
            cached = true;
        }
    }

    // --- Execution tier: return { ok: false, ... } (runtime problems, D-04) ---
    if (!evidence) {
        const result = await runCommand(
            binaryPath,
            ["explore", "--query", query, "--repo-root", repoRoot],
            (timeoutSeconds ?? 120) * 1000,
            { ...process.env, NO_COLOR: "1" },
        );

        if (result.timedOut || result.exitCode !== 0) {
            const payload = {
                ok: false,
                error: result.timedOut
                    ? "token_miser explore timed out"
                    : "token_miser explore exited non-zero",
                stderr: result.stderr,
                exitCode: result.exitCode,
                timedOut: result.timedOut,
            };
            return { payload, text: asToolText(payload) };
        }

        try {
            evidence = JSON.parse(result.stdout.trim());
        } catch {
            const payload = {
                ok: false,
                error: "malformed Evidence JSON",
                stderr: result.stderr,
                exitCode: result.exitCode,
            };
            return { payload, text: asToolText(payload) };
        }

        if (probe) {
            writeExploreCache(probe.key, {
                createdAt: new Date().toISOString(),
                query: normalizeExploreQuery(query),
                repoRoot,
                head: probe.head,
                dirtyHash: probe.dirtyHash,
                evidence: evidence as ExploreEvidence,
            });
        }
    }

    // --- Success shaping (D-02 dual output; cached flag per CTX-10) ---
    // By this point evidence is always assigned: either a cache hit set it
    // above, or the execution tier above returned early on failure.
    const finalEvidence = evidence as ExploreEvidence;

    // --- Cross-ref enrichment (D-01/D-12, CTX-08): recomputed on EVERY
    // return, cache hit and cache miss alike, since memory/wiki evolve
    // independently of repo HEAD. Never part of the cached entry (D-12) --
    // only the raw evidence above was written to cache.
    const enrichedCitations = await crossReferenceCitations(finalEvidence.citations, repoRoot);

    const payload = { ok: true, ...finalEvidence, citations: enrichedCitations, cached };
    return { payload, text: renderCitations({ citations: enrichedCitations, stats: finalEvidence.stats }) };
}

// Resolves the repo root for the `explore` CLI subcommand when
// CAIRN_EXPLORE_REPO_ROOT is unset -- mirrors `git rev-parse --show-toplevel`,
// argv-array only (V5), never a shell string.
function gitToplevel(cwd: string): string {
    // stdio ignores the child's stderr so a non-git cwd doesn't leak git's
    // "fatal: not a git repository" diagnostic onto the server's own stderr;
    // the caller's try/catch already surfaces a clean error message instead.
    return execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
    }).trim();
}

// Factory: each MCP client/session needs its own McpServer instance (the SDK
// only allows one connected transport per server). All instances share the
// module-level helpers + AgentFS below. Enables a single long-lived process to
// serve many concurrent clients within one trusted server-side storage domain.
function createMemoryServer(context: ServerContext = {}): McpServer {
    const server = new McpServer({ name: "cairn-memory", version: "0.1.0" });
    const memoryConfig = (): MemoryConfig => context.memoryConfig ?? getMemoryConfig();
    const scopeOptions = { projectId: context.projectId };

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
        const config = memoryConfig();
        const scopes = getSearchScopes(scope, config);
        const results = key
            ? (await Promise.all(scopes.map((candidate) => readKey(candidate, key, scopeOptions)))).flat()
            : searchEntries(
                (await Promise.all(scopes.map((candidate) => listEntries(candidate, "", scopeOptions)))).flat(),
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
            const agent = await openScope(target, true, scopeOptions);
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
        const entries = await listEntries(scope, prefix ?? "", scopeOptions);
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
        const agent = await openScope(scope, false, scopeOptions);

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
            memoryConfig(),
            context.projectId,
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

        const agent = await openScope(scope, true, scopeOptions);
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
        const current = await readKey(scope, key, scopeOptions);
        const history = (await listEntries(scope, historyPrefix(key), {
            includeHistory: true,
            ...scopeOptions,
        }))
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
            workspace: z.string().min(1).optional(),
            query: z.string().min(1),
        }),
        annotations: {
            readOnlyHint: true,
        },
    },
    async ({ workspace, query }) => {
        const workspaceSlug = workspace ?? defaultAnythingLLMWorkspace(memoryConfig());
        if (!workspaceSlug) {
            throw new Error("No AnythingLLM workspace provided and no project workspace found in memory config.");
        }
        const answer = await callAnythingLLM(workspaceSlug, query);

        return {
            content: [{ type: "text", text: answer }],
            structuredContent: { workspace: workspaceSlug, answer },
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
        const config = memoryConfig();
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

server.registerTool(
    "context_explore",
    {
        description: "Delegate a natural-language repo-exploration query to the external token_miser explore binary (FastContext-backed). Returns compact path:line-range citations. Requires CAIRN_EXPLORE_BINARY (absolute path to the token_miser binary) and a repo_root (per-call param or CAIRN_EXPLORE_REPO_ROOT env). Thin adapter — token_miser owns all exploration logic.",
        inputSchema: z.object({
            query: z.string().min(1),
            repo_root: z.string().min(1).optional(),
            timeout_seconds: z.number().int().min(10).max(600).optional(),
        }),
    },
    async ({ query, repo_root, timeout_seconds }) => {
        // repo_root resolution stays here (tool-specific: per-call param vs
        // CAIRN_EXPLORE_REPO_ROOT env) -- runContextExplore receives an
        // already-resolved absolute path and owns the shared precondition/
        // execution/cache tiers (D-06).
        const rawRoot = repo_root ?? process.env.CAIRN_EXPLORE_REPO_ROOT;
        if (!rawRoot) {
            throw new Error(
                "No repo_root provided and CAIRN_EXPLORE_REPO_ROOT is not set.",
            );
        }
        // Always resolve to an ABSOLUTE path before it crosses the process
        // boundary (Pitfall #3, D-01) — a relative repo_root would resolve
        // against runCommand's hardcoded cwd (infraRoot), not the caller's intent.
        const resolvedRoot = resolve(expandHome(rawRoot));

        const { payload, text } = await runContextExplore({
            query,
            repoRoot: resolvedRoot,
            timeoutSeconds: timeout_seconds,
        });

        return {
            content: [{ type: "text", text }],
            structuredContent: payload,
        };
    },
);

server.registerTool(
    "route_check",
    {
        description: "Check reachability of the external token_miser routing/tiering proxy via its /health endpoint. Requires CAIRN_ROUTE_ENDPOINT (base URL of an already-running token_miser instance). Thin adapter — token_miser owns all routing/tiering logic; this tool neither hosts a proxy nor learns which tier serves a request.",
        inputSchema: z.object({
            timeout_seconds: z.number().int().min(1).max(60).optional(),
        }),
    },
    async ({ timeout_seconds }) => {
        // --- Precondition tier: throw ---
        const rawEndpoint = process.env.CAIRN_ROUTE_ENDPOINT;
        if (!rawEndpoint) {
            throw new Error("CAIRN_ROUTE_ENDPOINT is not set.");
        }
        let endpoint: URL;
        try {
            endpoint = new URL(rawEndpoint);
        } catch {
            throw new Error(`CAIRN_ROUTE_ENDPOINT is not a valid URL: ${rawEndpoint}`);
        }
        const base = endpoint.toString().replace(/\/+$/, "");

        // --- Execution tier: return { ok: false, ... } ---
        let response: Response;
        try {
            response = await fetch(`${base}/health`, {
                signal: AbortSignal.timeout((timeout_seconds ?? 10) * 1000),
            });
        } catch (e) {
            const payload = {
                ok: false,
                error: e instanceof Error && e.name === "TimeoutError"
                    ? "token_miser /health timed out"
                    : "token_miser /health request failed",
                detail: e instanceof Error ? e.message : String(e),
            };
            return { content: [{ type: "text", text: asToolText(payload) }], structuredContent: payload };
        }

        if (!response.ok) {
            const payload = { ok: false, error: "token_miser /health returned non-2xx", status: response.status };
            return { content: [{ type: "text", text: asToolText(payload) }], structuredContent: payload };
        }

        let body: { status?: string; cluster_healthy?: boolean | null };
        try {
            body = await response.json();
        } catch {
            const payload = { ok: false, error: "malformed /health JSON" };
            return { content: [{ type: "text", text: asToolText(payload) }], structuredContent: payload };
        }

        const payload = { ok: true, status: body.status, cluster_healthy: body.cluster_healthy ?? null };
        return { content: [{ type: "text", text: asToolText(payload) }], structuredContent: payload };
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

// One-shot CLI: `node dist/index.js explore "<query>"` runs the SAME
// runContextExplore path as the MCP tool handler (D-06) -- a pre-task hook
// invokes this without an MCP session. Short internal timeout (well inside a
// hook's own budget) so a cache-miss query never outlives the caller's patience.
if (cliCommand === "explore") {
    try {
        const query = process.argv[3];
        if (!query) {
            throw new Error('Usage: node dist/index.js explore "<query>"');
        }
        const rawRoot = process.env.CAIRN_EXPLORE_REPO_ROOT;
        const repoRoot = rawRoot ? resolve(expandHome(rawRoot)) : gitToplevel(process.cwd());
        const { payload } = await runContextExplore({ query, repoRoot, timeoutSeconds: 20 });
        process.stdout.write(`${JSON.stringify(payload)}\n`);
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
        const context = parseServerContext(request.headers);
        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: (): string => randomUUID(),
            onsessioninitialized: (id: string): void => { sessions.set(id, transport); },
            onsessionclosed: (id: string): void => { sessions.delete(id); },
        });
        const session = createMemoryServer(context);
        await session.connect(transport);
        return transport.handleRequest(request);
    };

    const httpServer = createServer(async (req, res) => {
        const allowOrigin = originAllowed(req.headers.origin);
        if (allowOrigin) {
            res.setHeader("Access-Control-Allow-Origin", allowOrigin);
            res.setHeader("Vary", "Origin");
            res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
            res.setHeader(
                "Access-Control-Allow-Headers",
                "Content-Type, mcp-session-id, Accept, Authorization, X-Cairn-Project, X-Cairn-Scopes, X-Cairn-AnythingLLM-Workspaces",
            );
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
            const status = err instanceof ClientContextError ? 400 : 500;
            res.writeHead(status).end(err instanceof Error ? err.message : String(err));
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
