import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = fs.mkdtempSync(join(tmpdir(), "cairn-omp-staged-security-"));
const originalRead = fs.readFileSync;
const originalDescriptorRead = fs.readSync;
const originalOpen = fs.openSync;
const failures = [];
function restore() {
  fs.readFileSync = originalRead;
  fs.readSync = originalDescriptorRead;
  fs.openSync = originalOpen;
  syncBuiltinESMExports();
}
function mock() {
  const handlers = new Map();
  const commands = new Map();
  const messages = [];
  return {
    handlers, commands, messages,
    pi: {
      on(event, handler) { handlers.set(event, handler); },
      registerCommand(name, command) { commands.set(name, command); },
      getAllTools() { return []; },
      sendMessage(payload) { messages.push(payload); },
    },
  };
}
function context(project, ui) {
  return { cwd: project, agent: { kind: "main" }, hasUI: true, ui: { notify(text) { ui.push(text); } } };
}
async function control(name, operation) {
  try { await operation(); }
  catch (error) { failures.push(`${name}: ${error.message}`); }
}
try {
  fs.writeFileSync(join(root, "package.json"), '{"type":"module"}');
  const extension = join(root, "capture.ts");
  fs.writeFileSync(extension, fs.readFileSync(join(repository, "omp", "extensions", "cairnkeep-capture.ts"), "utf8").replaceAll("@@INFRA_ROOT@@", repository.replaceAll("\\", "/")));
  const { default: factory } = await import(pathToFileURL(extension).href);
  const project = join(root, "project");
  const staging = join(project, ".planning", "memory-staging");
  fs.mkdirSync(staging, { recursive: true });
  const staged = join(staging, "fixture.json");
  const payload = '{"candidates":[{"value":"reviewed fixture"}]}';
  fs.writeFileSync(staged, payload);
  let instance = mock();
  factory(instance.pi);
  let ui = [];
  await instance.handlers.get("session_start")({}, context(project, ui));
  assert.equal(instance.messages.length, 1);
  assert.match(ui[0], /1 memory candidate file/);
  assert.match(instance.messages[0].content, /memory_write/);

  const outside = join(root, "outside.json");
  fs.writeFileSync(outside, '{"candidates":[{"value":"private-external-sentinel"}]}');
  if (process.platform !== "win32") {
    fs.symlinkSync(outside, join(staging, "linked.json"));
    await control("OMP staged symlink exclusion", async () => {
      instance = mock(); factory(instance.pi); ui = [];
      await instance.handlers.get("session_start")({}, context(project, ui));
      assert.match(ui[0], /1 memory candidate file/);
      ui = [];
      await instance.commands.get("cairn-staged").handler("", context(project, ui));
      assert.equal(ui.join("\n").includes("private-external-sentinel"), false);
    });
    fs.unlinkSync(join(staging, "linked.json"));
  }
  await control("OMP staged growth", async () => {
    const descriptors = new Set();
    let grew = false;
    let unbounded = false;
    const change = () => {
      if (!grew) { grew = true; fs.appendFileSync(staged, " ".repeat(64 * 1024)); }
    };
    fs.openSync = (path, ...args) => {
      const fd = originalOpen(path, ...args);
      if (path === staged) descriptors.add(fd);
      return fd;
    };
    fs.readSync = (fd, ...args) => { if (descriptors.has(fd)) change(); return originalDescriptorRead(fd, ...args); };
    fs.readFileSync = (path, ...args) => {
      if (path === staged || descriptors.has(path)) { unbounded = true; change(); }
      return originalRead(path, ...args);
    };
    syncBuiltinESMExports();
    instance = mock(); factory(instance.pi); ui = [];
    try {
      await instance.handlers.get("session_start")({}, context(project, ui));
      assert.equal(grew, true);
      assert.equal(unbounded, false);
      assert.equal(instance.messages.length, 0, "changed staged content must not become wakeup evidence");
    } finally { restore(); }
  });
  fs.writeFileSync(staged, payload);
  fs.writeFileSync(join(staging, "oversized.json"), '{"candidates":[{"value":"oversized-sentinel"}]}' + " ".repeat(8192));
  ui = []; instance = mock(); factory(instance.pi);
  await instance.commands.get("cairn-staged").handler("", context(project, ui));
  await control("OMP listing bound", () => { assert.equal(ui.join("\n").includes("oversized-sentinel"), false); });
  assert.deepEqual(failures, [], "staged inspection must be bounded, contained and fail open without trusting unsafe content");
} finally {
  restore();
  fs.rmSync(root, { recursive: true, force: true });
}
console.log("PASS: OMP staged inspection rejects symlinks, growth and oversized content without blocking the session");
