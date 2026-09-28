#!/usr/bin/env bun
// Smoke verification for the oh-my-pi (omp) Cairnkeep memory extension.
//
// Renders omp/extensions/cairnkeep-memory.ts into a sandbox agent directory,
// loads it under Bun against a mock ExtensionAPI, and drives the real MCP
// bridge against a supervised `cairn memory-server` child. Asserts the
// registered tool surface matches the trusted MCP catalog, a real read call
// normalizes to the omp AgentToolResult shape, cancellation works, shutdown
// leaves no orphaned server, and a name collision refuses startup.
//
// Requires Bun (the omp runtime). Usage:
//   bun scripts/verify-omp-mcp-bridge.mjs
// Exit 0 with {"status":"PASS"} on success; exit 1 with {"status":"FAIL"}.
// Missing Bun or an unbuilt memory server reports {"status":"SKIP"}.

import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = join(root, "mcp-memory-server");
const serverEntry = join(serverRoot, "dist", "index.js");
const bridgeEntry = join(serverRoot, "dist", "pi-mcp-bridge.js");
const extensionTemplate = join(root, "omp", "extensions", "cairnkeep-memory.ts");
const ORPHAN_TIMEOUT_MS = 3_000;
const CALL_TIMEOUT_MS = 30_000;

function output(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function fail(reason) {
  throw Object.assign(new Error(reason), { code: reason });
}

function isGate(error) {
  return error instanceof Error && typeof error.code === "string";
}

function cleanEnvironment(extra = {}) {
  const env = { ...process.env };
  for (const name of [
    "CAIRN_MCP_TOOL_PROFILE",
    "CAIRN_MCP_ALLOWED_TOOLS",
    "CAIRN_TYPED_MEMORY_NODES",
    "CAIRN_ARTIFACT_STORE",
    "CAIRN_ARTIFACT_HTTP",
    "CAIRN_CONTEXT_PACKS",
    "CAIRN_CONTEXT_PACK_HTTP",
    "CAIRN_CAPABILITY_CONTRACT",
    "MCP_HTTP_PORT",
    "CAIRN_OMP_SMOKE_PIDS",
  ]) delete env[name];
  return { ...env, ...extra };
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function requireNoOrphans(pidFile) {
  const pids = existsSync(pidFile)
    ? readFileSync(pidFile, "utf8").split(/\s+/).filter(Boolean).map(Number).filter(Number.isSafeInteger)
    : [];
  if (pids.length === 0) fail("omp-child-evidence-missing");
  const deadline = Date.now() + ORPHAN_TIMEOUT_MS;
  while (Date.now() < deadline && pids.some(pidAlive)) await Bun.sleep(50);
  const alive = pids.filter(pidAlive);
  for (const pid of alive) {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
  if (alive.length) fail("omp-memory-child-orphaned");
}

function writeCairnWrapper(sandbox) {
  const bin = join(sandbox, "bin");
  mkdirSync(bin, { recursive: true });
  const wrapper = join(bin, "cairn");
  writeFileSync(wrapper, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv.length !== 3 || process.argv[2] !== "memory-server") process.exit(64);
appendFileSync(process.env.CAIRN_OMP_SMOKE_PIDS, String(process.pid) + "\\n");
await import(pathToFileURL(${JSON.stringify(serverEntry)}).href);
`);
  chmodSync(wrapper, 0o755);
  return bin;
}

// Metadata-only mock of the omp ExtensionAPI: registration captures full
// definitions, while getAllTools() exposes identity/schema without execute,
// mirroring omp's ToolInfo contract.
function createMockPi(existingNames = []) {
  const handlers = new Map();
  const definitions = new Map();
  const pi = {
    registerTool(tool) {
      definitions.set(tool.name, tool);
    },
    getAllTools() {
      const registered = Array.from(definitions.values(), ({ name, label, description, parameters }) => ({
        name,
        label,
        description,
        parameters,
      }));
      return [
        ...existingNames.map((name) => ({ name, label: name, description: name, parameters: { type: "object" } })),
        ...registered,
      ];
    },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },
  };
  const fire = async (event, eventPayload, ctx) => {
    for (const handler of handlers.get(event) ?? []) await handler(eventPayload, ctx);
  };
  return { pi, definitions, fire };
}

async function trustedCatalog(env, cwd) {
  const module = await import(pathToFileURL(bridgeEntry).href);
  const bridge = await module.connectCairnPiBridge({
    command: process.execPath,
    args: [serverEntry],
    cwd,
    env,
    startupTimeoutMs: 10_000,
  });
  try {
    return await bridge.listAllTools();
  } finally {
    await bridge.close();
  }
}

async function main() {
  if (!process.versions.bun) {
    output({ schema_version: 1, status: "SKIP", reason: "bun-runtime-required" });
    return;
  }
  if (!existsSync(serverEntry) || !existsSync(bridgeEntry)) fail("server-build-missing");
  if (!existsSync(extensionTemplate)) fail("extension-template-missing");

  const sandbox = mkdtempSync(join(tmpdir(), "cairn-omp-bridge-"));
  // The extension forwards `{ ...process.env }` to its bridge child, so the
  // sandbox environment must be live on this process while it runs.
  const savedEnv = new Map();
  const restoreEnv = () => {
    for (const [name, value] of savedEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  try {
    const pidFile = join(sandbox, "children.txt");
    const childPidFile = join(sandbox, "bridge-children.txt");
    const env = cleanEnvironment({
      CAIRN_AGENTFS_BASE_DIR: join(sandbox, "memory"),
      CAIRN_MCP_TOOL_PROFILE: "full",
      CAIRN_EXPLORE_BINARY: join(sandbox, "delayed-explore.mjs"),
      CAIRN_EXPLORE_CACHE: "0",
      CAIRN_OMP_SMOKE_PIDS: pidFile,
      CAIRN_BRIDGE_CHILD_PID_LOG: childPidFile,
      PATH: `${writeCairnWrapper(sandbox)}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
    });
    writeFileSync(
      join(sandbox, "delayed-explore.mjs"),
      "#!/usr/bin/env node\nsetTimeout(() => process.stdout.write(JSON.stringify({citations:[],stats:{turns:0,tool_calls:0}})), 10000);\n",
    );
    const cwd = join(sandbox, "project");
    mkdirSync(cwd, { recursive: true });

    const expected = await trustedCatalog(env, cwd);

    for (const [name, value] of Object.entries(env)) {
      savedEnv.set(name, process.env[name]);
      process.env[name] = value;
    }

    // Render and load the extension exactly as sync-omp-assets.sh installs it.
    const renderedExtension = join(sandbox, "cairnkeep-memory.ts");
    writeFileSync(
      renderedExtension,
      readFileSync(extensionTemplate, "utf8").replaceAll("@@INFRA_ROOT@@", root.replaceAll("\\", "/")),
    );
    const factoryModule = await import(pathToFileURL(renderedExtension).href);
    if (typeof factoryModule.default !== "function") fail("extension-factory-missing");

    const { pi, definitions, fire } = createMockPi();
    factoryModule.default(pi);
    const ctx = { cwd, shutdown() {} };
    await fire("session_start", { type: "session_start" }, ctx);

    const registered = Array.from(definitions.values());
    assert.deepEqual(
      registered.map(({ name }) => name),
      expected.map(({ name }) => name),
      "omp registered tool order drifted from the MCP catalog",
    );
    for (let index = 0; index < expected.length; index += 1) {
      assert.equal(registered[index].description, expected[index].description, `${expected[index].name} description drifted`);
      assert.deepEqual(registered[index].parameters, expected[index].inputSchema, `${expected[index].name} input schema drifted`);
      assert.equal(typeof registered[index].execute, "function", `${expected[index].name} missing execute`);
      assert.equal(registered[index].strict, false, `${expected[index].name} should opt out of strict grammar`);
    }
    const visibleRegistered = pi.getAllTools().filter(({ name }) => definitions.has(name));
    assert.equal(visibleRegistered.length, expected.length, "omp public tool surface incomplete");
    for (const tool of visibleRegistered) {
      assert.equal("execute" in tool, false, "omp public metadata exposed execute");
    }

    const read = definitions.get("memory_list");
    if (!read) fail("omp-read-tool-missing");
    const noSignal = undefined;
    const first = await read.execute("smoke-read-1", { scope: "project" }, noSignal, undefined, ctx);
    assert.ok(Array.isArray(first.content) && first.content.length > 0, "omp read returned no content");
    for (const block of first.content) {
      if (block.type === "text") assert.equal(typeof block.text, "string");
      else if (block.type === "image") {
        assert.equal(typeof block.data, "string");
        assert.equal(typeof block.mimeType, "string");
      } else fail("omp-content-shape-invalid");
    }
    assert.equal(first.details?.tool?.name, "memory_list", "omp details lost trusted tool metadata");
    assert.equal(first.details?.isError, false, "omp details misreport failure state");

    const delayed = definitions.get("context_explore");
    if (!delayed) fail("omp-explore-tool-missing");
    const controller = new AbortController();
    const pending = delayed.execute(
      "smoke-cancel",
      { query: "synthetic cancellation probe", repo_root: cwd, timeout_seconds: 1 },
      controller.signal,
      undefined,
      ctx,
    );
    setTimeout(() => controller.abort(new Error("cancelled")), 50);
    let cancellation = false;
    try { await pending; } catch { cancellation = true; }
    assert.ok(cancellation, "omp cancellation probe was not interrupted");

    const after = await read.execute("smoke-read-2", { scope: "project" }, noSignal, undefined, ctx);
    assert.ok(Array.isArray(after.content), "omp session unusable after cancellation");

    await fire("session_shutdown", { type: "session_shutdown" }, ctx);
    await requireNoOrphans(pidFile);
    await requireNoOrphans(childPidFile);

    // A colliding pre-existing tool name must refuse startup and close the bridge.
    const colliding = createMockPi([expected[0].name]);
    factoryModule.default(colliding.pi);
    let collisionRefused = false;
    try {
      await colliding.fire("session_start", { type: "session_start" }, ctx);
    } catch (error) {
      collisionRefused = /collision/.test(error instanceof Error ? error.message : String(error));
    }
    assert.ok(collisionRefused, "omp extension did not refuse a tool-name collision");
    await colliding.fire("session_shutdown", { type: "session_shutdown" }, ctx);
    await requireNoOrphans(pidFile);
    await requireNoOrphans(childPidFile);

    // An uninitialized host runtime (omp ephemeral side turns) must be a no-op.
    const pidsBefore = existsSync(pidFile) ? readFileSync(pidFile, "utf8").split(/\s+/).filter(Boolean).length : 0;
    const childPidsBefore = existsSync(childPidFile) ? readFileSync(childPidFile, "utf8").split(/\s+/).filter(Boolean).length : 0;
    const uninitialized = createMockPi();
    const throwingPi = new Proxy(uninitialized.pi, {
      get(target, property, receiver) {
        if (property === "getAllTools") {
          return () => {
            throw new Error("Extension runtime not initialized. Action methods cannot be called during extension loading.");
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    factoryModule.default(throwingPi);
    await uninitialized.fire("session_start", { type: "session_start" }, ctx);
    assert.equal(uninitialized.definitions.size, 0, "omp extension registered tools on an uninitialized runtime");
    await uninitialized.fire("session_shutdown", { type: "session_shutdown" }, ctx);
    const pidsAfter = existsSync(pidFile) ? readFileSync(pidFile, "utf8").split(/\s+/).filter(Boolean).length : 0;
    assert.equal(pidsAfter, pidsBefore, "omp extension spawned a server for an uninitialized runtime");
    const childPidsAfter = existsSync(childPidFile) ? readFileSync(childPidFile, "utf8").split(/\s+/).filter(Boolean).length : 0;
    assert.equal(childPidsAfter, childPidsBefore, "omp extension spawned a bridge child for an uninitialized runtime");

    output({
      schema_version: 1,
      status: "PASS",
      checks: [
        "extension-load",
        "catalog-parity",
        "public-metadata-shape",
        "agent-tool-result-shape",
        "trusted-details",
        "cancellation",
        "shutdown",
        "orphan-free",
        "bridge-child-orphan-free",
        "collision-refusal",
        "uninitialized-runtime-noop",
      ],
      tool_count: expected.length,
    });
  } finally {
    restoreEnv();
    rmSync(sandbox, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  output({ schema_version: 1, status: "FAIL", reason: isGate(error) ? error.code : "omp-smoke-failed" });
  process.exitCode = 1;
}
