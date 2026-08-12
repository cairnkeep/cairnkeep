#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXPECTED_RED_EXIT = 86;
const RED_MARKER = "PHASE26_RED:SETUP_RECONCILE_MISSING";
const here = dirname(fileURLToPath(import.meta.url));
const reconcilerPath = join(here, "setup-reconcile.mjs");

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function asset(path, value, mode, template, harness = null) {
  return Object.freeze({
    path,
    bytes: Buffer.from(value, "utf8"),
    mode,
    template,
    ...(harness ? { harness } : {}),
  });
}

function plan(target, assets, overrides = {}) {
  return Object.freeze({
    target: resolve(target),
    version: "fixture-1",
    git: "existing",
    memory: "local",
    harnesses: ["claude"],
    assets: Object.freeze(assets),
    ...overrides,
  });
}

function ownedState(rows, overrides = {}) {
  return {
    schema_version: 1,
    cairnkeep_version: "fixture-1",
    git: "existing",
    memory: "local",
    harnesses: ["claude"],
    assets: Object.fromEntries(rows.map(({ path, bytes, mode, template }) => [path, {
      digest: digest(bytes),
      mode,
      template,
    }])),
    ...overrides,
  };
}

function assertCounts(result, counts) {
  assert.deepEqual(result.counts, counts);
  assert.deepEqual(
    result.changes.map(({ status }) => status).sort(),
    Object.entries(counts).flatMap(([status, count]) => Array(count).fill(status)).sort(),
  );
}

function assertStrictState(state, target) {
  assert.deepEqual(Object.keys(state).sort(), [
    "assets",
    "cairnkeep_version",
    "git",
    "harnesses",
    "memory",
    "schema_version",
  ]);
  assert.equal(state.schema_version, 1);
  assert.deepEqual(state.harnesses, ["claude"]);
  assert.ok(["existing", "init", "none"].includes(state.git));
  assert.ok(["local", "none"].includes(state.memory));
  for (const [path, record] of Object.entries(state.assets)) {
    assert.equal(path.startsWith(".") && !path.startsWith("..") && !path.includes("\\"), true, `unsafe state path ${path}`);
    assert.deepEqual(Object.keys(record).sort(), ["digest", "mode", "template"]);
    assert.match(record.digest, /^[a-f0-9]{64}$/);
    assert.equal(Number.isInteger(record.mode), true);
    assert.equal(typeof record.template, "string");
  }
  const serialized = JSON.stringify(state);
  assert.equal(serialized.includes(resolve(target)), false, "state leaked absolute target");
  assert.doesNotMatch(serialized, /(?:token|secret|credential|endpoint|username|environment|https?:)/i);
}

function validateFixtures() {
  const sandbox = mkdtempSync(join(tmpdir(), "cairn-setup-reconcile-fixture-"));
  try {
    const target = join(sandbox, "project");
    const outside = join(sandbox, "outside");
    mkdirSync(target);
    mkdirSync(outside);
    const first = asset(".ai/start-claude.sh", "#!/bin/sh\necho one\n", 0o755, "start-claude.sh.template", "claude");
    const config = asset(".planning/config.json", "{\"fixture\":true}\n", 0o644, "planning-config.json.template");
    assert.equal(first.path.startsWith(".ai/"), true);
    assert.equal(config.path.startsWith(".planning/"), true);
    assert.equal(digest(first.bytes), createHash("sha256").update(first.bytes).digest("hex"));
    assert.deepEqual(ownedState([first]).assets[first.path], {
      digest: digest(first.bytes),
      mode: 0o755,
      template: "start-claude.sh.template",
    });
    return { sandbox, target, outside, first, config };
  } catch (error) {
    rmSync(sandbox, { recursive: true, force: true });
    throw error;
  }
}

async function loadReconciler() {
  return import(pathToFileURL(reconcilerPath).href);
}

function assertExports(reconciler) {
  assert.equal(reconciler.SETUP_STATE_SCHEMA_VERSION, 1);
  for (const name of ["hashSetupAsset", "reconcileSetupPlan", "writeSetupStateAtomic"]) {
    assert.equal(typeof reconciler[name], "function", `setup-reconcile must export ${name}`);
  }
}

async function testCreateAndIdempotence(reconciler, fixture) {
  const selectedPlan = plan(fixture.target, [fixture.first, fixture.config]);
  const unselected = join(fixture.target, ".ai", "start-pi.sh");
  mkdirSync(dirname(unselected), { recursive: true });
  symlinkSync(join(fixture.outside, "missing-pi"), unselected);

  const created = await reconciler.reconcileSetupPlan(selectedPlan);
  assertCounts(created, { created: 2, updated: 0, unchanged: 0, skipped: 0 });
  assert.deepEqual(readFileSync(join(fixture.target, fixture.first.path)), fixture.first.bytes);
  assert.deepEqual(readFileSync(join(fixture.target, fixture.config.path)), fixture.config.bytes);
  assert.equal((statSync(join(fixture.target, fixture.first.path)).mode & 0o777), 0o755);
  assert.equal((statSync(join(fixture.target, fixture.config.path)).mode & 0o777), 0o644);
  assert.equal(lstatSync(unselected).isSymbolicLink(), true, "unselected harness asset was inspected or removed");
  assertStrictState(created.state, fixture.target);
  const statePath = join(fixture.target, ".ai", "cairnkeep.json");
  assert.deepEqual(JSON.parse(readFileSync(statePath, "utf8")), created.state);

  const mtimes = new Map(selectedPlan.assets.map(({ path }) => [path, statSync(join(fixture.target, path)).mtimeMs]));
  const stateMtime = statSync(statePath).mtimeMs;
  const unchanged = await reconciler.reconcileSetupPlan(selectedPlan);
  assertCounts(unchanged, { created: 0, updated: 0, unchanged: 2, skipped: 0 });
  for (const [path, mtime] of mtimes) assert.equal(statSync(join(fixture.target, path)).mtimeMs, mtime, `identical rerun touched ${path}`);
  assert.equal(statSync(statePath).mtimeMs, stateMtime, "identical rerun rewrote setup state");
  assert.equal(lstatSync(unselected).isSymbolicLink(), true);
  return { selectedPlan, created };
}

async function testOwnershipBranches(reconciler, fixture, baseline) {
  const ownedPath = join(fixture.target, fixture.first.path);
  const previous = baseline.created.state;

  const next = asset(fixture.first.path, "#!/bin/sh\necho two\n", 0o755, fixture.first.template, "claude");
  const updated = await reconciler.reconcileSetupPlan(plan(fixture.target, [next]), { previousState: previous });
  assertCounts(updated, { created: 0, updated: 1, unchanged: 0, skipped: 0 });
  assert.deepEqual(readFileSync(ownedPath), next.bytes);

  writeFileSync(ownedPath, "operator-owned\n");
  chmodSync(ownedPath, 0o700);
  const userBytes = readFileSync(ownedPath);
  const userMtime = statSync(ownedPath).mtimeMs;
  const diverged = await reconciler.reconcileSetupPlan(plan(fixture.target, [fixture.first]), { previousState: updated.state });
  assertCounts(diverged, { created: 0, updated: 0, unchanged: 0, skipped: 1 });
  assert.deepEqual(readFileSync(ownedPath), userBytes);
  assert.equal(statSync(ownedPath).mtimeMs, userMtime);

  const unownedPath = join(fixture.target, ".planning", "operator.md");
  writeFileSync(unownedPath, "operator\n");
  const unowned = asset(".planning/operator.md", "desired\n", 0o644, "operator.template");
  const skipped = await reconciler.reconcileSetupPlan(plan(fixture.target, [unowned]), { previousState: null });
  assertCounts(skipped, { created: 0, updated: 0, unchanged: 0, skipped: 1 });
  assert.equal(readFileSync(unownedPath, "utf8"), "operator\n");
}

async function testUnsafePaths(reconciler, fixture) {
  for (const kind of ["symlink-ancestor", "file-ancestor", "symlink-destination"]) {
    const target = join(fixture.sandbox, kind);
    mkdirSync(target);
    const outsideSentinel = join(fixture.outside, `${kind}.txt`);
    writeFileSync(outsideSentinel, "outside\n");
    if (kind === "symlink-ancestor") symlinkSync(fixture.outside, join(target, ".ai"), "dir");
    else if (kind === "file-ancestor") writeFileSync(join(target, ".ai"), "not-a-directory\n");
    else {
      mkdirSync(join(target, ".ai"));
      symlinkSync(outsideSentinel, join(target, ".ai", "start-claude.sh"));
    }
    await assert.rejects(
      reconciler.reconcileSetupPlan(plan(target, [fixture.first])),
      /unsafe|symbolic|regular|contain|ancestor/i,
    );
    assert.equal(readFileSync(outsideSentinel, "utf8"), "outside\n");
    assert.equal(existsSync(join(target, ".planning")), false, `${kind} left partial state`);
    assert.equal(existsSync(join(target, ".agentfs")), false, `${kind} left partial state`);
  }
}

async function testStateInterruptionAndPrivacy(reconciler, fixture) {
  const statePath = join(fixture.target, ".ai", "cairnkeep.json");
  const before = readFileSync(statePath);
  const hostile = ownedState([fixture.first], { endpoint: "https://invalid.example", target: fixture.target });
  await assert.rejects(reconciler.writeSetupStateAtomic(statePath, hostile), /invalid|unknown|unsafe|state/i);
  assert.deepEqual(readFileSync(statePath), before);

  const replacement = ownedState([fixture.first], { cairnkeep_version: "fixture-2" });
  await assert.rejects(
    reconciler.writeSetupStateAtomic(statePath, replacement, {
      atomicReplace: async () => { throw new Error("fixture interruption before replacement"); },
    }),
    /fixture interruption/,
  );
  assert.deepEqual(readFileSync(statePath), before, "interrupted replacement changed prior state");
  const temporary = readdirSync(dirname(statePath)).filter((name) => name.includes("cairnkeep.json") && name.endsWith(".tmp"));
  assert.deepEqual(temporary, [], "interrupted replacement leaked a temporary state file");
}

async function main() {
  const fixture = validateFixtures();
  try {
    let reconciler;
    try {
      reconciler = await loadReconciler();
    } catch (error) {
      if (error?.code === "ERR_MODULE_NOT_FOUND" && String(error.message).includes("setup-reconcile.mjs")) {
        console.log(RED_MARKER);
        process.exitCode = EXPECTED_RED_EXIT;
        return;
      }
      throw error;
    }
    assertExports(reconciler);
    assert.equal(reconciler.hashSetupAsset(fixture.first.bytes), digest(fixture.first.bytes));
    const baseline = await testCreateAndIdempotence(reconciler, fixture);
    await testOwnershipBranches(reconciler, fixture, baseline);
    await testUnsafePaths(reconciler, fixture);
    await testStateInterruptionAndPrivacy(reconciler, fixture);
    console.log("PASS: setup ownership, idempotence, containment, privacy, and atomic state contract");
  } finally {
    rmSync(fixture.sandbox, { recursive: true, force: true });
  }
}

await main();
