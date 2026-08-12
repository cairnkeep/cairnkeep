#!/usr/bin/env node

import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const EXPECTED_RED_EXIT = 86;
const RED_MARKER = "PHASE26_RED:PI_MCP_BRIDGE_MISSING";
const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");
const projectRoot = resolve(serverRoot, "..");
const bridgeModulePath = join(serverRoot, "dist", "pi-mcp-bridge.js");
const extensionSourcePath = join(projectRoot, "pi", "extensions", "cairnkeep-memory.ts");
const selfPath = fileURLToPath(import.meta.url);

const ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});
const WRITE_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
});
const INPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    variant: { enum: ["text", "image", "structured", "error", "unsupported", "huge", "delay", "crash"] },
  },
});
const OUTPUT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: { ok: { type: "boolean" } },
});
const ALL_TOOLS = Object.freeze([
  Object.freeze({
    name: "memory_read",
    title: "Read memory",
    description: "Read a fixture memory value.",
    inputSchema: INPUT_SCHEMA,
    outputSchema: OUTPUT_SCHEMA,
    annotations: ANNOTATIONS,
    _meta: { fixture: "trusted-read" },
  }),
  Object.freeze({
    name: "memory_write",
    title: "Write memory",
    description: "Write a fixture memory value.",
    inputSchema: { type: "object", additionalProperties: false, properties: { value: { type: "string" } } },
    annotations: WRITE_ANNOTATIONS,
    _meta: { fixture: "trusted-write" },
  }),
  Object.freeze({
    name: "context_read",
    title: "Read context",
    description: "Read a fixture context value.",
    inputSchema: { type: "object", additionalProperties: false },
    annotations: ANNOTATIONS,
    _meta: { fixture: "trusted-context" },
  }),
]);

function record(event, extra = {}) {
  const path = process.env.CAIRN_PI_FIXTURE_LOG;
  if (path) appendFileSync(path, `${JSON.stringify({ event, ...extra })}\n`);
}

function profileTools() {
  const profile = process.env.CAIRN_PI_FIXTURE_PROFILE ?? "full";
  if (profile === "full") return ALL_TOOLS;
  if (profile === "read-only") return ALL_TOOLS.filter((tool) => tool.annotations.readOnlyHint);
  if (profile === "custom") return ALL_TOOLS.filter((tool) => tool.name === "memory_read");
  throw new Error(`unknown fixture profile: ${profile}`);
}

async function delayUntilCancelled(signal) {
  await new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(resolvePromise, 10_000);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      record("cancelled");
      rejectPromise(signal.reason ?? new Error("cancelled"));
    }, { once: true });
  });
}

async function runFakeServer() {
  if (process.env.MCP_HTTP_PORT !== undefined) {
    process.stderr.write("fixture inherited MCP_HTTP_PORT\n");
    process.exit(78);
  }
  record("started", { pid: process.pid });
  process.on("SIGTERM", () => { record("terminated", { signal: "SIGTERM" }); process.exit(0); });
  process.on("SIGINT", () => { record("terminated", { signal: "SIGINT" }); process.exit(0); });
  process.stdin.on("end", () => record("stdin-end"));

  const server = new Server({ name: "phase26-pi-fixture", version: "0.84.1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    const tools = profileTools();
    const cursor = request.params?.cursor;
    record("list", { cursor: cursor ?? null });
    if (cursor === undefined) return { tools: tools.slice(0, 1), ...(tools.length > 1 ? { nextCursor: "page-2" } : {}) };
    if (cursor === "page-2") return { tools: tools.slice(1) };
    throw new Error("invalid fixture cursor");
  });
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const variant = request.params.arguments?.variant ?? "text";
    record("call", { name: request.params.name, variant });
    if (!profileTools().some(({ name }) => name === request.params.name)) throw new Error("unknown fixture tool");
    if (variant === "crash") {
      process.stderr.write("fixture crash tail\n");
      process.exit(47);
    }
    if (variant === "delay") await delayUntilCancelled(extra.signal);
    if (variant === "image") return { content: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }] };
    if (variant === "structured") return {
      content: [{ type: "text", text: "structured" }],
      structuredContent: { ok: true },
      _meta: { fixture: "result-meta" },
    };
    if (variant === "error") return { content: [{ type: "text", text: "fixture failure" }], isError: true };
    if (variant === "unsupported") return { content: [{ type: "audio", data: "YXVkaW8=", mimeType: "audio/wav" }] };
    if (variant === "huge") return { content: [{ type: "text", text: "x".repeat(2 * 1024 * 1024) }] };
    return { content: [{ type: "text", text: "fixture text" }], structuredContent: { ok: true } };
  });
  await server.connect(new StdioServerTransport());
}

function childEnvironment(sandbox, profile, extra = {}) {
  const env = { ...process.env, ...extra, CAIRN_PI_FIXTURE_PROFILE: profile, CAIRN_PI_FIXTURE_LOG: join(sandbox, `${profile}.jsonl`) };
  delete env.MCP_HTTP_PORT;
  return env;
}

async function directClient(sandbox, profile) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [selfPath, "--fake-server"],
    cwd: projectRoot,
    env: childEnvironment(sandbox, profile),
    stderr: "pipe",
  });
  const client = new Client({ name: "phase26-direct-oracle", version: "1" }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

async function listAll(client) {
  const tools = [];
  let cursor;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

async function validateFakeServer(sandbox) {
  for (const [profile, expected] of [
    ["full", ["memory_read", "memory_write", "context_read"]],
    ["read-only", ["memory_read", "context_read"]],
    ["custom", ["memory_read"]],
  ]) {
    const { client } = await directClient(sandbox, profile);
    try {
      const tools = await listAll(client);
      assert.deepEqual(tools.map(({ name }) => name), expected);
      for (const tool of tools) {
        const source = ALL_TOOLS.find(({ name }) => name === tool.name);
        assert.equal(tool.title, source.title);
        assert.equal(tool.description, source.description);
        assert.deepEqual(tool.inputSchema, source.inputSchema);
        assert.deepEqual(tool.outputSchema, source.outputSchema);
        assert.deepEqual(tool.annotations, source.annotations);
        assert.deepEqual(tool._meta, source._meta);
      }
      if (profile === "full") {
        const text = await client.callTool({ name: "memory_read", arguments: { variant: "text" } });
        assert.deepEqual(text.content, [{ type: "text", text: "fixture text" }]);
        assert.deepEqual(text.structuredContent, { ok: true });
        const structured = await client.callTool({ name: "memory_read", arguments: { variant: "structured" } });
        assert.deepEqual(structured.structuredContent, { ok: true });
        const failure = await client.callTool({ name: "memory_read", arguments: { variant: "error" } });
        assert.equal(failure.isError, true);
        const controller = new AbortController();
        const delayed = client.callTool({ name: "memory_read", arguments: { variant: "delay" } }, undefined, { signal: controller.signal, timeout: 2_000 });
        setTimeout(() => controller.abort(new Error("fixture cancel")), 20);
        await assert.rejects(delayed, /fixture cancel|abort|cancel/i);
        assert.equal((await client.callTool({ name: "memory_read", arguments: { variant: "text" } })).isError, undefined);
      }
    } finally {
      await client.close();
    }
  }
  const events = readFileSync(join(sandbox, "full.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(events.filter(({ event }) => event === "list").slice(0, 2).map(({ cursor }) => cursor), [null, "page-2"]);
  assert.ok(events.some(({ event }) => event === "cancelled"), "fake server did not observe cancellation");
}

async function loadProduction() {
  const bridge = await import(pathToFileURL(bridgeModulePath).href);
  if (!existsSync(extensionSourcePath)) {
    const error = new Error(`Cannot find module '${extensionSourcePath}'`);
    error.code = "ERR_MODULE_NOT_FOUND";
    throw error;
  }
  return { bridge, extensionSource: readFileSync(extensionSourcePath, "utf8") };
}

function assertBridgeExports(bridge) {
  assert.equal(typeof bridge.connectCairnPiBridge, "function");
}

async function connectBridge(bridgeModule, sandbox, profile, extra = {}) {
  let childPid;
  const env = childEnvironment(sandbox, profile, extra);
  env.MCP_HTTP_PORT = "65535";
  const bridge = await bridgeModule.connectCairnPiBridge({
    command: process.execPath,
    args: [selfPath, "--fake-server"],
    cwd: projectRoot,
    env,
    startupTimeoutMs: 2_000,
    callTimeoutMs: 2_000,
    stderrLimitBytes: 8_192,
    resultLimitBytes: 1024 * 1024,
    onSpawn(child) { childPid = child.pid; },
  });
  return { bridge, childPid };
}

async function testBridge(bridgeModule, sandbox) {
  for (const profile of ["full", "read-only", "custom"]) {
    const direct = await directClient(sandbox, profile);
    const expected = await listAll(direct.client);
    await direct.client.close();
    const { bridge, childPid } = await connectBridge(bridgeModule, sandbox, profile);
    try {
      const discovered = await bridge.listAllTools();
      assert.deepEqual(discovered, expected, `${profile} bridge catalog drifted from direct tools/list`);
      if (profile === "full") {
        const tool = discovered.find(({ name }) => name === "memory_read");
        const text = await bridge.call(tool, { variant: "text" });
        assert.deepEqual(text.content, [{ type: "text", text: "fixture text" }]);
        assert.deepEqual(text.details, {
          tool,
          annotations: tool.annotations,
          outputSchema: tool.outputSchema,
          content: [{ type: "text", text: "fixture text" }],
          structuredContent: { ok: true },
          isError: false,
        });
        assert.deepEqual((await bridge.call(tool, { variant: "image" })).content, [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }]);
        await assert.rejects(bridge.call(tool, { variant: "error" }), /fixture failure/i);
        await assert.rejects(bridge.call(tool, { variant: "unsupported" }), /unsupported|audio/i);
        await assert.rejects(bridge.call(tool, { variant: "huge" }), /large|limit|size/i);
        const controller = new AbortController();
        const delayed = bridge.call(tool, { variant: "delay" }, { signal: controller.signal });
        setTimeout(() => controller.abort(new Error("Pi cancelled fixture call")), 20);
        await assert.rejects(delayed, /cancel|abort/i);
        assert.deepEqual((await bridge.call(tool, { variant: "text" })).content[0], { type: "text", text: "fixture text" });
      }
    } finally {
      await bridge.close();
      await bridge.close();
    }
    if (childPid) assert.throws(() => process.kill(childPid, 0), /ESRCH/, `${profile} bridge left child ${childPid}`);
  }

  const { bridge } = await connectBridge(bridgeModule, sandbox, "full");
  const tool = (await bridge.listAllTools()).find(({ name }) => name === "memory_read");
  const first = bridge.call(tool, { variant: "crash" });
  const second = bridge.call(tool, { variant: "delay" });
  await assert.rejects(first, /crash|closed|exit|47/i);
  await assert.rejects(second, /crash|closed|exit|47/i);
  await bridge.close();
}

async function testExtension(extensionSource, sandbox) {
  assert.doesNotMatch(extensionSource, /registerPrompt|registerCommand|setInterval|https?:\/\//);
  assert.match(extensionSource, /session_start/);
  assert.match(extensionSource, /session_shutdown/);
  assert.match(extensionSource, /registerTool/);
  assert.match(extensionSource, /getAllTools/);

  const fakeRoot = join(sandbox, "extension-root");
  const fakeDist = join(fakeRoot, "mcp-memory-server", "dist");
  mkdirSync(fakeDist, { recursive: true });
  const bridgeLog = join(sandbox, "extension-log.jsonl");
  writeFileSync(join(fakeDist, "pi-mcp-bridge.js"), `
import { appendFileSync } from "node:fs";
const log = (event) => appendFileSync(${JSON.stringify(bridgeLog)}, JSON.stringify(event) + "\\n");
export async function connectCairnPiBridge() {
  log({ event: "connect" });
  const tools = ${JSON.stringify(ALL_TOOLS.slice(0, 2))};
  return {
    async listAllTools() { return tools; },
    async call(tool, args) { log({ event: "call", name: tool.name, args }); return { content: [{ type: "text", text: "extension result" }], details: { tool } }; },
    async close() { log({ event: "close" }); },
  };
}
`);
  const rendered = extensionSource.replaceAll("@@INFRA_ROOT@@", fakeRoot.replaceAll("\\", "/"));
  assert.notEqual(rendered, extensionSource, "Pi extension did not use the rendered package-root contract");
  const extensionPath = join(sandbox, "cairnkeep-memory.mts");
  writeFileSync(extensionPath, rendered);
  const extension = await import(`${pathToFileURL(extensionPath).href}?fixture=${Date.now()}`);
  assert.equal(typeof extension.default, "function");

  const handlers = new Map();
  const registered = [];
  const pi = Object.freeze({
    on(event, handler) {
      assert.ok(["session_start", "session_shutdown"].includes(event), `unexpected Pi lifecycle event ${event}`);
      handlers.set(event, handler);
    },
    registerTool(definition) {
      assert.deepEqual(Object.keys(definition).sort(), ["description", "execute", "label", "name", "parameters"]);
      assert.equal("annotations" in definition, false, "Pi 0.84.1 has no native annotations slot");
      registered.push(definition);
    },
    getAllTools() { return []; },
  });
  await extension.default(pi);
  assert.deepEqual([...handlers.keys()].sort(), ["session_shutdown", "session_start"]);
  await handlers.get("session_start")({ type: "session_start" }, { cwd: projectRoot });
  assert.deepEqual(registered.map(({ name }) => name), ["memory_read", "memory_write"]);
  assert.deepEqual(registered[0].parameters, INPUT_SCHEMA);
  assert.deepEqual(await registered[0].execute("call-1", { variant: "text" }, new AbortController().signal), {
    content: [{ type: "text", text: "extension result" }],
    details: { tool: ALL_TOOLS[0] },
  });
  await handlers.get("session_shutdown")({ type: "session_shutdown" }, { cwd: projectRoot });
  const extensionEvents = readFileSync(bridgeLog, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(extensionEvents.map(({ event }) => event), ["connect", "call", "close"]);

  const collisionHandlers = new Map();
  await extension.default({
    on(event, handler) { collisionHandlers.set(event, handler); },
    registerTool() { throw new Error("collision contract registered before rejecting"); },
    getAllTools() { return [{ name: "memory_read" }]; },
  });
  await assert.rejects(collisionHandlers.get("session_start")({ type: "session_start" }, { cwd: projectRoot }), /collision|override|memory_read/i);
}

async function main() {
  if (process.argv[2] === "--fake-server") {
    assert.equal(process.argv.length, 3, "fake server accepts no extra arguments");
    await runFakeServer();
    return;
  }
  assert.equal(process.argv.length, 2, "bridge smoke accepts no arguments");
  const sandbox = mkdtempSync(join(tmpdir(), "cairn-pi-mcp-bridge-"));
  try {
    await validateFakeServer(sandbox);
    let production;
    try {
      production = await loadProduction();
    } catch (error) {
      const message = String(error?.message ?? "");
      if (error?.code === "ERR_MODULE_NOT_FOUND" && (message.includes("pi-mcp-bridge.js") || message.includes("cairnkeep-memory.ts"))) {
        console.log(RED_MARKER);
        process.exitCode = EXPECTED_RED_EXIT;
        return;
      }
      throw error;
    }
    assertBridgeExports(production.bridge);
    await testBridge(production.bridge, sandbox);
    await testExtension(production.extensionSource, sandbox);
    console.log("PASS: dynamic Pi MCP catalog, result, cancellation, crash, and lifecycle contract");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
