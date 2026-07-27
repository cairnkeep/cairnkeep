import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const EXPECTED_RED_EXIT = 86;
const STDIO_RED_MARKER = "PHASE17_RED:ARTIFACT_MCP_MISSING";
const HTTP_RED_MARKER = "PHASE17_RED:ARTIFACT_HTTP_CONSENT_MISSING";
const HTTP_TOKEN = "artifact-http-smoke-token";
const ALLOWED_ORIGIN = "https://artifact-smoke.example";
const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");
const projectRoot = resolve(serverRoot, "..");
const serverEntry = join(serverRoot, "dist", "index.js");
const artifactCli = join(serverRoot, "dist", "artifact-cli.js");
const ARTIFACT_TOOLS = ["artifact_delete", "artifact_list", "artifact_read", "artifact_write"];
const ARTIFACT_ALIASES = ["artifact_edit", "artifact_import", "artifact_search", "artifact_update"];
const ARTIFACT_KINDS = ["compaction_summary", "diff", "generated_file", "test_output"];
const JSON_SCHEMA = "http://json-schema.org/draft-07/schema#";

const BASELINE_TOOL_SCHEMAS = {
    context_explore: schema({
        query: { type: "string", minLength: 1 },
        repo_root: { type: "string", minLength: 1 },
        timeout_seconds: { type: "integer", minimum: 10, maximum: 600 },
    }, ["query"]),
    domain_knowledge_query: schema({
        workspace: { type: "string", minLength: 1 },
        query: { type: "string", minLength: 1 },
    }, ["query"]),
    domain_knowledge_sync: schema({
        workspace: { type: "string", minLength: 1 },
        mode: { type: "string", enum: ["incremental", "full", "replace"] },
        confirm_replace: { type: "boolean" },
        timeout_seconds: { type: "integer", minimum: 30, maximum: 3600 },
    }),
    memory_apply_reviewed: schema({
        scope: { type: "string" },
        review_id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" },
        key: { type: "string", minLength: 1 },
        value: { type: "string" },
    }, ["scope", "review_id", "key", "value"]),
    memory_delete: schema({
        scope: { type: "string" },
        key: { type: "string", minLength: 1 },
    }, ["scope", "key"]),
    memory_extract: schema({
        scope: { type: "string" },
        content: { type: "string", minLength: 1 },
        model: { type: "string", minLength: 1 },
        category: { type: "string", enum: ["decision", "preference", "pattern", "pitfall", "constraint", "bug", "convention"] },
    }, ["scope", "content"]),
    memory_history: schema({
        scope: { type: "string" },
        key: { type: "string", minLength: 1 },
    }, ["scope", "key"]),
    memory_invalidate_reviewed: schema({
        scope: { type: "string" },
        review_id: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" },
        key: { type: "string", minLength: 1 },
        reason: { type: "string", maxLength: 512 },
    }, ["scope", "review_id", "key"]),
    memory_list: schema({
        scope: { type: "string" },
        prefix: { type: "string" },
    }, ["scope"]),
    memory_read: schema({
        scope: { type: "string" },
        key: { type: "string" },
        query: { type: "string" },
    }, ["scope"]),
    memory_search: schema({
        scope: { type: "string" },
        query: { type: "string", minLength: 1 },
        top_k: { type: "integer", minimum: 1, maximum: 50 },
        min_score: { type: "number", minimum: 0, maximum: 1 },
    }, ["scope", "query"]),
    memory_supersede: schema({
        scope: { type: "string" },
        key: { type: "string", minLength: 1 },
        value: { type: "string" },
        reason: { type: "string" },
    }, ["scope", "key", "value"]),
    memory_write: schema({
        scope: { type: "string" },
        key: { type: "string", minLength: 1 },
        value: { type: "string" },
        promote_to: { type: "string" },
    }, ["scope", "key", "value"]),
    route_check: schema({
        timeout_seconds: { type: "integer", minimum: 1, maximum: 60 },
    }),
};

function schema(properties, required = []) {
    return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
        $schema: JSON_SCHEMA,
    };
}

function sorted(values) {
    return [...values].sort((left, right) => left.localeCompare(right));
}

function keys(value) {
    return sorted(Object.keys(value ?? {}));
}

function delay(milliseconds) {
    return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function cleanEnvironment(baseDir, extra = {}) {
    const env = {
        ...process.env,
        NODE_NO_WARNINGS: "1",
        CAIRN_AGENTFS_BASE_DIR: baseDir,
        ...extra,
    };
    for (const name of [
        "CAIRN_ARTIFACT_STORE",
        "CAIRN_ARTIFACT_HTTP",
        "CAIRN_COMPACTION_CAPTURE",
        "CAIRN_TYPED_MEMORY_NODES",
        "MCP_HTTP_PORT",
        "MCP_HTTP_HOST",
        "CAIRN_MEMORY_HTTP_TOKEN",
        "CAIRN_MEMORY_HTTP_ALLOWED_ORIGINS",
        "CAIRN_MEMORY_HTTP_ALLOWED_HOSTS",
    ]) {
        if (!(name in extra)) delete env[name];
    }
    return env;
}

async function connectStdio(root, enabled) {
    const env = cleanEnvironment(root, enabled ? { CAIRN_ARTIFACT_STORE: "1" } : {});
    const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverEntry],
        cwd: root,
        env,
    });
    const client = new Client({ name: "smoke-artifact-mcp", version: "0" }, { capabilities: {} });
    await client.connect(transport);
    return client;
}

async function call(client, name, args) {
    return client.callTool({ name, arguments: args });
}

function assertBaselineTools(tools) {
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    assert.deepEqual(sorted(Object.keys(byName)), sorted(Object.keys(BASELINE_TOOL_SCHEMAS)), "disabled tools/list names drifted");
    for (const [name, expectedSchema] of Object.entries(BASELINE_TOOL_SCHEMAS)) {
        assert.deepEqual(byName[name]?.inputSchema, expectedSchema, `${name} disabled input schema drifted`);
    }
    for (const name of [...ARTIFACT_TOOLS, ...ARTIFACT_ALIASES]) {
        assert.equal(Boolean(byName[name]), false, `${name} must be absent while artifact storage is disabled`);
    }
}

async function assertBaselineResponseRoots(client) {
    const write = await call(client, "memory_write", { scope: "identity", key: "patterns/artifact-baseline", value: "stable" });
    assert.deepEqual(keys(write.structuredContent), ["collisions", "key", "ok", "scope"]);
    const read = await call(client, "memory_read", { scope: "identity", key: "patterns/artifact-baseline" });
    assert.deepEqual(keys(read.structuredContent), ["results"]);
    assert.deepEqual(keys(read.structuredContent.results[0]), ["key", "scope", "value"]);
    const list = await call(client, "memory_list", { scope: "identity", prefix: "patterns/" });
    assert.deepEqual(keys(list.structuredContent), ["keys"]);
    const history = await call(client, "memory_history", { scope: "identity", key: "patterns/artifact-baseline" });
    assert.deepEqual(keys(history.structuredContent), ["current", "history", "key", "scope"]);
    const deleted = await call(client, "memory_delete", { scope: "identity", key: "patterns/artifact-baseline" });
    assert.deepEqual(keys(deleted.structuredContent), ["key", "ok", "scope"]);
}

async function disabledContract() {
    const root = mkdtempSync(join(tmpdir(), "cairn-artifact-mcp-disabled-"));
    try {
        const client = await connectStdio(root, false);
        try {
            assertBaselineTools((await client.listTools()).tools);
            await assertBaselineResponseRoots(client);
        } finally {
            await client.close();
        }
        assert.equal(existsSync(join(root, ".agentfs", "artifacts.db")), false, "disabled MCP traffic created artifacts.db");
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function artifactInputs(suffix = "one") {
    return [
        {
            kind: "compaction_summary",
            media_type: "text/markdown",
            provenance: { producer: "smoke-artifact-mcp", harness: "claude-code" },
            content: {
                raw_summary: `Goal ${suffix}\n\nDecision ${suffix}`,
                task_goals: [`goal-${suffix}`],
                decisions_made: [`decision-${suffix}`],
                open_todos: [`todo-${suffix}`],
                critical_error_traces: [],
                completeness: {
                    task_goals: "complete",
                    decisions_made: "complete",
                    open_todos: "complete",
                    critical_error_traces: "complete",
                },
                trigger: "manual",
            },
        },
        {
            kind: "diff",
            media_type: "text/x-diff",
            provenance: { producer: "smoke-artifact-mcp" },
            content: { text: `@@ -1 +1 @@\n-old\n+${suffix}\n` },
        },
        {
            kind: "test_output",
            media_type: "text/plain",
            provenance: { producer: "smoke-artifact-mcp" },
            content: { text: `test-output-${suffix}`, exit_code: 0, status: "passed" },
        },
        {
            kind: "generated_file",
            media_type: "text/plain",
            provenance: { producer: "smoke-artifact-mcp" },
            content: {
                path_label: `dist/generated-${suffix}.txt`,
                file_digest: "a".repeat(64),
                logical_bytes: suffix.length,
                binary: false,
                snapshot: `generated-${suffix}`,
            },
        },
    ];
}

function missingStdioCapability(message) {
    const error = new Error(message);
    error.code = "ERR_ARTIFACT_STDIO_MISSING";
    return error;
}

function assertArtifactToolSchemas(tools) {
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    const artifactNames = sorted(Object.keys(byName).filter((name) => name.startsWith("artifact_")));
    if (artifactNames.length === 0) throw missingStdioCapability("artifact MCP tools are absent");
    assert.deepEqual(artifactNames, ARTIFACT_TOOLS, "artifact tool registration must contain exactly four names");
    for (const alias of ARTIFACT_ALIASES) assert.equal(Boolean(byName[alias]), false, `${alias} is out of scope`);
    for (const [name, expected] of Object.entries(BASELINE_TOOL_SCHEMAS)) {
        assert.deepEqual(byName[name]?.inputSchema, expected, `${name} changed when artifact storage was enabled`);
    }

    const writeSchema = byName.artifact_write.inputSchema;
    assert.equal(writeSchema.type, "object");
    assert.deepEqual(sorted(writeSchema.required ?? []), ["content", "kind", "media_type", "provenance"]);
    assert.deepEqual(sorted(writeSchema.properties.kind.enum), ARTIFACT_KINDS);
    assert.equal(writeSchema.properties.session_ref.maxLength <= 256, true);
    assert.match(writeSchema.properties.session_ref.pattern, /unknown|A-Za-z|a-z/i);
    assert.ok(writeSchema.properties.content.anyOf || writeSchema.properties.content.oneOf, "artifact content must be a bounded union");
    const serializedWriteSchema = JSON.stringify(writeSchema);
    assert.equal(/"path"\s*:/.test(serializedWriteSchema), false, "artifact_write must not advertise a filesystem path");
    assert.equal(serializedWriteSchema.includes("path_label"), true, "generated-file content needs a contained path label");
    assert.equal(serializedWriteSchema.includes("maxLength"), true, "inline content must publish explicit bounds");

    const nodeRef = writeSchema.properties.node_ref;
    assert.deepEqual(sorted(nodeRef.required ?? []), ["address_space", "key", "scope"]);
    assert.deepEqual(sorted(nodeRef.properties.address_space.enum), ["memory", "project-notes", "shared-notes"]);
    assert.ok(nodeRef.properties.key.maxLength <= 1024);
    assert.ok(writeSchema.properties.supersedes.pattern.includes("art_"));

    const readSchema = byName.artifact_read.inputSchema;
    assert.deepEqual(sorted(readSchema.required ?? []), ["artifact_id"]);
    assert.deepEqual(sorted(Object.keys(readSchema.properties)), ["artifact_id"]);
    const listSchema = byName.artifact_list.inputSchema;
    assert.deepEqual(sorted(Object.keys(listSchema.properties)), ["cursor", "kind", "limit", "node_ref", "session_ref"]);
    assert.deepEqual(sorted(listSchema.properties.kind.enum), ARTIFACT_KINDS);
    assert.equal(listSchema.properties.limit.minimum, 1);
    assert.equal(listSchema.properties.limit.maximum, 100);
    const deleteSchema = byName.artifact_delete.inputSchema;
    assert.deepEqual(sorted(deleteSchema.required ?? []), ["artifact_id"]);
    assert.deepEqual(sorted(Object.keys(deleteSchema.properties)), ["artifact_id"]);

    assert.deepEqual(byName.artifact_read.annotations, { readOnlyHint: true, idempotentHint: true });
    assert.deepEqual(byName.artifact_list.annotations, { readOnlyHint: true, idempotentHint: true });
    assert.equal(byName.artifact_write.annotations?.readOnlyHint, false);
    assert.equal(byName.artifact_delete.annotations?.destructiveHint, true);
}

function assertValueFree(response, secret, surface) {
    const serialized = JSON.stringify({ content: response.content, structuredContent: response.structuredContent });
    assert.equal(serialized.includes(secret), false, `${surface} disclosed artifact content`);
    assert.equal(Object.hasOwn(response.structuredContent ?? {}, "content"), false, `${surface} returned a content field`);
}

function assertSuccessful(response, surface) {
    assert.notEqual(response.isError, true, `${surface} failed: ${JSON.stringify(response.content)}`);
    return response.structuredContent;
}

async function expectToolError(client, name, args, pattern) {
    const response = await call(client, name, args);
    assert.equal(response.isError, true, `${name} unexpectedly accepted ${JSON.stringify(args).slice(0, 200)}`);
    assert.match(JSON.stringify(response.content), pattern);
}

async function stdioCrudContract(root, client) {
    const tools = (await client.listTools()).tools;
    assertArtifactToolSchemas(tools);

    const created = [];
    for (const input of artifactInputs()) {
        const secret = input.content.raw_summary ?? input.content.text ?? input.content.snapshot;
        const response = await call(client, "artifact_write", input);
        const result = assertSuccessful(response, `write ${input.kind}`);
        assertValueFree(response, secret, `write ${input.kind}`);
        assert.match(result.artifact_id, /^art_[0-9a-f-]{36}$/i);
        assert.match(result.content_digest, /^[a-f0-9]{64}$/);
        assert.match(result.session_ref, /^cairn:[0-9a-f-]{36}$/i);
        created.push({ ...result, input, secret });
        await delay(2);
    }
    assert.equal(new Set(created.map(({ session_ref }) => session_ref)).size, 1, "omitted session refs must be stable per MCP connection");

    for (const entry of created) {
        const read = await call(client, "artifact_read", { artifact_id: entry.artifact_id });
        const artifact = assertSuccessful(read, `read ${entry.input.kind}`);
        assert.equal(JSON.stringify(artifact).includes(entry.secret), true, "explicit artifact_read must return stored content");
        assert.equal(artifact.artifact_id, entry.artifact_id);
        assert.equal(artifact.kind, entry.input.kind);
    }

    const listed = await call(client, "artifact_list", { limit: 100 });
    const listResult = assertSuccessful(listed, "list artifacts");
    for (const entry of created) assertValueFree(listed, entry.secret, "artifact_list");
    assert.equal(Array.isArray(listResult.artifacts), true);
    assert.deepEqual(new Set(listResult.artifacts.map(({ artifact_id }) => artifact_id)), new Set(created.map(({ artifact_id }) => artifact_id)));
    assert.equal(listResult.artifacts.every((artifact) => !Object.hasOwn(artifact, "content")), true);

    const firstPage = assertSuccessful(await call(client, "artifact_list", { limit: 1 }), "first list page");
    assert.equal(firstPage.artifacts.length, 1);
    assert.equal(typeof firstPage.next_cursor, "string");
    const secondPage = assertSuccessful(await call(client, "artifact_list", { limit: 1, cursor: firstPage.next_cursor }), "second list page");
    assert.equal(secondPage.artifacts.length, 1);
    assert.notEqual(secondPage.artifacts[0].artifact_id, firstPage.artifacts[0].artifact_id);
    await expectToolError(client, "artifact_list", { limit: 0 }, /limit|greater than|too small/i);
    await expectToolError(client, "artifact_list", { limit: 101 }, /limit|less than|too big/i);

    for (const entry of created) {
        const byKind = assertSuccessful(await call(client, "artifact_list", { kind: entry.input.kind }), `list ${entry.input.kind}`);
        assert.equal(byKind.artifacts.every(({ kind }) => kind === entry.input.kind), true);
    }
    const sessionList = assertSuccessful(await call(client, "artifact_list", { session_ref: created[0].session_ref }), "session list");
    assert.equal(sessionList.artifacts.length, created.length);

    const typedInput = {
        ...artifactInputs("typed")[1],
        session_ref: "cairn:explicit-session",
        node_ref: { scope: "project", address_space: "project-notes", key: "projects/example/generated" },
    };
    const typed = assertSuccessful(await call(client, "artifact_write", typedInput), "typed-node write");
    assert.equal(typed.session_ref, typedInput.session_ref);
    const nodeList = assertSuccessful(await call(client, "artifact_list", { node_ref: typedInput.node_ref }), "typed-node list");
    assert.deepEqual(nodeList.artifacts.map(({ artifact_id }) => artifact_id), [typed.artifact_id]);

    for (const session_ref of ["unknown", "../escape", "bad ref", ""]) {
        await expectToolError(client, "artifact_write", { ...artifactInputs("unsafe")[1], session_ref }, /session|invalid|safe|unknown/i);
    }
    await expectToolError(client, "artifact_write", {
        ...artifactInputs("path")[3],
        content: { ...artifactInputs("path")[3].content, path: "/etc/passwd" },
    }, /unrecognized|path|invalid/i);
    await expectToolError(client, "artifact_write", {
        ...artifactInputs("node")[1],
        node_ref: { scope: "all", address_space: "project-notes", key: "../escape" },
    }, /node|scope|path|invalid/i);

    const superseded = assertSuccessful(await call(client, "artifact_write", {
        ...artifactInputs("superseded")[1],
        session_ref: typedInput.session_ref,
        supersedes: typed.artifact_id,
    }), "same-kind/session supersede");
    assert.notEqual(superseded.artifact_id, typed.artifact_id);
    await expectToolError(client, "artifact_write", {
        ...artifactInputs("wrong-session")[1],
        session_ref: "cairn:different-session",
        supersedes: typed.artifact_id,
    }, /same session/i);
    await expectToolError(client, "artifact_write", {
        ...artifactInputs("wrong-kind")[2],
        session_ref: typedInput.session_ref,
        supersedes: typed.artifact_id,
    }, /same kind/i);

    const exact = assertSuccessful(await call(client, "artifact_read", { artifact_id: typed.artifact_id }), "exact read");
    const uniquePrefix = typed.artifact_id.slice(0, 12);
    const prefixed = assertSuccessful(await call(client, "artifact_read", { artifact_id: uniquePrefix }), "prefix read");
    assert.equal(prefixed.artifact_id, exact.artifact_id);
    await expectToolError(client, "artifact_read", { artifact_id: "art_" }, /ambiguous/i);

    const deletion = await call(client, "artifact_delete", { artifact_id: typed.artifact_id });
    assertSuccessful(deletion, "artifact delete");
    assertValueFree(deletion, typedInput.content.text, "artifact_delete");
    assert.equal(deletion.structuredContent.deleted, true);
    const idempotentDelete = assertSuccessful(await call(client, "artifact_delete", { artifact_id: typed.artifact_id }), "idempotent delete");
    assert.equal(idempotentDelete.deleted, false);
    await expectToolError(client, "artifact_read", { artifact_id: typed.artifact_id }, /not found/i);

    assert.equal(existsSync(join(root, ".agentfs", "artifacts.db")), true, "stdio writes did not create the project-local artifact store");
    return created;
}

function runCli(root, args, expectedStatus = 0) {
    const env = cleanEnvironment(root);
    const result = spawnSync(process.execPath, [artifactCli, ...args], { cwd: root, env, encoding: "utf8" });
    assert.equal(result.status, expectedStatus, `artifact CLI ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
    return result;
}

function cliContract(root, retained) {
    if (!existsSync(artifactCli)) throw missingStdioCapability("artifact CLI is absent");
    const list = JSON.parse(runCli(root, ["list", "--json"]).stdout);
    assert.equal(list.artifacts.some(({ artifact_id }) => artifact_id === retained[0].artifact_id), true);
    assert.equal(JSON.stringify(list).includes(retained[0].secret), false, "CLI list disclosed artifact content");

    const show = JSON.parse(runCli(root, ["show", retained[0].artifact_id.slice(0, 12), "--json"]).stdout);
    assert.equal(show.artifact_id, retained[0].artifact_id);
    assert.equal(JSON.stringify(show).includes(retained[0].secret), true, "CLI show did not return explicit content");

    const dryDelete = JSON.parse(runCli(root, ["delete", retained[1].artifact_id, "--dry-run", "--json"]).stdout);
    assert.equal(dryDelete.dry_run, true);
    assert.equal(dryDelete.deleted, false);
    const deleted = JSON.parse(runCli(root, ["delete", retained[1].artifact_id, "--json"]).stdout);
    assert.equal(deleted.deleted, true);
    assert.equal(JSON.stringify(deleted).includes(retained[1].secret), false);

    const dryPrune = JSON.parse(runCli(root, ["prune", "--dry-run", "--json"]).stdout);
    assert.equal(dryPrune.dry_run, true);
    const protectedPrune = JSON.parse(runCli(root, ["prune", "--dry-run", "--include-protected", "--json"]).stdout);
    assert.equal(protectedPrune.dry_run, true);
    assert.equal(protectedPrune.include_protected, true);
}

async function stdioContract() {
    const root = mkdtempSync(join(tmpdir(), "cairn-artifact-mcp-stdio-"));
    try {
        const client = await connectStdio(root, true);
        let retained;
        try {
            retained = await stdioCrudContract(root, client);
        } finally {
            await client.close();
        }

        const secondClient = await connectStdio(root, true);
        try {
            const second = assertSuccessful(await call(secondClient, "artifact_write", artifactInputs("second-connection")[1]), "second-connection write");
            assert.match(second.session_ref, /^cairn:[0-9a-f-]{36}$/i);
            assert.notEqual(second.session_ref, retained[0].session_ref, "new MCP connection reused a generated session ref");
        } finally {
            await secondClient.close();
        }
        cliContract(root, retained);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function filesUnder(root) {
    if (!existsSync(root)) return [];
    const files = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const path = join(root, entry.name);
        if (entry.isDirectory()) files.push(...filesUnder(path));
        else files.push(path);
    }
    return files;
}

async function unusedPort() {
    const probe = createServer();
    await new Promise((resolveListen, reject) => {
        probe.once("error", reject);
        probe.listen(0, "127.0.0.1", resolveListen);
    });
    const address = probe.address();
    assert.ok(address && typeof address === "object");
    const port = address.port;
    await new Promise((resolveClose) => probe.close(resolveClose));
    return port;
}

function waitForListen(processHandle) {
    return new Promise((resolveListen, reject) => {
        let stderr = "";
        const timer = setTimeout(() => reject(new Error(`HTTP server did not start in time:\n${stderr}`)), 5000);
        processHandle.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
            if (stderr.includes("listening on")) {
                clearTimeout(timer);
                resolveListen();
            }
        });
        processHandle.once("exit", (code) => {
            clearTimeout(timer);
            reject(new Error(`HTTP server exited before listening (${code}):\n${stderr}`));
        });
    });
}

function waitForExit(processHandle) {
    if (processHandle.exitCode !== null) return Promise.resolve(processHandle.exitCode);
    return new Promise((resolveExit) => processHandle.once("exit", resolveExit));
}

async function startHttpServer({ baseDir, cwd, artifactStore, artifactHttp, token = HTTP_TOKEN }) {
    const port = await unusedPort();
    const extra = {
        MCP_HTTP_PORT: String(port),
        MCP_HTTP_HOST: "127.0.0.1",
        CAIRN_MEMORY_HTTP_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
        CAIRN_MEMORY_HTTP_TOKEN: token,
    };
    if (artifactStore) extra.CAIRN_ARTIFACT_STORE = "1";
    if (artifactHttp) extra.CAIRN_ARTIFACT_HTTP = "1";
    const processHandle = spawn(process.execPath, [serverEntry], {
        cwd,
        env: cleanEnvironment(baseDir, extra),
        stdio: ["ignore", "ignore", "pipe"],
    });
    await waitForListen(processHandle);
    return { processHandle, port };
}

async function stopHttpServer(processHandle) {
    if (processHandle.exitCode === null) processHandle.kill("SIGINT");
    await waitForExit(processHandle);
}

const INITIALIZE_BODY = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "smoke-artifact-http-raw", version: "0" },
    },
});

function rawHttp(port, { token, host, origin, method = "POST", project, body = INITIALIZE_BODY } = {}) {
    return new Promise((resolveRequest, reject) => {
        const headers = {
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
        };
        if (body !== null) headers["Content-Length"] = Buffer.byteLength(body);
        if (token !== undefined) headers.Authorization = `Bearer ${token}`;
        if (host !== undefined) headers.Host = host;
        if (origin !== undefined) headers.Origin = origin;
        if (project !== undefined) headers["X-Cairn-Project"] = project;
        if (method === "OPTIONS") {
            headers["Access-Control-Request-Method"] = "POST";
            headers["Access-Control-Request-Headers"] = "Content-Type, Authorization, X-Cairn-Project";
        }
        const request = httpRequest({ host: "127.0.0.1", port, path: "/mcp", method, headers }, (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => resolveRequest({
                status: response.statusCode,
                headers: response.headers,
                body: Buffer.concat(chunks).toString("utf8"),
            }));
        });
        request.on("error", reject);
        if (body !== null && method !== "OPTIONS") request.write(body);
        request.end();
    });
}

async function connectHttp(port, project, suffix = "client") {
    const headers = {
        Authorization: `Bearer ${HTTP_TOKEN}`,
        "X-Cairn-Project": project,
        "X-Cairn-Scopes": "identity,project",
        "X-Cairn-AnythingLLM-Workspaces": `${project}-docs`,
    };
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers },
    });
    const client = new Client({ name: `smoke-artifact-http-${suffix}`, version: "0" }, { capabilities: {} });
    await client.connect(transport);
    return client;
}

async function assertHttpGuards() {
    const baseDir = mkdtempSync(join(tmpdir(), "cairn-artifact-http-no-token-base-"));
    const cwd = mkdtempSync(join(tmpdir(), "cairn-artifact-http-no-token-cwd-"));
    const port = await unusedPort();
    try {
        const processHandle = spawn(process.execPath, [serverEntry], {
            cwd,
            env: cleanEnvironment(baseDir, {
                MCP_HTTP_PORT: String(port),
                MCP_HTTP_HOST: "127.0.0.1",
                CAIRN_MEMORY_HTTP_TOKEN: undefined,
            }),
            stdio: ["ignore", "ignore", "pipe"],
        });
        assert.notEqual(await waitForExit(processHandle), 0, "HTTP server must fail closed without a bearer token");
    } finally {
        rmSync(baseDir, { recursive: true, force: true });
        rmSync(cwd, { recursive: true, force: true });
    }
}

async function assertHttpRequestGuards(port) {
    const expectedHost = `127.0.0.1:${port}`;
    assert.equal((await rawHttp(port, { host: expectedHost })).status, 401, "missing bearer token must return 401");
    assert.equal((await rawHttp(port, { token: "x".repeat(HTTP_TOKEN.length), host: expectedHost })).status, 401, "same-length bad bearer must return 401");
    assert.equal((await rawHttp(port, { token: "short", host: expectedHost })).status, 401, "different-length bad bearer must return 401");
    assert.equal((await rawHttp(port, { token: HTTP_TOKEN, host: "unexpected.example" })).status, 403, "unexpected Host must return 403");

    const allowedPreflight = await rawHttp(port, { method: "OPTIONS", origin: ALLOWED_ORIGIN, body: null });
    assert.equal(allowedPreflight.status, 204, "allowed CORS preflight must return 204");
    assert.equal(allowedPreflight.headers["access-control-allow-origin"], ALLOWED_ORIGIN);
    assert.match(allowedPreflight.headers["access-control-allow-headers"] ?? "", /X-Cairn-Project/i);
    const deniedPreflight = await rawHttp(port, { method: "OPTIONS", origin: "https://denied.example", body: null });
    assert.equal(deniedPreflight.status, 403, "unlisted CORS origin must return 403");
}

function assertRemoteToolSet(tools, artifactExpected) {
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    for (const [name, expectedSchema] of Object.entries(BASELINE_TOOL_SCHEMAS)) {
        assert.deepEqual(byName[name]?.inputSchema, expectedSchema, `${name} remote schema drifted`);
    }
    const artifactNames = sorted(Object.keys(byName).filter((name) => name.startsWith("artifact_")));
    if (artifactExpected && artifactNames.length === 0) throw missingHttpCapability("double-consent artifact tools are absent");
    assert.deepEqual(artifactNames, artifactExpected ? ARTIFACT_TOOLS : [], "remote artifact consent matrix is incorrect");
    for (const alias of ARTIFACT_ALIASES) assert.equal(Boolean(byName[alias]), false, `${alias} is out of scope over HTTP`);
    if (artifactExpected) assertArtifactToolSchemas(tools);
}

function missingHttpCapability(message) {
    const error = new Error(message);
    error.code = "ERR_ARTIFACT_HTTP_MISSING";
    return error;
}

async function assertExistingRemoteMemory(client, project) {
    const key = `patterns/${project}`;
    const write = assertSuccessful(await call(client, "memory_write", { scope: "project", key, value: project }), "remote memory write");
    assert.deepEqual(keys(write), ["collisions", "key", "ok", "scope"]);
    const read = assertSuccessful(await call(client, "memory_read", { scope: "project", key }), "remote memory read");
    assert.deepEqual(keys(read), ["results"]);
    assert.equal(read.results[0].value, project);
}

async function matrixCase({ artifactStore, artifactHttp, artifactExpected, label, verifyGuards = false }) {
    const baseDir = mkdtempSync(join(tmpdir(), `cairn-artifact-http-${label}-base-`));
    const cwd = mkdtempSync(join(tmpdir(), `cairn-artifact-http-${label}-cwd-`));
    let server;
    try {
        server = await startHttpServer({ baseDir, cwd, artifactStore, artifactHttp });
        if (verifyGuards) await assertHttpRequestGuards(server.port);
        const client = await connectHttp(server.port, `matrix-${label}`, label);
        try {
            assertRemoteToolSet((await client.listTools()).tools, artifactExpected);
            await assertExistingRemoteMemory(client, `matrix-${label}`);
        } finally {
            await client.close();
        }
    } finally {
        if (server) await stopHttpServer(server.processHandle);
        rmSync(baseDir, { recursive: true, force: true });
        rmSync(cwd, { recursive: true, force: true });
    }
}

async function doubleConsentContract() {
    const baseDir = mkdtempSync(join(tmpdir(), "cairn-artifact-http-enabled-base-"));
    const cwd = mkdtempSync(join(tmpdir(), "cairn-artifact-http-enabled-cwd-"));
    const clientSelectedRoot = mkdtempSync(join(tmpdir(), "cairn-artifact-http-client-path-"));
    let server;
    try {
        try {
            server = await startHttpServer({ baseDir, cwd, artifactStore: true, artifactHttp: true });
            const alpha = await connectHttp(server.port, "project-alpha", "alpha");
            const beta = await connectHttp(server.port, "project-beta", "beta");
            try {
                assertRemoteToolSet((await alpha.listTools()).tools, true);
                assertRemoteToolSet((await beta.listTools()).tools, true);
                await assertExistingRemoteMemory(alpha, "project-alpha");
                await assertExistingRemoteMemory(beta, "project-beta");

                const alphaWrite = assertSuccessful(await call(alpha, "artifact_write", {
                    ...artifactInputs("alpha-private")[1],
                    provenance: { producer: "smoke-artifact-http", source_event: clientSelectedRoot },
                }), "project-alpha artifact write");
                const betaWrite = assertSuccessful(await call(beta, "artifact_write", artifactInputs("beta-private")[1]), "project-beta artifact write");
                assert.notEqual(alphaWrite.artifact_id, betaWrite.artifact_id);
                assert.notEqual(alphaWrite.session_ref, betaWrite.session_ref, "HTTP MCP sessions must not share generated session refs");

                const alphaList = assertSuccessful(await call(alpha, "artifact_list", {}), "project-alpha artifact list");
                const betaList = assertSuccessful(await call(beta, "artifact_list", {}), "project-beta artifact list");
                assert.deepEqual(alphaList.artifacts.map(({ artifact_id }) => artifact_id), [alphaWrite.artifact_id]);
                assert.deepEqual(betaList.artifacts.map(({ artifact_id }) => artifact_id), [betaWrite.artifact_id]);
                await expectToolError(alpha, "artifact_read", { artifact_id: betaWrite.artifact_id }, /not found/i);
                await expectToolError(beta, "artifact_read", { artifact_id: alphaWrite.artifact_id }, /not found/i);
            } finally {
                await alpha.close();
                await beta.close();
            }

            const beforeInvalid = filesUnder(baseDir);
            const expectedHost = `127.0.0.1:${server.port}`;
            const missingProject = await rawHttp(server.port, { token: HTTP_TOKEN, host: expectedHost });
            assert.equal(missingProject.status, 400, "double-consent HTTP must reject a missing project identity before storage resolution");
            const invalidProject = await rawHttp(server.port, { token: HTTP_TOKEN, host: expectedHost, project: "../escape" });
            assert.equal(invalidProject.status, 400, "double-consent HTTP must reject an invalid project identity before storage resolution");
            assert.deepEqual(filesUnder(baseDir), beforeInvalid, "invalid project identity changed server-side storage");
        } finally {
            if (server) await stopHttpServer(server.processHandle);
        }

        const artifactDatabases = filesUnder(baseDir).filter((path) => path.endsWith(`${join(".agentfs", "artifacts.db")}`));
        assert.equal(artifactDatabases.length, 2, `expected one server-derived artifact store per project, found ${artifactDatabases.map((path) => relative(baseDir, path)).join(", ")}`);
        assert.equal(artifactDatabases.every((path) => resolve(path).startsWith(`${resolve(baseDir)}/`)), true);
        assert.equal(artifactDatabases.some((path) => resolve(path).startsWith(`${resolve(cwd)}/`)), false, "remote artifact store resolved under server cwd");
        assert.equal(artifactDatabases.some((path) => resolve(path).startsWith(`${resolve(clientSelectedRoot)}/`)), false, "remote artifact store used a client-selected path");
        assert.equal(artifactDatabases.some((path) => path.includes("project-alpha")), true);
        assert.equal(artifactDatabases.some((path) => path.includes("project-beta")), true);
    } finally {
        rmSync(baseDir, { recursive: true, force: true });
        rmSync(cwd, { recursive: true, force: true });
        rmSync(clientSelectedRoot, { recursive: true, force: true });
    }
}

async function httpContract() {
    await assertHttpGuards();
    await matrixCase({ artifactStore: false, artifactHttp: false, artifactExpected: false, label: "neither", verifyGuards: true });
    await matrixCase({ artifactStore: true, artifactHttp: false, artifactExpected: false, label: "store-only" });
    await matrixCase({ artifactStore: false, artifactHttp: true, artifactExpected: false, label: "http-only" });
    await doubleConsentContract();
}

async function main() {
    const [mode, ...extra] = process.argv.slice(2);
    assert.equal(extra.length, 0, "smoke-artifact-mcp accepts at most one mode");
    const knownModes = [undefined, "--disabled-only", "--expect-red-stdio", "--expect-red-http", "--stdio-only", "--http-only"];
    assert.equal(knownModes.includes(mode), true, `Unknown smoke-artifact-mcp mode: ${mode}`);

    if (mode === "--disabled-only") {
        await disabledContract();
        console.log("PASS: artifact MCP disabled baseline");
        return;
    }
    if (mode === "--expect-red-stdio") {
        await disabledContract();
        try {
            await stdioContract();
        } catch (error) {
            if (error?.code === "ERR_ARTIFACT_STDIO_MISSING") {
                console.log(STDIO_RED_MARKER);
                process.exitCode = EXPECTED_RED_EXIT;
                return;
            }
            throw error;
        }
        throw new Error("Artifact MCP/CLI unexpectedly exists; run the GREEN contract instead.");
    }
    if (mode === "--expect-red-http") {
        try {
            await httpContract();
        } catch (error) {
            if (error?.code === "ERR_ARTIFACT_HTTP_MISSING") {
                console.log(HTTP_RED_MARKER);
                process.exitCode = EXPECTED_RED_EXIT;
                return;
            }
            throw error;
        }
        throw new Error("Artifact HTTP double consent unexpectedly exists; run the GREEN contract instead.");
    }
    if (mode === "--http-only") {
        await httpContract();
        console.log("PASS: artifact HTTP consent, guard and project-isolation contract");
        return;
    }

    await disabledContract();
    await stdioContract();
    await httpContract();
    console.log("PASS: artifact MCP disabled, stdio, CLI and HTTP contract");
}

await main();
