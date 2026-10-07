#!/usr/bin/env bun
// Smoke verification for the oh-my-pi (omp) cairnkeep-capture extension
// (memory-capture + memory-wakeup port).
//
// Renders omp/extensions/cairnkeep-capture.ts against a synthetic infra root
// (stub server `extract` subcommand + the real staging wrapper), loads it
// under Bun against a mock ExtensionAPI, and drives session_stop /
// session_start with mock branch data. Asserts guard behavior, transcript
// text shaping (12000-char cap keeping the most recent text, toolResult
// noise dropped), staging filename/JSON contract, retention cap 5, session
// de-dupe, wakeup notify + nextTurn context injection, uninitialized-runtime
// and subagent skips, and the /cairn-staged command surface.
//
// Requires Bun (the omp runtime). Usage:
//   bun scripts/verify-omp-capture.mjs
// Exit 0 with {"status":"PASS"} on success; exit 1 with {"status":"FAIL"}.

import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionTemplate = join(root, "omp", "extensions", "cairnkeep-capture.ts");
const stageWrapper = join(root, "scripts", "lib", "omp-capture-stage.mjs");
const STAGING_REL = join(".planning", "memory-staging");
const STUB_MODEL = "stub-model";
const STAGED_CUSTOM_TYPE = "sh.cairnkeep.staged-memory";

function output(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function fail(reason) {
  throw Object.assign(new Error(reason), { code: reason });
}

function isGate(error) {
  return error instanceof Error && typeof error.code === "string";
}

// Stub server entry: same stdin -> stdout contract as
// `node dist/index.js extract <model>` with a fixed candidate set, and logs
// the received transcript text for assertion.
const STUB_SERVER = String.raw`
let input = "";
process.stdin.on("data", (chunk) => { input += chunk.toString("utf8"); });
process.stdin.on("end", () => {
  if (process.env.CAIRN_STUB_STDIN_LOG) require("node:fs").writeFileSync(process.env.CAIRN_STUB_STDIN_LOG, input);
  process.stdout.write(JSON.stringify({
    model: process.argv[3] ?? "unknown",
    count: 2,
    candidates: [
      { category: "decisions", key: "decisions/stub-one", value: "Stub candidate one." },
      { category: "pitfalls", key: "pitfalls/stub-two", value: "Stub candidate two." },
    ],
  }));
});
`;

function writeFakeInfra(sandbox) {
  const fakeRoot = join(sandbox, "infra");
  mkdirSync(join(fakeRoot, "mcp-memory-server", "dist"), { recursive: true });
  mkdirSync(join(fakeRoot, "scripts", "lib"), { recursive: true });
  const stub = join(fakeRoot, "mcp-memory-server", "dist", "index.js");
  writeFileSync(stub, STUB_SERVER);
  chmodSync(stub, 0o755);
  copyFileSync(stageWrapper, join(fakeRoot, "scripts", "lib", "omp-capture-stage.mjs"));
  copyFileSync(join(root, "scripts", "lib", "stable-file.mjs"), join(fakeRoot, "scripts", "lib", "stable-file.mjs"));
  return fakeRoot;
}

function bootstrappedRepo(sandbox, name) {
  const repo = join(sandbox, name);
  mkdirSync(join(repo, ".agentfs"), { recursive: true });
  writeFileSync(join(repo, ".agentfs", "project.db"), "");
  return repo;
}

function message(role, text) {
  return { type: "message", message: { role, content: [{ type: "text", text }] } };
}

function mockCtx({ cwd, kind, branch = [], uiLog, uninitialized = false }) {
  return {
    cwd,
    hasUI: true,
    agent: { kind },
    sessionManager: { getBranch: () => branch },
    ui: { notify: (text, type) => uiLog.push({ text, type }) },
    shutdown() {},
    ...(uninitialized ? {} : {}),
  };
}

function createMockPi({ uninitialized = false } = {}) {
  const handlers = new Map();
  const commands = new Map();
  const sentMessages = [];
  const pi = {
    registerCommand(name, options) {
      commands.set(name, options);
    },
    sendMessage(payload, options) {
      sentMessages.push({ payload, options });
    },
    getAllTools() {
      if (uninitialized) {
        throw new Error("Extension runtime not initialized. Action methods cannot be called during extension loading.");
      }
      return [];
    },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },
  };
  const fire = async (event, payload, ctx) => {
    for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
  };
  return { pi, commands, sentMessages, fire };
}

async function waitFor(condition, timeoutMs = 5000, label = "condition") {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = condition();
      if (value) return value;
    } catch {
      // not yet
    }
    await Bun.sleep(50);
  }
  fail(`timeout-waiting-for-${label}`);
}

function stagedFiles(repo) {
  const dir = join(repo, STAGING_REL);
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
}

async function main() {
  if (!process.versions.bun) {
    output({ schema_version: 1, status: "SKIP", reason: "bun-runtime-required" });
    return;
  }
  if (!existsSync(extensionTemplate) || !existsSync(stageWrapper)) fail("capture-assets-missing");

  const sandbox = mkdtempSync(join(tmpdir(), "cairn-omp-capture-"));
  const savedEnv = new Map();
  const setEnv = (entries) => {
    for (const [name, value] of Object.entries(entries)) {
      if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  const restoreEnv = () => {
    for (const [name, value] of savedEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };

  try {
    const fakeRoot = writeFakeInfra(sandbox);
    const renderedExtension = join(sandbox, "cairnkeep-capture.ts");
    writeFileSync(
      renderedExtension,
      readFileSync(extensionTemplate, "utf8").replaceAll("@@INFRA_ROOT@@", fakeRoot.replaceAll("\\", "/")),
    );
    const factoryModule = await import(pathToFileURL(renderedExtension).href);
    if (typeof factoryModule.default !== "function") fail("extension-factory-missing");

    setEnv({ CAIRN_LLM_API_KEY: "stub-key", CAIRN_LLM_EXTRACTION_MODEL: STUB_MODEL });

    // 1) Guard: no .agentfs/project.db -> no staging.
    {
      const bare = join(sandbox, "bare-repo");
      mkdirSync(bare, { recursive: true });
      const mock = createMockPi();
      factoryModule.default(mock.pi);
      const branch = [message("user", "guard probe")];
      await mock.fire("session_stop", { type: "session_stop", session_id: "guard-1" }, mockCtx({ cwd: bare, kind: "main", branch, uiLog: [] }));
      await Bun.sleep(300);
      assert.equal(existsSync(join(bare, STAGING_REL)), false, "capture staged outside a bootstrapped repo");
    }

    // 2) Guard: missing extraction env -> no staging.
    {
      const repo = bootstrappedRepo(sandbox, "env-guard-repo");
      const mock = createMockPi();
      factoryModule.default(mock.pi);
      setEnv({ CAIRN_LLM_API_KEY: undefined, CAIRN_LLM_EXTRACTION_MODEL: undefined });
      await mock.fire("session_stop", { type: "session_stop", session_id: "guard-2" }, mockCtx({ cwd: repo, kind: "main", branch: [message("user", "env guard probe")], uiLog: [] }));
      await Bun.sleep(300);
      assert.equal(stagedFiles(repo).length, 0, "capture staged without extraction env");
      setEnv({ CAIRN_LLM_API_KEY: "stub-key", CAIRN_LLM_EXTRACTION_MODEL: STUB_MODEL });
    }

    // 3) Happy path: staging contract + transcript shaping.
    const stdinLog = join(sandbox, "stdin-log.txt");
    setEnv({ CAIRN_STUB_STDIN_LOG: stdinLog });
    const repo = bootstrappedRepo(sandbox, "repo");
    const oldTurn = `OLD-TURN-MARKER ${"x".repeat(20000)}`;
    const recentTurn = "RECENT-TURN-MARKER this is the latest user text";
    const branch = [
      message("user", oldTurn),
      { type: "message", message: { role: "toolResult", content: [{ type: "text", text: "TOOLRESULT-NOISE" }] } },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", name: "bash", arguments: {} },
            { type: "text", text: "assistant visible text" },
          ],
        },
      },
      message("user", recentTurn),
    ];
    let uiLog = [];
    const mock = createMockPi();
    factoryModule.default(mock.pi);
    await mock.fire("session_stop", { type: "session_stop", session_id: "happy-1" }, mockCtx({ cwd: repo, kind: "main", branch, uiLog }));

    const staged = await waitFor(() => {
      const files = stagedFiles(repo);
      return files.length === 1 ? files : undefined;
    }, 8000, "staged-file");
    assert.match(staged[0], /^\d{8}T\d{6}Z\.json$/, "staging filename drifted from the UTC contract");
    const stagedJson = readFileSync(join(repo, STAGING_REL, staged[0]), "utf8");
    const stagedParsed = JSON.parse(stagedJson);
    assert.equal(stagedParsed.count, 2, "staged candidate JSON drifted");
    assert.ok(Array.isArray(stagedParsed.candidates) && stagedParsed.candidates.length === 2, "staged candidates missing");
    assert.ok(stagedJson.endsWith("\n"), "staged file missing trailing newline");

    await waitFor(() => (existsSync(stdinLog) ? readFileSync(stdinLog, "utf8") : ""), 8000, "stdin-log");
    const transcript = readFileSync(stdinLog, "utf8");
    assert.ok(transcript.length <= 12000, "transcript text exceeded the 12000-char cap");
    assert.ok(transcript.includes("RECENT-TURN-MARKER"), "transcript text lost the most recent turn");
    assert.ok(!transcript.includes("OLD-TURN-MARKER"), "transcript text kept dropped old content past the cap");
    assert.ok(!transcript.includes("TOOLRESULT-NOISE"), "transcript text leaked a toolResult entry");
    assert.ok(!transcript.includes("bash") || !transcript.includes("toolCall"), "transcript text leaked tool-call blocks");
    assert.ok(transcript.includes("USER:") && transcript.includes("ASSISTANT:"), "transcript text lost role prefixes");

    // 4) De-dupe: same session id never stages twice.
    await mock.fire("session_stop", { type: "session_stop", session_id: "happy-1" }, mockCtx({ cwd: repo, kind: "main", branch: [message("user", "second settle")], uiLog: [] }));
    await Bun.sleep(300);
    assert.equal(stagedFiles(repo).length, 1, "session_stop de-dupe by session id failed");

    // 5) Retention cap 5: pre-seed 5 older files, new capture drops the oldest.
    for (let index = 0; index < 5; index += 1) {
      const name = `2026010${index}T00000${index}Z.json`;
      writeFileSync(join(repo, STAGING_REL, name), JSON.stringify({ candidates: [] }));
      const then = new Date(Date.now() - (10 - index) * 60_000);
      utimesSync(join(repo, STAGING_REL, name), then, then);
    }
    const preCap = stagedFiles(repo);
    assert.equal(preCap.length, 6, "pre-seed setup wrong");
    await mock.fire("session_stop", { type: "session_stop", session_id: "cap-1" }, mockCtx({ cwd: repo, kind: "main", branch: [message("user", "cap probe")], uiLog: [] }));
    await waitFor(() => (stagedFiles(repo).length === 5 ? true : undefined), 8000, "retention-cap");
    assert.ok(!stagedFiles(repo).includes("20260100T000000Z.json"), "retention cap kept the oldest staged file");

    // 6) Wakeup: notify + nextTurn context, malformed staged JSON skipped.
    uiLog = [];
    const wakeupMock = createMockPi();
    factoryModule.default(wakeupMock.pi);
    const stagedBefore = stagedFiles(repo);
    const validCount = stagedBefore.filter((file) => {
      try {
        const parsed = JSON.parse(readFileSync(join(repo, STAGING_REL, file), "utf8"));
        return Array.isArray(parsed.candidates) && parsed.candidates.length > 0;
      } catch {
        return false;
      }
    }).length;
    writeFileSync(join(repo, STAGING_REL, "malformed.json"), "{not json");
    await wakeupMock.fire("session_start", { type: "session_start" }, mockCtx({ cwd: repo, kind: "main", uiLog }));
    assert.equal(uiLog.length, 1, "wakeup notify missing or duplicated");
    assert.ok(uiLog[0].text.includes(`${validCount} memory candidate file(s)`), "wakeup notify count drifted");
    assert.equal(wakeupMock.sentMessages.length, 1, "wakeup context message missing");
    const sent = wakeupMock.sentMessages[0];
    assert.equal(sent.options?.deliverAs, "nextTurn", "wakeup context must target the next user turn");
    assert.equal(sent.payload?.customType, STAGED_CUSTOM_TYPE, "wakeup customType drifted");
    assert.ok(String(sent.payload?.content).includes("memory_write"), "wakeup context lost the agent-gated write instruction");

    // 7) Uninitialized runtime: wakeup skipped entirely.
    const uninit = createMockPi({ uninitialized: true });
    factoryModule.default(uninit.pi);
    const uninitUi = [];
    await uninit.fire("session_start", { type: "session_start" }, mockCtx({ cwd: repo, kind: "main", uiLog: uninitUi }));
    assert.equal(uninitUi.length, 0, "wakeup fired on an uninitialized runtime");
    assert.equal(uninit.sentMessages.length, 0, "wakeup sent context on an uninitialized runtime");

    // 8) Subagent sessions: capture and wakeup both skip.
    const sub = createMockPi();
    factoryModule.default(sub.pi);
    const subUi = [];
    const beforeSub = stagedFiles(repo);
    await sub.fire("session_stop", { type: "session_stop", session_id: "sub-1" }, mockCtx({ cwd: repo, kind: "sub", branch: [message("user", "sub probe")], uiLog: subUi }));
    await sub.fire("session_start", { type: "session_start" }, mockCtx({ cwd: repo, kind: "sub", uiLog: subUi }));
    await Bun.sleep(300);
    assert.deepEqual(stagedFiles(repo), beforeSub, "subagent session staged a capture");
    assert.equal(subUi.length, 0, "subagent session fired wakeup");
    assert.equal(sub.sentMessages.length, 0, "subagent session sent wakeup context");

    // 9) /cairn-staged command surface lists staged files.
    const command = wakeupMock.commands.get("cairn-staged");
    if (!command) fail("cairn-staged-command-missing");
    const cmdUi = [];
    await command.handler("", mockCtx({ cwd: repo, kind: "main", uiLog: cmdUi }));
    assert.equal(cmdUi.length, 1, "cairn-staged produced no listing");
    const listingDir = join(repo, STAGING_REL);
    const newestFive = readdirSync(listingDir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => ({ name, mtime: statSync(join(listingDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 5)
      .map(({ name }) => name);
    for (const file of newestFive) {
      assert.ok(cmdUi[0].text.includes(file), `cairn-staged listing omitted ${file}`);
    }

    output({
      schema_version: 1,
      status: "PASS",
      checks: [
        "guards-skip",
        "env-guards-skip",
        "staging-contract",
        "transcript-cap-recent",
        "transcript-noise-dropped",
        "session-dedupe",
        "retention-cap",
        "wakeup-notify-and-nextturn",
        "uninitialized-runtime-skip",
        "subagent-skip",
        "cairn-staged-command",
      ],
    });
  } finally {
    restoreEnv();
    rmSync(sandbox, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof assert.AssertionError) {
    output({ schema_version: 1, status: "FAIL", reason: `assertion: ${error.message}` });
  } else {
    output({ schema_version: 1, status: "FAIL", reason: isGate(error) ? error.code : "omp-capture-smoke-failed" });
  }
  process.exitCode = 1;
}
