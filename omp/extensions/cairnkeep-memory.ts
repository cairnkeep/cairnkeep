import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@oh-my-pi/pi-coding-agent";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Bridges Cairnkeep memory MCP tools into oh-my-pi as native extension tools.
// The bridge spawns and supervises `cairn memory-server` over local stdio;
// tools are discovered dynamically and registered under their bare MCP names.
// A `cairn-memory` entry in the omp MCP config coexists without collision:
// config-served MCP tools are minted with an `mcp__` name prefix, so the two
// surfaces never claim the same tool name. Ephemeral side-turn runtimes that
// have not initialized extension actions skip bridge startup entirely.
const CAIRN_ROOT = "@@INFRA_ROOT@@";
const BRIDGE_ENTRY = join(CAIRN_ROOT, "mcp-memory-server", "dist", "pi-mcp-bridge.js");

type BridgeModule = typeof import("../../mcp-memory-server/dist/pi-mcp-bridge.js");
type Bridge = Awaited<ReturnType<BridgeModule["connectCairnPiBridge"]>>;
type DiscoveredTool = Awaited<ReturnType<Bridge["listAllTools"]>>[number];

// AgentToolResult.content accepts text and base64 image blocks; the bridge
// already reduces MCP content to exactly those two shapes.
function toAgentToolResult(result: Awaited<ReturnType<Bridge["call"]>>): AgentToolResult {
    const content = result.content.map((item) =>
        item.type === "text"
            ? { type: "text" as const, text: item.text }
            : { type: "image" as const, data: item.data, mimeType: item.mimeType },
    );
    return { content, details: result.details };
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
                throw new Error(`Cairnkeep MCP tool collision would override an existing omp tool: ${collisions.join(", ")}.`);
            }
            for (const tool of tools) {
                const discovered: DiscoveredTool = tool;
                pi.registerTool({
                    name: tool.name,
                    label: tool.title ?? tool.name,
                    description: tool.description ?? tool.title ?? tool.name,
                    // omp accepts a plain JSON Schema document (TJsonSchema) for
                    // extension-authored tools; MCP inputSchema is already one.
                    parameters: tool.inputSchema as ToolDefinition["parameters"],
                    strict: false,
                    execute: async (_toolCallId, args, signal) =>
                        toAgentToolResult(await connected.call(discovered, args as Record<string, unknown>, { signal })),
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
        if (runtimeUninitialized(pi)) return;
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
