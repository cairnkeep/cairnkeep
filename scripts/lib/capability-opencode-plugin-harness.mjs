#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const [pluginPath, repoPath, fixturePath, scenario = "contract"] = process.argv.slice(2);
const sessionID = process.env.CAIRN_TEST_SESSION ?? "session-fixture";

assert.ok(
  pluginPath && repoPath && fixturePath,
  "usage: capability-opencode-plugin-harness.mjs <plugin.ts> <repo> <fixture.json> [scenario]",
);

const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
const contract = fixture?.opencode;
assert.equal(contract?.version, "1.17.20", "fixture must pin OpenCode 1.17.20");
assert.equal(
  contract?.source?.commit,
  "4473fc3c9055046183990a965d68df3db7ea6f62",
  "fixture must pin the official v1.17.20 source commit",
);
assert.equal(contract?.hook?.name, "command.execute.before");
assert.deepEqual(contract?.dispose, {
  name: "dispose",
  phase: "plugin-shutdown",
  input_fields: [],
  additional_properties: false,
  source_file: "packages/plugin/src/index.ts",
  source_commit: "4473fc3c9055046183990a965d68df3db7ea6f62",
  purpose: "Release plugin-owned resources after the host stops using the plugin instance.",
});
assert.deepEqual(contract?.hook?.input?.required_fields, ["command", "sessionID", "arguments"]);
assert.deepEqual(contract?.hook?.output?.required_fields, ["parts"]);
assert.deepEqual(Object.keys(contract?.events ?? {}).sort(), [
  "session.deleted",
  "session.error",
  "session.idle",
  "session.status",
]);
assert.equal(contract?.lifecycle?.event_callback_is_awaited, false);

function assertExactKeys(value, required, optional = []) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  const keys = Object.keys(value).sort();
  const allowed = [...required, ...optional].sort();
  for (const key of required) assert.ok(keys.includes(key), `missing required field: ${key}`);
  for (const key of keys) assert.ok(allowed.includes(key), `unexpected fixture field: ${key}`);
}

assertExactKeys(
  contract.hook.input.sample,
  contract.hook.input.required_fields,
  contract.hook.input.optional_fields,
);
assertExactKeys(
  contract.hook.output.sample,
  contract.hook.output.required_fields,
  contract.hook.output.optional_fields,
);
for (const [name, eventContract] of Object.entries(contract.events)) {
  assertExactKeys(
    eventContract.sample,
    eventContract.required_fields,
    eventContract.optional_fields,
  );
  assertExactKeys(
    eventContract.sample.properties,
    eventContract.properties_required_fields,
    eventContract.properties_optional_fields,
  );
  assert.equal(eventContract.sample.type, name);
  if (name === "session.deleted") {
    assertExactKeys(
      eventContract.sample.properties.info,
      eventContract.info_required_fields,
      eventContract.info_optional_fields,
    );
    assertExactKeys(
      eventContract.sample.properties.info.time,
      eventContract.time_required_fields,
      eventContract.time_optional_fields,
    );
  }
}

const module = await import(`${pathToFileURL(pluginPath).href}?test=${Date.now()}`);
assert.equal(typeof module.CapabilityCommandPlugin, "function");
assert.deepEqual(module.OPENCODE_CAPABILITY_CONTRACT, {
  version: contract.version,
  sourceCommit: contract.source.commit,
  admissionHook: contract.hook.name,
  terminalEvents: contract.lifecycle,
});

const calls = [];
const client = {
  session: {
    get: async ({ path }) => ({
      data: {
        id: path.id,
        projectID: "project-fixture",
        directory: repoPath,
        title: "fixture",
        version: contract.version,
        time: { created: 1, updated: 2 },
      },
    }),
  },
};
const plugin = await module.CapabilityCommandPlugin({
  client,
  project: {
    id: "project-fixture",
    worktree: scenario === "identity-mismatch" ? `${repoPath}-decoy` : repoPath,
  },
  directory: repoPath,
  worktree: repoPath,
  serverUrl: new URL("http://127.0.0.1:4096"),
  $: undefined,
  experimental_workspace: undefined,
});

assert.ok(plugin && typeof plugin === "object");
assert.equal(typeof plugin[contract.hook.name], "function");
assert.equal(typeof plugin.event, "function");

async function commandBefore(targetSessionID = sessionID) {
  const input = structuredClone(contract.hook.input.sample);
  const output = structuredClone(contract.hook.output.sample);
  input.sessionID = targetSessionID;
  if (scenario === "malformed-admission") input.unexpected = "rejected";
  try {
    await plugin[contract.hook.name](input, output);
    calls.push({ boundary: contract.hook.name, result: "allowed", parts: output.parts.length });
  } catch (error) {
    calls.push({
      boundary: contract.hook.name,
      result: "blocked",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function deliver(eventName, targetSessionID = sessionID) {
  const event = structuredClone(contract.events[eventName].sample);
  if (eventName === "session.deleted") event.properties.info.id = targetSessionID;
  else event.properties.sessionID = targetSessionID;
  await plugin.event({ event });
  calls.push({ boundary: "event", event: eventName });
}

async function disposePlugin() {
  if (typeof plugin.dispose !== "function") {
    calls.push({ boundary: contract.dispose.name, result: "missing" });
    return false;
  }
  await plugin.dispose();
  calls.push({ boundary: contract.dispose.name, result: "completed" });
  return true;
}

function traceRows() {
  const trace = process.env.CAIRN_BOUNDARY_TRACE;
  if (!trace || !existsSync(trace)) return [];
  const raw = readFileSync(trace, "utf8").trim();
  return raw ? raw.split(/\n/).map(JSON.parse) : [];
}

async function waitForOperation(operation, count) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (traceRows().filter((row) => row.operation === operation).length >= count) return;
    await delay(10);
  }
  throw new Error(`coordinator operation did not arrive: ${operation} #${count}`);
}

function releaseCoordinator() {
  const release = process.env.CAIRN_TEST_RELEASE_FILE;
  assert.ok(release, "CAIRN_TEST_RELEASE_FILE is required for ordering scenarios");
  writeFileSync(release, "release\n");
}

const scenarios = new Set([
  "contract",
  "admission",
  "success",
  "status-success",
  "error",
  "abandonment",
  "duplicate-success",
  "duplicate-error",
  "settled-then-delete",
  "cwd-drift-success",
  "malformed-admission",
  "identity-mismatch",
  "dispose-contract",
  "dispose-unfinished",
  "dispose-multiple",
  "dispose-settled-success",
  "dispose-settled-error",
  "dispose-terminal-race",
  "terminal-next-admission",
  "dispose-master-off",
]);
assert.ok(scenarios.has(scenario), `unsupported scenario: ${scenario}`);

if (!new Set(["contract", "dispose-contract", "dispose-multiple"]).has(scenario)) await commandBefore();
if (scenario === "success") await deliver("session.idle");
if (scenario === "status-success") await deliver("session.status");
if (scenario === "error") await deliver("session.error");
if (scenario === "abandonment") await deliver("session.deleted");
if (scenario === "duplicate-success") {
  await deliver("session.idle");
  await deliver("session.status");
  await deliver("session.idle");
}
if (scenario === "duplicate-error") {
  await deliver("session.error");
  await deliver("session.error");
}
if (scenario === "settled-then-delete") {
  await deliver("session.idle");
  await deliver("session.deleted");
}
if (scenario === "cwd-drift-success") {
  process.chdir(`${repoPath}-decoy`);
  await deliver("session.idle");
}
if (scenario === "dispose-contract") await disposePlugin();
if (scenario === "dispose-unfinished" || scenario === "dispose-master-off") await disposePlugin();
if (scenario === "dispose-multiple") {
  await commandBefore(`${sessionID}-one`);
  await commandBefore(`${sessionID}-two`);
  await disposePlugin();
}
if (scenario === "dispose-settled-success") {
  await deliver("session.idle");
  await disposePlugin();
}
if (scenario === "dispose-settled-error") {
  await deliver("session.error");
  await disposePlugin();
}
if (scenario === "dispose-terminal-race") {
  assert.equal(typeof plugin.dispose, "function", "native dispose hook is missing");
  const terminal = deliver("session.idle");
  await waitForOperation("harness-terminal", 1);
  const disposal = plugin.dispose();
  await delay(50);
  releaseCoordinator();
  await terminal;
  await disposal;
  calls.push({ boundary: contract.dispose.name, result: "completed" });
}
if (scenario === "terminal-next-admission") {
  const terminal = deliver("session.error");
  await waitForOperation("harness-terminal", 1);
  const nextAdmission = commandBefore();
  await delay(50);
  assert.equal(traceRows().filter((row) => row.operation === "harness-before").length, 1,
    "next same-session admission reached the coordinator before the accepted terminal finished");
  releaseCoordinator();
  await terminal;
  await nextAdmission;
}

process.stdout.write(`${JSON.stringify({
  fixture: {
    version: contract.version,
    commit: contract.source.commit,
  },
  dispose_present: typeof plugin.dispose === "function",
  scenario,
  calls,
})}\n`);
