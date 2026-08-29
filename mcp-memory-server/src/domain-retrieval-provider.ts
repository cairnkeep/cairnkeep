import { isIP } from "node:net";

export type DomainRetrievalProvider = "anythingllm" | "openviking";

type Environment = Record<string, string | undefined>;

export type DomainKnowledgeQuery = {
    workspace: string;
    query: string;
    remote?: boolean;
    env?: Environment;
};

const OPENVIKING_RESPONSE_LIMIT = 1024 * 1024;
const OPENVIKING_DEFAULT_TIMEOUT_MS = 30_000;
const OPENVIKING_MAX_TIMEOUT_MS = 120_000;

export function resolveDomainRetrievalProvider(
    env: Environment = process.env,
): DomainRetrievalProvider {
    const configured = env.CAIRN_DOMAIN_RETRIEVAL_PROVIDER?.trim() || "anythingllm";
    if (configured === "anythingllm" || configured === "openviking") return configured;
    throw new Error(
        "CAIRN_DOMAIN_RETRIEVAL_PROVIDER must be either 'anythingllm' or 'openviking'.",
    );
}

function isLoopbackHostname(hostname: string): boolean {
    const normalized = hostname.startsWith("[") && hostname.endsWith("]")
        ? hostname.slice(1, -1)
        : hostname;
    if (normalized === "localhost" || normalized === "::1") return true;
    if (isIP(normalized) !== 4) return false;
    return normalized.split(".")[0] === "127";
}

function openVikingEndpoint(env: Environment): URL {
    const configured = env.CAIRN_OPENVIKING_BASE_URL?.trim();
    if (!configured) {
        throw new Error("OpenViking base URL is not set; configure CAIRN_OPENVIKING_BASE_URL.");
    }

    let url: URL;
    try {
        url = new URL(configured);
    } catch {
        throw new Error("OpenViking base URL must be a valid HTTP(S) URL.");
    }
    if (url.username || url.password) {
        throw new Error("OpenViking base URL must not contain embedded credentials.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("OpenViking base URL must use HTTP or HTTPS.");
    }
    if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
        throw new Error("OpenViking base URL must use HTTPS unless it targets a loopback host.");
    }
    if (url.search || url.hash) {
        throw new Error("OpenViking base URL must not contain a query string or fragment.");
    }

    url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/v1/search/find`;
    return url;
}

function openVikingTimeout(env: Environment): number {
    const raw = env.CAIRN_OPENVIKING_TIMEOUT_MS?.trim();
    if (!raw) return OPENVIKING_DEFAULT_TIMEOUT_MS;
    const timeout = Number(raw);
    if (!Number.isInteger(timeout) || timeout < 100 || timeout > OPENVIKING_MAX_TIMEOUT_MS) {
        throw new Error(
            `CAIRN_OPENVIKING_TIMEOUT_MS must be an integer from 100 to ${OPENVIKING_MAX_TIMEOUT_MS}.`,
        );
    }
    return timeout;
}

function openVikingTargetUri(workspace: string): string {
    if (!workspace.startsWith("viking://")) {
        return `viking://resources/${encodeURIComponent(workspace)}`;
    }
    if (
        workspace !== "viking://resources"
        && !/^viking:\/\/resources\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(workspace)
    ) {
        throw new Error("OpenViking workspace URI must stay below viking://resources.");
    }
    const path = workspace.slice("viking://resources".length);
    let decoded: string;
    try {
        decoded = decodeURIComponent(path);
    } catch {
        throw new Error("OpenViking workspace URI contains invalid percent encoding.");
    }
    if (decoded.split("/").some((segment) => segment === "." || segment === "..")) {
        throw new Error("OpenViking workspace URI must not contain traversal segments.");
    }
    return workspace;
}

async function boundedResponseText(response: Response): Promise<string> {
    const advertisedLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(advertisedLength) && advertisedLength > OPENVIKING_RESPONSE_LIMIT) {
        throw new Error("OpenViking response is too large.");
    }
    if (!response.body) return "";

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > OPENVIKING_RESPONSE_LIMIT) {
            await reader.cancel();
            throw new Error("OpenViking response is too large.");
        }
        chunks.push(value);
    }
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(joined);
}

async function callAnythingLLM(
    workspace: string,
    query: string,
    env: Environment,
): Promise<string> {
    const apiKey = env.ANYTHINGLLM_API_KEY;
    if (!apiKey) {
        throw new Error("ANYTHINGLLM_API_KEY is not set.");
    }

    const baseUrl = env.ANYTHINGLLM_BASE_URL ?? "http://localhost:3001";
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

type OpenVikingResource = {
    context_type?: "resource";
    uri: string;
    level?: number;
    score?: number;
    category?: string;
    match_reason?: string;
    abstract: string;
    overview?: string | null;
};

function parseOpenVikingResult(text: string): { resources: OpenVikingResource[]; total: number } {
    let payload: unknown;
    try {
        payload = JSON.parse(text);
    } catch {
        throw new Error("OpenViking response is not valid JSON.");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("OpenViking response does not contain a useful retrieval payload.");
    }
    const envelope = payload as Record<string, unknown>;
    const result = envelope.result;
    if (
        envelope.status !== "ok"
        || !result
        || typeof result !== "object"
        || Array.isArray(result)
    ) {
        throw new Error("OpenViking response does not contain a useful retrieval payload.");
    }
    const candidate = result as Record<string, unknown>;
    if (!Array.isArray(candidate.resources) || !Number.isInteger(candidate.total) || Number(candidate.total) < 0) {
        throw new Error("OpenViking response does not contain a useful retrieval payload.");
    }
    const resources: OpenVikingResource[] = [];
    for (const resource of candidate.resources) {
        if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
            throw new Error("OpenViking response does not contain a useful retrieval payload.");
        }
        const item = resource as Record<string, unknown>;
        if (
            typeof item.uri !== "string"
            || (item.uri !== "viking://resources" && !item.uri.startsWith("viking://resources/"))
            || typeof item.abstract !== "string"
            || (item.context_type !== undefined && item.context_type !== "resource")
            || (item.level !== undefined && (!Number.isInteger(item.level) || Number(item.level) < 0 || Number(item.level) > 2))
            || (item.score !== undefined && (typeof item.score !== "number" || !Number.isFinite(item.score)))
            || (item.category !== undefined && typeof item.category !== "string")
            || (item.match_reason !== undefined && typeof item.match_reason !== "string")
            || (item.overview !== undefined && item.overview !== null && typeof item.overview !== "string")
        ) {
            throw new Error("OpenViking response does not contain a useful retrieval payload.");
        }
        resources.push({
            ...(item.context_type === "resource" ? { context_type: item.context_type } : {}),
            uri: item.uri,
            ...(item.level !== undefined ? { level: Number(item.level) } : {}),
            ...(item.score !== undefined ? { score: Number(item.score) } : {}),
            ...(typeof item.category === "string" ? { category: item.category } : {}),
            ...(typeof item.match_reason === "string" ? { match_reason: item.match_reason } : {}),
            abstract: item.abstract,
            ...(item.overview === null || typeof item.overview === "string" ? { overview: item.overview } : {}),
        });
    }
    if (Number(candidate.total) < resources.length) {
        throw new Error("OpenViking response does not contain a useful retrieval payload.");
    }
    return { resources, total: Number(candidate.total) };
}

async function callOpenViking(
    workspace: string,
    query: string,
    remote: boolean,
    env: Environment,
): Promise<string> {
    if (env.CAIRN_OPENVIKING !== "1") {
        throw new Error("OpenViking retrieval requires CAIRN_OPENVIKING=1.");
    }
    if (remote && env.CAIRN_OPENVIKING_MCP_HTTP !== "1") {
        throw new Error("Remote OpenViking retrieval requires CAIRN_OPENVIKING_MCP_HTTP=1.");
    }

    const endpoint = openVikingEndpoint(env);
    const timeout = openVikingTimeout(env);
    const apiKey = (env.CAIRN_OPENVIKING_API_KEY ?? env.OPENVIKING_API_KEY)?.trim();
    let response: Response;
    try {
        response = await fetch(endpoint, {
            method: "POST",
            headers: {
                ...(apiKey ? { "X-API-Key": apiKey } : {}),
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                query,
                target_uri: openVikingTargetUri(workspace),
                context_type: ["resource"],
                limit: 10,
            }),
            redirect: "manual",
            signal: AbortSignal.timeout(timeout),
        });
    } catch (error) {
        if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
            throw new Error("OpenViking request timed out.");
        }
        throw new Error(`OpenViking request failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (response.status >= 300 && response.status < 400) {
        throw new Error(`OpenViking request refused redirect status ${response.status}.`);
    }
    if (!response.ok) {
        throw new Error(`OpenViking request failed with ${response.status}.`);
    }
    if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
        throw new Error("OpenViking response is not JSON.");
    }

    let text: string;
    try {
        text = await boundedResponseText(response);
    } catch (error) {
        if (error instanceof TypeError) throw new Error("OpenViking response is not valid UTF-8.");
        throw error;
    }
    return JSON.stringify(parseOpenVikingResult(text), null, 2);
}

export async function queryDomainKnowledge({
    workspace,
    query,
    remote = false,
    env = process.env,
}: DomainKnowledgeQuery): Promise<string> {
    const provider = resolveDomainRetrievalProvider(env);
    if (provider === "anythingllm") return callAnythingLLM(workspace, query, env);
    return callOpenViking(workspace, query, remote, env);
}
