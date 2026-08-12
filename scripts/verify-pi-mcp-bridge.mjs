#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const selfPath = fileURLToPath(import.meta.url);
const serverRoot = join(root, "mcp-memory-server");
const serverEntry = join(serverRoot, "dist", "index.js");
const bridgeEntry = join(serverRoot, "dist", "pi-mcp-bridge.js");
const extensionTemplate = join(root, "pi", "extensions", "cairnkeep-memory.ts");
const MAX_OUTPUT_BYTES = 64 * 1024;
const PROCESS_TIMEOUT_MS = 15_000;
const ORPHAN_TIMEOUT_MS = 3_000;
const PROFILES = Object.freeze([
  Object.freeze({ name: "full", allowed: null }),
  Object.freeze({ name: "read-only", allowed: null }),
  Object.freeze({ name: "custom", allowed: "memory_list,context_explore" }),
]);

class GateError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function output(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function fail(code) {
  throw new GateError(code);
}

function parseArgs(argv) {
  const options = { requiredRelease: false, selfTest: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--required-release") options.requiredRelease = true;
    else if (arg === "--self-test") options.selfTest = true;
    else if (arg === "--json") options.json = true;
    else if (["--pi-0-84-1", "--pi-current", "--pi-current-version"].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail("invalid-arguments");
      index += 1;
      if (arg === "--pi-0-84-1") options.minimumPath = value;
      else if (arg === "--pi-current") options.currentPath = value;
      else options.currentVersion = value;
    } else fail("invalid-arguments");
  }
  if (options.selfTest && (options.requiredRelease || options.minimumPath || options.currentPath || options.currentVersion)) {
    fail("invalid-arguments");
  }
  options.minimumPath ??= process.env.CAIRN_PI_0841_BIN;
  options.currentPath ??= process.env.CAIRN_PI_CURRENT_BIN;
  options.currentVersion ??= process.env.CAIRN_PI_CURRENT_VERSION;
  return options;
}

function semver(value) {
  if (typeof value !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)) fail("invalid-current-version");
  return value;
}

function executable(path) {
  if (typeof path !== "string" || path.length === 0) fail("invalid-executable");
  let resolved;
  try {
    resolved = realpathSync(resolve(path));
    if (!statSync(resolved).isFile()) fail("invalid-executable");
    accessSync(resolved, constants.X_OK);
  } catch (error) {
    if (error instanceof GateError) throw error;
    fail("invalid-executable");
  }
  return resolved;
}

function boundedAppend(current, chunk) {
  const next = Buffer.concat([current, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
  return next.byteLength <= MAX_OUTPUT_BYTES ? next : next.subarray(next.byteLength - MAX_OUTPUT_BYTES);
}

function spawnCaptured(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500).unref();
    }, options.timeoutMs ?? PROCESS_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout = boundedAppend(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = boundedAppend(stderr, chunk); });
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once("close", (status, signal) => {
      clearTimeout(timer);
      resolvePromise({ status, signal, timedOut, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8") });
    });
  });
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
    "CAIRN_PI_ACCEPTANCE_EVIDENCE",
    "CAIRN_PI_ACCEPTANCE_PIDS",
    "CAIRN_PI_ACCEPTANCE_BRIDGE",
    "CAIRN_PI_ACCEPTANCE_ORACLE",
    "CAIRN_PI_ACCEPTANCE_PROFILE",
    "CAIRN_PI_ACCEPTANCE_SELFTEST_FAULT",
  ]) delete env[name];
  return { ...env, ...extra };
}

async function loadSdk() {
  const sdk = join(serverRoot, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm");
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import(pathToFileURL(join(sdk, "client", "index.js")).href),
    import(pathToFileURL(join(sdk, "client", "stdio.js")).href),
  ]);
  return { Client, StdioClientTransport };
}

function profileEnvironment(sandbox, profile) {
  return cleanEnvironment({
    CAIRN_AGENTFS_BASE_DIR: join(sandbox, "memory"),
    CAIRN_MCP_TOOL_PROFILE: profile.name,
    CAIRN_EXPLORE_BINARY: join(sandbox, "delayed-explore.mjs"),
    CAIRN_EXPLORE_CACHE: "0",
    ...(profile.allowed ? { CAIRN_MCP_ALLOWED_TOOLS: profile.allowed } : {}),
  });
}

async function directCatalog(sdk, sandbox, profile) {
  const transport = new sdk.StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    cwd: sandbox,
    env: profileEnvironment(sandbox, profile),
    stderr: "pipe",
  });
  const client = new sdk.Client({ name: "cairnkeep-pi-release-oracle", version: "1" }, { capabilities: {} });
  await client.connect(transport, { timeout: 5_000, maxTotalTimeout: 5_000 });
  try {
    const tools = [];
    let cursor;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: 5_000 });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  } finally {
    await client.close();
  }
}

async function buildCatalogs(sandbox) {
  if (!existsSync(serverEntry) || !existsSync(bridgeEntry)) fail("server-build-missing");
  const sdk = await loadSdk();
  const catalogs = new Map();
  for (const profile of PROFILES) catalogs.set(profile.name, await directCatalog(sdk, sandbox, profile));
  return catalogs;
}

function captureToolRegistrations(pi, registeredTools) {
  return new Proxy(pi, {
    get(target, property, receiver) {
      if (property === "registerTool") {
        return (tool) => {
          registeredTools.set(tool.name, tool);
          target.registerTool(tool);
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

const OBSERVER_SOURCE = String.raw`
import cairnMemoryExtension from @@CAIRN_MEMORY_EXTENSION@@;
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const evidencePath = process.env.CAIRN_PI_ACCEPTANCE_EVIDENCE;
const bridgePath = process.env.CAIRN_PI_ACCEPTANCE_BRIDGE;
const write = (value) => writeFileSync(evidencePath, JSON.stringify(value));
const serial = (value) => JSON.parse(JSON.stringify(value));
@@CAPTURE_TOOL_REGISTRATIONS@@

export default function acceptanceObserver(pi) {
  const registeredTools = new Map();
  cairnMemoryExtension(captureToolRegistrations(pi, registeredTools));
  pi.on("session_start", async (_event, ctx) => {
    let acceptanceBridge;
    let stage = "tools";
    try {
      const registered = Array.from(registeredTools.values());
      const visibleRegistered = pi.getAllTools().filter(({ name }) => registeredTools.has(name));
      const read = registered.find(({ name }) => name === "memory_list");
      const delayed = registered.find(({ name }) => name === "context_explore");
      if (!read || !delayed || typeof read.execute !== "function" || typeof delayed.execute !== "function") throw new Error("tools unavailable");

      stage = "bridge-import";
      const bridgeModule = await import(pathToFileURL(bridgePath).href);
      stage = "bridge-connect";
      acceptanceBridge = await bridgeModule.connectCairnPiBridge({ cwd: ctx.cwd, env: { ...process.env } });
      stage = "catalog";
      const trustedCatalog = await acceptanceBridge.listAllTools();

      stage = "read-call";
      const first = await read.execute("acceptance-read-1", { scope: "project" }, new AbortController().signal);
      stage = "cancel-call";
      const controller = new AbortController();
      const pending = delayed.execute("acceptance-cancel", {
        query: "synthetic cancellation probe",
        repo_root: ctx.cwd,
        timeout_seconds: 1,
      }, controller.signal);
      setTimeout(() => controller.abort(new Error("cancelled")), 50);
      let cancellation = false;
      try { await pending; } catch { cancellation = true; }
      stage = "post-cancel-call";
      const after = await read.execute("acceptance-read-2", { scope: "project" }, new AbortController().signal);
      stage = "bridge-close";
      await acceptanceBridge.close();
      acceptanceBridge = undefined;

      stage = "evidence";
      write({
        status: "PASS",
        registered: registered.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: serial(tool.parameters),
          nativeAnnotations: Object.hasOwn(tool, "annotations"),
        })),
        visibleRegistered: visibleRegistered.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: serial(tool.parameters),
          exposesExecute: typeof tool.execute === "function",
        })),
        trustedCatalog: serial(trustedCatalog),
        callDetails: serial(first.details),
        callPassed: Array.isArray(first.content),
        cancellation,
        sessionUsable: Array.isArray(after.content),
        shutdownRequested: true,
      });
    } catch {
      try { await acceptanceBridge?.close(); } catch {}
      write({ status: "FAIL", reason: "observer-" + stage + "-failed" });
    } finally {
      ctx.shutdown();
    }
  });
}
`;

function writeRuntimeFixtures(sandbox) {
  const piRoot = join(sandbox, "pi-root");
  const extensionDir = join(piRoot, "extensions");
  mkdirSync(extensionDir, { recursive: true });
  const installedExtension = join(extensionDir, "cairnkeep-memory.ts");
  const rendered = readFileSync(extensionTemplate, "utf8").replaceAll("@@INFRA_ROOT@@", root.replaceAll("\\", "/"));
  writeFileSync(installedExtension, rendered);
  const observer = join(sandbox, "cairnkeep-acceptance.ts");
  writeFileSync(observer, OBSERVER_SOURCE
    .replace("@@CAIRN_MEMORY_EXTENSION@@", JSON.stringify(installedExtension))
    .replace("@@CAPTURE_TOOL_REGISTRATIONS@@", captureToolRegistrations.toString()));
  const delayed = join(sandbox, "delayed-explore.mjs");
  writeFileSync(delayed, "#!/usr/bin/env node\nsetTimeout(() => process.stdout.write(JSON.stringify({citations:[],stats:{turns:0,tool_calls:0}})), 10000);\n");
  chmodSync(delayed, 0o755);
  return { piRoot, observer };
}

function writeCairnWrapper(sandbox) {
  const bin = join(sandbox, "bin");
  mkdirSync(bin, { recursive: true });
  const wrapper = join(bin, "cairn");
  writeFileSync(wrapper, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
if (process.argv.length !== 3 || process.argv[2] !== "memory-server") process.exit(64);
appendFileSync(process.env.CAIRN_PI_ACCEPTANCE_PIDS, String(process.pid) + "\\n");
await import(pathToFileURL(${JSON.stringify(serverEntry)}).href);
`);
  chmodSync(wrapper, 0o755);
  return bin;
}

function validateCatalogEvidence(expected, evidence) {
  if (evidence?.status !== "PASS") {
    const reason = typeof evidence?.reason === "string" && /^observer-(tools|bridge-import|bridge-connect|catalog|read-call|cancel-call|post-cancel-call|bridge-close|evidence)-failed$/.test(evidence.reason)
      ? evidence.reason
      : "pi-observer-failed";
    fail(reason);
  }
  if (!Array.isArray(evidence.registered) || !Array.isArray(evidence.visibleRegistered) || !Array.isArray(evidence.trustedCatalog)) fail("pi-evidence-invalid");
  assert.deepEqual(evidence.trustedCatalog, expected, "trusted Pi bridge catalog drifted");
  assert.deepEqual(evidence.registered.map(({ name }) => name), expected.map(({ name }) => name), "Pi registered tool order drifted");
  assert.deepEqual(evidence.visibleRegistered.map(({ name }) => name), expected.map(({ name }) => name), "Pi public tool order drifted");
  for (let index = 0; index < expected.length; index += 1) {
    assert.equal(evidence.registered[index].description, expected[index].description, `${expected[index].name} description drifted`);
    assert.deepEqual(evidence.registered[index].inputSchema, expected[index].inputSchema, `${expected[index].name} input schema drifted`);
    assert.equal(evidence.registered[index].nativeAnnotations, false, `${expected[index].name} claimed unsupported native annotations`);
    assert.equal(evidence.visibleRegistered[index].description, expected[index].description, `${expected[index].name} public description drifted`);
    assert.deepEqual(evidence.visibleRegistered[index].inputSchema, expected[index].inputSchema, `${expected[index].name} public input schema drifted`);
    assert.equal(evidence.visibleRegistered[index].exposesExecute, false, `${expected[index].name} public metadata unexpectedly exposed execute`);
    assert.deepEqual(evidence.trustedCatalog[index].outputSchema, expected[index].outputSchema, `${expected[index].name} output schema drifted`);
    assert.deepEqual(evidence.trustedCatalog[index].annotations, expected[index].annotations, `${expected[index].name} annotations drifted`);
  }
  const read = expected.find(({ name }) => name === "memory_list");
  if (!read || !evidence.callDetails) fail("pi-read-evidence-missing");
  assert.deepEqual(evidence.callDetails.tool, read, "trusted call tool metadata drifted");
  assert.deepEqual(evidence.callDetails.annotations, read.annotations, "trusted call annotations drifted");
  assert.deepEqual(evidence.callDetails.outputSchema, read.outputSchema, "trusted call output schema drifted");
  if (!evidence.callPassed) fail("pi-read-call-failed");
  if (!evidence.cancellation) fail("pi-cancellation-failed");
  if (!evidence.sessionUsable) fail("pi-session-died-after-cancel");
  if (!evidence.shutdownRequested) fail("pi-shutdown-not-requested");
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
  if (pids.length === 0) fail("pi-child-evidence-missing");
  const deadline = Date.now() + ORPHAN_TIMEOUT_MS;
  while (Date.now() < deadline && pids.some(pidAlive)) await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  const alive = pids.filter(pidAlive);
  for (const pid of alive) {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
  if (alive.length) fail("pi-memory-child-orphaned");
}

async function reportedVersion(path, expected) {
  const result = await spawnCaptured(path, ["--version"], { cwd: root, env: cleanEnvironment(), timeoutMs: 5_000 });
  if (result.timedOut || result.status !== 0) fail("pi-version-check-failed");
  const versions = `${result.stdout}\n${result.stderr}`.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/g) ?? [];
  if (!versions.includes(expected)) fail("pi-version-mismatch");
}

async function runProfile(executablePath, version, profile, expected, parent, extraEnv = {}) {
  const sandbox = join(parent, `${version.replaceAll(/[^0-9A-Za-z]/g, "-")}-${profile.name}`);
  mkdirSync(sandbox, { recursive: true });
  const { piRoot, observer } = writeRuntimeFixtures(sandbox);
  const wrapperBin = writeCairnWrapper(sandbox);
  const evidencePath = join(sandbox, "evidence.json");
  const pidFile = join(sandbox, "children.txt");
  const oraclePath = join(sandbox, "oracle.json");
  writeFileSync(oraclePath, JSON.stringify(expected));
  const env = {
    ...profileEnvironment(sandbox, profile),
    ...extraEnv,
    PI_CODING_AGENT_DIR: piRoot,
    PATH: `${wrapperBin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
    CAIRN_PI_ACCEPTANCE_EVIDENCE: evidencePath,
    CAIRN_PI_ACCEPTANCE_PIDS: pidFile,
    CAIRN_PI_ACCEPTANCE_BRIDGE: bridgeEntry,
    CAIRN_PI_ACCEPTANCE_ORACLE: oraclePath,
    CAIRN_PI_ACCEPTANCE_PROFILE: profile.name,
  };
  const args = [
    "--mode", "rpc", "--no-session", "--no-extensions",
    "--extension", observer,
    "--no-skills", "--no-prompt-templates", "--no-context-files",
    "--no-builtin-tools", "--approve",
  ];
  const result = await spawnCaptured(executablePath, args, { cwd: sandbox, env });
  if (result.timedOut) fail("pi-runtime-timeout");
  if (result.status !== 0) fail("pi-runtime-failed");
  if (!existsSync(evidencePath)) fail("pi-evidence-missing");
  let evidence;
  try { evidence = JSON.parse(readFileSync(evidencePath, "utf8")); } catch { fail("pi-evidence-invalid"); }
  try { validateCatalogEvidence(expected, evidence); } catch (error) {
    if (error instanceof GateError) throw error;
    fail("pi-catalog-mismatch");
  }
  await requireNoOrphans(pidFile);
  return Object.freeze({ profile: profile.name, tool_count: expected.length, catalog: true, trusted_details: true, call: true, cancellation: true, shutdown: true, orphan_free: true });
}

async function runExecutable(executablePath, version, catalogs, parent, extraEnv = {}) {
  await reportedVersion(executablePath, version);
  const profiles = [];
  for (const profile of PROFILES) profiles.push(await runProfile(executablePath, version, profile, catalogs.get(profile.name), parent, extraEnv));
  return Object.freeze({ version, profiles });
}

function fakeExecutableSource(version) {
  return `#!/usr/bin/env node
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
if (process.argv.includes("--version")) { console.log(${JSON.stringify(version)}); process.exit(0); }
const expected = JSON.parse(readFileSync(process.env.CAIRN_PI_ACCEPTANCE_ORACLE, "utf8"));
const fault = process.env.CAIRN_PI_ACCEPTANCE_SELFTEST_FAULT || "";
if (fault === "shutdown") process.exit(9);
const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, " + (fault === "orphan" ? "10000" : "20") + ")"], { stdio: "ignore", detached: fault === "orphan" });
appendFileSync(process.env.CAIRN_PI_ACCEPTANCE_PIDS, String(child.pid) + "\\n");
if (fault === "orphan") child.unref(); else await new Promise((resolvePromise) => child.once("exit", resolvePromise));
const registered = expected.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, nativeAnnotations: false }));
if (fault === "profile" && process.env.CAIRN_PI_ACCEPTANCE_PROFILE === "read-only") registered[0].name = "drifted_tool";
const visibleRegistered = registered.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, exposesExecute: false }));
const read = expected.find(({ name }) => name === "memory_list");
writeFileSync(process.env.CAIRN_PI_ACCEPTANCE_EVIDENCE, JSON.stringify({
  status: "PASS", registered, visibleRegistered, trustedCatalog: expected,
  callDetails: { tool: read, annotations: read?.annotations, outputSchema: read?.outputSchema },
  callPassed: true, cancellation: fault !== "cancellation", sessionUsable: true,
  shutdownRequested: true,
}));
`;
}

function writeFakeExecutable(directory, name, version) {
  const path = join(directory, name);
  writeFileSync(path, fakeExecutableSource(version));
  chmodSync(path, 0o755);
  return path;
}

async function expectGate(code, action) {
  await assert.rejects(action, (error) => error instanceof GateError && error.code === code);
}

async function selfTest() {
  const sandbox = mkdtempSync(join(tmpdir(), "cairn-pi-release-self-test-"));
  try {
    const captured = new Map();
    const definitions = new Map();
    const metadataOnlyPi = {
      registerTool(tool) { definitions.set(tool.name, tool); },
      getAllTools() {
        return Array.from(definitions.values(), ({ name, description, parameters }) => ({ name, description, parameters }));
      },
    };
    const acceptancePi = captureToolRegistrations(metadataOnlyPi, captured);
    const execute = async () => ({ content: [] });
    acceptancePi.registerTool({ name: "fixture_tool", description: "Fixture", parameters: { type: "object" }, execute });
    assert.equal(metadataOnlyPi.getAllTools()[0].execute, undefined);
    assert.equal(captured.get("fixture_tool").execute, execute);

    const skipped = await spawnCaptured(process.execPath, [selfPath], { cwd: root, env: cleanEnvironment(), timeoutMs: 5_000 });
    assert.equal(skipped.status, 0);
    assert.deepEqual(JSON.parse(skipped.stdout), { schema_version: 1, status: "SKIP", reason: "real-pi-fixtures-unavailable" });
    const requiredMissing = await spawnCaptured(process.execPath, [selfPath, "--required-release"], { cwd: root, env: cleanEnvironment(), timeoutMs: 5_000 });
    assert.notEqual(requiredMissing.status, 0);
    assert.equal(requiredMissing.stdout.includes("SKIP"), false);
    assert.deepEqual(JSON.parse(requiredMissing.stdout), { schema_version: 1, status: "FAIL", reason: "required-fixtures-missing" });
    const minimum = writeFakeExecutable(sandbox, "pi-minimum", "0.84.1");
    const equalCurrent = writeFakeExecutable(sandbox, "pi-current-equal", "0.84.1");
    const current = writeFakeExecutable(sandbox, "pi-current", "0.99.0");
    const equalRelease = await spawnCaptured(process.execPath, [
      selfPath,
      "--required-release",
      "--pi-0-84-1", minimum,
      "--pi-current", equalCurrent,
      "--pi-current-version", "0.84.1",
    ], { cwd: root, env: cleanEnvironment() });
    assert.equal(equalRelease.status, 0);
    const equalEvidence = JSON.parse(equalRelease.stdout);
    assert.equal(equalEvidence.status, "PASS");
    assert.equal(equalEvidence.mode, "required-release");
    assert.equal(equalEvidence.versions_equal, true);
    assert.equal(equalEvidence.minimum.version, "0.84.1");
    assert.equal(equalEvidence.current.version, "0.84.1");
    for (const forbidden of [sandbox, process.env.USER, process.env.HOSTNAME, basename(root)]) {
      if (forbidden && equalRelease.stdout.includes(forbidden)) fail("self-test-evidence-disclosure");
    }
    const duplicateFixture = await spawnCaptured(process.execPath, [
      selfPath,
      "--required-release",
      "--pi-0-84-1", minimum,
      "--pi-current", minimum,
      "--pi-current-version", "0.84.1",
    ], { cwd: root, env: cleanEnvironment() });
    assert.notEqual(duplicateFixture.status, 0);
    assert.deepEqual(JSON.parse(duplicateFixture.stdout), { schema_version: 1, status: "FAIL", reason: "fixtures-not-distinct" });
    const catalogs = await buildCatalogs(sandbox);
    const pass = await Promise.all([
      runExecutable(minimum, "0.84.1", catalogs, join(sandbox, "pass-minimum")),
      runExecutable(current, "0.99.0", catalogs, join(sandbox, "pass-current")),
    ]);
    assert.equal(pass.length, 2);
    await expectGate("pi-version-mismatch", () => reportedVersion(current, "0.99.1"));
    await expectGate("pi-catalog-mismatch", () => runExecutable(minimum, "0.84.1", catalogs, join(sandbox, "profile-fault"), { CAIRN_PI_ACCEPTANCE_SELFTEST_FAULT: "profile" }));
    await expectGate("pi-cancellation-failed", () => runProfile(minimum, "0.84.1", PROFILES[0], catalogs.get("full"), join(sandbox, "cancel-fault"), { CAIRN_PI_ACCEPTANCE_SELFTEST_FAULT: "cancellation" }));
    await expectGate("pi-runtime-failed", () => runProfile(minimum, "0.84.1", PROFILES[0], catalogs.get("full"), join(sandbox, "shutdown-fault"), { CAIRN_PI_ACCEPTANCE_SELFTEST_FAULT: "shutdown" }));
    await expectGate("pi-memory-child-orphaned", () => runProfile(minimum, "0.84.1", PROFILES[0], catalogs.get("full"), join(sandbox, "orphan-fault"), { CAIRN_PI_ACCEPTANCE_SELFTEST_FAULT: "orphan" }));
    const sanitized = JSON.stringify({ schema_version: 1, status: "PASS", mode: "self-test", checks: ["skip", "required-input", "version", "equal-version-fixtures", "distinct-fixtures", "metadata-only-pi-api", "profiles", "trusted-details", "cancellation", "shutdown", "orphan"] });
    for (const forbidden of [sandbox, process.env.USER, process.env.HOSTNAME, basename(root)]) {
      if (forbidden && sanitized.includes(forbidden)) fail("self-test-evidence-disclosure");
    }
    output(JSON.parse(sanitized));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    await selfTest();
    return;
  }
  const complete = Boolean(options.minimumPath && options.currentPath && options.currentVersion);
  if (!complete) {
    if (options.requiredRelease) fail("required-fixtures-missing");
    output({ schema_version: 1, status: "SKIP", reason: options.minimumPath || options.currentPath || options.currentVersion ? "real-pi-fixtures-incomplete" : "real-pi-fixtures-unavailable" });
    return;
  }
  const currentVersion = semver(options.currentVersion);
  const minimumPath = executable(options.minimumPath);
  const currentPath = executable(options.currentPath);
  if (minimumPath === currentPath) fail("fixtures-not-distinct");
  const sandbox = mkdtempSync(join(tmpdir(), "cairn-pi-release-"));
  try {
    const catalogs = await buildCatalogs(sandbox);
    const minimum = await runExecutable(minimumPath, "0.84.1", catalogs, join(sandbox, "minimum"));
    const current = await runExecutable(currentPath, currentVersion, catalogs, join(sandbox, "current"));
    output({
      schema_version: 1,
      status: "PASS",
      mode: options.requiredRelease ? "required-release" : "available-fixtures",
      versions_equal: currentVersion === "0.84.1",
      minimum,
      current,
    });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  const reason = error instanceof GateError ? error.code : "acceptance-runner-failed";
  output({ schema_version: 1, status: "FAIL", reason });
  process.exitCode = 1;
}
