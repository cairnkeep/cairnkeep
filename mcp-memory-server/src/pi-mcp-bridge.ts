import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

export type CairnPiBridgeState = "idle" | "starting" | "ready" | "closing" | "closed";

export type CairnPiDiscoveredTool = Tool;

export type CairnPiCallContent =
    | { type: "text"; text: string; annotations?: unknown; _meta?: Record<string, unknown> }
    | { type: "image"; data: string; mimeType: string; annotations?: unknown; _meta?: Record<string, unknown> };

export type CairnPiCallDetails = {
    tool: CairnPiDiscoveredTool;
    annotations: CairnPiDiscoveredTool["annotations"];
    outputSchema: CairnPiDiscoveredTool["outputSchema"];
    content: CallToolResult["content"];
    structuredContent: CallToolResult["structuredContent"];
    isError: boolean;
    _meta?: Record<string, unknown>;
};

export type CairnPiCallResult = {
    content: CairnPiCallContent[];
    details: CairnPiCallDetails;
};

export type CairnPiBridgeOptions = {
    command?: string;
    args?: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    startupTimeoutMs?: number;
    callTimeoutMs?: number;
    stderrLimitBytes?: number;
    resultLimitBytes?: number;
    onSpawn?: (child: { pid?: number }) => void;
};

export type CairnPiBridge = {
    readonly state: CairnPiBridgeState;
    listAllTools(): Promise<CairnPiDiscoveredTool[]>;
    call(
        tool: CairnPiDiscoveredTool,
        args: Record<string, unknown>,
        options?: { signal?: AbortSignal },
    ): Promise<CairnPiCallResult>;
    close(): Promise<void>;
};

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_CALL_TIMEOUT_MS = 30_000;
const DEFAULT_STDERR_LIMIT_BYTES = 16 * 1024;
const DEFAULT_RESULT_LIMIT_BYTES = 4 * 1024 * 1024;
const MAX_CATALOG_PAGES = 1_000;

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
    const selected = value ?? fallback;
    if (!Number.isSafeInteger(selected) || selected <= 0) throw new Error(`${name} must be a positive integer.`);
    return selected;
}

function childEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(source)) {
        if (value !== undefined && name !== "MCP_HTTP_PORT") env[name] = value;
    }
    return env;
}

function byteLength(value: unknown): number {
    try {
        return Buffer.byteLength(JSON.stringify(value), "utf8");
    } catch {
        throw new Error("MCP result could not be measured safely.");
    }
}

function boundedMessage(error: unknown, stderr: string): string {
    const base = error instanceof Error ? error.message : String(error);
    const tail = stderr.trim();
    return tail ? `${base} (server stderr: ${tail})` : base;
}

function transportBufferSize(resultLimitBytes: number): number {
    return Math.min(
        Math.max(resultLimitBytes + 64 * 1024, resultLimitBytes * 4),
        64 * 1024 * 1024,
    );
}

function failureText(result: CallToolResult): string {
    const text = result.content
        .filter((item): item is Extract<CallToolResult["content"][number], { type: "text" }> => item.type === "text")
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join("; ");
    return text || "The MCP server reported a tool failure.";
}

function piContent(result: CallToolResult): CairnPiCallContent[] {
    return result.content.map((item) => {
        if (item.type === "text") return { ...item };
        if (item.type === "image") return { ...item };
        throw new Error(`Unsupported MCP result content type: ${item.type}.`);
    });
}

export async function connectCairnPiBridge(options: CairnPiBridgeOptions = {}): Promise<CairnPiBridge> {
    const startupTimeoutMs = positiveInteger(options.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS, "startupTimeoutMs");
    const callTimeoutMs = positiveInteger(options.callTimeoutMs, DEFAULT_CALL_TIMEOUT_MS, "callTimeoutMs");
    const stderrLimitBytes = positiveInteger(options.stderrLimitBytes, DEFAULT_STDERR_LIMIT_BYTES, "stderrLimitBytes");
    const resultLimitBytes = positiveInteger(options.resultLimitBytes, DEFAULT_RESULT_LIMIT_BYTES, "resultLimitBytes");
    const transport = new StdioClientTransport({
        command: options.command ?? "cairn",
        args: options.args ? [...options.args] : ["memory-server"],
        cwd: options.cwd ?? process.cwd(),
        env: childEnvironment(options.env ?? process.env),
        stderr: "pipe",
        maxBufferSize: transportBufferSize(resultLimitBytes),
    });
    const client = new Client({ name: "cairnkeep-pi-bridge", version: "1" }, { capabilities: {} });
    let state: CairnPiBridgeState = "idle";
    let stderr = Buffer.alloc(0);
    let transportFailure: Error | undefined;
    let catalog: CairnPiDiscoveredTool[] = [];
    let closePromise: Promise<void> | undefined;

    transport.stderr?.on("data", (chunk: Buffer | string) => {
        const next = Buffer.concat([stderr, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
        stderr = next.byteLength <= stderrLimitBytes ? next : next.subarray(next.byteLength - stderrLimitBytes);
    });

    const stderrTail = (): string => stderr.toString("utf8");
    const requireReady = (): void => {
        if (state !== "ready") throw new Error(`Pi MCP bridge is ${state}; calls require ready state.`);
    };

    const discover = async (): Promise<CairnPiDiscoveredTool[]> => {
        const tools: CairnPiDiscoveredTool[] = [];
        const names = new Set<string>();
        const cursors = new Set<string>();
        let cursor: string | undefined;
        for (let pageNumber = 0; pageNumber < MAX_CATALOG_PAGES; pageNumber += 1) {
            const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: startupTimeoutMs });
            if (byteLength(page) > resultLimitBytes) throw new Error("MCP tool catalog exceeds the configured result size limit.");
            for (const tool of page.tools) {
                if (names.has(tool.name)) throw new Error(`MCP tool catalog contains duplicate name: ${tool.name}.`);
                names.add(tool.name);
                tools.push(tool);
            }
            if (!page.nextCursor) return tools;
            if (cursors.has(page.nextCursor)) throw new Error("MCP tool catalog pagination repeated a cursor.");
            cursors.add(page.nextCursor);
            cursor = page.nextCursor;
        }
        throw new Error("MCP tool catalog exceeded the pagination limit.");
    };

    const close = (): Promise<void> => {
        if (closePromise) return closePromise;
        state = "closing";
        closePromise = (async () => {
            try {
                await client.close();
            } finally {
                state = "closed";
                catalog = [];
            }
        })();
        return closePromise;
    };

    state = "starting";
    try {
        await client.connect(transport, { timeout: startupTimeoutMs, maxTotalTimeout: startupTimeoutMs });
        const protocolErrorHandler = transport.onerror;
        transport.onerror = (error) => {
            transportFailure = error;
            protocolErrorHandler?.(error);
        };
        const protocolCloseHandler = transport.onclose;
        transport.onclose = () => {
            protocolCloseHandler?.();
            if (state === "starting" || state === "ready") {
                state = "closed";
                catalog = [];
            }
        };
        const pid = transport.pid;
        if (pid !== null) options.onSpawn?.({ pid });
        catalog = await discover();
        state = "ready";
    } catch (error) {
        await close().catch(() => undefined);
        throw new Error(`Unable to start local Pi MCP bridge: ${boundedMessage(error, stderrTail())}`, { cause: error });
    }

    return {
        get state(): CairnPiBridgeState { return state; },
        async listAllTools(): Promise<CairnPiDiscoveredTool[]> {
            requireReady();
            return catalog.map((tool) => structuredClone(tool));
        },
        async call(
            tool: CairnPiDiscoveredTool,
            args: Record<string, unknown>,
            callOptions: { signal?: AbortSignal } = {},
        ): Promise<CairnPiCallResult> {
            requireReady();
            const discovered = catalog.find(({ name }) => name === tool.name);
            if (!discovered) throw new Error(`MCP tool was not discovered for this session: ${tool.name}.`);
            try {
                const result = await client.callTool(
                    { name: discovered.name, arguments: args },
                    undefined,
                    { signal: callOptions.signal, timeout: callTimeoutMs, maxTotalTimeout: callTimeoutMs },
                ) as CallToolResult;
                if (byteLength(result) > resultLimitBytes) throw new Error("MCP tool result exceeds the configured size limit.");
                if (result.isError) throw new Error(failureText(result));
                const details: CairnPiCallDetails = {
                    tool: discovered,
                    annotations: discovered.annotations,
                    outputSchema: discovered.outputSchema,
                    content: result.content,
                    structuredContent: result.structuredContent,
                    isError: false,
                    ...(result._meta ? { _meta: result._meta } : {}),
                };
                return { content: piContent(result), details };
            } catch (error) {
                const failure = transportFailure && /closed/i.test(error instanceof Error ? error.message : String(error))
                    ? transportFailure
                    : error;
                throw new Error(`Pi MCP call ${discovered.name} failed: ${boundedMessage(failure, stderrTail())}`, { cause: error });
            }
        },
        close,
    };
}
