#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");
const childEntry = join(serverRoot, "dist", "pi-bridge-child.js");
const selfPath = fileURLToPath(import.meta.url);
const ORPHAN_TIMEOUT_MS = 3_000;

const TOOLS = Object.freeze([
  Object.freeze({
    name: "memory_read",
    title: "Read memory",
    description: "Read a fixture memory value.",
    inputSchema: { type: "object", additionalProperties: false, properties: { variant: { enum: ["text", "error", "delay", "crash"] } } },
  }),
  Object.freeze({
    name: "memory_write",
    title: "Write memory",
    description: "Write a fixture memory value.",
    inputSchema: { type: "object", additionalProperties: false },
  }),
]);

function record(event, extra = {}) {
  const path = process.env.CAIRN_PI_FIXTURE_LOG;
  if (path) appendFileSync(path, `${JSON.stringify({ event, ...extra })}\n`);
}

async function runFakeServer() {
  if (process.env.MCP_HTTP_PORT !== undefined) {
    record("env-leak", { mcpHttpPort: process.env.MCP_HTTP_PORT });
    process.stderr.write("fixture inherited MCP_HTTP_PORT\n");
    process.exit(78);
  }
  record("started", {
    pid: process.pid,
    pathHasBunShim: (process.env.PATH ?? "").split(":").some((entry) => /^\/tmp\/bun-node-[^/]+$/.test(entry)),
  });
  process.on("SIGTERM", () => { record("terminated", { signal: "SIGTERM" }); process.exit(0); });
  process.on("SIGINT", () => { record("terminated", { signal: "SIGINT" }); process.exit(0); });

  const server = new Server({ name: "pi-bridge-child-fixture", version: "1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const variant = request.params.arguments?.variant ?? "text";
    record("call", { name: request.params.name, variant });
    if (variant === "crash") {
      process.stderr.write("fixture crash tail\n");
      process.exit(47);
    }
    if (variant === "delay") {
      await new Promise((resolvePromise, rejectPromise) => {
        const timer = setTimeout(resolvePromise, 10_000);
        extra.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          record("cancelled");
          rejectPromise(extra.signal.reason ?? new Error("cancelled"));
        }, { once: true });
      });
    }
    if (variant === "error") return { content: [{ type: "text", text: "fixture failure" }], isError: true };
    return { content: [{ type: "text", text: "fixture text" }], structuredContent: { ok: true } };
  });
  await server.connect(new StdioServerTransport());
}

// Minimal NDJSON client for the bridge child.
function startChild(sandbox) {
  const fixtureLog = join(sandbox, "fixture.jsonl");
  const env = {
    ...process.env,
    CAIRN_PI_FIXTURE_LOG: fixtureLog,
    CAIRN_PI_BRIDGE_COMMAND: process.execPath,
    CAIRN_PI_BRIDGE_ARGS: JSON.stringify([selfPath, "--fake-server"]),
    // Poison the parent env: the child must strip both before the fixture sees them.
    MCP_HTTP_PORT: "65535",
    PATH: `/tmp/bun-node-deadbeef${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
  };
  const child = spawn("node", [childEntry, sandbox], { stdio: ["pipe", "pipe", "pipe"], env });
  let stdoutBuffer = "";
  let id = 0;
  const waiters = new Map();
  const stderrTail = { value: "" };
  child.stderr.on("data", (chunk) => {
    const next = stderrTail.value + chunk.toString("utf8");
    stderrTail.value = next.length <= 8192 ? next : next.slice(next.length - 8192);
  });
  const exited = new Promise((resolvePromise) => child.once("exit", (code, signal) => resolvePromise({ code, signal })));
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    let newline = stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      newline = stdoutBuffer.indexOf("\n");
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.type === "result" && waiters.has(message.id)) {
        const { resolve: resolvePromise, reject, timer } = waiters.get(message.id);
        clearTimeout(timer);
        waiters.delete(message.id);
        if (message.ok) resolvePromise(message);
        else reject(Object.assign(new Error(message.error), { bridgeResult: message }));
      }
    }
  });
  const request = (message, timeoutMs = 5_000) => {
    const requestId = ++id;
    session.lastRequestId = requestId;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        waiters.delete(requestId);
        rejectPromise(new Error(`request ${message.type} timed out`));
      }, timeoutMs);
      waiters.set(requestId, { resolve: resolvePromise, reject: rejectPromise, timer });
      child.stdin.write(`${JSON.stringify({ ...message, id: requestId })}\n`);
    });
  };
  const session = { child, request, exited, stderrTail, fixtureLog, lastRequestId: 0 };
  return session;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function reapFixtures(fixtureLog) {
  for (const event of await fixtureEvents(fixtureLog)) {
    if (event.event !== "started" || !Number.isSafeInteger(event.pid)) continue;
    if (pidAlive(event.pid)) {
      try {
        process.kill(event.pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }
}

async function waitForEvent(fixtureLog, eventName, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await fixtureEvents(fixtureLog)).some(({ event }) => event === eventName)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`fixture did not record ${eventName}`);
}

async function expectExited(exited, timeoutMs, label) {
  const timeout = new Promise((resolvePromise) => setTimeout(() => resolvePromise(null), timeoutMs));
  const result = await Promise.race([exited, timeout]);
  assert.ok(result, `${label} did not exit`);
  return result;
}

async function fixtureEvents(fixtureLog) {
  return existsSync(fixtureLog)
    ? readFileSync(fixtureLog, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
}

async function main() {
  if (process.argv[2] === "--fake-server") {
    await runFakeServer();
    return;
  }
  assert.equal(process.argv.length, 2, "bridge child smoke accepts no arguments");
  assert.ok(existsSync(childEntry), "pi-bridge-child.js is not built");

  const sandbox = mkdtempSync(join(tmpdir(), "cairn-pi-bridge-child-"));
  try {
    // Oracle: the same fixture through a direct MCP client.
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [selfPath, "--fake-server"],
      env: { ...process.env, CAIRN_PI_FIXTURE_LOG: join(sandbox, "direct.jsonl") },
      stderr: "pipe",
    });
    const direct = new Client({ name: "pi-bridge-child-oracle", version: "1" }, { capabilities: {} });
    await direct.connect(transport);
    const expectedTools = (await direct.listTools()).tools;
    await direct.close();

    // Ready + list parity with the direct oracle.
    const first = startChild(sandbox);
    const listResult = await first.request({ type: "list" });
    assert.deepEqual(listResult.tools, expectedTools, "child catalog drifted from direct tools/list");

    // Call success preserves the full bridge result shape.
    const callResult = await first.request({ type: "call", tool: expectedTools[0], args: { variant: "text" } });
    assert.deepEqual(callResult.result.content, [{ type: "text", text: "fixture text" }]);
    assert.deepEqual(callResult.result.details.structuredContent, { ok: true });
    assert.equal(callResult.result.details.isError, false);

    // Call error propagates as ok:false with the failure text.
    const failure = await first.request({ type: "call", tool: expectedTools[0], args: { variant: "error" } }).catch((error) => error);
    assert.ok(failure instanceof Error, "error variant resolved instead of rejecting");
    assert.match(failure.message, /fixture failure/i);
    assert.equal(typeof failure.bridgeResult.stderr, "string");

    // Cancel aborts the in-flight bridge call.
    const delayed = first.request({ type: "call", tool: expectedTools[0], args: { variant: "delay" } });
    const delayId = first.lastRequestId;
    setTimeout(() => first.child.stdin.write(`${JSON.stringify({ type: "cancel", id: delayId })}\n`), 20);
    await assert.rejects(delayed, /cancel|abort/i);
    await waitForEvent(first.fixtureLog, "cancelled");

    // Clean close: child exits and the fixture server is terminated.
    await first.request({ type: "close" }, 1_000).catch(() => undefined);
    const firstExit = await expectExited(first.exited, ORPHAN_TIMEOUT_MS, "close");
    assert.equal(firstExit.code, 0, "clean close must exit 0");
    // The fixture server must be gone (the MCP transport ends its stdin and
    // the process exits; a "terminated" signal record is not guaranteed).
    const startedEvent = (await fixtureEvents(first.fixtureLog)).find(({ event }) => event === "started");
    assert.ok(startedEvent && Number.isSafeInteger(startedEvent.pid), "fixture pid not recorded");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, ORPHAN_TIMEOUT_MS));
    assert.ok(!pidAlive(startedEvent.pid), "fixture server survived clean close");

    // Crash mid-call: the crashing call and its in-flight sibling both fail.
    const second = startChild(sandbox);
    await second.request({ type: "list" });
    const crashing = second.request({ type: "call", tool: expectedTools[0], args: { variant: "crash" } }).catch((error) => error);
    const sibling = second.request({ type: "call", tool: expectedTools[0], args: { variant: "delay" } }, 8_000).catch((error) => error);
    const crashError = await crashing;
    assert.match(crashError.message, /crash|closed|exit|47/i);
    const siblingError = await sibling;
    assert.ok(siblingError instanceof Error, "sibling call survived the fixture crash");
    // The bridge is dead: further list requests fail instead of hanging.
    await assert.rejects(second.request({ type: "list" }, 3_000), /closed|ready/i);
    await second.request({ type: "close" }, 1_000).catch(() => undefined);
    await expectExited(second.exited, ORPHAN_TIMEOUT_MS, "post-crash close");

    // SIGKILL while idle: the child dies; a pending call would reject (parent
    // responsibility), here we assert the child itself is gone.
    const third = startChild(sandbox);
    await third.request({ type: "list" });
    third.child.kill("SIGKILL");
    const thirdExit = await expectExited(third.exited, ORPHAN_TIMEOUT_MS, "SIGKILLed child");
    assert.equal(thirdExit.signal, "SIGKILL");

    // Env contract: the fixture (the process that actually spawns the server)
    // saw MCP_HTTP_PORT stripped and no bare /tmp/bun-node-* PATH entry.
    const events = await fixtureEvents(first.fixtureLog);
    const started = events.find(({ event }) => event === "started");
    assert.ok(started, "fixture did not record its startup env");
    assert.notEqual(started.pathHasBunShim, true, "Bun node-shim PATH entry leaked into the grandchild env");
    assert.ok(!events.some(({ event }) => event === "env-leak"), "MCP_HTTP_PORT leaked into the grandchild env");

    console.log("PASS: pi-bridge-child ready/list parity, call, error, cancel, close, crash, SIGKILL, and env-stripping contract");
  } finally {
    // A SIGKILLed bridge child cannot close its fixture server; reap survivors.
    await reapFixtures(join(sandbox, "fixture.jsonl"));
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
