import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseHttpPort, resolveHttpToken } from "../mcp-memory-server/dist/http-security.js";

const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "cairnkeep-container-health", version: "1" },
    },
};

export async function containerHealthcheck(env = process.env) {
    const port = parseHttpPort(env.MCP_HTTP_PORT);
    if (!port.enabled) return "error" in port ? 1 : 0;
    const token = resolveHttpToken(env);
    if (!token.ok) return 1;
    try {
        const response = await fetch(`http://127.0.0.1:${port.port}/mcp`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token.token}`,
                "Content-Type": "application/json",
                Accept: "application/json, text/event-stream",
            },
            body: JSON.stringify(body),
            redirect: "manual",
            signal: AbortSignal.timeout(4000),
        });
        await response.body?.cancel();
        return response.ok ? 0 : 1;
    } catch { return 1; }
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
    process.exitCode = await containerHealthcheck();
}
