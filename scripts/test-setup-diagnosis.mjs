#!/usr/bin/env node
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildSetupPlan } from "./setup-core.mjs";
import { reconcileSetupPlan } from "./setup-reconcile.mjs";
import { diagnoseSetup } from "./setup.mjs";

const sandbox = mkdtempSync(join(tmpdir(), "cairn-setup-diagnosis-"));
try {
  const project = join(sandbox, "project");
  mkdirSync(project);
  const plan = buildSetupPlan({
    target: project,
    preflight: { targetState: "empty", gitExecutable: "available", repository: "work-tree" },
    choices: { git: "existing", harnesses: ["claude", "opencode", "omp"], memory: "local", confirmed: true },
  });
  const customPaths = [".ai/env.example", ".ai/start-claude.sh", ".ai/start-opencode.sh", ".planning/graphs/policy.md"];
  for (const path of customPaths) {
    const file = join(project, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, path.endsWith(".sh") ? "#!/bin/sh\n# Project-owned launcher\nexit 0\n" : "Project-owned configuration\n");
    chmodSync(file, path.endsWith(".sh") ? 0o755 : 0o640);
  }
  const before = new Map(customPaths.map(path => [path, { bytes: readFileSync(join(project, path)), mode: statSync(join(project, path)).mode, mtime: statSync(join(project, path)).mtimeMs }]));
  const result = await reconcileSetupPlan(plan);
  assert.equal(result.counts.skipped, customPaths.length);
  for (const path of customPaths) assert.equal(Object.hasOwn(result.state.assets, path), false, "custom file became setup-owned");
  const statePath = join(project, ".ai/cairnkeep.json");
  const stateBytes = readFileSync(statePath);
  assert.equal(diagnoseSetup(project).status, "complete", "safe preserved custom assets must not make setup incomplete");
  for (const [path, saved] of before) {
    assert.deepEqual(readFileSync(join(project, path)), saved.bytes);
    assert.equal(statSync(join(project, path)).mode, saved.mode);
    assert.equal(statSync(join(project, path)).mtimeMs, saved.mtime);
  }
  assert.deepEqual(readFileSync(statePath), stateBytes, "diagnosis rewrote ownership state");

  for (const path of customPaths) {
    const file = join(project, path), saved = `${file}.saved`;
    renameSync(file, saved);
    assert.equal(diagnoseSetup(project).status, "incomplete", "missing unowned asset accepted");
    mkdirSync(file);
    assert.equal(diagnoseSetup(project).status, "incomplete", "directory asset accepted");
    rmSync(file, { recursive: true });
    if (process.platform !== "win32") {
      symlinkSync(saved, file);
      assert.equal(diagnoseSetup(project).status, "incomplete", "symlink asset accepted");
      rmSync(file);
    }
    renameSync(saved, file);
  }
  if (process.platform !== "win32") {
    const launcher = join(project, ".ai/start-claude.sh");
    chmodSync(launcher, 0o644);
    assert.equal(diagnoseSetup(project).status, "incomplete", "non-executable custom launcher accepted");
    chmodSync(launcher, 0o755);
    const directory = join(project, ".planning/graphs"), saved = `${directory}.saved`;
    renameSync(directory, saved);
    symlinkSync(saved, directory, "dir");
    assert.equal(diagnoseSetup(project).status, "incomplete", "symlinked asset ancestor accepted");
    rmSync(directory);
    renameSync(saved, directory);
  }
  const owned = join(project, ".ai/start-omp.sh"), ownedBytes = readFileSync(owned);
  writeFileSync(owned, "owned drift\n");
  assert.equal(diagnoseSetup(project).status, "incomplete", "owned digest drift accepted");
  writeFileSync(owned, ownedBytes);
  assert.equal(diagnoseSetup(project).status, "complete");

  // An ownership map can legitimately be empty when every asset was preserved.
  const unowned = { ...result.state, assets: {} };
  writeFileSync(statePath, JSON.stringify(unowned) + "\n");
  chmodSync(statePath, 0o600);
  assert.equal(diagnoseSetup(project).status, "complete", "all-custom setup falsely requires owned files");
  assert.deepEqual(JSON.parse(readFileSync(statePath)), unowned);
  assert.equal(existsSync(join(project, ".ai/start-omp.sh")), true);
  console.log("PASS: setup diagnosis preserves custom ownership and rejects missing, unsafe, non-executable and drifted assets");
} finally {
  rmSync(sandbox, { recursive: true, force: true });
}
