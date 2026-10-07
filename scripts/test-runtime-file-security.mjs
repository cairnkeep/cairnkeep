import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { readSetupPolicy, buildSetupPlan } from "./setup-core.mjs";
import { reconcileSetupPlan } from "./setup-reconcile.mjs";
import { diagnoseSetup } from "./setup.mjs";
import { reconcilePlaybookInstructions } from "./playbook-instructions.mjs";
import { createTar, runWindowsCommand } from "./windows-platform.mjs";
import { readStableFile, readStableText } from "./lib/stable-file.mjs";

const root = fs.mkdtempSync(join(tmpdir(), "cairn-cli-file-security-"));
const failures = [];
const original = {
  lstat: fs.lstatSync, open: fs.openSync, close: fs.closeSync,
  read: fs.readSync, readFile: fs.readFileSync,
  rename: fs.renameSync, write: fs.writeFileSync,
};
let swap = 0;
function restore() {
  fs.lstatSync = original.lstat;
  fs.openSync = original.open;
  fs.closeSync = original.close;
  fs.readSync = original.read;
  fs.readFileSync = original.readFile;
  fs.renameSync = original.rename;
  fs.writeFileSync = original.write;
  syncBuiltinESMExports();
}
function write(path, value, mode = 0o600) {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, value, { mode });
}
async function control(name, operation) {
  try { await operation(); }
  catch (error) { failures.push(`${name}: ${error.message}`); }
}
async function substitute(path, occurrence, replacement, operation) {
  const candidate = join(root, "swaps", `${++swap}.candidate`);
  const inspected = join(root, "swaps", `${swap}.inspected`);
  write(candidate, replacement, fs.statSync(path).mode & 0o777);
  let calls = 0;
  let injected = false;
  fs.lstatSync = (target, ...args) => {
    const info = original.lstat(target, ...args);
    if (target === path && ++calls === occurrence) {
      injected = true;
      fs.renameSync(path, inspected);
      fs.renameSync(candidate, path);
    }
    return info;
  };
  syncBuiltinESMExports();
  try { await operation(); }
  finally { restore(); assert.equal(injected, true, "the actual reader must encounter replacement"); }
}
async function grow(path, operation) {
  const inspectedSize = fs.statSync(path).size;
  const descriptors = new Set();
  let injected = false;
  let unbounded = false;
  const allocations = [];
  function change() {
    if (!injected) { injected = true; fs.appendFileSync(path, " ".repeat(2 * 1024 * 1024)); }
  }
  fs.openSync = (target, ...args) => {
    const fd = original.open(target, ...args);
    if (target === path) descriptors.add(fd);
    return fd;
  };
  fs.closeSync = (fd) => { descriptors.delete(fd); return original.close(fd); };
  fs.readSync = (fd, buffer, ...args) => {
    if (descriptors.has(fd)) { change(); allocations.push(buffer.byteLength); }
    return original.read(fd, buffer, ...args);
  };
  fs.readFileSync = (target, ...args) => {
    if (target === path || descriptors.has(target)) { unbounded = true; change(); }
    return original.readFile(target, ...args);
  };
  syncBuiltinESMExports();
  try { await operation(); }
  finally {
    restore();
    assert.equal(injected, true, "the actual reader must encounter growth");
    assert.equal(unbounded, false, "CLI readers must not use an unbounded readFile result");
    assert.ok(allocations.every((size) => size <= inspectedSize + 1));
    assert.equal(descriptors.size, 0, "failed reads must close descriptors");
  }
}

try {
  const missingProject = join(root, "not-created-yet");
  assert.equal(reconcilePlaybookInstructions(missingProject, { check: true }).status, "would-created");
  assert.equal(fs.existsSync(missingProject), false, "instruction preflight must not create a new project");
  assert.throws(() => reconcilePlaybookInstructions(missingProject), /ENOENT/);
  const helperFixture = join(root, "helper.txt");
  write(helperFixture, "bounded", 0o644);
  assert.equal(readStableText(helperFixture, { label: "Fixture", maxBytes: 7 }).text, "bounded");
  fs.readSync = (descriptor, buffer, offset, length, position) => original.read(descriptor, buffer, offset, Math.min(2, length), position);
  syncBuiltinESMExports();
  try { assert.equal(readStableText(helperFixture, { label: "Fixture", maxBytes: 7 }).text, "bounded", "partial reads must assemble complete content"); }
  finally { restore(); }
  let readAttempts = 0;
  fs.readSync = (...args) => { readAttempts += 1; return original.read(...args); };
  syncBuiltinESMExports();
  try {
    assert.throws(() => readStableFile(helperFixture, { label: "Fixture", maxBytes: 6 }), /unsafe/);
    if (process.platform !== "win32") assert.throws(() => readStableFile("/dev/null", { label: "Fixture", maxBytes: 7 }), /unsafe/);
    assert.equal(readAttempts, 0, "oversized and special files must be rejected before content reads");
  } finally { restore(); }
  write(helperFixture, Buffer.from([0xff]), 0o644);
  assert.throws(() => readStableText(helperFixture, { label: "Fixture", maxBytes: 7 }), /UTF-8/);
  if (process.platform !== "win32") assert.throws(() => readStableFile(helperFixture, { label: "Fixture", maxBytes: 7, privateMode: 0o600 }), /unsafe/);

  const policyPath = join(root, "policy.json");
  write(policyPath, '{"schema_version":1,"defaults":{},"constraints":{}}', 0o644);
  assert.equal(readSetupPolicy(policyPath).schema_version, 1);
  await control("setup policy growth", () => grow(policyPath, () => {
    assert.throws(() => readSetupPolicy(policyPath), /unsafe|changed|limit/i);
  }));

  const project = join(root, "project");
  fs.mkdirSync(project);
  const plan = buildSetupPlan({
    target: project,
    preflight: { targetState: "empty", gitExecutable: "available", repository: "work-tree" },
    choices: { git: "existing", harnesses: ["claude"], memory: "local", confirmed: true },
  });
  const created = await reconcileSetupPlan(plan);
  assert.equal(diagnoseSetup(project).status, "complete");
  const statePath = join(project, ".ai", "cairnkeep.json");
  const stateBytes = fs.readFileSync(statePath);
  await control("setup diagnosis state growth", () => grow(statePath, () => {
    assert.equal(diagnoseSetup(project).status, "incomplete");
  }));
  write(statePath, stateBytes);
  const owned = join(project, ".ai", "start-claude.sh");
  const ownedBytes = fs.readFileSync(owned);
  write(owned, "# Caller-owned launcher.\n", 0o755);
  await control("setup diagnosis owned replacement", () => substitute(owned, 1, ownedBytes, () => {
    assert.equal(diagnoseSetup(project).status, "incomplete", "replacement must not restore recorded ownership");
  }));
  write(owned, "# Caller-owned launcher.\n", 0o755);
  await control("setup reconciliation ownership replacement", () => substitute(owned, 2, ownedBytes, async () => {
    await assert.rejects(() => reconcileSetupPlan(plan, { previousState: created.state }), /unsafe|changed/i);
  }));
  write(owned, ownedBytes, 0o755);
  await control("setup mutation ownership recheck", async () => {
    const update = { ...plan, assets: [ { ...plan.assets.find((asset) => asset.path === ".ai/start-claude.sh"), bytes: Buffer.from("# Generated update.\n") } ] };
    let observed;
    let inspected = false;
    let injected = false;
    fs.openSync = (path, ...args) => {
      const descriptor = original.open(path, ...args);
      if (path === owned) observed = descriptor;
      return descriptor;
    };
    fs.closeSync = (descriptor) => {
      if (descriptor === observed) inspected = true;
      return original.close(descriptor);
    };
    fs.lstatSync = (path, ...args) => {
      if (inspected && !injected && path === dirname(owned)) {
        injected = true;
        original.write(owned, "# Concurrent caller rule.\n");
      }
      return original.lstat(path, ...args);
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(() => reconcileSetupPlan(update, { previousState: created.state }), /changed|unsafe/i);
      assert.equal(injected, true);
      assert.equal(fs.readFileSync(owned, "utf8"), "# Concurrent caller rule.\n");
    } finally { restore(); write(owned, ownedBytes, 0o755); }
  });

  const agents = join(project, "AGENTS.md");
  write(agents, "# User rules\n\nRetain this line.\n", 0o640);
  assert.equal(reconcilePlaybookInstructions(project, { check: true }).status, "would-updated");
  await control("playbook instructions growth", () => grow(agents, () => {
    assert.throws(() => reconcilePlaybookInstructions(project, { check: true }), /unsafe|changed|bounded/i);
  }));
  write(agents, "# User rules\n\nRetain this line.\n", 0o640);
  fs.chmodSync(agents, 0o640);
  assert.equal(reconcilePlaybookInstructions(project).status, "updated");
  assert.match(fs.readFileSync(agents, "utf8"), /Retain this line/);
  if (process.platform !== "win32") assert.equal(fs.statSync(agents).mode & 0o777, 0o640);
  assert.equal(reconcilePlaybookInstructions(project).status, "unchanged");
  await control("instruction mutation ownership recheck", () => {
    write(agents, "# Prior instructions\n", 0o640);
    let injected = false;
    fs.writeFileSync = (path, ...args) => {
      if (!injected && typeof path === "string" && basename(path).startsWith(".AGENTS.md.")) {
        injected = true;
        original.write(agents, "# Concurrent caller rule.\n");
      }
      return original.write(path, ...args);
    };
    fs.openSync = (path, ...args) => {
      if (!injected && typeof path === "string" && basename(path).startsWith(".AGENTS.md.")) {
        injected = true;
        original.write(agents, "# Concurrent caller rule.\n");
      }
      return original.open(path, ...args);
    };
    syncBuiltinESMExports();
    try {
      assert.throws(() => reconcilePlaybookInstructions(project), /changed|unsafe/i);
      assert.equal(injected, true);
      assert.equal(fs.readFileSync(agents, "utf8"), "# Concurrent caller rule.\n");
      assert.equal(fs.readdirSync(project).some((name) => name.startsWith(".AGENTS.md.")), false);
    } finally { restore(); }
  });
  const unapproved = join(root, "unapproved");
  fs.mkdirSync(unapproved);
  write(join(unapproved, "AGENTS.md"), "# Private rule\n", 0o640);
  if (process.platform !== "win32") {
    const linkedProject = join(root, "linked-project");
    fs.symlinkSync(unapproved, linkedProject, "dir");
    await control("playbook project symlink", () => {
      assert.throws(() => reconcilePlaybookInstructions(linkedProject), /unsafe|symlink|directory/i);
      assert.equal(fs.readFileSync(join(unapproved, "AGENTS.md"), "utf8"), "# Private rule\n");
    });
  }

  const archive = join(root, "memory.tgz");
  const archiveBytes = gzipSync(createTar([["project.db", Buffer.from("New database fixture.")]]));
  write(archive, archiveBytes);
  const memory = join(root, "memory");
  const database = join(memory, "project.db");
  write(database, "Prior database fixture.");
  const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const previousBase = process.env.CAIRN_AGENTFS_BASE_DIR;
  process.env.CAIRN_AGENTFS_BASE_DIR = memory;
  try {
    await control("Windows archive growth", () => grow(archive, async () => {
      await assert.rejects(() => runWindowsCommand({ command: "memory", args: ["import", archive], root: repository }), /unsafe|changed/i);
    }));
    write(archive, archiveBytes);
    fs.renameSync = (source, destination) => {
      if (destination === database) throw Object.assign(new Error("Synthetic denied replacement."), { code: "EPERM" });
      return original.rename(source, destination);
    };
    syncBuiltinESMExports();
    await control("Windows denied replacement retention", async () => {
      try {
        await assert.rejects(() => runWindowsCommand({ command: "memory", args: ["import", archive], root: repository }), /denied/i);
        assert.equal(fs.readFileSync(database, "utf8"), "Prior database fixture.", "replacement failure must retain the live database");
        assert.deepEqual(fs.readdirSync(memory).filter((name) => name.includes(".tmp-")), [], "failed replacement must clean its own temporary files");
      } finally { restore(); }
    });
    write(database, "Prior database fixture.");
    let denied = 0;
    fs.renameSync = (source, destination) => {
      if (destination === database && denied++ < 2) {
        assert.equal(fs.readFileSync(database, "utf8"), "Prior database fixture.");
        throw Object.assign(new Error("Synthetic transient sharing violation."), { code: "EBUSY" });
      }
      return original.rename(source, destination);
    };
    syncBuiltinESMExports();
    try {
      await runWindowsCommand({ command: "memory", args: ["import", archive], root: repository });
      assert.equal(denied, 3);
      assert.equal(fs.readFileSync(database, "utf8"), "New database fixture.");
    } finally { restore(); }
    write(database, "Prior database fixture.");
    if (process.platform !== "win32") {
      const outside = join(root, "outside-target");
      write(outside, "Outside sentinel.");
      let injected = false;
      let collidingTemporary;
      function substituteTemporary(path) {
        if (!injected && typeof path === "string" && dirname(path) === memory
            && basename(path).startsWith("project.db.tmp-")) {
          injected = true;
          collidingTemporary = path;
          fs.symlinkSync(outside, path);
        }
      }
      fs.openSync = (path, ...args) => { substituteTemporary(path); return original.open(path, ...args); };
      fs.writeFileSync = (path, ...args) => { substituteTemporary(path); return original.write(path, ...args); };
      syncBuiltinESMExports();
      await control("Windows exclusive temporary publication", async () => {
        try {
          await assert.rejects(() => runWindowsCommand({ command: "memory", args: ["import", archive], root: repository }), /exist|unsafe/i);
          assert.equal(injected, true);
          assert.equal(fs.readFileSync(outside, "utf8"), "Outside sentinel.", "temporary symlink must not receive private content");
          assert.equal(fs.readFileSync(database, "utf8"), "Prior database fixture.");
          assert.equal(fs.lstatSync(collidingTemporary).isSymbolicLink(), true, "a collision must not delete an unowned temporary name");
        } finally { restore(); }
      });
    }
  } finally {
    if (previousBase === undefined) delete process.env.CAIRN_AGENTFS_BASE_DIR;
    else process.env.CAIRN_AGENTFS_BASE_DIR = previousBase;
  }

  assert.deepEqual(failures, [], "CLI file boundaries must fail closed without changing ownership");
} finally {
  restore();
  fs.rmSync(root, { recursive: true, force: true });
}
console.log("PASS: bounded setup/instruction/archive reads and denied/exclusive Windows publication");
