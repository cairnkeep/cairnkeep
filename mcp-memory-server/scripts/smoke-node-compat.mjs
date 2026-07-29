import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AgentFS } from "agentfs-sdk";

const RED_MARKER = "PHASE16_RED:NODE_COMPAT_ADDITIVE_SCHEMA_MISSING";
const phase16Fields = new Set(["node_type", "tags", "node_types", "tags_all", "tags_any"]);

const baselineSchemas = {
    context_explore: { query: { type: "string", minLength: 1 }, repo_root: { type: "string", minLength: 1 }, timeout_seconds: { type: "integer", minimum: 10, maximum: 600 } },
    domain_knowledge_query: { workspace: { type: "string", minLength: 1 }, query: { type: "string", minLength: 1 } },
    domain_knowledge_sync: { workspace: { type: "string", minLength: 1 }, mode: { type: "string", enum: ["incremental", "full", "replace"] }, confirm_replace: { type: "boolean" }, timeout_seconds: { type: "integer", minimum: 30, maximum: 3600 } },
    memory_apply_reviewed: { scope: { type: "string" }, review_id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }, key: { type: "string", minLength: 1 }, value: { type: "string" } },
    memory_delete: { scope: { type: "string" }, key: { type: "string", minLength: 1 } },
    memory_extract: { scope: { type: "string" }, content: { type: "string", minLength: 1 }, model: { type: "string", minLength: 1 }, category: { type: "string", enum: ["decision", "preference", "pattern", "pitfall", "constraint", "bug", "convention"] } },
    memory_history: { scope: { type: "string" }, key: { type: "string", minLength: 1 } },
    memory_invalidate_reviewed: { scope: { type: "string" }, review_id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" }, key: { type: "string", minLength: 1 }, reason: { type: "string", maxLength: 512 } },
    memory_list: { scope: { type: "string" }, prefix: { type: "string" } },
    memory_read: { scope: { type: "string" }, key: { type: "string" }, query: { type: "string" } },
    memory_search: { scope: { type: "string" }, query: { type: "string", minLength: 1 }, top_k: { type: "integer", minimum: 1, maximum: 50 }, min_score: { type: "number", minimum: 0, maximum: 1 } },
    memory_supersede: { scope: { type: "string" }, key: { type: "string", minLength: 1 }, value: { type: "string" }, reason: { type: "string" } },
    memory_write: { scope: { type: "string" }, key: { type: "string", minLength: 1 }, value: { type: "string" }, promote_to: { type: "string" } },
    route_check: { timeout_seconds: { type: "integer", minimum: 1, maximum: 60 } },
};

const baselineRequired = {
    context_explore: ["query"],
    domain_knowledge_query: ["query"],
    domain_knowledge_sync: [],
    memory_apply_reviewed: ["scope", "review_id", "key", "value"],
    memory_delete: ["scope", "key"],
    memory_extract: ["scope", "content"],
    memory_history: ["scope", "key"],
    memory_invalidate_reviewed: ["scope", "review_id", "key"],
    memory_list: ["scope"],
    memory_read: ["scope"],
    memory_search: ["scope", "query"],
    memory_supersede: ["scope", "key", "value"],
    memory_write: ["scope", "key", "value"],
    route_check: [],
};

function sorted(value) {
    return [...value].sort((left, right) => left.localeCompare(right));
}

function databaseShape(path) {
    const database = new DatabaseSync(path, { readOnly: true });
    try {
        return {
            tables: database.prepare("SELECT name FROM sqlite_master WHERE type = ? ORDER BY name").all("table").map(({ name }) => name),
            legacyHex: database.prepare("SELECT hex(value) AS value_hex FROM kv_store WHERE key = ?").get("legacy/raw")?.value_hex,
        };
    } finally {
        database.close();
    }
}

async function seedLegacy(path) {
    const agent = await AgentFS.open({ id: "identity", path });
    try {
        await agent.kv.set("legacy/raw", "Legacy bytes: \u0000 café \ud83e\udea8");
    } finally {
        await agent.close();
    }
}

async function connect(baseDir, enabled) {
    const env = { ...process.env, CAIRN_AGENTFS_BASE_DIR: baseDir, NODE_NO_WARNINGS: "1" };
    if (enabled) env.CAIRN_TYPED_MEMORY_NODES = "1";
    else delete env.CAIRN_TYPED_MEMORY_NODES;
    const transport = new StdioClientTransport({ command: "node", args: ["dist/index.js"], env });
    const client = new Client({ name: "smoke-node-compat", version: "0" }, { capabilities: {} });
    await client.connect(transport);
    return { client, transport };
}

function assertDisabledSchemas(tools) {
    const names = sorted(tools.map(({ name }) => name));
    assert.deepEqual(names, sorted(Object.keys(baselineSchemas)), "disabled tools/list names drifted");
    assert.equal(names.includes("memory_import"), false);
    for (const alias of ["memory_edit", "memory_update", "memory_remove"]) {
        assert.equal(names.includes(alias), false, `${alias} must not be introduced`);
    }
    for (const tool of tools) {
        assert.equal(tool.inputSchema.type, "object", `${tool.name} schema type changed`);
        assert.deepEqual(tool.inputSchema.properties, baselineSchemas[tool.name], `${tool.name} properties drifted`);
        assert.deepEqual(sorted(tool.inputSchema.required ?? []), sorted(baselineRequired[tool.name]), `${tool.name} required fields drifted`);
    }
}

async function disabledContract() {
    const baseDir = mkdtempSync(join(tmpdir(), "cairn-node-compat-disabled-"));
    const dbPath = join(baseDir, "identity.db");
    try {
        await seedLegacy(dbPath);
        const before = databaseShape(dbPath);
        const beforeFiles = sorted(readdirSync(baseDir));
        const { client } = await connect(baseDir, false);
        try {
            const tools = await client.listTools();
            assertDisabledSchemas(tools.tools);
            const read = await client.callTool({ name: "memory_read", arguments: { scope: "identity", key: "legacy/raw" } });
            assert.deepEqual(read.structuredContent, { results: [{ scope: "identity", key: "legacy/raw", value: "Legacy bytes: \u0000 café \ud83e\udea8" }] });
            const list = await client.callTool({ name: "memory_list", arguments: { scope: "identity" } });
            assert.deepEqual(list.structuredContent, { keys: ["legacy/raw"] });
        } finally {
            await client.close();
        }
        const after = databaseShape(dbPath);
        assert.deepEqual(after, before, "disabled reads changed the database schema or raw legacy cell bytes");
        assert.deepEqual(sorted(readdirSync(baseDir)), beforeFiles, "disabled reads initialized a file or cache");
    } finally {
        rmSync(baseDir, { recursive: true, force: true });
    }
}

async function enabledContract() {
    const baseDir = mkdtempSync(join(tmpdir(), "cairn-node-compat-enabled-"));
    const dbPath = join(baseDir, "identity.db");
    try {
        await seedLegacy(dbPath);
        const beforeHex = databaseShape(dbPath).legacyHex;
        const { client } = await connect(baseDir, true);
        try {
            const listed = await client.listTools();
            const byName = Object.fromEntries(listed.tools.map((tool) => [tool.name, tool]));
            assert.ok(byName.memory_import, "memory_import is absent");
            assert.deepEqual(sorted(Object.keys(byName.memory_write.inputSchema.properties).filter((name) => phase16Fields.has(name))), ["node_type", "tags"]);
            assert.deepEqual(sorted(Object.keys(byName.memory_supersede.inputSchema.properties).filter((name) => phase16Fields.has(name))), ["node_type", "tags"]);
            for (const name of ["memory_list", "memory_search"]) {
                assert.deepEqual(sorted(Object.keys(byName[name].inputSchema.properties).filter((field) => phase16Fields.has(field))), ["node_types", "tags_all", "tags_any"]);
            }
            for (const alias of ["memory_edit", "memory_update", "memory_remove"]) {
                assert.equal(Boolean(byName[alias]), false, `${alias} must not be introduced`);
            }
            const read = await client.callTool({ name: "memory_read", arguments: { scope: "identity", key: "legacy/raw" } });
            const node = read.structuredContent?.results?.[0];
            assert.deepEqual(node && { schema_version: node.schema_version, node_type: node.node_type, tags: node.tags, address_space: node.address_space }, {
                schema_version: 1,
                node_type: "memory",
                tags: [],
                address_space: "memory",
            });
        } finally {
            await client.close();
        }
        assert.equal(databaseShape(dbPath).legacyHex, beforeHex, "typed projection rewrote raw legacy bytes");
    } finally {
        rmSync(baseDir, { recursive: true, force: true });
    }
}

const disabledOnly = process.argv.includes("--disabled-only");
const expectRed = process.argv.includes("--expect-red");

await disabledContract();
if (!disabledOnly) {
    try {
        await enabledContract();
    } catch (error) {
        if (expectRed && error instanceof assert.AssertionError && /memory_import is absent|actual.*undefined|Expected values/.test(error.message)) {
            console.error(RED_MARKER);
            process.exit(86);
        }
        throw error;
    }
}

console.log("Phase 16 node compatibility checks passed");
