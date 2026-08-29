import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
    queryDomainKnowledge,
    resolveDomainRetrievalProvider,
} from "../dist/domain-retrieval-provider.js";

let failures = 0;
function check(name, condition) {
    console.log(`${condition ? "ok" : "FAIL"}: ${name}`);
    if (!condition) failures += 1;
}

async function expectReject(name, operation, pattern) {
    try {
        await operation();
        check(name, false);
    } catch (error) {
        check(name, pattern.test(error instanceof Error ? error.message : String(error)));
    }
}

const requests = [];
const mock = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({ url: request.url, method: request.method, headers: request.headers, body });

    if (request.url === "/redirect/api/v1/search/find") {
        response.writeHead(302, { Location: "/api/v1/search/find" }).end();
        return;
    }
    if (request.url === "/status/api/v1/search/find") {
        response.writeHead(503, { "Content-Type": "application/json" }).end(JSON.stringify({ secret: "must-not-leak" }));
        return;
    }
    if (request.url === "/malformed/api/v1/search/find") {
        response.writeHead(200, { "Content-Type": "application/json" }).end("not-json");
        return;
    }
    if (request.url === "/empty/api/v1/search/find") {
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok", result: {} }));
        return;
    }
    if (request.url === "/large/api/v1/search/find") {
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok", result: { resources: [{ abstract: "x".repeat(1_100_000) }], total: 1 } }));
        return;
    }
    if (request.url === "/slow/api/v1/search/find") {
        setTimeout(() => {
            if (!response.destroyed) response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ status: "ok", result: { resources: [], total: 0 } }));
        }, 250);
        return;
    }

    response.writeHead(200, { "Content-Type": "application/json" });
    if (request.url?.startsWith("/api/v1/workspace/")) {
        response.end(JSON.stringify({ textResponse: "unchanged AnythingLLM answer" }));
        return;
    }
    response.end(JSON.stringify({
        status: "ok",
        result: {
            memories: [],
            resources: [{ uri: "viking://resources/project-alpha/runbook.md", level: 0, score: 0.9, abstract: "Rollback safely." }],
            skills: [],
            total: 1,
        },
    }));
});
await new Promise((resolvePromise) => mock.listen(0, "127.0.0.1", resolvePromise));
const address = mock.address();
if (!address || typeof address === "string") throw new Error("mock server did not bind");
const baseUrl = `http://127.0.0.1:${address.port}`;

const enabledOpenViking = {
    CAIRN_DOMAIN_RETRIEVAL_PROVIDER: "openviking",
    CAIRN_OPENVIKING: "1",
    CAIRN_OPENVIKING_BASE_URL: baseUrl,
    CAIRN_OPENVIKING_API_KEY: "openviking-secret-token",
};

try {
    check("AnythingLLM remains the default provider", resolveDomainRetrievalProvider({}) === "anythingllm");
    check("AnythingLLM can be selected explicitly", resolveDomainRetrievalProvider({ CAIRN_DOMAIN_RETRIEVAL_PROVIDER: "anythingllm" }) === "anythingllm");
    await expectReject(
        "unknown providers fail closed",
        async () => resolveDomainRetrievalProvider({ CAIRN_DOMAIN_RETRIEVAL_PROVIDER: "other" }),
        /CAIRN_DOMAIN_RETRIEVAL_PROVIDER.*anythingllm.*openviking/,
    );

    const anythingStart = requests.length;
    const anythingAnswer = await queryDomainKnowledge({
        workspace: "project alpha",
        query: "What changed?",
        env: { ANYTHINGLLM_BASE_URL: baseUrl, ANYTHINGLLM_API_KEY: "anything-secret-token" },
    });
    const anythingRequest = requests[anythingStart];
    check("AnythingLLM direct answer is byte-compatible", anythingAnswer === "unchanged AnythingLLM answer");
    check("AnythingLLM request path is unchanged", anythingRequest?.url === "/api/v1/workspace/project%20alpha/chat");
    check("AnythingLLM request mode is unchanged", anythingRequest?.body === JSON.stringify({ message: "What changed?", mode: "query" }));
    check("AnythingLLM bearer authentication is unchanged", anythingRequest?.headers.authorization === "Bearer anything-secret-token");

    const openVikingStart = requests.length;
    const openVikingAnswer = await queryDomainKnowledge({ workspace: "project-alpha", query: "How do I roll back?", env: enabledOpenViking });
    const openVikingRequest = requests[openVikingStart];
    const openVikingBody = JSON.parse(openVikingRequest?.body ?? "null");
    check("OpenViking uses only the read-only find endpoint", openVikingRequest?.url === "/api/v1/search/find" && openVikingRequest?.method === "POST");
    check("OpenViking scopes short workspace names to resources", openVikingBody.target_uri === "viking://resources/project-alpha");
    check("OpenViking excludes memories and skills", JSON.stringify(openVikingBody.context_type) === JSON.stringify(["resource"]));
    check("OpenViking token is carried only in its API header", openVikingRequest?.headers["x-api-key"] === "openviking-secret-token");
    check("OpenViking returns the strict result payload", JSON.parse(openVikingAnswer).resources?.[0]?.abstract === "Rollback safely.");

    const disabledStart = requests.length;
    await expectReject(
        "OpenViking requires explicit feature consent",
        () => queryDomainKnowledge({ workspace: "project-alpha", query: "query", env: { ...enabledOpenViking, CAIRN_OPENVIKING: "0" } }),
        /CAIRN_OPENVIKING=1/,
    );
    await expectReject(
        "remote MCP requires separate OpenViking consent",
        () => queryDomainKnowledge({ workspace: "project-alpha", query: "query", remote: true, env: enabledOpenViking }),
        /CAIRN_OPENVIKING_MCP_HTTP=1/,
    );
    check("disabled OpenViking paths make no network request", requests.length === disabledStart);

    for (const [name, unsafeBase] of [
        ["embedded credentials", `http://user:password@127.0.0.1:${address.port}`],
        ["non-HTTP protocol", "file:///tmp/openviking"],
        ["non-loopback plain HTTP", "http://192.0.2.1:1933"],
    ]) {
        const start = requests.length;
        await expectReject(
            `OpenViking rejects ${name}`,
            () => queryDomainKnowledge({ workspace: "project-alpha", query: "query", env: { ...enabledOpenViking, CAIRN_OPENVIKING_BASE_URL: unsafeBase } }),
            /OpenViking base URL/,
        );
        check(`${name} rejection occurs before network`, requests.length === start);
    }

    await expectReject(
        "OpenViking does not follow redirects",
        () => queryDomainKnowledge({ workspace: "project-alpha", query: "query", env: { ...enabledOpenViking, CAIRN_OPENVIKING_BASE_URL: `${baseUrl}/redirect` } }),
        /redirect|302/i,
    );
    await expectReject(
        "OpenViking rejects failing status without echoing response content",
        () => queryDomainKnowledge({ workspace: "project-alpha", query: "query", env: { ...enabledOpenViking, CAIRN_OPENVIKING_BASE_URL: `${baseUrl}/status` } }),
        /503/,
    );
    await expectReject(
        "OpenViking rejects malformed JSON",
        () => queryDomainKnowledge({ workspace: "project-alpha", query: "query", env: { ...enabledOpenViking, CAIRN_OPENVIKING_BASE_URL: `${baseUrl}/malformed` } }),
        /valid JSON/,
    );
    await expectReject(
        "OpenViking rejects structurally useless payloads",
        () => queryDomainKnowledge({ workspace: "project-alpha", query: "query", env: { ...enabledOpenViking, CAIRN_OPENVIKING_BASE_URL: `${baseUrl}/empty` } }),
        /useful.*payload/i,
    );
    await expectReject(
        "OpenViking enforces the response size cap",
        () => queryDomainKnowledge({ workspace: "project-alpha", query: "query", env: { ...enabledOpenViking, CAIRN_OPENVIKING_BASE_URL: `${baseUrl}/large` } }),
        /too large/,
    );
    await expectReject(
        "OpenViking requests time out",
        () => queryDomainKnowledge({ workspace: "project-alpha", query: "query", env: { ...enabledOpenViking, CAIRN_OPENVIKING_BASE_URL: `${baseUrl}/slow`, CAIRN_OPENVIKING_TIMEOUT_MS: "100" } }),
        /timed out/,
    );

    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const serverEntry = resolve(scriptDir, "..", "dist", "index.js");
    const storeDir = mkdtempSync(join(tmpdir(), "cairn-domain-retrieval-"));
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverEntry],
        cwd: storeDir,
        env: { ...process.env, ...enabledOpenViking, CAIRN_AGENTFS_BASE_DIR: storeDir },
        stderr: "pipe",
    });
    const client = new Client({ name: "domain-retrieval-smoke", version: "1" });
    try {
        await client.connect(transport);
        const result = await client.callTool({ name: "domain_knowledge_query", arguments: { workspace: "project-alpha", query: "How do I roll back?" } });
        check("MCP query preserves the workspace/answer response shape", result.structuredContent?.workspace === "project-alpha" && typeof result.structuredContent?.answer === "string");
        const sync = await client.callTool({ name: "domain_knowledge_sync", arguments: { workspace: "project-alpha" } });
        check("OpenViking synchronization fails clearly", sync.isError === true && /read-only OpenViking provider/.test(sync.content?.[0]?.text ?? ""));
    } finally {
        await client.close().catch(() => {});
        rmSync(storeDir, { recursive: true, force: true });
    }
} finally {
    await new Promise((resolvePromise) => mock.close(resolvePromise));
}

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log("\nDomain retrieval provider checks passed");
