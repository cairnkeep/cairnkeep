import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const RED_MARKER = "PHASE16_RED:NOTE_JOURNALED_LIFECYCLE_MISSING";
const MANUAL_SUFFIX = "\n## Maintainer notes\n\nPreserve these exact maintainer bytes.\n";
const SERVER_ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "index.js");

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

async function connect(baseDir, projectRoot) {
    const transport = new StdioClientTransport({
        command: "node",
        args: [SERVER_ENTRY],
        cwd: projectRoot,
        env: { ...process.env, CAIRN_AGENTFS_BASE_DIR: baseDir, CAIRN_TYPED_MEMORY_NODES: "1" },
    });
    const client = new Client({ name: "smoke-note-mcp", version: "0" }, { capabilities: {} });
    await client.connect(transport);
    return client;
}

async function call(client, name, args) {
    return client.callTool({ name, arguments: args });
}

function baseRecord(id = "knowledge-note") {
    const now = "2026-07-26T12:00:00.000Z";
    return {
        schema_version: 1,
        id,
        title: "Lossless note",
        description: "A nested note record used by the MCP lifecycle contract.",
        keywords: ["lossless", "nested"],
        node_type: "knowledge",
        tags: ["mcp", "note-tree"],
        occurrences: [{
            session_id: "note-mcp-session",
            session_digest: "a".repeat(64),
            ended_at: now,
            sequence: 1,
            outcome: "resolution",
            evidence: "The canonical Markdown record round-tripped.",
        }],
        created_at: now,
        updated_at: now,
    };
}

function noteArgs(record, overrides = {}) {
    return { scope: "project", address_space: "project-notes", key: `knowledge/${record.id}`, value: JSON.stringify(record), node_type: record.node_type, tags: record.tags, ...overrides };
}

async function addressedCapability(client) {
    const tools = Object.fromEntries((await client.listTools()).tools.map((tool) => [tool.name, tool]));
    for (const name of ["memory_read", "memory_write", "memory_list", "memory_search", "memory_supersede", "memory_delete", "memory_import"]) {
        assert.ok(tools[name]?.inputSchema?.properties?.address_space, `addressed note capability is absent from ${name}`);
    }
}

async function crudChecks(client, storeRoot) {
    const record = baseRecord();
    const created = await call(client, "memory_write", noteArgs(record));
    assert.notEqual(created.isError, true, JSON.stringify(created));
    const read = await call(client, "memory_read", { scope: "project", address_space: "project-notes", key: `knowledge/${record.id}` });
    assert.deepEqual(JSON.parse(read.structuredContent?.results?.[0]?.value), record);
    assert.deepEqual({ node_type: read.structuredContent.results[0].node_type, tags: read.structuredContent.results[0].tags }, { node_type: record.node_type, tags: record.tags });
    const notePath = read.structuredContent.results[0].path;
    writeFileSync(notePath, `${readFileSync(notePath, "utf8")}${MANUAL_SUFFIX}`);

    const listed = await call(client, "memory_list", { scope: "project", address_space: "project-notes", prefix: "knowledge/" });
    assert.equal(listed.structuredContent?.keys.includes(`knowledge/${record.id}`), true);
    const searched = await call(client, "memory_search", { scope: "project", address_space: "project-notes", query: "Lossless note" });
    assert.equal(searched.structuredContent?.results?.[0]?.key, `knowledge/${record.id}`);

    const replacement = { ...record, description: "Updated without losing nested fields.", updated_at: "2026-07-26T12:01:00.000Z" };
    const superseded = await call(client, "memory_supersede", noteArgs(replacement, { reason: "test update" }));
    assert.notEqual(superseded.isError, true, JSON.stringify(superseded));
    assert.equal(readFileSync(notePath, "utf8").endsWith(MANUAL_SUFFIX), true);
    const history = await call(client, "memory_history", { scope: "project", address_space: "project-notes", key: `knowledge/${record.id}` });
    assert.deepEqual(JSON.parse(history.structuredContent?.history?.[0]?.value), record);

    const importedRecord = baseRecord("imported-note");
    const importRequest = { schema_version: 1, scope: "project", address_space: "project-notes", import_id: "note-batch-1", nodes: [{ key: `knowledge/${importedRecord.id}`, value: JSON.stringify(importedRecord), node_type: importedRecord.node_type, tags: importedRecord.tags }] };
    const imported = await call(client, "memory_import", importRequest);
    assert.notEqual(imported.isError, true);
    const replayed = await call(client, "memory_import", importRequest);
    assert.equal(replayed.structuredContent?.replayed, true);
    const divergentReplay = await call(client, "memory_import", { ...importRequest, nodes: [{ ...importRequest.nodes[0], value: JSON.stringify({ ...importedRecord, description: "Divergent replay." }) }] });
    assert.equal(divergentReplay.isError, true);
    const importedReplacement = { ...importedRecord, description: "Replaced through note import.", updated_at: "2026-07-26T12:02:00.000Z" };
    const replacedImport = await call(client, "memory_import", { ...importRequest, import_id: "note-batch-2", conflict_policy: "supersede", nodes: [{ ...importRequest.nodes[0], value: JSON.stringify(importedReplacement) }] });
    assert.notEqual(replacedImport.isError, true);
    const importedHistory = await call(client, "memory_history", { scope: "project", address_space: "project-notes", key: `knowledge/${importedRecord.id}` });
    assert.deepEqual(JSON.parse(importedHistory.structuredContent?.history?.[0]?.value), importedRecord);

    const unmanaged = join(storeRoot, "notes", "projects", "unmanaged-collision.md");
    mkdirSync(join(storeRoot, "notes", "projects"), { recursive: true });
    writeFileSync(unmanaged, "unmanaged exact bytes\n");
    const collision = await call(client, "memory_write", noteArgs(baseRecord("unmanaged-collision"), { key: "../unmanaged-collision" }));
    assert.equal(collision.isError, true);
    assert.equal(readFileSync(unmanaged, "utf8"), "unmanaged exact bytes\n");

    const deleted = await call(client, "memory_delete", { scope: "project", address_space: "project-notes", key: `knowledge/${record.id}` });
    assert.equal(deleted.structuredContent?.deleted, true);
    assert.deepEqual(JSON.parse(deleted.structuredContent?.final_snapshot?.value), replacement);
    assert.equal(existsSync(notePath), false);
    assert.equal(snapshot(storeRoot).some(([path]) => path.endsWith("project.db")), false, "note values entered AgentFS");
}

async function transactionChecks(storeRoot, projectRoot) {
    const module = await import("../dist/note-store.js");
    assert.equal(typeof module.applyNoteMutation, "function", "note journal mutation seam is absent");
    assert.equal(typeof module.repairNoteTransactions, "function", "note journal repair seam is absent");
    const operations = ["create", "supersede", "delete", "import"];
    const states = ["prepared", "committing", "committed"];
    for (const operation of operations) {
        for (const state of states) {
            const root = join(storeRoot, "crash", operation, state);
            mkdirSync(projectRoot, { recursive: true });
            const fixture = await module.createNoteMutationFixture({ projectRoot, storeRoot: root, operation });
            const before = snapshot(root);
            await assert.rejects(() => module.applyNoteMutation({ ...fixture, inject_failure: state, failure_mode: "exception" }));
            const blocked = await module.applyNoteMutation({ ...fixture, operation: "create", probe_only: true });
            assert.equal(blocked.status, "recovery_required");
            const repairedException = await module.repairNoteTransactions({ storeRoot: root });
            assert.equal(repairedException.repaired, 1);
            if (state === "committed") assert.notDeepEqual(snapshot(root), before, `${operation}/${state} incorrectly rolled back`);
            else assert.deepEqual(snapshot(root), before, `${operation}/${state} failed to roll back exactly`);

            await assert.rejects(() => module.applyNoteMutation({ ...fixture, inject_failure: state, failure_mode: "termination" }));
            const repairedTermination = await module.repairNoteTransactions({ storeRoot: root });
            assert.equal(repairedTermination.repaired, 1);
            assert.equal(snapshot(root).some(([path]) => path.includes("transactions/")), false, `${operation}/${state} left a transaction directory`);
        }
    }
}

async function httpProjectIdentityCheck(storeRoot) {
    const port = 10500 + (process.pid % 500);
    const token = "note-mcp-http-token";
    const server = spawn(process.execPath, [SERVER_ENTRY], {
        env: {
            ...process.env,
            MCP_HTTP_PORT: String(port),
            MCP_HTTP_HOST: "127.0.0.1",
            CAIRN_MEMORY_HTTP_TOKEN: token,
            CAIRN_AGENTFS_BASE_DIR: storeRoot,
            CAIRN_TYPED_MEMORY_NODES: "1",
        },
    });
    await new Promise((resolveReady, reject) => {
        const timer = setTimeout(() => reject(new Error("note MCP HTTP server did not start")), 5000);
        server.stderr.on("data", (chunk) => {
            if (chunk.toString().includes("listening on")) {
                clearTimeout(timer);
                resolveReady();
            }
        });
        server.once("exit", (code) => {
            clearTimeout(timer);
            reject(new Error(`note MCP HTTP server exited early: ${code}`));
        });
    });
    const client = new Client({ name: "smoke-note-http", version: "0" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}`, "X-Cairn-Project": "note-http-project", "X-Cairn-Scopes": "project" } },
    });
    try {
        await client.connect(transport);
        const record = baseRecord("http-note");
        const created = await call(client, "memory_write", noteArgs(record));
        assert.notEqual(created.isError, true);
        const read = await call(client, "memory_read", { scope: "project", address_space: "project-notes", key: `knowledge/${record.id}` });
        assert.deepEqual(JSON.parse(read.structuredContent?.results?.[0]?.value), record);
        assert.match(read.structuredContent?.results?.[0]?.path, /note-http-project/);
    } finally {
        await client.close().catch(() => {});
        server.kill("SIGINT");
        await new Promise((resolveExit) => server.once("exit", resolveExit)).catch(() => {});
    }
}

async function main() {
    const scratch = mkdtempSync(join(tmpdir(), "cairn-note-mcp-"));
    const storeRoot = join(scratch, "store");
    const projectRoot = join(scratch, "project");
    mkdirSync(projectRoot, { recursive: true });
    const client = await connect(storeRoot, projectRoot);
    try {
        await addressedCapability(client);
        if (!process.argv.includes("--planning-only") && !process.argv.includes("--transaction-only")) await crudChecks(client, storeRoot);
    } finally {
        await client.close();
    }
    if (!process.argv.includes("--planning-only") && !process.argv.includes("--transaction-only")) await httpProjectIdentityCheck(storeRoot);
    if (!process.argv.includes("--planning-only") && !process.argv.includes("--crud-only")) await transactionChecks(storeRoot, projectRoot);
    rmSync(scratch, { recursive: true, force: true });
}

try {
    await main();
} catch (error) {
    if (process.argv.includes("--expect-red") && error instanceof assert.AssertionError && /addressed note capability is absent/.test(error.message)) {
        console.error(RED_MARKER);
        process.exit(86);
    }
    throw error;
}

console.log("Phase 16 canonical note MCP checks passed");
