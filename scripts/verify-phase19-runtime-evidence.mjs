#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMMIT = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SCOPES = new Set(["offline-framework", "live-evaluation"]);
const FORBIDDEN_KEYS = new Set(["environment", "env", "prompt", "model_output", "adapter_stderr", "verifier_output", "workspace_path"]);
const SECRET_SENTINELS = ["phase19-secret-sentinel", "phase19-prompt-sentinel", "phase19-model-output-sentinel", "phase19-adapter-stderr-sentinel"];

function usage() {
  return `Usage:
  node scripts/verify-phase19-runtime-evidence.mjs --self-test
  node scripts/verify-phase19-runtime-evidence.mjs --capture <evidence-dir> <source-commit>
  node scripts/verify-phase19-runtime-evidence.mjs --verify-only <evidence-dir> <source-commit>\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requireCommit(value) {
  if (!COMMIT.test(value)) throw new Error("source commit must be one lowercase full commit");
  return value;
}

function requireDigest(value, label) {
  if (!DIGEST.test(value)) throw new Error(`${label} must be one SHA-256 digest`);
  return value;
}

function safeRelative(value, label) {
  if (typeof value !== "string" || !SAFE_PATH.test(value) || isAbsolute(value) || value.includes("\\")) {
    throw new Error(`${label} must be a bounded relative path`);
  }
  const parts = value.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) throw new Error(`${label} escapes its evidence root`);
  return value;
}

function assertNoForbiddenKeys(value, path = "manifest") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`${path}: forbidden evidence field ${key}`);
    assertNoForbiddenKeys(child, `${path}.${key}`);
  }
}

function readOwnedFile(root, relative) {
  const label = safeRelative(relative, "evidence file");
  const path = join(root, label);
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) throw new Error(`${label}: unsafe evidence file`);
  return readFileSync(path);
}

function verifyEvidence(directory, sourceCommit) {
  requireCommit(sourceCommit);
  const root = resolve(directory);
  const manifestPath = join(root, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("evidence manifest is missing");
  const manifestBytes = readOwnedFile(root, "manifest.json");
  const raw = manifestBytes.toString("utf8");
  for (const sentinel of SECRET_SENTINELS) {
    if (raw.includes(sentinel)) throw new Error("evidence contains a secret sentinel");
  }
  const manifest = JSON.parse(raw);
  assertNoForbiddenKeys(manifest);
  assert.deepEqual(Object.keys(manifest).sort(), [
    "adapter_id", "claim_anchors", "command_inventory", "evidence_scope", "files", "missingness_digest",
    "note_snapshot_digests", "report_digest", "runtime", "schema_version", "source_commit", "task_set_digest",
  ]);
  assert.equal(manifest.schema_version, 1);
  assert.equal(SCOPES.has(manifest.evidence_scope), true, "unsupported evidence scope");
  assert.equal(manifest.source_commit, sourceCommit, "stale source commit");
  requireDigest(manifest.task_set_digest, "task-set digest");
  requireDigest(manifest.report_digest, "report digest");
  requireDigest(manifest.missingness_digest, "missingness digest");
  assert.equal(Array.isArray(manifest.note_snapshot_digests), true);
  manifest.note_snapshot_digests.forEach((value) => requireDigest(value, "note snapshot digest"));
  assert.deepEqual(Object.keys(manifest.runtime).sort(), ["arch", "node", "platform"]);
  assert.equal(Array.isArray(manifest.command_inventory) && manifest.command_inventory.length > 0, true);
  for (const row of manifest.command_inventory) {
    assert.deepEqual(Object.keys(row).sort(), ["args", "id", "program", "status"]);
    assert.equal(typeof row.id, "string");
    assert.equal(typeof row.program, "string");
    assert.equal(Array.isArray(row.args), true);
    assert.equal(row.status, "pass");
  }
  assert.equal(Array.isArray(manifest.files) && manifest.files.length >= 3, true);
  const seen = new Set();
  for (const row of manifest.files) {
    assert.deepEqual(Object.keys(row).sort(), ["path", "sha256"]);
    const label = safeRelative(row.path, "manifest file path");
    assert.equal(seen.has(label), false, "duplicate evidence file");
    seen.add(label);
    const bytes = readOwnedFile(root, label);
    requireDigest(row.sha256, `${label} digest`);
    assert.equal(sha256(bytes), row.sha256, `${label}: stale file digest`);
    for (const sentinel of SECRET_SENTINELS) assert.equal(bytes.includes(sentinel), false, `${label}: secret sentinel leaked`);
  }
  for (const required of ["task-set.json", "report.json", "runtime.log"]) {
    assert.equal(seen.has(required), true, `missing required evidence file ${required}`);
  }
  const taskSetBytes = readOwnedFile(root, "task-set.json");
  const reportBytes = readOwnedFile(root, "report.json");
  assert.equal(sha256(taskSetBytes), manifest.task_set_digest, "stale task-set digest");
  assert.equal(sha256(reportBytes), manifest.report_digest, "stale report digest");
  const report = JSON.parse(reportBytes.toString("utf8"));
  assert.equal(report.missingness_digest, manifest.missingness_digest, "hidden or stale missingness");
  assert.deepEqual(report.note_snapshot_digests, manifest.note_snapshot_digests, "stale note snapshot digest list");
  assert.equal(Array.isArray(manifest.claim_anchors), true);
  if (manifest.evidence_scope === "offline-framework") {
    assert.equal(manifest.adapter_id, "cairn-offline-fake-v1", "offline evidence lost fake identity");
    assert.deepEqual(manifest.claim_anchors, [], "fake evidence authorized a product claim");
  } else {
    assert.notEqual(manifest.adapter_id, "cairn-offline-fake-v1", "fake adapter was classified as live proof");
    assert.equal(manifest.claim_anchors.length > 0, true, "live claim is unanchored");
    for (const anchor of manifest.claim_anchors) {
      assert.equal(typeof anchor.id, "string");
      assert.equal(anchor.report_digest, manifest.report_digest, "claim anchor uses stale report");
    }
  }
  return manifest;
}

function writeFixture(directory, overrides = {}) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const taskSet = Buffer.from('{"schema_version":1,"id":"offline-fixture","tasks":["task-a"]}\n');
  const noteDigest = sha256("note-snapshot");
  const missingnessDigest = sha256("missingness");
  const report = Buffer.from(`${JSON.stringify({
    schema_version: 1,
    evidence_scope: "offline-framework",
    missingness_digest: missingnessDigest,
    note_snapshot_digests: [noteDigest],
    population: { declared: 1, executed: 1, paired: 1, note_eligible: 1 },
  })}\n`);
  const runtime = Buffer.from("runtime=node-22\nresult=pass\n");
  const files = [
    ["task-set.json", taskSet],
    ["report.json", report],
    ["runtime.log", runtime],
  ];
  for (const [name, bytes] of files) writeFileSync(join(directory, name), bytes, { mode: 0o600 });
  const manifest = {
    schema_version: 1,
    evidence_scope: "offline-framework",
    source_commit: "a".repeat(40),
    task_set_digest: sha256(taskSet),
    report_digest: sha256(report),
    note_snapshot_digests: [noteDigest],
    missingness_digest: missingnessDigest,
    runtime: { node: "22.0.0", platform: "linux", arch: "x64" },
    adapter_id: "cairn-offline-fake-v1",
    command_inventory: [{ id: "offline-fixture", program: "node", args: ["fake-eval-adapter.mjs"], status: "pass" }],
    files: files.map(([path, bytes]) => ({ path, sha256: sha256(bytes) })),
    claim_anchors: [],
    ...overrides,
  };
  writeFileSync(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}

function expectFailure(label, operation) {
  assert.throws(operation, undefined, label);
}

function mutateManifest(directory, mutation) {
  const path = join(directory, "manifest.json");
  const value = JSON.parse(readFileSync(path, "utf8"));
  mutation(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), "cairn-phase19-evidence-"));
  const commit = "a".repeat(40);
  try {
    const valid = join(root, "valid");
    writeFixture(valid);
    verifyEvidence(valid, commit);

    const cases = [
      ["stale-source", (dir) => mutateManifest(dir, (value) => { value.source_commit = "b".repeat(40); })],
      ["stale-task", (dir) => mutateManifest(dir, (value) => { value.task_set_digest = "b".repeat(64); })],
      ["stale-report", (dir) => mutateManifest(dir, (value) => { value.report_digest = "c".repeat(64); })],
      ["stale-note", (dir) => mutateManifest(dir, (value) => { value.note_snapshot_digests = ["d".repeat(64)]; })],
      ["hidden-missingness", (dir) => mutateManifest(dir, (value) => { value.missingness_digest = "e".repeat(64); })],
      ["fake-live", (dir) => mutateManifest(dir, (value) => { value.evidence_scope = "live-evaluation"; value.claim_anchors = [{ id: "efficiency", report_digest: value.report_digest }]; })],
      ["fake-claim", (dir) => mutateManifest(dir, (value) => { value.claim_anchors = [{ id: "quality", report_digest: value.report_digest }]; })],
      ["forbidden-field", (dir) => mutateManifest(dir, (value) => { value.environment = { TOKEN: "redacted" }; })],
      ["absolute-path", (dir) => mutateManifest(dir, (value) => { value.files[0].path = "/tmp/task-set.json"; })],
      ["secret-bytes", (dir) => { writeFileSync(join(dir, "runtime.log"), SECRET_SENTINELS[0]); mutateManifest(dir, (value) => { value.files[2].sha256 = sha256(SECRET_SENTINELS[0]); }); }],
    ];
    for (const [label, mutation] of cases) {
      const directory = join(root, label);
      writeFixture(directory);
      mutation(directory);
      expectFailure(label, () => verifyEvidence(directory, commit));
    }

    const live = join(root, "live");
    const liveManifest = writeFixture(live, { evidence_scope: "live-evaluation", adapter_id: "operator-adapter-v1" });
    mutateManifest(live, (value) => { value.claim_anchors = [{ id: "efficiency-estimate", report_digest: liveManifest.report_digest }]; });
    verifyEvidence(live, commit);

    process.stdout.write("PASS: Phase 19 runtime-evidence integrity and fake/live separation self-test\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function capture(directory, sourceCommit) {
  requireCommit(sourceCommit);
  const head = readFileSync(join(ROOT, ".git", "HEAD"), "utf8").trim();
  if (!head.startsWith("ref:")) throw new Error("capture requires an attached clean source checkout");
  const production = join(ROOT, "mcp-memory-server", "dist", "eval-report.js");
  if (!existsSync(production)) throw new Error("Phase 19 production evaluation report module is absent");
  throw new Error("runtime capture requires the Phase 19 final evidence plan");
}

function main() {
  const [mode, directory, sourceCommit, ...extra] = process.argv.slice(2);
  if (mode === "--self-test" && directory === undefined && sourceCommit === undefined && extra.length === 0) return selfTest();
  if ((mode === "--capture" || mode === "--verify-only") && directory && sourceCommit && extra.length === 0) {
    if (mode === "--capture") capture(resolve(directory), sourceCommit);
    else {
      verifyEvidence(resolve(directory), sourceCommit);
      process.stdout.write(`PASS: Phase 19 runtime evidence verified for ${sourceCommit}\n`);
    }
    return;
  }
  process.stderr.write(usage());
  process.exitCode = 2;
}

try {
  main();
} catch (error) {
  process.stderr.write(`FATAL: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
