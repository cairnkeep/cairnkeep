import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = mkdtempSync(join(tmpdir(), "cairn-workspace-mcp-"));
const requests = [];
const mock = createServer(async (request, response) => {
    for await (const chunk of request) { /* Drain the bounded synthetic request. */ }
    requests.push(request.url);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ textResponse: "synthetic workspace answer" }));
});
await new Promise(resolve => mock.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${mock.address().port}`;
const config = join(root, "memory.json");
const mapping = join(root, "projects.json");
const script = join(root, "sync_to_anythingllm.py");
const alpha = join(root, "alpha");
const beta = join(root, "beta");
const nested = join(alpha, "src");
for (const path of [alpha, beta, nested]) mkdirSync(path, { recursive: true });
writeFileSync(config, JSON.stringify({ scopes: ["identity"], anythingllm_workspaces: ["engineering-patterns", "legacy-docs"] }));
writeFileSync(mapping, JSON.stringify({ projects: [{ slug: "alpha-docs", path: alpha }, { slug: "beta-docs", path: beta }] }));
writeFileSync(script, 'import json, sys\nprint(json.dumps(sys.argv[1:]))\n');
try {
    for (const [cwd, expected] of [[alpha, "alpha-docs"], [beta, "beta-docs"], [nested, "alpha-docs"], [root, "legacy-docs"]]) {
        const client = new Client({ name: "workspace-routing-test", version: "1" });
        const transport = new StdioClientTransport({
            command: process.execPath,
            args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
            cwd,
            env: {
                ...process.env,
                MCP_HTTP_PORT: "",
                AGENT_MEMORY_CONFIG: config,
                CAIRN_AGENTFS_BASE_DIR: join(root, "store"),
                CAIRN_DOMAIN_RETRIEVAL_PROVIDER: "anythingllm",
                CAIRN_ANYTHINGLLM_PROJECTS_FILE: mapping,
                CAIRN_ANYTHINGLLM_SYNC_SCRIPT: script,
                ANYTHINGLLM_BASE_URL: base,
                ANYTHINGLLM_API_KEY: "synthetic-test-key",
            },
            stderr: "pipe",
        });
        try {
            await client.connect(transport);
            const response = await client.callTool({ name: "domain_knowledge_query", arguments: { query: "Synthetic question" } });
            assert.equal(response.isError, undefined);
            assert.deepEqual(response.structuredContent, { workspace: expected, answer: "synthetic workspace answer" });
            assert.equal(requests.at(-1), `/api/v1/workspace/${expected}/chat`);
            const explicit = await client.callTool({ name: "domain_knowledge_query", arguments: { workspace: "explicit-docs", query: "Synthetic question" } });
            assert.equal(explicit.structuredContent.workspace, "explicit-docs");
            if (process.platform !== "win32") {
                const synced = await client.callTool({ name: "domain_knowledge_sync", arguments: {} });
                assert.equal(synced.structuredContent?.ok, true);
                assert.equal(synced.structuredContent.workspace, expected);
                assert.deepEqual(JSON.parse(synced.structuredContent.stdout), ["--project", expected]);
            }
            const denied = await client.callTool({ name: "domain_knowledge_sync", arguments: { mode: "replace" } });
            assert.equal(denied.isError, true);
            assert.match(denied.content[0].text, /confirm_replace=true/);
        } finally {
            await client.close().catch(() => {});
            await transport.close().catch(() => {});
        }
    }
    console.log("PASS: real stdio MCP repository routing, explicit override and replace consent; synthetic sync on POSIX");
} finally {
    await new Promise(resolve => mock.close(resolve));
    rmSync(root, { recursive: true, force: true });
}
