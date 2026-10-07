import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

let failures = 0;
function check(name, condition) {
    console.log(`${condition ? "ok" : "FAIL"}: ${name}`);
    if (!condition) failures += 1;
}

const PORT = 9500 + (process.pid % 500);
const ANYTHING_PORT = PORT + 500;
const TOKEN = "remote-context-smoke-token";
const storeDir = mkdtempSync(join(tmpdir(), "cairn-remote-context-"));
const anythingRequests = [];
const serverEntry = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

const anythingServer = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    anythingRequests.push({ url: req.url, body: Buffer.concat(chunks).toString("utf8") });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ textResponse: "project-alpha answer" }));
});
await new Promise((resolve) => anythingServer.listen(ANYTHING_PORT, "127.0.0.1", resolve));

const server = spawn("node", [serverEntry], {
    cwd: storeDir,
    env: {
        ...process.env,
        MCP_HTTP_PORT: String(PORT),
        MCP_HTTP_HOST: "127.0.0.1",
        CAIRN_MEMORY_HTTP_TOKEN: TOKEN,
        CAIRN_AGENTFS_BASE_DIR: storeDir,
        ANYTHINGLLM_BASE_URL: `http://127.0.0.1:${ANYTHING_PORT}`,
        ANYTHINGLLM_API_KEY: "smoke-anything-key",
    },
});

function waitForListen(proc) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("server did not start in time")), 5000);
        proc.stderr.on("data", (chunk) => {
            if (chunk.toString().includes("listening on")) {
                clearTimeout(timer);
                resolve();
            }
        });
        proc.on("exit", (code) => {
            clearTimeout(timer);
            reject(new Error(`server exited early: ${code}`));
        });
    });
}

async function connect(project, workspaces) {
    const client = new Client({ name: `smoke-${project || "legacy"}`, version: "0" });
    const headers = { Authorization: `Bearer ${TOKEN}` };
    if (project) {
        headers["X-Cairn-Project"] = project;
        headers["X-Cairn-Scopes"] = "identity,project";
        headers["X-Cairn-AnythingLLM-Workspaces"] = workspaces;
    }
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), {
        requestInit: { headers },
    });
    await client.connect(transport);
    return client;
}

try {
    await waitForListen(server);
    const alpha = await connect("project-alpha", "engineering-patterns,alpha-docs");
    const beta = await connect("project-beta", "engineering-patterns,beta-docs");
    const legacy = await connect();

    await alpha.callTool({
        name: "memory_write",
        arguments: { scope: "project", key: "decisions/shared-key", value: "alpha" },
    });
    await beta.callTool({
        name: "memory_write",
        arguments: { scope: "project", key: "decisions/shared-key", value: "beta" },
    });
    await legacy.callTool({
        name: "memory_write",
        arguments: { scope: "project", key: "decisions/legacy-key", value: "legacy" },
    });

    const alphaRead = await alpha.callTool({
        name: "memory_read",
        arguments: { scope: "project", key: "decisions/shared-key" },
    });
    const betaRead = await beta.callTool({
        name: "memory_read",
        arguments: { scope: "project", key: "decisions/shared-key" },
    });
    const legacyRead = await legacy.callTool({
        name: "memory_read",
        arguments: { scope: "project", key: "decisions/legacy-key" },
    });
    const alphaValue = alphaRead.structuredContent?.results?.[0]?.value;
    const betaValue = betaRead.structuredContent?.results?.[0]?.value;
    const legacyValue = legacyRead.structuredContent?.results?.[0]?.value;

    check("project-alpha reads only its project value", alphaValue === "alpha");
    check("project-beta reads only its project value", betaValue === "beta");
    check("legacy session reads its project value without routing headers", legacyValue === "legacy");
    check("project-alpha database uses the server-side project directory", existsSync(join(storeDir, "projects", "project-alpha.db")));
    check("project-beta database uses the server-side project directory", existsSync(join(storeDir, "projects", "project-beta.db")));
    check("legacy project database still uses the server working directory", existsSync(join(storeDir, ".agentfs", "project.db")));

    const answer = await alpha.callTool({
        name: "domain_knowledge_query",
        arguments: { query: "What belongs to alpha?" },
    });
    check("AnythingLLM default comes from session metadata", answer.structuredContent?.workspace === "alpha-docs");
    check("AnythingLLM request targets the declared workspace", anythingRequests[0]?.url === "/api/v1/workspace/alpha-docs/chat");

    await alpha.close();
    await beta.close();
    await legacy.close();

    const invalid = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
            "X-Cairn-Project": "../escape",
        },
        body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "invalid", version: "0" } },
        }),
    });
    check("invalid project identities fail with 400", invalid.status === 400);
} finally {
    server.kill("SIGINT");
    await new Promise((resolve) => server.once("exit", resolve)).catch(() => {});
    await new Promise((resolve) => anythingServer.close(resolve));
    rmSync(storeDir, { recursive: true, force: true });
}

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log("\nRemote context checks passed");
