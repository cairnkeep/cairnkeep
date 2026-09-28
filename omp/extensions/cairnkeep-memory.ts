import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

// The bridge runs as a node child process because compiled Bun standalone
// binaries cannot resolve node_modules for runtime-imported files.
const CAIRN_ROOT = "@@INFRA_ROOT@@";
const CHILD_ENTRY = join(CAIRN_ROOT, "mcp-memory-server", "dist", "pi-bridge-child.js");

const STARTUP_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 30_000;
const STDERR_LIMIT_BYTES = 16 * 1024;
const SHUTDOWN_GRACE_MS = 3_000;

type CatalogTool = {
    name: string;
    title?: string;
    description?: string;
    inputSchema: Record<string, unknown>;
};

type ChildResult =
    | { type: "ready" }
    | { type: "result"; id: number; ok: true; tools?: CatalogTool[]; result?: unknown }
    | { type: "result"; id: number; ok: false; error: string; stderr?: string };

type PendingRequest = {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
};

// Minimal line-delimited JSON client for pi-bridge-child.js: requests carry
// an id, results route back by id, and an unexpected child exit rejects
// everything pending with the captured stderr tail.
class BridgeChildClient {
    #child: ChildProcess;
    #nextId = 1;
    #stdoutBuffer = "";
    #stderrTail = "";
    #pending = new Map<number, PendingRequest>();
    #readyPending: PendingRequest | undefined;
    #exitPromise: Promise<void>;
    #closed = false;

    private constructor(child: ChildProcess) {
        this.#child = child;
        this.#exitPromise = new Promise((resolvePromise) => {
            child.once("exit", () => resolvePromise());
            child.once("error", () => resolvePromise());
        });
        child.stdout?.on("data", (chunk: Buffer | string) => this.#onStdout(chunk));
        child.stderr?.on("data", (chunk: Buffer | string) => this.#appendStderr(chunk));
        child.on("error", () => this.#failAll(new Error("Cairnkeep bridge child failed to start.")));
        child.once("exit", (code, signal) => {
            const detail = this.#stderrTail.trim();
            const suffix = detail ? ` (child stderr: ${detail})` : "";
            this.#failAll(new Error(`Cairnkeep bridge child exited (${signal ?? code}).${suffix}`));
            this.#readyPending?.reject(new Error(`Cairnkeep bridge child exited before ready (${signal ?? code}).${suffix}`));
            this.#readyPending = undefined;
        });
        const pidLog = process.env.CAIRN_BRIDGE_CHILD_PID_LOG;
        if (pidLog && child.pid) appendFileSync(pidLog, `${child.pid}\n`);
    }

    static spawn(cwd: string): BridgeChildClient {
        const child = spawn("node", [CHILD_ENTRY, cwd], { stdio: ["pipe", "pipe", "pipe"] });
        child.stdin.on("error", () => undefined);
        return new BridgeChildClient(child);
    }

    ready(): Promise<void> {
        return new Promise((resolvePromise, rejectPromise) => {
            const timer = setTimeout(() => {
                this.#readyPending = undefined;
                rejectPromise(new Error("Cairnkeep bridge child timed out waiting for ready."));
            }, STARTUP_TIMEOUT_MS);
            this.#readyPending = {
                resolve: () => {
                    clearTimeout(timer);
                    resolvePromise();
                },
                reject: (error) => {
                    clearTimeout(timer);
                    rejectPromise(error);
                },
                timer,
            };
        });
    }

    request(message: Omit<{ type: "list" | "close" }, "id"> | { type: "call"; tool: unknown; args: Record<string, unknown> }, timeoutMs: number): Promise<unknown> {
        const id = this.#nextId++;
        return new Promise((resolvePromise, rejectPromise) => {
            const timer = setTimeout(() => {
                this.#pending.delete(id);
                rejectPromise(new Error(`Cairnkeep bridge child request ${message.type} timed out after ${timeoutMs}ms.`));
            }, timeoutMs);
            this.#pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
            this.#write({ ...message, id });
        });
    }

    // One MCP tool call: 30s backstop timer plus cancellation forwarded to the
    // child as a protocol-level cancel.
    call(tool: unknown, args: Record<string, unknown>, signal: AbortSignal | undefined): Promise<unknown> {
        const id = this.#nextId++;
        return new Promise((resolvePromise, rejectPromise) => {
            let timer: ReturnType<typeof setTimeout> | undefined;
            const cancel = (): void => {
                if (timer) clearTimeout(timer);
                this.#pending.delete(id);
                this.#write({ type: "cancel", id });
                rejectPromise(new Error("cancelled"));
            };
            timer = setTimeout(() => {
                this.#pending.delete(id);
                this.#write({ type: "cancel", id });
                rejectPromise(new Error(`Cairnkeep MCP call timed out after ${CALL_TIMEOUT_MS}ms.`));
            }, CALL_TIMEOUT_MS);
            this.#pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
            if (signal) {
                if (signal.aborted) {
                    cancel();
                    return;
                }
                signal.addEventListener("abort", cancel, { once: true });
            }
            this.#write({ type: "call", id, tool, args });
        });
    }

    async close(): Promise<void> {
        if (this.#closed) return;
        this.#closed = true;
        try {
            this.#write({ type: "close" });
        } catch {
            // Child already gone — the exit handler rejected everything pending.
        }
        const grace = setTimeout(() => {
            try {
                this.#child.kill("SIGKILL");
            } catch {
                // best-effort kill only
            }
        }, SHUTDOWN_GRACE_MS);
        await this.#exitPromise;
        clearTimeout(grace);
    }

    #write(message: unknown): void {
        this.#child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    #appendStderr(chunk: Buffer | string): void {
        const next = this.#stderrTail + (Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk);
        this.#stderrTail = next.length <= STDERR_LIMIT_BYTES ? next : next.slice(next.length - STDERR_LIMIT_BYTES);
    }

    #onStdout(chunk: Buffer | string): void {
        this.#stdoutBuffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
        let newline = this.#stdoutBuffer.indexOf("\n");
        while (newline >= 0) {
            const line = this.#stdoutBuffer.slice(0, newline);
            this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
            newline = this.#stdoutBuffer.indexOf("\n");
            if (!line.trim()) continue;
            let message: ChildResult;
            try {
                message = JSON.parse(line) as ChildResult;
            } catch {
                continue;
            }
            if (message.type === "ready") {
                this.#readyPending?.resolve(undefined);
                this.#readyPending = undefined;
                continue;
            }
            if (message.type !== "result") continue;
            const pending = this.#pending.get(message.id);
            if (!pending) continue;
            this.#pending.delete(message.id);
            clearTimeout(pending.timer);
            if (message.ok) pending.resolve(message.tools ?? message.result);
            else {
                const detail = typeof message.stderr === "string" && message.stderr.trim() ? ` (child stderr: ${message.stderr.trim()})` : "";
                pending.reject(new Error(`${message.error}${detail}`));
            }
        }
    }

    #failAll(error: Error): void {
        for (const pending of this.#pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
        this.#pending.clear();
    }
}

// AgentToolResult.content accepts text and base64 image blocks; the bridge
// child already reduces MCP content to exactly those two shapes.
function toAgentToolResult(result: unknown): AgentToolResult {
    const { content, details } = result as {
        content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
        details?: unknown;
    };
    return {
        content: content.map((item) =>
            item.type === "text"
                ? { type: "text" as const, text: item.text ?? "" }
                : { type: "image" as const, data: item.data ?? "", mimeType: item.mimeType ?? "" },
        ),
        details,
    };
}

// omp rebinds extensions to ephemeral side-turn runtimes (e.g. title
// generation) whose action methods are uninitialized stubs that throw; bridge
// startup is skipped there and the real session starts it later.
function runtimeUninitialized(pi: ExtensionAPI): boolean {
    try {
        pi.getAllTools();
        return false;
    } catch (error) {
        if (error instanceof Error && error.message.includes("Extension runtime not initialized")) return true;
        throw error;
    }
}

function existingToolNames(pi: ExtensionAPI): Set<string> {
    return new Set(pi.getAllTools().map((tool) => tool.name));
}

export default function cairnMemoryExtension(pi: ExtensionAPI): void {
    let client: BridgeChildClient | undefined;
    let startPromise: Promise<void> | undefined;
    let shutdownPromise: Promise<void> | undefined;

    const start = async (ctx: ExtensionContext): Promise<void> => {
        const connected = BridgeChildClient.spawn(ctx.cwd);
        try {
            await connected.ready();
            const tools = (await connected.request({ type: "list" }, STARTUP_TIMEOUT_MS)) as CatalogTool[];
            const existing = existingToolNames(pi);
            const collisions = tools.map(({ name }) => name).filter((name) => existing.has(name));
            if (collisions.length) {
                throw new Error(`Cairnkeep MCP tool collision would override an existing omp tool: ${collisions.join(", ")}.`);
            }
            for (const tool of tools) {
                pi.registerTool({
                    name: tool.name,
                    label: tool.title ?? tool.name,
                    description: tool.description ?? tool.title ?? tool.name,
                    // omp accepts a plain JSON Schema document (TJsonSchema) for
                    // extension-authored tools; MCP inputSchema is already one.
                    parameters: tool.inputSchema as ToolDefinition["parameters"],
                    strict: false,
                    execute: async (_toolCallId, args, signal) =>
                        toAgentToolResult(await connected.call(tool, args as Record<string, unknown>, signal)),
                });
            }
            client = connected;
        } catch (error) {
            await connected.close().catch(() => undefined);
            throw error;
        }
    };

    pi.on("session_start", async (_event, ctx: ExtensionContext) => {
        if (shutdownPromise) throw new Error("Cairnkeep MCP bridge is already shutting down.");
        if (runtimeUninitialized(pi)) return;
        if (!startPromise) startPromise = start(ctx);
        await startPromise;
    });

    pi.on("session_shutdown", async () => {
        if (!shutdownPromise) {
            shutdownPromise = (async () => {
                await startPromise?.catch(() => undefined);
                await client?.close();
            })();
        }
        await shutdownPromise;
    });
}
