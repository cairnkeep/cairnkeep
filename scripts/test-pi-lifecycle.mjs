#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runWindowsCommand } from "./windows-platform.mjs";

const EXPECTED_RED_EXIT = 86;
const RED_MARKER = "PHASE26_RED:PI_LIFECYCLE_MISSING";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 20_000, ...options });
  if (result.error) throw result.error;
  return result;
}

function assertFixtureContract(sandbox) {
  const project = join(sandbox, "Project with spaces – Unicode");
  const piLive = join(sandbox, "Pi Agent");
  mkdirSync(project, { recursive: true });
  mkdirSync(join(piLive, "extensions"), { recursive: true });
  const setupState = {
    schema_version: 1,
    cairnkeep_version: "fixture-1",
    git: "none",
    memory: "local",
    harnesses: ["pi"],
    assets: {},
  };
  assert.equal(setupState.harnesses.includes("pi"), true);
  assert.equal(setupState.harnesses.includes("claude"), false);
  assert.equal(existsSync(join(piLive, "extensions", "cairnkeep-memory.ts")), false, "project setup fixture auto-synced machine state");
  writeFileSync(join(piLive, "extensions", "operator-extension.ts"), "operator bytes\n");
  return { project, piLive };
}

function productionComplete() {
  const required = [
    "pi/extensions/cairnkeep-memory.ts",
    "mcp-memory-server/dist/pi-mcp-bridge.js",
    "scripts/setup.mjs",
    "scripts/sync-pi-assets.sh",
    "scripts/uninstall.sh",
    "schemas/cairnkeep-setup.schema.json",
  ];
  if (!required.every((path) => existsSync(join(root, path)))) return false;
  const sync = readFileSync(join(root, "scripts", "sync-pi-assets.sh"), "utf8");
  const uninstall = readFileSync(join(root, "scripts", "uninstall.sh"), "utf8");
  const windows = readFileSync(join(root, "scripts", "windows-platform.mjs"), "utf8");
  return [sync, uninstall, windows].every((text) => text.includes("extensions/cairnkeep-memory.ts"));
}

async function exerciseSelectedSetup(sandbox, fixture) {
  const env = { ...process.env, HOME: join(sandbox, "setup-home") };
  mkdirSync(env.HOME, { recursive: true });
  if (process.platform !== "win32") {
    const result = run(join(root, "bin", "cairn"), [
      "setup", fixture.project,
      "--git", "none",
      "--harness", "pi",
      "--memory", "local",
      "--yes",
      "--json",
    ], { env });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).harnesses, ["pi"]);
    assert.equal(existsSync(join(fixture.project, ".ai", "start-pi.sh")), true);
    assert.equal(existsSync(join(fixture.project, ".ai", "start-claude.sh")), false);
  }
  assert.equal(existsSync(join(fixture.piLive, "extensions", "cairnkeep-memory.ts")), false, "setup auto-synced Pi machine assets");

  const windowsProject = join(sandbox, "Windows selected project – Unicode");
  let output = "";
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk) => {
    output += String(chunk);
    return true;
  });
  try {
    const handled = await runWindowsCommand({
      command: "setup",
      args: [windowsProject, "--git", "none", "--harness", "pi", "--memory", "local", "--yes", "--json"],
      root,
    });
    assert.equal(handled, true);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.deepEqual(JSON.parse(output).harnesses, ["pi"]);
  assert.equal(existsSync(join(windowsProject, ".ai", "start-pi.cmd")), true);
  assert.equal(existsSync(join(windowsProject, ".ai", "start-claude.cmd")), false);
}

async function exerciseWindowsLifecycle(sandbox) {
  const live = join(sandbox, "Windows Pi Agent");
  mkdirSync(join(live, "extensions"), { recursive: true });
  writeFileSync(join(live, "extensions", "operator-extension.ts"), "operator bytes\n");
  process.exitCode = 0;
  await runWindowsCommand({ command: "sync-pi", args: ["--apply", "--live-root", live], root });
  assert.equal(process.exitCode, 0);
  for (const path of [
    "extensions/cairnkeep-memory.ts",
    "extensions/cairnkeep-trajectory.ts",
    "prompts/graphify.md",
  ]) assert.equal(existsSync(join(live, ...path.split("/"))), true, `Windows sync omitted ${path}`);
  assert.equal(readFileSync(join(live, "extensions", "operator-extension.ts"), "utf8"), "operator bytes\n");

  await runWindowsCommand({ command: "sync-pi", args: ["--check", "--live-root", live], root });
  assert.equal(process.exitCode, 0);
}

function exercisePosixLifecycle(sandbox, fixture) {
  const env = { ...process.env, HOME: join(sandbox, "home"), PI_CODING_AGENT_DIR: fixture.piLive };
  mkdirSync(env.HOME, { recursive: true });
  let result = run(join(root, "scripts", "sync-pi-assets.sh"), ["--apply", "--live-root", fixture.piLive], { env });
  assert.equal(result.status, 0, result.stderr);
  for (const path of [
    "extensions/cairnkeep-memory.ts",
    "extensions/cairnkeep-trajectory.ts",
    "prompts/graphify.md",
  ]) assert.equal(existsSync(join(fixture.piLive, ...path.split("/"))), true, `POSIX sync omitted ${path}`);
  assert.equal(readFileSync(join(fixture.piLive, "extensions", "operator-extension.ts"), "utf8"), "operator bytes\n");

  const memoryExtension = join(fixture.piLive, "extensions", "cairnkeep-memory.ts");
  rmSync(memoryExtension);
  result = run(join(root, "scripts", "sync-pi-assets.sh"), ["--check", "--live-root", fixture.piLive], { env });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing live Pi asset.*cairnkeep-memory\.ts/);
  assert.match(`${result.stdout}${result.stderr}`, /sync-pi-assets\.sh --apply|--apply/);

  result = run(join(root, "scripts", "sync-pi-assets.sh"), ["--apply", "--live-root", fixture.piLive], { env });
  assert.equal(result.status, 0, result.stderr);
  writeFileSync(memoryExtension, `${readFileSync(memoryExtension, "utf8")}\n// operator-modified fixture\n`);
  const modifiedBytes = readFileSync(memoryExtension);

  const store = join(env.HOME, ".cairnkeep");
  const packs = join(store, "packs", "objects", "fixture");
  mkdirSync(join(store, "memory"), { recursive: true });
  mkdirSync(packs, { recursive: true });
  writeFileSync(join(store, "memory", "record"), "memory bytes\n");
  writeFileSync(join(packs, "record"), "pack bytes\n");
  result = run(join(root, "scripts", "uninstall.sh"), ["--yes", "--live-root", join(sandbox, "unused-live"), "--pi-live-root", fixture.piLive], {
    env: { ...env, CAIRN_AGENTFS_BASE_DIR: store, CAIRN_PACK_BASE_DIR: join(store, "packs") },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(memoryExtension), false);
  assert.equal(readFileSync(join(fixture.piLive, "extensions", "operator-extension.ts"), "utf8"), "operator bytes\n");
  assert.equal(readFileSync(join(store, "memory", "record"), "utf8"), "memory bytes\n");
  assert.equal(readFileSync(join(packs, "record"), "utf8"), "pack bytes\n");

  const backupName = readdirSync(env.HOME)
    .filter((name) => name.startsWith(".cairnkeep-uninstall-"))
    .sort()
    .at(-1);
  assert.equal(typeof backupName, "string");
  const backup = join(env.HOME, backupName);
  const manifest = readFileSync(join(backup, "manifest.tsv"), "utf8");
  assert.equal(manifest.includes(memoryExtension), true);
  assert.equal(existsSync(join(backup, "revert.sh")), true);
  result = run("bash", [join(backup, "revert.sh")], { env });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(memoryExtension), modifiedBytes);
}

async function main() {
  const sandbox = mkdtempSync(join(tmpdir(), "cairn-pi-lifecycle-"));
  const originalExitCode = process.exitCode;
  try {
    const fixture = assertFixtureContract(sandbox);
    if (!productionComplete()) {
      console.log(RED_MARKER);
      process.exitCode = EXPECTED_RED_EXIT;
      return;
    }
    await exerciseSelectedSetup(sandbox, fixture);
    await exerciseWindowsLifecycle(sandbox);
    if (process.platform !== "win32") exercisePosixLifecycle(sandbox, fixture);
    assert.equal(existsSync(join(fixture.piLive, "extensions", "operator-extension.ts")), true);
    console.log("PASS: Pi memory-extension sync, drift, backup, revert, and preservation lifecycle contract");
  } finally {
    if (process.exitCode !== EXPECTED_RED_EXIT) process.exitCode = originalExitCode;
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
