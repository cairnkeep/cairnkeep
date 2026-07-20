import { readFileSync } from "node:fs";

const port = process.env.MCP_HTTP_PORT?.trim();
if (!port) {
    process.exit(0);
}

let token = process.env.CAIRN_MEMORY_HTTP_TOKEN?.trim();
const tokenFile = process.env.CAIRN_MEMORY_HTTP_TOKEN_FILE?.trim();
if (!token && tokenFile) {
    try {
        token = readFileSync(tokenFile, "utf8").trim();
    } catch {
        process.exit(1);
    }
}
if (!token) {
    process.exit(1);
}

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

try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(4000),
    });
    process.exit(response.ok ? 0 : 1);
} catch {
    process.exit(1);
}
