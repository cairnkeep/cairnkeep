import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { MCP_TOOL_CATALOG, MCP_TOOL_NAMES } from "../dist/mcp-tool-catalog.js";
import { hardenPrivatePath, privatePathIsSafe } from "../dist/platform-security.js";

const root = mkdtempSync(join(tmpdir(), "cairn-mcp-trust-"));
const project = join(root, "project");
mkdirSync(project);
const serverEntry = fileURLToPath(new URL("../dist/index.js", import.meta.url));

function environment(extra = {}) {
    const env = { ...process.env };
    for (const name of [
        "CAIRN_MCP_TOOL_PROFILE", "CAIRN_MCP_ALLOWED_TOOLS", "CAIRN_TYPED_MEMORY_NODES",
        "CAIRN_ARTIFACT_STORE", "CAIRN_ARTIFACT_HTTP", "CAIRN_CONTEXT_PACKS",
        "CAIRN_CONTEXT_PACK_HTTP", "CAIRN_CAPABILITY_CONTRACT", "MCP_HTTP_PORT",
    ]) delete env[name];
    return { ...env, CAIRN_AGENTFS_BASE_DIR: join(root, "memory"), ...extra };
}

async function tools(env = environment()) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry], cwd: project, env, stderr: "pipe" });
    const client = new Client({ name: "smoke-mcp-trust", version: "1" }, { capabilities: {} });
    await client.connect(transport);
    try { return (await client.listTools()).tools; } finally { await client.close(); }
}

function complete(tool) {
    assert.equal(tool.title, MCP_TOOL_CATALOG[tool.name].title, `${tool.name} title`);
    assert.deepEqual(tool.annotations, MCP_TOOL_CATALOG[tool.name].annotations, `${tool.name} annotations`);
    for (const key of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        assert.equal(typeof tool.annotations[key], "boolean", `${tool.name}.${key}`);
    }
}

const implicitFull = await tools();
const explicitFull = await tools(environment({ CAIRN_MCP_TOOL_PROFILE: "full" }));
assert.deepEqual(explicitFull, implicitFull, "explicit full profile must preserve discovery byte-for-byte");
implicitFull.forEach(complete);

const allGates = await tools(environment({
    CAIRN_TYPED_MEMORY_NODES: "1", CAIRN_ARTIFACT_STORE: "1", CAIRN_CONTEXT_PACKS: "1",
}));
assert.deepEqual(allGates.map(({ name }) => name), MCP_TOOL_NAMES, "whole catalog registration order");
allGates.forEach(complete);

const readOnly = await tools(environment({ CAIRN_MCP_TOOL_PROFILE: "read-only", CAIRN_TYPED_MEMORY_NODES: "1", CAIRN_ARTIFACT_STORE: "1", CAIRN_CONTEXT_PACKS: "1" }));
assert.deepEqual(readOnly.map(({ name }) => name), MCP_TOOL_NAMES.filter((name) => MCP_TOOL_CATALOG[name].annotations.readOnlyHint));
readOnly.forEach((tool) => assert.equal(tool.annotations.readOnlyHint, true));

const custom = await tools(environment({ CAIRN_MCP_TOOL_PROFILE: "custom", CAIRN_MCP_ALLOWED_TOOLS: "memory_read,context_pack_read", CAIRN_CONTEXT_PACKS: "1" }));
assert.deepEqual(custom.map(({ name }) => name), ["memory_read", "context_pack_read"]);

mkdirSync(join(project, ".ai"));
writeFileSync(join(project, ".ai", "mcp-tools.json"), `${JSON.stringify({ schema_version: 1, mode: "custom", allowed_tools: ["memory_history"] }, null, 2)}\n`, { mode: 0o600 });
hardenPrivatePath(join(project, ".ai", "mcp-tools.json"));
const configured = await tools(environment());
assert.deepEqual(configured.map(({ name }) => name), ["memory_history"]);
if (process.platform === "win32") {
    assert.equal(privatePathIsSafe(join(project, ".ai", "mcp-tools.json")), true);
} else {
    assert.equal(statSync(join(project, ".ai", "mcp-tools.json")).mode & 0o777, 0o600);
}

const statusCli = fileURLToPath(new URL("../dist/mcp-tool-cli.js", import.meta.url));
const { spawnSync } = await import("node:child_process");
const status = spawnSync(process.execPath, [statusCli, "status", "--project", project, "--json"], { encoding: "utf8", env: environment() });
assert.equal(status.status, 0, status.stderr);
const parsed = JSON.parse(status.stdout);
assert.equal(parsed.mode, "custom");
assert.match(parsed.profile_digest, /^[a-f0-9]{64}$/);

const setCustom = spawnSync(process.execPath, [statusCli, "set", "custom", "--tool", "memory_read", "memory_list", "--project", project], { encoding: "utf8", env: environment() });
assert.equal(setCustom.status, 0, setCustom.stderr);
assert.deepEqual((await tools(environment())).map(({ name }) => name), ["memory_read", "memory_list"]);
const setFull = spawnSync(process.execPath, [statusCli, "set", "full", "--project", project], { encoding: "utf8", env: environment() });
assert.equal(setFull.status, 0, setFull.stderr);
assert.deepEqual(JSON.parse(readFileSync(join(project, ".ai", "mcp-tools.json"), "utf8")).allowed_tools, [], "derived profiles persist no stale catalog snapshot");
assert.deepEqual(await tools(environment()), implicitFull, "persisted full profile preserves default discovery");
const setReadOnly = spawnSync(process.execPath, [statusCli, "set", "read-only", "--project", project], { encoding: "utf8", env: environment() });
assert.equal(setReadOnly.status, 0, setReadOnly.stderr);
assert.deepEqual((await tools(environment())).map(({ name }) => name), implicitFull.filter((tool) => tool.annotations.readOnlyHint).map(({ name }) => name));

const invalid = spawnSync(process.execPath, [serverEntry], { cwd: project, env: environment({ CAIRN_MCP_TOOL_PROFILE: "custom", CAIRN_MCP_ALLOWED_TOOLS: "not_a_tool" }), encoding: "utf8", input: "" });
assert.notEqual(invalid.status, 0, "unknown custom tool must fail startup");
assert.match(invalid.stderr, /Unknown MCP tool name/);

// Conservative clients may execute only complete read-only observations without approval.
for (const tool of allGates) {
    const observation = tool.annotations.readOnlyHint && !tool.annotations.destructiveHint;
    if (!observation) assert.equal(tool.annotations.readOnlyHint, false, `${tool.name} mutation requires approval`);
}

console.log("PASS: MCP annotation catalog, profiles, gates, and conservative classifier");
