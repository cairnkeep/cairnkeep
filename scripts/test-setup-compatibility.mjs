#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bootstrapWindows } from "./windows-platform.mjs";
import { HARNESS_IDS } from "./harness-registry.mjs";

const EXPECTED_RED_EXIT = 86;
const RED_MARKER = "PHASE26_RED:SETUP_RECONCILE_MISSING";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const setupCorePath = join(here, "setup-core.mjs");
const setupReconcilePath = join(here, "setup-reconcile.mjs");
const HARNESSES = HARNESS_IDS;
const MANAGED_ROOTS = [".ai", ".codex", ".planning", ".agentfs"];

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    shell: false,
  });
  assert.equal(result.status, options.status ?? 0, `${executable} ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
  return result;
}

function walkFiles(base, prefix = "") {
  if (!existsSync(base)) return [];
  const files = [];
  for (const entry of readdirSync(base, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const next = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...walkFiles(join(base, entry.name), next));
    else if (entry.isFile()) files.push(next.replaceAll("\\", "/"));
  }
  return files;
}

function snapshot(target) {
  const result = new Map();
  for (const managed of MANAGED_ROOTS) {
    for (const path of walkFiles(join(target, managed), managed)) {
      const absolute = join(target, ...path.split("/"));
      result.set(path, {
        bytes: readFileSync(absolute),
        executable: (statSync(absolute).mode & 0o111) !== 0,
        private: (statSync(absolute).mode & 0o077) === 0,
      });
    }
  }
  return result;
}

function assertSnapshotEqual(actual, expected, label, allowedAdditions = []) {
  const unexpected = [...actual.keys()].filter((path) => !expected.has(path) && !allowedAdditions.includes(path));
  assert.deepEqual(unexpected, [], `${label} added unexpected managed paths`);
  for (const [path, before] of expected) {
    assert.ok(actual.has(path), `${label} omitted ${path}`);
    const after = actual.get(path);
    assert.deepEqual(after.bytes, before.bytes, `${label} changed bytes for ${path}`);
    assert.equal(after.executable, before.executable, `${label} changed executable semantics for ${path}`);
    if (path === ".ai/capabilities.json") assert.equal(after.private, true, `${label} weakened private mode for ${path}`);
  }
}

function validateLegacyOracles(sandbox) {
  const posix = join(sandbox, "posix");
  const windows = join(sandbox, "windows");
  mkdirSync(posix);
  mkdirSync(windows);

  const first = run("bash", [join(here, "bootstrap.sh"), posix]);
  assert.equal(first.stderr, "");
  assert.match(first.stdout, /Cairnkeep bootstrapped into/);
  for (const harness of HARNESSES) assert.ok(existsSync(join(posix, ".ai", `start-${harness}.sh`)), `${harness} POSIX launcher missing`);
  const posixBefore = snapshot(posix);
  writeFileSync(join(posix, ".ai", "env.example"), "operator-owned\n");
  chmodSync(join(posix, ".ai", "env.example"), 0o640);
  const operatorBytes = readFileSync(join(posix, ".ai", "env.example"));
  const rerun = run("bash", [join(here, "bootstrap.sh"), posix]);
  assert.match(rerun.stdout, /skip \(exists\): \.ai\/env\.example/);
  assert.deepEqual(readFileSync(join(posix, ".ai", "env.example")), operatorBytes);

  bootstrapWindows(root, [windows]);
  const windowsSnapshot = snapshot(windows);
  for (const harness of HARNESSES) {
    assert.ok(windowsSnapshot.has(`.ai/start-${harness}.sh`), `${harness} Windows shell launcher missing`);
    assert.ok(windowsSnapshot.has(`.ai/start-${harness}.cmd`), `${harness} Windows cmd launcher missing`);
  }
  for (const [path, value] of posixBefore) {
    assert.ok(windowsSnapshot.has(path), `Windows bootstrap omitted POSIX asset ${path}`);
    assert.deepEqual(windowsSnapshot.get(path).bytes, value.bytes, `Windows bootstrap changed common asset ${path}`);
  }

  const plain = join(sandbox, "plain");
  mkdirSync(plain);
  const rejected = run("bash", [join(here, "bootstrap.sh"), "--untracked", plain], { status: 1 });
  assert.match(rejected.stderr, /--untracked requires.*git repository/i);
  for (const managed of MANAGED_ROOTS) assert.equal(existsSync(join(plain, managed)), false, `legacy --untracked failure created ${managed}`);

  const repo = join(sandbox, "repo");
  mkdirSync(repo);
  run("git", ["init", "-q", repo]);
  run("bash", [join(here, "bootstrap.sh"), "--untracked", repo]);
  assert.equal(run("git", ["-C", repo, "status", "--porcelain"]).stdout, "");
  return { posixBefore, windowsSnapshot };
}

async function loadProduction() {
  const core = await import(pathToFileURL(setupCorePath).href);
  const reconcile = await import(pathToFileURL(setupReconcilePath).href);
  return { core, reconcile };
}

function assertProductionExports({ core, reconcile }) {
  assert.equal(typeof core.buildSetupPlan, "function");
  assert.equal(typeof reconcile.reconcileSetupPlan, "function");
  assert.equal(typeof reconcile.writeSetupStateAtomic, "function");
}

async function testSetupCompatibility(production, sandbox, legacy) {
  const target = join(sandbox, "setup");
  mkdirSync(target);
  const plan = production.core.buildSetupPlan({
    target,
    preflight: { targetState: "empty", gitExecutable: "available", repository: "work-tree" },
    choices: Object.freeze({ git: "existing", harnesses: HARNESSES, memory: "local", confirmed: true }),
  });
  const result = await production.reconcile.reconcileSetupPlan(plan);
  assert.deepEqual(result.counts, { created: legacy.posixBefore.size + 1, updated: 0, unchanged: 0, skipped: 0 });
  const current = snapshot(target);
  assertSnapshotEqual(current, legacy.posixBefore, "deterministic setup", [".ai/cairnkeep.json", ".codex/config.toml"]);
  assert.ok(current.has(".ai/cairnkeep.json"), "setup state missing");
  const state = JSON.parse(current.get(".ai/cairnkeep.json").bytes.toString("utf8"));
  assert.deepEqual(state.harnesses, HARNESSES);
  assert.equal(state.git, "existing");
  assert.equal(state.memory, "local");
  assert.doesNotMatch(JSON.stringify(state), new RegExp(sandbox.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const beforeMtimes = new Map([...legacy.posixBefore.keys()].map((path) => [path, statSync(join(target, ...path.split("/"))).mtimeMs]));
  const rerun = await production.reconcile.reconcileSetupPlan(plan);
  assert.equal(rerun.counts.created, 0);
  assert.equal(rerun.counts.updated, 0);
  assert.equal(rerun.counts.skipped, 0);
  for (const [path, mtime] of beforeMtimes) assert.equal(statSync(join(target, ...path.split("/"))).mtimeMs, mtime, `rerun touched ${path}`);
}

async function main() {
  const sandbox = mkdtempSync(join(tmpdir(), "cairn-setup-compatibility-"));
  try {
    const legacy = validateLegacyOracles(sandbox);
    let production;
    try {
      production = await loadProduction();
    } catch (error) {
      const message = String(error?.message ?? "");
      if (error?.code === "ERR_MODULE_NOT_FOUND" && (message.includes("setup-core.mjs") || message.includes("setup-reconcile.mjs"))) {
        console.log(RED_MARKER);
        process.exitCode = EXPECTED_RED_EXIT;
        return;
      }
      throw error;
    }
    assertProductionExports(production);
    await testSetupCompatibility(production, sandbox, legacy);
    console.log("PASS: legacy POSIX/Windows bootstrap and deterministic setup compatibility contract");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
