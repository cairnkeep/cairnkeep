import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const EXPECTED_RED_EXIT = 86;
const RED_MARKER = "PHASE18_RED:CAPABILITY_MCP_MISSING";
const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");
const projectRoot = resolve(serverRoot, "..");
const serverEntry = join(serverRoot, "dist", "index.js");
const LEGACY_TOOL_NAMES = [
    "memory_read",
    "memory_write",
    "memory_list",
    "memory_delete",
    "memory_search",
    "memory_extract",
    "memory_supersede",
    "memory_apply_reviewed",
    "memory_invalidate_reviewed",
    "memory_history",
    "domain_knowledge_query",
    "domain_knowledge_sync",
    "context_explore",
    "route_check",
];
const MAPPED_TOOLS = new Map([
    ["memory.write", "memory_write"],
    ["memory.search", "memory_search"],
    ["route.check", "route_check"],
    ["context.explore", "context_explore"],
]);
const CAPABILITY_ENV = new Map([
    ["memory.write", "CAIRN_CAPABILITY_MEMORY_WRITE"],
    ["memory.search", "CAIRN_CAPABILITY_MEMORY_SEARCH"],
    ["route.check", "CAIRN_CAPABILITY_ROUTE_CHECK"],
    ["context.explore", "CAIRN_CAPABILITY_CONTEXT_EXPLORE"],
]);
const CAPABILITY_ENV_KEYS = [
    "CAIRN_CAPABILITY_CONTRACT",
    "CAIRN_CAPABILITY_LOGGING",
    ...CAPABILITY_ENV.values(),
];
const EXPECTED_MAPPED_DEFINITIONS = {
    memory_write: {
        name: "memory_write",
        description: "Write a memory entry to a scoped AgentFS database and optionally promote it.",
        inputSchema: {
            type: "object",
            properties: {
                scope: { type: "string" },
                key: { type: "string", minLength: 1 },
                value: { type: "string" },
                promote_to: { type: "string" },
            },
            required: ["scope", "key", "value"],
            $schema: "http://json-schema.org/draft-07/schema#",
        },
        execution: { taskSupport: "forbidden" },
    },
    memory_search: {
        name: "memory_search",
        description: "Semantic search across AgentFS memory scopes using the configured embedding endpoint, ranked by cosine similarity. Falls back to substring matching when embeddings are unavailable. Use this to find memory by meaning rather than by exact key.",
        inputSchema: {
            type: "object",
            properties: {
                scope: { type: "string" },
                query: { type: "string", minLength: 1 },
                top_k: { type: "integer", minimum: 1, maximum: 50 },
                min_score: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["scope", "query"],
            $schema: "http://json-schema.org/draft-07/schema#",
        },
        annotations: { readOnlyHint: true },
        execution: { taskSupport: "forbidden" },
    },
    context_explore: {
        name: "context_explore",
        description: "Delegate a natural-language repo-exploration query to the external token_miser explore binary (FastContext-backed). Returns compact path:line-range citations. Requires CAIRN_EXPLORE_BINARY (absolute path to the token_miser binary) and a repo_root (per-call param or CAIRN_EXPLORE_REPO_ROOT env). Thin adapter — token_miser owns all exploration logic.",
        inputSchema: {
            type: "object",
            properties: {
                query: { type: "string", minLength: 1 },
                repo_root: { type: "string", minLength: 1 },
                timeout_seconds: { type: "integer", minimum: 10, maximum: 600 },
            },
            required: ["query"],
            $schema: "http://json-schema.org/draft-07/schema#",
        },
        execution: { taskSupport: "forbidden" },
    },
    route_check: {
        name: "route_check",
        description: "Check reachability of the external token_miser routing/tiering proxy via its /health endpoint. Requires CAIRN_ROUTE_ENDPOINT (base URL of an already-running token_miser instance). Thin adapter — token_miser owns all routing/tiering logic; this tool neither hosts a proxy nor learns which tier serves a request.",
        inputSchema: {
            type: "object",
            properties: {
                timeout_seconds: { type: "integer", minimum: 1, maximum: 60 },
            },
            $schema: "http://json-schema.org/draft-07/schema#",
        },
        execution: { taskSupport: "forbidden" },
    },
};

function parseMode() {
    const [mode, ...extra] = process.argv.slice(2);
    assert.equal(extra.length, 0, "smoke-capability-mcp accepts at most one mode");
    assert.equal([undefined, "--baseline", "--registration-only", "--expect-red"].includes(mode), true, `Unknown smoke-capability-mcp mode: ${String(mode)}`);
    return mode;
}

function cleanEnvironment(extra = {}) {
    const env = { ...process.env };
    for (const key of CAPABILITY_ENV_KEYS) delete env[key];
    delete env.CAIRN_TRAJECTORY_CAPTURE;
    delete env.CAIRN_EXPLORE_BINARY;
    delete env.CAIRN_EXPLORE_REPO_ROOT;
    delete env.CAIRN_ROUTE_ENDPOINT;
    delete env.CAIRN_LLM_API_KEY;
    delete env.CAIRN_LLM_API_URL;
    delete env.CAIRN_MEMORY_EMBEDDING_MODEL;
    delete env.CAIRN_TYPED_MEMORY_NODES;
    delete env.CAIRN_ARTIFACT_STORE;
    delete env.CAIRN_ARTIFACT_HTTP;
    delete env.CAIRN_AGENTFS_BASE_DIR;
    delete env.MCP_HTTP_PORT;
    delete env.CAIRN_MEMORY_HTTP_TOKEN;
    return Object.assign(env, extra);
}

function contractEnvironment(overrides = {}) {
    return cleanEnvironment({
        CAIRN_CAPABILITY_CONTRACT: "1",
        CAIRN_CAPABILITY_MEMORY_WRITE: "1",
        CAIRN_CAPABILITY_MEMORY_SEARCH: "1",
        CAIRN_CAPABILITY_ROUTE_CHECK: "1",
        CAIRN_CAPABILITY_CONTEXT_EXPLORE: "1",
        ...overrides,
    });
}

async function withClient({ cwd, env, label }, operation) {
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverEntry],
        cwd,
        env,
        stderr: "pipe",
    });
    let stderr = "";
    if (transport.stderr) transport.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const client = new Client({ name: `smoke-capability-mcp-${label}`, version: "0" }, { capabilities: {} });
    await client.connect(transport);
    try {
        return await operation(client, () => stderr);
    } finally {
        await client.close();
    }
}

function byName(tools) {
    return Object.fromEntries(tools.map((tool) => [tool.name, tool]));
}

function assertLegacyTools(tools) {
    assert.deepEqual(tools.map(({ name }) => name), LEGACY_TOOL_NAMES, "master-off tool order changed");
    const definitions = byName(tools);
    for (const [name, expected] of Object.entries(EXPECTED_MAPPED_DEFINITIONS)) {
        assert.deepEqual(definitions[name], expected, `${name} public definition changed from the pre-Phase-18 baseline`);
    }
}

async function listTools(root, env, label) {
    return withClient({ cwd: root, env, label }, async (client, stderr) => {
        const result = await client.listTools();
        assert.equal(stderr(), "", `${label} wrote server diagnostics during tools/list`);
        return result.tools;
    });
}

function filesystemSnapshot(root) {
    const walk = (directory, prefix = "") => {
        if (!existsSync(directory)) return [];
        return readdirSync(directory).flatMap((name) => {
            const absolute = join(directory, name);
            const relative = join(prefix, name);
            return statSync(absolute).isDirectory()
                ? [relative, ...walk(absolute, relative)]
                : [relative];
        });
    };
    return walk(root).sort();
}

async function baselineIdentity() {
    const packageJson = JSON.parse(readFileSync(join(serverRoot, "package.json"), "utf8"));
    assert.equal(packageJson.scripts["check:capability-mcp"], "node scripts/smoke-capability-mcp.mjs");
    assert.equal(packageJson.scripts["test:smoke"].includes("check:capability-mcp"), false, "MCP RED contract entered the default suite");

    const root = mkdtempSync(join(tmpdir(), "cairn-capability-mcp-baseline-"));
    try {
        const configPath = join(root, ".ai", "capabilities.json");
        mkdirSync(dirname(configPath), { recursive: true });
        writeFileSync(configPath, "{ malformed-capability-config sentinel-private-value\n", { mode: 0o600 });
        const beforeBytes = readFileSync(configPath);
        const beforeFiles = filesystemSnapshot(root);
        const tools = await listTools(root, cleanEnvironment(), "baseline");
        assertLegacyTools(tools);
        assert.deepEqual(readFileSync(configPath), beforeBytes, "master-off tools/list changed malformed configuration bytes");
        assert.deepEqual(filesystemSnapshot(root), beforeFiles, "master-off tools/list performed config, digest, UUID, timer, or DB work");
        return tools;
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function missingConditionalRegistration(message) {
    const error = new Error(message);
    error.code = "ERR_CAPABILITY_MCP_MISSING";
    return error;
}

async function registrationChecks() {
    const baseline = await baselineIdentity();
    const root = mkdtempSync(join(tmpdir(), "cairn-capability-registration-"));
    try {
        const allEnabled = await listTools(root, contractEnvironment(), "all-enabled");
        assert.deepEqual(allEnabled, baseline, "all-enabled MCP surface changed public order or definitions");
        const baselineNames = baseline.map(({ name }) => name);
        for (const [capabilityId, toolName] of MAPPED_TOOLS) {
            const envKey = CAPABILITY_ENV.get(capabilityId);
            const actual = await listTools(root, contractEnvironment({ [envKey]: "0" }), `disabled-${capabilityId}`);
            if (actual.map(({ name }) => name).includes(toolName)) {
                if (actual.map(({ name }) => name).join("\n") === baselineNames.join("\n")) {
                    throw missingConditionalRegistration(`${toolName} remains registered when ${capabilityId} is disabled`);
                }
                throw new Error(`${toolName} remains registered alongside an unexpected tool-list mutation`);
            }
            const expected = baseline.filter(({ name }) => name !== toolName);
            assert.deepEqual(actual, expected, `${capabilityId} changed an adjacent tool, retained order, or public definition`);
            for (const adjacent of ["memory_delete", "memory_supersede", "memory_extract"]) {
                assert.equal(actual.some(({ name }) => name === adjacent), true, `${capabilityId} removed adjacent ${adjacent}`);
            }
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

async function captureCall(client, name, args) {
    try {
        return { kind: "result", value: await client.callTool({ name, arguments: args }) };
    } catch (error) {
        return {
            kind: "throw",
            value: {
                name: error instanceof Error ? error.name : typeof error,
                message: error instanceof Error ? error.message : String(error),
                code: error && typeof error === "object" && "code" in error ? error.code : undefined,
            },
        };
    }
}

async function memoryBehavior(env, label) {
    const root = mkdtempSync(join(tmpdir(), `cairn-capability-memory-${label}-`));
    try {
        const actualEnv = { ...env, CAIRN_AGENTFS_BASE_DIR: join(root, "memory") };
        return await withClient({ cwd: root, env: actualEnv, label }, async (client, stderr) => {
            const write = await captureCall(client, "memory_write", {
                scope: "identity",
                key: "patterns/capability-contract",
                value: "stable-memory-value",
            });
            const search = await captureCall(client, "memory_search", {
                scope: "identity",
                query: "stable-memory-value",
                top_k: 3,
            });
            const precondition = await captureCall(client, "memory_write", {
                scope: "identity",
                key: "reviewed/forbidden",
                value: "must-fail",
            });
            return { write, search, precondition, stderr: stderr() };
        });
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function startFixtureServer(handler) {
    const paths = [];
    let calls = 0;
    const server = createServer((request, response) => {
        calls += 1;
        paths.push(request.url);
        handler(request, response);
    });
    return new Promise((resolvePromise) => {
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            resolvePromise({
                url: `http://127.0.0.1:${address.port}`,
                paths,
                calls: () => calls,
                close: () => new Promise((done) => server.close(done)),
            });
        });
    });
}

async function routePair(label, handler, args = {}) {
    const fixture = await startFixtureServer(handler);
    const root = mkdtempSync(join(tmpdir(), `cairn-capability-route-${label}-`));
    try {
        const invoke = (env, suffix) => withClient({ cwd: root, env: { ...env, CAIRN_ROUTE_ENDPOINT: fixture.url }, label: `${label}-${suffix}` }, async (client, stderr) => ({
            call: await captureCall(client, "route_check", args),
            stderr: stderr(),
        }));
        const baseline = await invoke(cleanEnvironment(), "baseline");
        assert.equal(fixture.calls(), 1, `${label} baseline route call did not invoke exactly one delegate request`);
        const enabled = await invoke(contractEnvironment(), "enabled");
        assert.equal(fixture.calls(), 2, `${label} enabled route call did not invoke exactly one delegate request`);
        assert.deepEqual(enabled, baseline, `${label} route result/error/timeout or stderr changed`);
        assert.deepEqual(fixture.paths, ["/health", "/health"], `${label} route ownership drifted from one GET /health per call`);
    } finally {
        await fixture.close();
        rmSync(root, { recursive: true, force: true });
    }
}

function createExploreFixture(root) {
    const binary = join(root, "token-miser-fixture.mjs");
    const log = join(root, "explore-calls.ndjson");
    writeFileSync(binary, `#!/usr/bin/env node\nimport { appendFileSync } from "node:fs";\nconst args = process.argv.slice(2);\nappendFileSync(process.env.CAIRN_EXPLORE_SPY_LOG, JSON.stringify(args) + "\\n");\nconst query = args[args.indexOf("--query") + 1];\nif (query === "returned-error") { process.stderr.write("fixed-delegate-error"); process.exit(7); }\nif (query === "timeout") { setTimeout(() => {}, 12000); }\nelse { process.stdout.write(JSON.stringify({ schema_version: 1, query, citations: [{ path: "src/fixture.ts", start_line: 4, end_line: 8 }], stats: { turns: 1, tool_calls: 1 } })); }\n`, { mode: 0o700 });
    chmodSync(binary, 0o700);
    return { binary, log };
}

async function explorePair(query, timeoutSeconds = 10) {
    const root = mkdtempSync(join(tmpdir(), `cairn-capability-explore-${query}-`));
    try {
        const fixture = createExploreFixture(root);
        const common = {
            CAIRN_EXPLORE_BINARY: fixture.binary,
            CAIRN_EXPLORE_REPO_ROOT: root,
            CAIRN_EXPLORE_CACHE: "0",
            CAIRN_EXPLORE_SPY_LOG: fixture.log,
        };
        const invoke = (env, label) => withClient({ cwd: root, env: { ...env, ...common }, label }, async (client, stderr) => ({
            call: await captureCall(client, "context_explore", { query, timeout_seconds: timeoutSeconds }),
            stderr: stderr(),
        }));
        const baseline = await invoke(cleanEnvironment(), `${query}-baseline`);
        const enabled = await invoke(contractEnvironment(), `${query}-enabled`);
        assert.deepEqual(enabled, baseline, `${query} explore result/error/timeout or stderr changed`);
        const calls = readFileSync(fixture.log, "utf8").trim().split("\n").map((line) => JSON.parse(line));
        assert.equal(calls.length, 2, `${query} explore did not invoke its delegate exactly once per call`);
        for (const args of calls) {
            assert.deepEqual(args, ["explore", "--query", query, "--repo-root", root], `${query} moved or changed the external binary seam`);
        }
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

async function preconditionPair(tool, args, baselineEnv, enabledEnv) {
    const root = mkdtempSync(join(tmpdir(), `cairn-capability-precondition-${tool}-`));
    try {
        const invoke = (env, label) => withClient({ cwd: root, env, label }, async (client, stderr) => ({
            call: await captureCall(client, tool, args),
            stderr: stderr(),
        }));
        const baseline = await invoke(baselineEnv, `${tool}-precondition-baseline`);
        const enabled = await invoke(enabledEnv, `${tool}-precondition-enabled`);
        assert.deepEqual(enabled, baseline, `${tool} thrown precondition contract changed`);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

async function behaviorChecks() {
    const baselineMemory = await memoryBehavior(cleanEnvironment(), "baseline");
    const enabledMemory = await memoryBehavior(contractEnvironment(), "enabled");
    assert.deepEqual(enabledMemory, baselineMemory, "enabled memory schemas/results/preconditions/stderr changed");
    assert.equal(baselineMemory.stderr, "");

    await preconditionPair("route_check", {}, cleanEnvironment(), contractEnvironment());
    await preconditionPair("context_explore", { query: "missing-binary", repo_root: projectRoot }, cleanEnvironment(), contractEnvironment());
    await routePair("success", (_request, response) => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ status: "ok", cluster_healthy: true }));
    });
    await routePair("returned-failure", (_request, response) => {
        response.writeHead(503, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ status: "unhealthy" }));
    });
    await routePair("timeout", () => {}, { timeout_seconds: 1 });
    await explorePair("success");
    await explorePair("returned-error");
    await explorePair("timeout");
}

async function loggingFaultIdentity() {
    const normalRoot = mkdtempSync(join(tmpdir(), "cairn-capability-mcp-log-normal-"));
    const faultRoot = mkdtempSync(join(tmpdir(), "cairn-capability-mcp-log-fault-"));
    try {
        mkdirSync(join(faultRoot, ".agentfs", "trajectory.db"), { recursive: true });
        const invoke = (root, label) => withClient({
            cwd: root,
            env: contractEnvironment({
                CAIRN_CAPABILITY_LOGGING: "1",
                CAIRN_TRAJECTORY_CAPTURE: "1",
                CAIRN_AGENTFS_BASE_DIR: join(root, "memory"),
            }),
            label,
        }, async (client, stderr) => ({
            call: await captureCall(client, "memory_search", { scope: "identity", query: "absent-value" }),
            stderr: stderr(),
        }));
        const normal = await invoke(normalRoot, "logging-normal");
        const fault = await invoke(faultRoot, "logging-fault");
        assert.deepEqual(fault, normal, "callback store open failure changed MCP result or diagnostics");
        assert.equal(existsSync(join(normalRoot, ".agentfs", "trajectory.db")), true, "eligible stdio callback did not create a local final record");
    } finally {
        rmSync(normalRoot, { recursive: true, force: true });
        rmSync(faultRoot, { recursive: true, force: true });
    }
}

async function main() {
    const mode = parseMode();
    if (mode === "--baseline") {
        await baselineIdentity();
        console.log("PASS: capability MCP master-off baseline");
        return;
    }
    if (mode === "--expect-red") {
        try {
            await registrationChecks();
        } catch (error) {
            if (error?.code === "ERR_CAPABILITY_MCP_MISSING") {
                console.log(RED_MARKER);
                process.exitCode = EXPECTED_RED_EXIT;
                return;
            }
            throw error;
        }
        throw new Error("Capability MCP conditional registration unexpectedly exists; run the GREEN contract instead.");
    }
    await registrationChecks();
    if (mode === "--registration-only") {
        console.log("PASS: capability MCP registration omission contract");
        return;
    }
    await behaviorChecks();
    await loggingFaultIdentity();
    console.log("PASS: capability MCP registration, compatibility and delegate ownership contract");
}

await main();
