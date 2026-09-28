import { childEnvironment, connectCairnPiBridge } from "./pi-mcp-bridge.js";

/**
 * NDJSON stdio child hosting the Cairn Pi MCP bridge.
 *
 * Compiled Bun standalone binaries cannot resolve node_modules for files
 * imported at runtime, so omp extensions cannot import pi-mcp-bridge.js
 * in-process. This child is spawned with plain node (which resolves
 * node_modules natively) and speaks a minimal line-delimited JSON protocol:
 *
 *   parent -> child: {"type":"list","id":n}
 *                    {"type":"call","id":n,"tool":<catalog tool>,"args":{...}}
 *                    {"type":"cancel","id":n}
 *                    {"type":"close"}
 *   child -> parent: {"type":"ready"} after the bridge connects
 *                    {"type":"result","id":n,"ok":true,"tools":[...]} for list
 *                    {"type":"result","id":n,"ok":true,"result":{...}}
 *                    {"type":"result","id":n,"ok":false,"error":string,"stderr":string}
 *
 * Startup: cwd from argv[2] (default process.cwd()); server command from
 * CAIRN_PI_BRIDGE_COMMAND (default "cairn"); args from CAIRN_PI_BRIDGE_ARGS
 * (default '["memory-server"]'); the grandchild env is childEnvironment of
 * this process, so MCP_HTTP_PORT and Bun node-shim PATH entries are stripped
 * before the server spawns.
 *
 * stdin end or SIGTERM/SIGINT closes the bridge and exits 0. Uncaught errors
 * print one JSON error line to stderr and exit non-zero.
 */

type ChildRequest =
    | { type: "list"; id: number }
    | { type: "call"; id: number; tool: unknown; args?: Record<string, unknown> }
    | { type: "cancel"; id: number }
    | { type: "close" };

const STDERR_LIMIT_BYTES = 16 * 1024;

let stderrTail = "";
const stderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    const text = typeof chunk === "string" ? chunk : String(chunk);
    const next = stderrTail + text;
    stderrTail = next.length <= STDERR_LIMIT_BYTES ? next : next.slice(next.length - STDERR_LIMIT_BYTES);
    return (stderrWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stderr.write;

function send(message: unknown): void {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

function fatal(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ type: "error", error: message })}\n`);
    process.exit(1);
}

process.on("uncaughtException", fatal);
process.on("unhandledRejection", (reason) => fatal(reason));

async function main(): Promise<void> {
    const cwd = process.argv[2] ?? process.cwd();
    const command = process.env.CAIRN_PI_BRIDGE_COMMAND ?? "cairn";
    const args = JSON.parse(process.env.CAIRN_PI_BRIDGE_ARGS ?? '["memory-server"]') as string[];
    const bridge = await connectCairnPiBridge({ cwd, command, args, env: childEnvironment(process.env) });

    const controllers = new Map<number, AbortController>();
    let stdinBuffer = "";
    let closing = false;

    const close = async (): Promise<void> => {
        if (closing) return;
        closing = true;
        await bridge.close().catch(() => undefined);
        process.exit(0);
    };

    process.on("SIGTERM", () => void close());
    process.on("SIGINT", () => void close());
    process.stdin.on("end", () => void close());

    async function handle(request: ChildRequest): Promise<void> {
        try {
            switch (request.type) {
                case "list": {
                    send({ type: "result", id: request.id, ok: true, tools: await bridge.listAllTools() });
                    break;
                }
                case "call": {
                    const controller = new AbortController();
                    controllers.set(request.id, controller);
                    try {
                        const result = await bridge.call(
                            request.tool as Parameters<typeof bridge.call>[0],
                            request.args ?? {},
                            { signal: controller.signal },
                        );
                        send({ type: "result", id: request.id, ok: true, result });
                    } catch (error) {
                        send({
                            type: "result",
                            id: request.id,
                            ok: false,
                            error: error instanceof Error ? error.message : String(error),
                            stderr: stderrTail,
                        });
                    } finally {
                        controllers.delete(request.id);
                    }
                    break;
                }
                case "cancel": {
                    controllers.get(request.id)?.abort(new Error("cancelled"));
                    break;
                }
                case "close": {
                    await close();
                    break;
                }
            }
        } catch (error) {
            const id = typeof (request as { id?: unknown }).id === "number" ? (request as { id: number }).id : -1;
            send({
                type: "result",
                id,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                stderr: stderrTail,
            });
        }
    }

    process.stdin.on("data", (chunk: Buffer | string) => {
        stdinBuffer += chunk.toString("utf8");
        let newline = stdinBuffer.indexOf("\n");
        while (newline >= 0) {
            const line = stdinBuffer.slice(0, newline);
            stdinBuffer = stdinBuffer.slice(newline + 1);
            newline = stdinBuffer.indexOf("\n");
            if (!line.trim()) continue;
            let request: ChildRequest;
            try {
                request = JSON.parse(line) as ChildRequest;
            } catch {
                continue;
            }
            void handle(request);
        }
    });

    send({ type: "ready" });
}

main().catch(fatal);
