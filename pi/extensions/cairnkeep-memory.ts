import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const CAIRN_ROOT = "@@INFRA_ROOT@@";
const BRIDGE_ENTRY = join(CAIRN_ROOT, "mcp-memory-server", "dist", "pi-mcp-bridge.js");

type BridgeModule = typeof import("../../mcp-memory-server/dist/pi-mcp-bridge.js");
type Bridge = Awaited<ReturnType<BridgeModule["connectCairnPiBridge"]>>;

function existingToolNames(pi: ExtensionAPI): Set<string> {
    return new Set(pi.getAllTools().map((tool) => tool.name));
}

export default function cairnMemoryExtension(pi: ExtensionAPI): void {
    let bridge: Bridge | undefined;
    let startPromise: Promise<void> | undefined;
    let shutdownPromise: Promise<void> | undefined;

    const start = async (ctx: ExtensionContext): Promise<void> => {
        const module = await import(pathToFileURL(BRIDGE_ENTRY).href) as BridgeModule;
        const connected = await module.connectCairnPiBridge({ cwd: ctx.cwd, env: { ...process.env } });
        try {
            const tools = await connected.listAllTools();
            const existing = existingToolNames(pi);
            const collisions = tools.map(({ name }) => name).filter((name) => existing.has(name));
            if (collisions.length) {
                throw new Error(`Cairnkeep MCP tool collision would override an existing Pi tool: ${collisions.join(", ")}.`);
            }
            for (const tool of tools) {
                pi.registerTool({
                    name: tool.name,
                    label: tool.title ?? tool.name,
                    description: tool.description ?? tool.title ?? tool.name,
                    parameters: tool.inputSchema,
                    execute: async (_callId, args, signal) => connected.call(tool, args, { signal }),
                });
            }
            bridge = connected;
        } catch (error) {
            await connected.close().catch(() => undefined);
            throw error;
        }
    };

    pi.on("session_start", async (_event, ctx: ExtensionContext) => {
        if (shutdownPromise) throw new Error("Cairnkeep MCP bridge is already shutting down.");
        if (!startPromise) startPromise = start(ctx);
        await startPromise;
    });

    pi.on("session_shutdown", async () => {
        if (!shutdownPromise) {
            shutdownPromise = (async () => {
                await startPromise?.catch(() => undefined);
                await bridge?.close();
            })();
        }
        await shutdownPromise;
    });
}
