#!/usr/bin/env node

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { PHASE26_TEST_MANIFEST, validatePhase26TestManifest } from "./phase26-test-manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function dispatchPhase26Tests(spawn = spawnSync) {
  const results = [];
  for (const entry of validatePhase26TestManifest().filter(({ state }) => state === "routine")) {
    const result = spawn(process.execPath, [join(root, ...entry.path.split("/"))], { cwd: root, stdio: "inherit" });
    results.push({ path: entry.path, status: result.status ?? 1 });
    if (result.status !== 0) break;
  }
  return results;
}

function verifyPhase26RedRegistration() {
  validatePhase26TestManifest();
  const scheduled = dispatchPhase26Tests((_command, args) => {
    throw new Error(`RED-only Phase 26 test was scheduled: ${args[0]}`);
  });
  if (scheduled.length !== 0) throw new Error("RED-only Phase 26 tests must not run in routine dispatch.");
  console.log(`PASS: Phase 26 manifest has ${PHASE26_TEST_MANIFEST.length} exact RED-only entries and routine dispatch schedules none`);
}

function verifyPhase26RoutineRegistration() {
  const entries = validatePhase26TestManifest();
  if (!entries.every(({ state }) => state === "routine")) {
    throw new Error("Every Phase 26 test must be routine after learning and track routing complete.");
  }
  const recorded = [];
  const scheduled = dispatchPhase26Tests((command, args, options) => {
    if (command !== process.execPath) throw new Error("Phase 26 dispatch must use the active Node executable.");
    if (!Array.isArray(args) || args.length !== 1) throw new Error("Phase 26 dispatch arguments drifted.");
    if (options?.cwd !== root || options?.stdio !== "inherit") throw new Error("Phase 26 dispatch options drifted.");
    recorded.push(relative(root, args[0]).split(sep).join("/"));
    return { status: 0 };
  });
  const expected = entries.map(({ path }) => path);
  if (JSON.stringify(recorded) !== JSON.stringify(expected)) throw new Error("Phase 26 executable dispatch paths or order drifted.");
  if (JSON.stringify(scheduled.map(({ path }) => path)) !== JSON.stringify(expected)) throw new Error("Phase 26 dispatch result paths drifted.");
  if (new Set(recorded).size !== expected.length) throw new Error("Phase 26 executable dispatch scheduled a duplicate contract.");
  console.log(`PASS: Phase 26 routine dispatch schedules all ${expected.length} exact contracts once`);
}

function run() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--verify-phase26-registration=red") {
    verifyPhase26RedRegistration();
    return;
  }
  if (args.length === 1 && args[0] === "--verify-phase26-registration=routine") {
    verifyPhase26RoutineRegistration();
    return;
  }
  if (args.length !== 0) throw new Error(`Unknown repository test option: ${args.join(" ")}`);

  if (process.platform !== "win32") {
    for (const test of readdirSync(join(root, "scripts")).filter((name) => /^test-.*\.sh$/.test(name)).sort()) {
      const result = spawnSync(join(root, "scripts", test), [], { cwd: root, stdio: "inherit" });
      if (result.status !== 0) process.exit(result.status ?? 1);
    }
  }
  const native = spawnSync(process.execPath, [join(root, "scripts", "test-windows-native.mjs")], { cwd: root, stdio: "inherit" });
  if (native.status !== 0) process.exit(native.status ?? 1);
  const phase26 = dispatchPhase26Tests();
  const failed = phase26.find(({ status }) => status !== 0);
  if (failed) process.exit(failed.status);
}

run();
