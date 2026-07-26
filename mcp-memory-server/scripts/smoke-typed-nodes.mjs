import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const RED_MARKER = "PHASE16_RED:TYPED_NODE_LIFECYCLE_MISSING";

async function connect(baseDir, extraEnv = {}) {
    const transport = new StdioClientTransport({
        command: "node",
        args: ["dist/index.js"],
        env: { ...process.env, CAIRN_AGENTFS_BASE_DIR: baseDir, CAIRN_TYPED_MEMORY_NODES: "1", ...extraEnv },
    });
    const client = new Client({ name: "smoke-typed-nodes", version: "0" }, { capabilities: {} });
    await client.connect(transport);
    return client;
}

async function call(client, name, args) {
    return client.callTool({ name, arguments: args });
}

function nodeProjection(node) {
    return {
        schema_version: node?.schema_version,
        address_space: node?.address_space,
        node_type: node?.node_type,
        tags: node?.tags,
    };
}

async function schemaChecks(client) {
    const tools = Object.fromEntries((await client.listTools()).tools.map((tool) => [tool.name, tool]));
    assert.ok(tools.memory_import, "typed memory_import tool is absent");
    for (const [name, fields] of [
        ["memory_write", ["node_type", "tags"]],
        ["memory_supersede", ["node_type", "tags"]],
        ["memory_list", ["node_types", "tags_all", "tags_any"]],
        ["memory_search", ["node_types", "tags_all", "tags_any"]],
    ]) {
        for (const field of fields) assert.ok(tools[name]?.inputSchema?.properties?.[field], `${name}.${field} is absent`);
    }
}

async function lifecycleChecks(client) {
    const created = await call(client, "memory_write", {
        scope: "identity",
        key: "patterns/typed-node",
        value: "first value",
        node_type: "knowledge",
        tags: [" Release Train ", "release_train", "Zeta", "alpha", "alpha"],
    });
    assert.equal(created.isError, false);
    const first = (await call(client, "memory_read", { scope: "identity", key: "patterns/typed-node" })).structuredContent?.results?.[0];
    assert.deepEqual(nodeProjection(first), { schema_version: 1, address_space: "memory", node_type: "knowledge", tags: ["alpha", "release-train", "zeta"] });

    const badType = await call(client, "memory_write", { scope: "identity", key: "bugs/bad-type", value: "bad", node_type: "runbook" });
    assert.equal(badType.isError, true, "arbitrary unnamespaced node type was accepted");
    const extension = await call(client, "memory_write", { scope: "identity", key: "patterns/extension", value: "ok", node_type: "custom:runbook", tags: [] });
    assert.equal(extension.isError, false, "namespaced extension type was rejected");

    const legacyCreate = await call(client, "memory_write", { scope: "identity", key: "patterns/collision", value: "one" });
    assert.equal(legacyCreate.isError, false);
    const legacyOverwrite = await call(client, "memory_write", { scope: "identity", key: "patterns/collision", value: "two" });
    assert.equal(legacyOverwrite.isError, false);
    assert.equal(legacyOverwrite.structuredContent?.collisions?.length, 1, "legacy overwrite response changed");
    const typedCollision = await call(client, "memory_write", { scope: "identity", key: "patterns/typed-node", value: "different", node_type: "knowledge", tags: ["alpha"] });
    assert.equal(typedCollision.isError, true, "metadata-aware create overwrote a differing live node");

    const metadataOnly = await call(client, "memory_supersede", {
        scope: "identity",
        key: "patterns/typed-node",
        value: "first value",
        node_type: "hindsight",
        tags: ["fixed", "compiler_error"],
        reason: "classification corrected",
    });
    assert.equal(metadataOnly.isError, false);
    const replacement = await call(client, "memory_supersede", {
        scope: "identity",
        key: "patterns/typed-node",
        value: "second value",
        reason: "content corrected",
    });
    assert.equal(replacement.isError, false);
    const history = (await call(client, "memory_history", { scope: "identity", key: "patterns/typed-node" })).structuredContent;
    assert.equal(history?.history?.length, 2);
    assert.deepEqual(history.history.map((entry) => ({ value: entry.value, node_type: entry.node_type, tags: entry.tags })), [
        { value: "first value", node_type: "knowledge", tags: ["alpha", "release-train", "zeta"] },
        { value: "first value", node_type: "hindsight", tags: ["compiler-error", "fixed"] },
    ]);
    assert.deepEqual(nodeProjection(history.current_node), { schema_version: 1, address_space: "memory", node_type: "hindsight", tags: ["compiler-error", "fixed"] });

    const deleted = await call(client, "memory_delete", { scope: "identity", key: "patterns/typed-node" });
    assert.equal(deleted.structuredContent?.deleted, true);
    assert.deepEqual(deleted.structuredContent?.final_snapshot && {
        value: deleted.structuredContent.final_snapshot.value,
        node_type: deleted.structuredContent.final_snapshot.node_type,
        tags: deleted.structuredContent.final_snapshot.tags,
    }, { value: "second value", node_type: "hindsight", tags: ["compiler-error", "fixed"] });
    assert.equal((await call(client, "memory_list", { scope: "identity" })).structuredContent?.keys.includes("patterns/typed-node"), false);
    const repeatedDelete = await call(client, "memory_delete", { scope: "identity", key: "patterns/typed-node" });
    assert.equal(repeatedDelete.structuredContent?.deleted, false);
    assert.equal(repeatedDelete.structuredContent?.missing, true);
    const recreated = await call(client, "memory_write", { scope: "identity", key: "patterns/typed-node", value: "third value", node_type: "shared", tags: ["restored"] });
    assert.equal(recreated.isError, false);
}

async function searchChecks(client) {
    const fixtures = [
        ["patterns/exact-needle", "weak semantic vector", "knowledge", ["release"]],
        ["patterns/fuzzy", "needle semantic favorite", "memory", ["other"]],
        ["patterns/tagged", "unrelated", "hindsight", ["needle", "release"]],
        ["patterns/outside-top-k", "needle", "hindsight", ["eligible"]],
    ];
    for (const [key, value, node_type, tags] of fixtures) {
        const result = await call(client, "memory_write", { scope: "identity", key, value, node_type, tags });
        assert.equal(result.isError, false);
    }
    const byAll = await call(client, "memory_list", { scope: "identity", tags_all: ["needle", "release"] });
    assert.deepEqual(byAll.structuredContent?.keys, ["patterns/tagged"]);
    const byAnyAndType = await call(client, "memory_search", { scope: "identity", query: "needle", node_types: ["hindsight"], tags_any: ["eligible", "release"], top_k: 1 });
    assert.equal(byAnyAndType.structuredContent?.results?.length, 1);
    assert.equal(["patterns/outside-top-k", "patterns/tagged"].includes(byAnyAndType.structuredContent.results[0].key), true);

    const exactFirst = await call(client, "memory_search", { scope: "identity", query: "needle", top_k: 3 });
    assert.equal(exactFirst.structuredContent?.results?.[0]?.key, "patterns/exact-needle", "exact key hit did not outrank semantic score");
}

async function main() {
    const baseDir = mkdtempSync(join(tmpdir(), "cairn-typed-nodes-"));
    const embeddingServer = createServer(async (request, response) => {
        let body = "";
        for await (const chunk of request) body += chunk;
        const input = JSON.parse(body).input ?? [];
        const data = input.map((text, index) => ({
            index,
            embedding: String(text).includes("patterns/fuzzy") ? [1, 0] : String(text) === "needle" ? [1, 0] : [0, 1],
        }));
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data }));
    });
    await new Promise((resolve) => embeddingServer.listen(0, "127.0.0.1", resolve));
    const port = embeddingServer.address().port;
    const client = await connect(baseDir, {
        CAIRN_LLM_API_KEY: "test-key",
        CAIRN_MEMORY_EMBEDDING_URL: `http://127.0.0.1:${port}/v1`,
        CAIRN_MEMORY_EMBEDDING_MODEL: "test-model",
    });
    try {
        await schemaChecks(client);
        if (!process.argv.includes("--schema-only")) await lifecycleChecks(client);
        if (process.argv.includes("--search-only") || (!process.argv.includes("--service-only") && !process.argv.includes("--lifecycle-only"))) await searchChecks(client);
    } finally {
        await client.close();
        await new Promise((resolve) => embeddingServer.close(resolve));
        rmSync(baseDir, { recursive: true, force: true });
    }
}

try {
    await main();
} catch (error) {
    if (process.argv.includes("--expect-red") && error instanceof assert.AssertionError && /typed memory_import tool is absent/.test(error.message)) {
        console.error(RED_MARKER);
        process.exit(86);
    }
    throw error;
}

console.log("Phase 16 typed-node checks passed");
