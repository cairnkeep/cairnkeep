import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AgentFS } from "agentfs-sdk";

const RED_MARKER = "PHASE16_RED:MEMORY_IMPORT_TOOL_MISSING";
const SECRET = "import-secret-sentinel-7f918c";

function snapshot(root) {
    if (!existsSync(root)) return [];
    const entries = [];
    function walk(path) {
        for (const item of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const child = join(path, item.name);
            if (item.isDirectory()) walk(child);
            else entries.push([relative(root, child), statSync(child).mode & 0o777, createHash("sha256").update(readFileSync(child)).digest("hex")]);
        }
    }
    walk(root);
    return entries;
}

async function connect(baseDir, extraEnv = {}) {
    const transport = new StdioClientTransport({
        command: "node",
        args: ["dist/index.js"],
        env: { ...process.env, CAIRN_AGENTFS_BASE_DIR: baseDir, CAIRN_TYPED_MEMORY_NODES: "1", ...extraEnv },
    });
    const client = new Client({ name: "smoke-memory-import", version: "0" }, { capabilities: {} });
    await client.connect(transport);
    return client;
}

async function call(client, name, args) {
    return client.callTool({ name, arguments: args });
}

function importRequest(overrides = {}) {
    return {
        schema_version: 1,
        scope: "identity",
        address_space: "memory",
        nodes: [{ key: "knowledge/imported", value: SECRET, node_type: "knowledge", tags: ["Import Batch", "release_train"] }],
        ...overrides,
    };
}

function serializedResponse(response) {
    return JSON.stringify({ content: response.content, structuredContent: response.structuredContent });
}

async function schemaChecks(client) {
    const tools = Object.fromEntries((await client.listTools()).tools.map((tool) => [tool.name, tool]));
    assert.ok(tools.memory_import, "memory_import registration is absent");
    const schema = tools.memory_import.inputSchema;
    assert.deepEqual(schema.required, ["schema_version", "scope", "nodes"]);
    assert.equal(schema.properties.schema_version.const, 1);
    assert.equal(schema.properties.nodes.minItems, 1);
    assert.equal(schema.properties.nodes.maxItems, 256);
    assert.deepEqual(schema.properties.conflict_policy.enum, ["reject", "supersede"]);
    assert.equal(schema.properties.dry_run.type, "boolean");
    assert.equal(schema.properties.import_id.maxLength, 128);
    assert.deepEqual(schema.properties.address_space.enum, ["memory", "project-notes", "shared-notes"]);
}

async function directSchemaChecks() {
    const schema = await import("../dist/node-schema.js");
    const valid = schema.memoryImportEnvelopeSchema.parse(importRequest());
    assert.equal(valid.schema_version, 1);
    assert.equal(valid.address_space, "memory");
    assert.deepEqual(valid.nodes[0].tags, ["import-batch", "release-train"]);
    for (const request of [
        importRequest({ scope: "all" }),
        importRequest({ nodes: [] }),
        importRequest({ nodes: Array.from({ length: 257 }, (_, index) => ({ key: `knowledge/${index}`, value: "x", node_type: "knowledge", tags: [] })) }),
        importRequest({ nodes: [{ key: "knowledge/huge", value: "x".repeat(256 * 1024 + 1), node_type: "knowledge", tags: [] }] }),
    ]) {
        assert.equal(schema.memoryImportEnvelopeSchema.safeParse(request).success, false);
    }
}

async function directServiceChecks() {
    const store = await import("../dist/node-store.js");
    const baseDir = mkdtempSync(join(tmpdir(), "cairn-import-service-"));
    const dryPlan = await store.planMemoryImport(null, importRequest({ dry_run: true }));
    assert.deepEqual(dryPlan.actions, [{ key: "knowledge/imported", action: "would_create" }]);
    assert.equal(existsSync(baseDir), true);
    const agent = await AgentFS.open({ id: "identity", path: join(baseDir, "identity.db") });
    try {
        const plan = await store.planMemoryImport(agent, importRequest({ import_id: "direct-1" }));
        const created = await store.commitMemoryImport(agent, plan);
        assert.equal(created.counts.created, 1);
        const replay = await store.commitMemoryImport(agent, plan);
        assert.equal(replay.replayed, true);
        const conflict = await store.planMemoryImport(agent, importRequest({ nodes: [{ key: "knowledge/imported", value: "different", node_type: "knowledge", tags: [] }] }));
        assert.equal(conflict.conflict, true);
        await assert.rejects(() => store.commitMemoryImport(agent, conflict), /CONFLICT/);
    } finally {
        await agent.close();
        rmSync(baseDir, { recursive: true, force: true });
    }
}

async function validationAndDryRun(client, baseDir) {
    const before = snapshot(baseDir);
    const dry = await call(client, "memory_import", importRequest({ dry_run: true }));
    assert.notEqual(dry.isError, true);
    assert.match(dry.structuredContent?.batch_digest, /^[a-f0-9]{64}$/);
    assert.deepEqual(dry.structuredContent?.counts, { would_create: 1, would_replace: 0, unchanged: 0, rejected: 0 });
    assert.deepEqual(dry.structuredContent?.actions, [{ key: "knowledge/imported", action: "would_create" }]);
    assert.equal(serializedResponse(dry).includes(SECRET), false, "dry-run response disclosed a node value");
    assert.deepEqual(snapshot(baseDir), before, "dry-run changed the scratch tree");

    const invalidRequests = [
        importRequest({ scope: "all" }),
        importRequest({ nodes: [] }),
        importRequest({ nodes: Array.from({ length: 257 }, (_, index) => ({ key: `knowledge/${index}`, value: "x", node_type: "knowledge", tags: [] })) }),
        importRequest({ nodes: [{ key: "../escape", value: "x", node_type: "knowledge", tags: [] }] }),
        importRequest({ nodes: [{ key: "/absolute", value: "x", node_type: "knowledge", tags: [] }] }),
        importRequest({ nodes: [{ key: "empty//segment", value: "x", node_type: "knowledge", tags: [] }] }),
        importRequest({ nodes: [{ key: "dot/./segment", value: "x", node_type: "knowledge", tags: [] }] }),
        importRequest({ nodes: [{ key: "dot/../segment", value: "x", node_type: "knowledge", tags: [] }] }),
        importRequest({ nodes: [{ key: "back\\slash", value: "x", node_type: "knowledge", tags: [] }] }),
        importRequest({ nodes: [{ key: "__history__/forged", value: "x", node_type: "knowledge", tags: [] }] }),
        importRequest({ nodes: [{ key: "knowledge/duplicate", value: "one", node_type: "knowledge", tags: [] }, { key: "knowledge/duplicate", value: "two", node_type: "knowledge", tags: [] }] }),
        importRequest({ nodes: [{ key: "knowledge/huge", value: "x".repeat(256 * 1024 + 1), node_type: "knowledge", tags: [] }] }),
        importRequest({ nodes: [{ key: "knowledge/tags", value: "x", node_type: "knowledge", tags: Array.from({ length: 65 }, (_, index) => `tag-${index}`) }] }),
        importRequest({ nodes: [{ key: "knowledge/tag-length", value: "x", node_type: "knowledge", tags: ["x".repeat(129)] }] }),
    ];
    for (const request of invalidRequests) {
        const invalid = await call(client, "memory_import", request);
        assert.equal(invalid.isError, true, `invalid import was accepted: ${JSON.stringify(request).slice(0, 200)}`);
    }
    assert.deepEqual(snapshot(baseDir), before, "invalid imports changed the scratch tree");
}

async function serviceChecks(client) {
    const created = await call(client, "memory_import", importRequest({ import_id: "batch-1" }));
    assert.notEqual(created.isError, true);
    assert.deepEqual(created.structuredContent?.counts, { created: 1, replaced: 0, unchanged: 0, rejected: 0 });
    assert.equal(serializedResponse(created).includes(SECRET), false, "import response disclosed a node value");

    const replay = await call(client, "memory_import", importRequest({ import_id: "batch-1" }));
    assert.notEqual(replay.isError, true);
    assert.equal(replay.structuredContent?.replayed, true);
    assert.deepEqual(replay.structuredContent?.counts, { created: 0, replaced: 0, unchanged: 1, rejected: 0 });
    const contentReplay = await call(client, "memory_import", importRequest({ import_id: undefined }));
    assert.notEqual(contentReplay.isError, true);
    assert.deepEqual(contentReplay.structuredContent?.counts, { created: 0, replaced: 0, unchanged: 1, rejected: 0 });

    const divergentReplay = await call(client, "memory_import", importRequest({ import_id: "batch-1", nodes: [{ key: "knowledge/imported", value: "different", node_type: "knowledge", tags: [] }] }));
    assert.equal(divergentReplay.isError, true);
    const conflict = await call(client, "memory_import", importRequest({ import_id: "batch-2", nodes: [{ key: "knowledge/imported", value: "replacement", node_type: "hindsight", tags: ["fixed"] }] }));
    assert.equal(conflict.isError, true);
    const afterReject = await call(client, "memory_read", { scope: "identity", key: "knowledge/imported" });
    assert.equal(afterReject.structuredContent?.results?.[0]?.value, SECRET);

    const supersede = await call(client, "memory_import", importRequest({
        import_id: "batch-3",
        conflict_policy: "supersede",
        nodes: [{ key: "knowledge/imported", value: "replacement", node_type: "hindsight", tags: ["fixed"] }],
    }));
    assert.notEqual(supersede.isError, true);
    assert.equal(supersede.structuredContent?.counts?.replaced, 1);
    const history = await call(client, "memory_history", { scope: "identity", key: "knowledge/imported" });
    assert.deepEqual(history.structuredContent?.history?.map((entry) => ({ value: entry.value, node_type: entry.node_type, tags: entry.tags })), [
        { value: SECRET, node_type: "knowledge", tags: ["import-batch", "release-train"] },
    ]);

    const mixed = await call(client, "memory_import", importRequest({ nodes: [
        { key: "knowledge/would-create", value: "must roll back", node_type: "knowledge", tags: [] },
        { key: "../invalid", value: "invalid", node_type: "knowledge", tags: [] },
    ] }));
    assert.equal(mixed.isError, true);
    assert.equal((await call(client, "memory_read", { scope: "identity", key: "knowledge/would-create" })).structuredContent?.results?.length, 0);

    const concurrentRequest = importRequest({ import_id: "concurrent", nodes: [{ key: "knowledge/concurrent", value: "same", node_type: "knowledge", tags: [] }] });
    const concurrent = await Promise.all([call(client, "memory_import", concurrentRequest), call(client, "memory_import", concurrentRequest)]);
    assert.equal(concurrent.every((response) => !response.isError), true, JSON.stringify(concurrent.map((response) => response.content)));
    assert.equal(concurrent.filter((response) => response.structuredContent?.counts?.created === 1).length, 1);
}

async function injectedFailureCheck() {
    const baseDir = mkdtempSync(join(tmpdir(), "cairn-import-injected-"));
    const client = await connect(baseDir, { CAIRN_TEST_FAIL_IMPORT_AFTER: "1" });
    try {
        const response = await call(client, "memory_import", importRequest({ nodes: [
            { key: "knowledge/first", value: "one", node_type: "knowledge", tags: [] },
            { key: "knowledge/second", value: "two", node_type: "knowledge", tags: [] },
        ] }));
        assert.equal(response.isError, true);
        for (const key of ["knowledge/first", "knowledge/second"]) {
            assert.equal((await call(client, "memory_read", { scope: "identity", key })).structuredContent?.results?.length, 0);
        }
    } finally {
        await client.close();
        rmSync(baseDir, { recursive: true, force: true });
    }
}

async function main() {
    if (process.argv.includes("--schema-only")) {
        await directSchemaChecks();
        return;
    }
    if (process.argv.includes("--service-only")) {
        await directServiceChecks();
        return;
    }
    const baseDir = mkdtempSync(join(tmpdir(), "cairn-memory-import-"));
    const client = await connect(baseDir);
    try {
        await schemaChecks(client);
        await validationAndDryRun(client, baseDir);
        if (!process.argv.includes("--planning-only")) await serviceChecks(client);
    } finally {
        await client.close();
        rmSync(baseDir, { recursive: true, force: true });
    }
    if (!process.argv.includes("--planning-only")) await injectedFailureCheck();
}

try {
    await main();
} catch (error) {
    if (process.argv.includes("--expect-red") && error instanceof assert.AssertionError && /memory_import registration is absent/.test(error.message)) {
        console.error(RED_MARKER);
        process.exit(86);
    }
    throw error;
}

console.log("Phase 16 structured import checks passed");
