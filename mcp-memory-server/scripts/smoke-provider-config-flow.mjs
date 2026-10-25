import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Exercise the exact configuration-file -> default workspace -> request flow,
// not only the provider function with an explicitly supplied workspace.
const root = mkdtempSync(join(tmpdir(), "cairn-provider-config-flow-"));
const requests = [];
const mock = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ url: request.url, headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(request.url === "/api/v1/search/find"
        ? { status: "ok", result: { resources: [], total: 0 } }
        : { textResponse: "synthetic answer" }));
});
await new Promise(resolve => mock.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${mock.address().port}`;
const query = "Synthetic selected question";
const sentinel = "unselected-local-content-sentinel";
try {
    for (const provider of ["anythingllm", "openviking"]) {
        for (const workspace of ["reviewed-docs", "https://untrusted.invalid/escape?token=not-a-secret"]) {
            const project = join(root, `${provider}-${requests.length}`);
            mkdirSync(project);
            writeFileSync(join(project, "private.txt"), sentinel);
            const config = join(project, "memory.json");
            writeFileSync(config, JSON.stringify({
                scopes: ["identity"], anythingllm_workspaces: [workspace],
                unrelated: sentinel,
                ANYTHINGLLM_BASE_URL: "https://untrusted.invalid",
                CAIRN_OPENVIKING_BASE_URL: "https://untrusted.invalid",
                ANYTHINGLLM_API_KEY: "file-cannot-select-credential",
            }));
            const client = new Client({ name: "provider-file-flow", version: "1" });
            const transport = new StdioClientTransport({
                command: process.execPath,
                args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))], cwd: project,
                // No inherited provider settings or private machine credentials.
                env: {
                    PATH: process.env.PATH, HOME: root,
                    ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot, USERPROFILE: root } : {}),
                    AGENT_MEMORY_CONFIG: config, CAIRN_AGENTFS_BASE_DIR: join(project, "store"),
                    CAIRN_ANYTHINGLLM_PROJECTS_FILE: join(root, "absent-mapping.json"),
                    CAIRN_DOMAIN_RETRIEVAL_PROVIDER: provider,
                    ANYTHINGLLM_BASE_URL: endpoint, ANYTHINGLLM_API_KEY: "synthetic-provider-key",
                    CAIRN_OPENVIKING: "1", CAIRN_OPENVIKING_BASE_URL: endpoint,
                    CAIRN_OPENVIKING_API_KEY: "synthetic-provider-key",
                }, stderr: "pipe",
            });
            try {
                await client.connect(transport);
                const before = requests.length;
                const result = await client.callTool({ name: "domain_knowledge_query", arguments: { query } });
                assert.notEqual(result.isError, true);
                assert.equal(requests.length, before + 1);
                const request = requests.at(-1);
                assert.equal(request.headers.host, new URL(endpoint).host);
                assert.equal(JSON.stringify(request).includes(sentinel), false);
                assert.equal(JSON.stringify(request).includes("file-cannot-select-credential"), false);
                if (provider === "anythingllm") {
                    assert.equal(request.url, `/api/v1/workspace/${encodeURIComponent(workspace)}/chat`);
                    assert.equal(request.headers.authorization, "Bearer synthetic-provider-key");
                    assert.deepEqual(JSON.parse(request.body), { message: query, mode: "query" });
                } else {
                    assert.equal(request.url, "/api/v1/search/find");
                    assert.equal(request.headers["x-api-key"], "synthetic-provider-key");
                    assert.deepEqual(JSON.parse(request.body), { query, target_uri: `viking://resources/${encodeURIComponent(workspace)}`, context_type: ["resource"], limit: 10 });
                }
            } finally {
                await client.close(); await transport.close();
            }
        }
    }
    console.log("PASS: real MCP file-derived workspaces cannot choose provider origin, credentials or unselected file content");
} finally {
    await new Promise(resolve => mock.close(resolve));
    rmSync(root, { recursive: true, force: true });
}
