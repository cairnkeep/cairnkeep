#!/usr/bin/env node

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
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

function verifyPhase26Registration() {
  validatePhase26TestManifest();
  const scheduled = dispatchPhase26Tests((_command, args) => {
    throw new Error(`RED-only Phase 26 test was scheduled: ${args[0]}`);
  });
  if (scheduled.length !== 0) throw new Error("RED-only Phase 26 tests must not run in routine dispatch.");
  console.log(`PASS: Phase 26 manifest has ${PHASE26_TEST_MANIFEST.length} exact RED-only entries and routine dispatch schedules none`);
}

function run() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--verify-phase26-registration=red") {
    verifyPhase26Registration();
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
