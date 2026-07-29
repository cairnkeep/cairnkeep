#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_RELATIVE = join(
  ".planning",
  "phases",
  "19-evaluation-harness",
  "runtime-evidence",
);
const EXPECTED_LOGS = ["node-22.log", "node-24.log", "node-26.log", "bash-3.2.log"];
const NODE_IMAGES = new Map([
  ["node-22", "node:22-bookworm"],
  ["node-24", "node:24-bookworm"],
  ["node-26", "node:26-bookworm"],
]);
const BASH_IMAGE = "docker.io/library/bash:3.2";
const COMMIT = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const SAFE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const FORBIDDEN_KEYS = new Set([
  "environment",
  "env",
  "prompt",
  "model_output",
  "adapter_stderr",
  "verifier_output",
  "workspace_path",
]);
const SECRET_SENTINELS = [
  "phase19-secret-sentinel",
  "phase19-prompt-sentinel",
  "phase19-model-output-sentinel",
  "phase19-adapter-stderr-sentinel",
];
const CAPABILITIES = [
  "memory.write",
  "memory.search",
  "notes.distill",
  "wiki",
  "graph",
  "security.audit",
  "route.check",
  "context.explore",
];
const REPORT_CONTRACT_CACHE = new Map();

const REPORT_PROBE = String.raw`set -eu
rm -rf /tmp/cairn-phase19-report-output /tmp/cairn-phase19-report-probe
mkdir -p /tmp/cairn-phase19-report-probe
CAIRN_EVAL=1 node mcp-memory-server/dist/eval-cli.js validate --task-set examples/eval/task-set.json --adapter examples/eval/adapter.json --output /tmp/cairn-phase19-report-output --seed runtime-evidence-seed --json >/tmp/cairn-phase19-report-probe/validate.json
CAIRN_EVAL=1 node mcp-memory-server/dist/eval-cli.js run --task-set examples/eval/task-set.json --adapter examples/eval/adapter.json --output /tmp/cairn-phase19-report-output --seed runtime-evidence-seed --yes --json >/tmp/cairn-phase19-report-probe/run.json 2>/dev/null
node --input-type=module -e '
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
function sortCanonical(value) {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b,"en")).map(([key, child])=>[key,sortCanonical(child)]));
  return value;
}
const sha256=(value)=>createHash("sha256").update(value).digest("hex");
const taskSet=JSON.parse(readFileSync("examples/eval/task-set.json","utf8"));
const binding=JSON.parse(readFileSync("examples/eval/bundled-fake.json","utf8"));
const installedPackage=JSON.parse(readFileSync("package.json","utf8"));
const validation=JSON.parse(readFileSync("/tmp/cairn-phase19-report-probe/validate.json","utf8"));
const run=JSON.parse(readFileSync("/tmp/cairn-phase19-report-probe/run.json","utf8"));
const reportBytes=readFileSync(run.report_path);
const report=JSON.parse(reportBytes.toString("utf8"));
const taskSetDigest=sha256(Buffer.from(JSON.stringify(sortCanonical(taskSet)),"utf8"));
assert.equal(binding.identifier,"cairn-offline-fake-v1");
assert.equal(binding.package_version,installedPackage.version);
assert.equal(binding.task_set_digest,taskSetDigest);
assert.equal(validation.operation,"validate");
assert.equal(validation.plan.source.identifier,binding.identifier);
assert.equal(validation.plan.source.package_version,installedPackage.version);
assert.equal(validation.plan.task_set_digest,taskSetDigest);
assert.equal(run.operation,"run");
assert.equal(run.status,"final");
assert.equal(report.status,"final");
assert.equal(report.task_set_digest,taskSetDigest);
assert.equal(report.evidence.evidence_scope,"offline-framework");
assert.equal(report.evidence.source_commit,taskSetDigest);
assert.equal(report.evidence.package_version,installedPackage.version);
assert.equal(report.evidence.task_set_digest,taskSetDigest);
assert.equal(report.evidence.missingness_digest,report.missingness.digest);
assert.deepEqual(report.evidence.claim_anchors,[]);
assert.equal(report.observations.length,taskSet.tasks.length*2);
const metadata={
  schema_version:1,
  evidence_scope:report.evidence.evidence_scope,
  adapter_id:binding.identifier,
  package_version:report.evidence.package_version,
  task_set_digest:taskSetDigest,
  plan_digest:validation.plan.plan_digest,
  schedule_digest:validation.plan.schedule_digest,
  report_digest:report.evidence.report_digest,
  report_file_sha256:sha256(reportBytes),
  report_source_commit:report.evidence.source_commit,
  runtime_id:report.evidence.runtime_id,
  schema_digests:report.evidence.schema_digests,
  note_snapshot_digests:report.evidence.note_snapshot_digests,
  missingness_digest:report.evidence.missingness_digest,
  claim_anchors:report.evidence.claim_anchors,
  observation_count:report.observations.length,
};
writeFileSync("/tmp/cairn-phase19-report-metadata.json",JSON.stringify(metadata));
'
chmod -R u+w /tmp/cairn-phase19-report-output /tmp/cairn-phase19-report-probe
rm -rf /tmp/cairn-phase19-report-output /tmp/cairn-phase19-report-probe`;
const REPORT_PROBE_COMMAND = `printf %s ${JSON.stringify(Buffer.from(REPORT_PROBE, "utf8").toString("base64"))} | base64 -d | bash`;

const NODE_COMMANDS = [
  ["fixture-git-init", "rm -f .git && git init -q && git fetch -q .cairn-runtime-evidence.bundle HEAD && git reset -q --mixed FETCH_HEAD && rm -f .cairn-runtime-evidence.bundle && git config user.name 'Runtime Evidence' && git config user.email 'runtime-evidence@example.invalid'", "runtime-setup"],
  ["root-install", "npm ci --offline", "runtime-setup"],
  ["server-install", "npm --prefix mcp-memory-server ci --offline", "runtime-setup"],
  ["server-build", "npm --prefix mcp-memory-server run build", "offline-framework"],
  ["eval-schema", "node mcp-memory-server/scripts/smoke-eval-schema.mjs", "offline-framework"],
  ["eval-process", "node mcp-memory-server/scripts/smoke-eval-process.mjs", "offline-framework"],
  ["eval-statistics", "node mcp-memory-server/scripts/smoke-eval-statistics.mjs", "offline-framework"],
  ["server-full-suite", "npm --prefix mcp-memory-server test", "full-regression"],
  ["root-full-suite", "npm test", "full-regression"],
  ["fake-two-pass", "bash scripts/test-phase19-eval-lifecycle.sh fake", "offline-framework"],
  ["fake-ablation-all-eight", "bash scripts/test-phase19-eval-lifecycle.sh ablation", "offline-framework"],
  ["claims", "bash scripts/test-phase19-eval-lifecycle.sh claims", "claim-boundary"],
  ["completion", "bash scripts/test-completion.sh", "public-lifecycle"],
  ["doctor", "bash scripts/test-doctor.sh", "public-lifecycle"],
  ["package-install", "bash scripts/test-package-install.sh", "package-lifecycle"],
  ["uninstall-revert", "bash scripts/test-uninstall.sh", "package-lifecycle"],
  ["docs-parity", "bash scripts/verify-docs-parity.sh", "public-guard"],
  ["public-guard", "bash scripts/verify-no-private-references.sh", "public-guard"],
  ["report-provenance", REPORT_PROBE_COMMAND, "report-provenance"],
  ["dependency-lock-drift", "git diff --exit-code -- package.json package-lock.json mcp-memory-server/package.json mcp-memory-server/package-lock.json", "source-integrity"],
];

const BASH_COMMANDS = [
  ["phase19-lifecycle-syntax", "bash -n scripts/test-phase19-eval-lifecycle.sh scripts/test-eval-cli.sh scripts/test-completion.sh scripts/test-doctor.sh scripts/test-package-install.sh scripts/test-uninstall.sh scripts/verify-docs-parity.sh scripts/verify-no-private-references.sh", "runtime-portability"],
  ["portable-shell", "bash scripts/test-portable-sh.sh", "runtime-portability"],
];

function usage() {
  return `Usage:
  node scripts/verify-phase19-runtime-evidence.mjs --self-test
  node scripts/verify-phase19-runtime-evidence.mjs --capture <evidence-dir> <source-commit>
  node scripts/verify-phase19-runtime-evidence.mjs --verify-only <evidence-dir> <source-commit>\n`;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    env: options.env ?? process.env,
    timeout: options.timeout ?? 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function combined(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function requireSuccess(result, label) {
  if (result.status !== 0) throw new Error(`${label} failed (exit ${String(result.status)}):\n${combined(result)}`);
  return String(result.stdout ?? "").trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sortCanonical(value) {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, child]) => [key, sortCanonical(child)]));
  }
  return value;
}

function canonicalDigest(value) {
  return sha256(Buffer.from(JSON.stringify(sortCanonical(value)), "utf8"));
}

function requireCommit(value) {
  if (!COMMIT.test(value)) throw new Error("source commit must be one lowercase full commit");
  return value;
}

function requireDigest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new Error(`${label} must be one SHA-256 digest`);
  return value;
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER.test(value) || value.length > 128) {
    throw new Error(`${label} must be one bounded identifier`);
  }
  return value;
}

function requireIsoTimestamp(value, label) {
  assert.equal(typeof value, "string", `${label}: timestamp missing`);
  assert.equal(new Date(value).toISOString(), value, `${label}: timestamp is not canonical ISO-8601`);
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

function assertNoSentinels(bytes, label) {
  for (const sentinel of SECRET_SENTINELS) {
    assert.equal(bytes.includes(sentinel), false, `${label}: secret sentinel leaked`);
  }
}

function readOwnedFile(root, relative) {
  const label = safeRelative(relative, "evidence file");
  const path = join(root, label);
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024) throw new Error(`${label}: unsafe evidence file`);
  const bytes = readFileSync(path);
  assertNoSentinels(bytes, label);
  return bytes;
}

function git(repo, args, options = {}) {
  return run("git", ["-C", repo, ...args], options);
}

function resolveCommit(repo, value) {
  requireCommit(value);
  const resolved = requireSuccess(git(repo, ["rev-parse", `${value}^{commit}`]), "resolve source commit");
  if (resolved !== value) throw new Error("supplied source commit does not resolve exactly");
  return resolved;
}

function committedBytes(repo, sourceCommit, path) {
  const result = git(repo, ["show", `${sourceCommit}:${path}`], { timeout: 120_000 });
  if (result.status !== 0) throw new Error(`cannot read committed ${path}`);
  return Buffer.from(result.stdout, "utf8");
}

function committedBinding(repo, sourceCommit) {
  const taskSet = JSON.parse(committedBytes(repo, sourceCommit, "examples/eval/task-set.json").toString("utf8"));
  const binding = JSON.parse(committedBytes(repo, sourceCommit, "examples/eval/bundled-fake.json").toString("utf8"));
  const packageValue = JSON.parse(committedBytes(repo, sourceCommit, "package.json").toString("utf8"));
  const taskSetDigest = canonicalDigest(taskSet);
  assert.deepEqual(Object.keys(binding).sort(), ["identifier", "package_version", "schema_version", "task_set_digest"]);
  assert.equal(binding.schema_version, 1, "bundled binding schema changed");
  assert.equal(binding.identifier, "cairn-offline-fake-v1", "bundled adapter identity changed");
  assert.equal(binding.package_version, packageValue.version, "bundled package version is stale");
  assert.equal(binding.task_set_digest, taskSetDigest, "bundled task-set digest is stale");
  return { taskSet, binding, packageVersion: packageValue.version, taskSetDigest };
}

function committedReportContracts(repo, sourceCommit) {
  const cached = REPORT_CONTRACT_CACHE.get(sourceCommit);
  if (cached) return cached;
  const publishedDocument = JSON.parse(committedBytes(repo, sourceCommit, "schemas/eval-report.schema.json").toString("utf8"));
  const npmCache = requireSuccess(run("npm", ["config", "get", "cache"]), "resolve npm cache for schema oracle");
  if (!existsSync(npmCache)) throw new Error("local npm cache is unavailable for exact-commit schema verification");
  const runtimeDocument = withDetachedWorktree(repo, sourceCommit, (worktree) => {
    const server = join(worktree, "mcp-memory-server");
    const environment = {
      ...process.env,
      NPM_CONFIG_AUDIT: "false",
      NPM_CONFIG_CACHE: npmCache,
      NPM_CONFIG_FUND: "false",
      NPM_CONFIG_OFFLINE: "true",
    };
    requireSuccess(run("npm", ["ci", "--offline", "--ignore-scripts"], {
      cwd: server,
      env: environment,
      timeout: 600_000,
    }), "install exact-commit report contract dependencies");
    requireSuccess(run("npm", ["run", "build"], {
      cwd: server,
      env: environment,
      timeout: 600_000,
    }), "build exact-commit report contract");
    const projection = String.raw`import { z } from "zod";
import { canonicalJson, evalReportSchema } from "./dist/eval-schema.js";
process.stdout.write(canonicalJson(z.toJSONSchema(evalReportSchema, { target: "draft-2020-12", io: "input" })));`;
    const projected = requireSuccess(run(process.execPath, ["--input-type=module", "-e", projection], {
      cwd: server,
      env: environment,
      timeout: 120_000,
    }), "project exact-commit runtime report contract");
    return JSON.parse(projected);
  });
  const value = {
    runtimeDocument,
    publishedDocument,
    digests: [canonicalDigest(runtimeDocument), canonicalDigest(publishedDocument)],
  };
  value.digests.forEach((digest) => requireDigest(digest, "exact-commit report contract digest"));
  REPORT_CONTRACT_CACHE.set(sourceCommit, value);
  return value;
}

function assertCallerSourceClean(repo, sourceCommit) {
  assert.equal(requireSuccess(git(repo, ["rev-parse", "HEAD"]), "read caller HEAD"), sourceCommit, "caller HEAD differs from source commit");
  for (const [label, args] of [
    ["worktree", ["diff", "--quiet", "HEAD", "--", ".", ":(exclude).planning/**"]],
    ["index", ["diff", "--cached", "--quiet", "--", ".", ":(exclude).planning/**"]],
  ]) {
    if (git(repo, args).status !== 0) throw new Error(`caller tracked source ${label} differs from HEAD`);
  }
}

function assertDetachedSourceClean(worktree, sourceCommit) {
  assert.equal(requireSuccess(git(worktree, ["rev-parse", "HEAD"]), "read detached HEAD"), sourceCommit);
  const status = requireSuccess(git(worktree, ["status", "--porcelain", "--untracked-files=no"]), "inspect detached source");
  if (status !== "") throw new Error("detached source has tracked differences");
}

function withDetachedWorktree(repo, sourceCommit, operation) {
  const parent = mkdtempSync(join(tmpdir(), "cairn-phase19-detached-"));
  const worktree = join(parent, "source");
  let added = false;
  try {
    requireSuccess(git(repo, ["worktree", "add", "--detach", worktree, sourceCommit], { timeout: 120_000 }), "create detached source worktree");
    added = true;
    assertDetachedSourceClean(worktree, sourceCommit);
    return operation(worktree);
  } finally {
    if (added) git(repo, ["worktree", "remove", "--force", worktree], { timeout: 120_000 });
    rmSync(parent, { recursive: true, force: true });
  }
}

function findContainerEngine() {
  for (const engine of ["podman", "docker"]) {
    if (run(engine, ["--version"]).status === 0) return engine;
  }
  throw new Error("Podman or Docker is required for Phase 19 runtime evidence");
}

function ensureImage(engine, image) {
  if (run(engine, ["image", "inspect", image], { timeout: 120_000 }).status === 0) return;
  requireSuccess(run(engine, ["pull", image], { timeout: 600_000 }), `pull standard image ${image}`);
}

function shellEvidenceRunner() {
  return `run_evidence() {
  evidence_id="$1"
  evidence_scope="$2"
  evidence_command="$3"
  evidence_output=$(mktemp)
  printf 'EVIDENCE_COMMAND_BEGIN|%s|%s|%s\\n' "$evidence_id" "$evidence_scope" "$evidence_command"
  set +e
  bash -c "$evidence_command" >"$evidence_output" 2>&1
  evidence_status=$?
  set -e
  if [ "$evidence_status" -eq 0 ]; then evidence_result=pass; else evidence_result=fail; fi
  rm -f "$evidence_output"
  printf 'EVIDENCE_COMMAND_END|%s|%s|%s|%s\\n' "$evidence_id" "$evidence_scope" "$evidence_status" "$evidence_result"
  return "$evidence_status"
}
`;
}

function shellCommandRows(commands) {
  return commands.map(([id, command, scope]) => (
    `run_evidence ${JSON.stringify(id)} ${JSON.stringify(scope)} ${JSON.stringify(command)}`
  )).join("\n");
}

function suiteHeader(sourceCommit, runtime, image, versionCommand) {
  return `printf 'evidence_schema_version=2\\n'
printf 'source_commit=${sourceCommit}\\n'
printf 'runtime=${runtime}\\n'
printf 'image=${image}\\n'
printf 'source_tree_clean=true\\n'
printf 'generated_at=%s\\n' "$CAIRN_EVIDENCE_TIMESTAMP"
printf 'runtime_version=%s\\n' "$(${versionCommand})"
printf 'evidence_scope=offline-framework\\n'
`;
}

function nodeSuite(sourceCommit, runtime, image) {
  return `set -eu
mkdir -p /work/source /tmp/npm-logs
cp -a /source/. /work/source/
cd /work/source
export NPM_CONFIG_CACHE=/npm-cache
export NPM_CONFIG_LOGS_DIR=/tmp/npm-logs
export NPM_CONFIG_AUDIT=false
export NPM_CONFIG_FUND=false
export NPM_CONFIG_OFFLINE=true
${suiteHeader(sourceCommit, runtime, image, "node --version")}${shellEvidenceRunner()}${shellCommandRows(NODE_COMMANDS)}
printf 'REPORT_METADATA|'
cat /tmp/cairn-phase19-report-metadata.json
printf '\\nPASS: Phase 19 runtime ${runtime}\\n'`;
}

function bashSuite(sourceCommit) {
  return `set -eu
mkdir -p /work/source
cp -a /source/. /work/source/
cd /work/source
${suiteHeader(sourceCommit, "bash-3.2", BASH_IMAGE, "bash --version | head -n 1")}${shellEvidenceRunner()}${shellCommandRows(BASH_COMMANDS)}
printf 'PASS: Phase 19 runtime bash-3.2\\n'`;
}

function runContainer(engine, image, runtime, worktree, npmCache, generatedAt, sourceCommit) {
  const script = runtime.startsWith("node-")
    ? nodeSuite(sourceCommit, runtime, image)
    : bashSuite(sourceCommit);
  const args = [
    "run",
    "--rm",
    "--network",
    "none",
    "--mount",
    `type=bind,src=${worktree},dst=/source,readonly`,
    "--env",
    `CAIRN_EVIDENCE_TIMESTAMP=${generatedAt}`,
  ];
  if (runtime.startsWith("node-")) args.push("--mount", `type=bind,src=${npmCache},dst=/npm-cache`);
  args.push(image, "bash", "-c", script);
  const result = run(engine, args, { timeout: 1_800_000 });
  return { output: combined(result), status: result.status };
}

function parseCommandRecords(text, file) {
  const records = [];
  let pending = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("EVIDENCE_COMMAND_BEGIN|")) {
      if (pending !== null) throw new Error(`${file}: nested command evidence`);
      const [marker, id, evidenceScope, ...commandParts] = line.split("|");
      const command = commandParts.join("|");
      if (marker !== "EVIDENCE_COMMAND_BEGIN" || !id || !evidenceScope || !command) throw new Error(`${file}: malformed command start`);
      pending = { id, command, evidence_scope: evidenceScope };
    } else if (line.startsWith("EVIDENCE_COMMAND_END|")) {
      const [marker, id, evidenceScope, statusText, result] = line.split("|");
      if (marker !== "EVIDENCE_COMMAND_END" || pending === null) throw new Error(`${file}: unmatched command end`);
      if (id !== pending.id || evidenceScope !== pending.evidence_scope) throw new Error(`${file}: command identity changed`);
      const exitStatus = Number(statusText);
      if (!Number.isSafeInteger(exitStatus) || exitStatus < 0 || !["pass", "fail"].includes(result)) throw new Error(`${file}: malformed command result`);
      records.push({ ...pending, exit_status: exitStatus, result });
      pending = null;
    }
  }
  if (pending !== null) throw new Error(`${file}: command evidence is incomplete`);
  return records;
}

function expectedCommands(runtime) {
  return (runtime.startsWith("node-") ? NODE_COMMANDS : BASH_COMMANDS).map(
    ([id, command, evidence_scope]) => ({ id, command, evidence_scope, exit_status: 0, result: "pass" }),
  );
}

function parseLog(text, expected) {
  const lines = text.split(/\r?\n/);
  const fixed = [
    "evidence_schema_version=2",
    `source_commit=${expected.sourceCommit}`,
    `runtime=${expected.runtime}`,
    `image=${expected.image}`,
    "source_tree_clean=true",
    `generated_at=${expected.generatedAt}`,
  ];
  assert.deepEqual(lines.slice(0, fixed.length), fixed, `${expected.file}: fixed header mismatch`);
  const runtimeLine = lines[6] ?? "";
  const expectedMajor = expected.runtime.startsWith("node-") ? `runtime_version=v${expected.runtime.slice(5)}.` : "runtime_version=GNU bash, version 3.2";
  assert.equal(runtimeLine.startsWith(expectedMajor), true, `${expected.file}: runtime identity mismatch`);
  assert.equal(lines[7], "evidence_scope=offline-framework", `${expected.file}: evidence scope mismatch`);
  assert.equal(text.includes(`PASS: Phase 19 runtime ${expected.runtime}`), true, `${expected.file}: final pass marker missing`);
  const allowed = /^(?:evidence_schema_version=2|source_commit=[0-9a-f]{40}|runtime=(?:node-(?:22|24|26)|bash-3\.2)|image=[A-Za-z0-9][A-Za-z0-9._:/-]*|source_tree_clean=true|generated_at=[0-9TZ:.-]+|runtime_version=(?:v(?:22|24|26)\.[0-9A-Za-z.+-]+|GNU bash, version 3\.2[^\r\n]*)|evidence_scope=offline-framework|EVIDENCE_COMMAND_(?:BEGIN|END)\|.*|REPORT_METADATA\|\{.*\}|PASS: Phase 19 runtime (?:node-(?:22|24|26)|bash-3\.2)|)$/;
  for (const line of lines) assert.equal(allowed.test(line), true, `${expected.file}: unsanitized log line`);
  const commands = parseCommandRecords(text, expected.file);
  assert.deepEqual(commands, expectedCommands(expected.runtime), `${expected.file}: command inventory mismatch`);
  const metadataLines = lines.filter((line) => line.startsWith("REPORT_METADATA|"));
  if (expected.runtime.startsWith("node-")) {
    assert.equal(metadataLines.length, 1, `${expected.file}: report provenance missing`);
    return { runtimeVersion: runtimeLine.slice("runtime_version=".length), commands, metadata: JSON.parse(metadataLines[0].slice("REPORT_METADATA|".length)) };
  }
  assert.equal(metadataLines.length, 0, `${expected.file}: Bash log gained report provenance`);
  return { runtimeVersion: runtimeLine.slice("runtime_version=".length), commands, metadata: null };
}

function verifyReportMetadata(metadata, binding, manifest, expectedSchemaDigests, label) {
  assertNoForbiddenKeys(metadata, label);
  assert.deepEqual(Object.keys(metadata).sort(), [
    "adapter_id", "claim_anchors", "evidence_scope", "missingness_digest", "note_snapshot_digests",
    "observation_count", "package_version", "plan_digest", "report_digest", "report_file_sha256",
    "report_source_commit", "runtime_id", "schedule_digest", "schema_digests", "schema_version", "task_set_digest",
  ]);
  assert.equal(metadata.schema_version, 1);
  assert.equal(metadata.evidence_scope, "offline-framework");
  assert.equal(metadata.adapter_id, binding.binding.identifier);
  assert.equal(metadata.package_version, binding.packageVersion);
  assert.equal(metadata.task_set_digest, binding.taskSetDigest);
  assert.equal(metadata.report_source_commit, binding.taskSetDigest, `${label}: bundled report source identity changed`);
  requireIdentifier(metadata.runtime_id, `${label} runtime ID`);
  requireDigest(metadata.plan_digest, `${label} plan digest`);
  requireDigest(metadata.schedule_digest, `${label} schedule digest`);
  requireDigest(metadata.report_digest, `${label} report digest`);
  requireDigest(metadata.report_file_sha256, `${label} report file digest`);
  requireDigest(metadata.missingness_digest, `${label} missingness digest`);
  assert.equal(Array.isArray(metadata.schema_digests) && metadata.schema_digests.length === 2, true);
  metadata.schema_digests.forEach((value) => requireDigest(value, `${label} schema digest`));
  assert.deepEqual(metadata.schema_digests, expectedSchemaDigests, `${label}: schema digests differ from exact committed contracts`);
  assert.equal(Array.isArray(metadata.note_snapshot_digests), true);
  metadata.note_snapshot_digests.forEach((value) => requireDigest(value, `${label} note snapshot digest`));
  assert.deepEqual(metadata.claim_anchors, [], `${label}: offline evidence authorized a claim`);
  assert.equal(metadata.observation_count, binding.taskSet.tasks.length * 2, `${label}: fake two-pass population mismatch`);
  for (const key of ["plan_digest", "schedule_digest", "report_digest", "missingness_digest"]) {
    assert.equal(metadata[key], manifest[key], `${label}: ${key} differs from manifest`);
  }
  assert.deepEqual(metadata.schema_digests, manifest.schema_digests, `${label}: schema digests differ from manifest`);
  for (const digest of metadata.note_snapshot_digests) {
    assert.equal(manifest.note_snapshot_digests.includes(digest), true, `${label}: note digest is absent from manifest union`);
  }
}

function verifyEvidence(directory, sourceCommit) {
  resolveCommit(ROOT, requireCommit(sourceCommit));
  const root = resolve(directory);
  const manifestPath = join(root, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("evidence manifest is missing");
  const manifestBytes = readOwnedFile(root, "manifest.json");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assertNoForbiddenKeys(manifest);
  assert.deepEqual(Object.keys(manifest).sort(), [
    "ablated_capabilities", "adapter_id", "claim_anchors", "command_inventory", "detached_source", "evidence_scope", "generated_at",
    "logs", "missingness_digest", "note_snapshot_digests", "package_version", "plan_digest", "report_digest",
    "report_source_commit", "schedule_digest", "schema_digests", "schema_version", "source_commit", "source_tree_clean",
    "task_set_digest",
  ]);
  assert.equal(manifest.schema_version, 2);
  assert.equal(manifest.source_commit, sourceCommit, "stale source commit");
  assert.equal(manifest.source_tree_clean, true);
  assert.equal(manifest.detached_source, true);
  requireIsoTimestamp(manifest.generated_at, "manifest");
  assert.equal(manifest.evidence_scope, "offline-framework");
  assert.equal(manifest.adapter_id, "cairn-offline-fake-v1");
  assert.deepEqual(manifest.ablated_capabilities, CAPABILITIES, "all eight capability ablations are not bound");
  assert.deepEqual(manifest.claim_anchors, [], "offline evidence authorized a product claim");
  const binding = committedBinding(ROOT, sourceCommit);
  const reportContracts = committedReportContracts(ROOT, sourceCommit);
  assert.equal(manifest.package_version, binding.packageVersion, "manifest package version is stale");
  assert.equal(manifest.task_set_digest, binding.taskSetDigest, "manifest task-set digest differs from committed canonical artifact");
  assert.equal(manifest.report_source_commit, binding.taskSetDigest, "manifest report source identity changed");
  for (const key of ["plan_digest", "schedule_digest", "report_digest", "missingness_digest"]) requireDigest(manifest[key], `manifest ${key}`);
  assert.equal(Array.isArray(manifest.schema_digests) && manifest.schema_digests.length === 2, true);
  manifest.schema_digests.forEach((value) => requireDigest(value, "manifest schema digest"));
  assert.deepEqual(manifest.schema_digests, reportContracts.digests,
    "manifest schema digests differ from the exact committed report contracts");
  assert.equal(Array.isArray(manifest.note_snapshot_digests), true);
  manifest.note_snapshot_digests.forEach((value) => requireDigest(value, "manifest note snapshot digest"));
  assert.deepEqual(manifest.logs?.map(({ file }) => file), EXPECTED_LOGS, "manifest log names mismatch");
  const flattened = [];
  let stableMetadata = null;
  const runtimeNoteDigests = new Set();
  for (const row of manifest.logs) {
    assert.deepEqual(Object.keys(row).sort(), [
      "commands", "file", "generated_at", "image", "report_file_sha256", "result", "runtime", "runtime_version",
      "sha256", "source_commit", "source_tree_clean",
    ]);
    const runtime = row.file === "bash-3.2.log" ? "bash-3.2" : row.file.replace(/\.log$/, "");
    assert.equal(row.runtime, runtime, `${row.file}: runtime mismatch`);
    assert.equal(row.source_commit, sourceCommit, `${row.file}: mixed source commit`);
    assert.equal(row.source_tree_clean, true);
    assert.equal(row.generated_at, manifest.generated_at);
    assert.equal(row.result, "pass");
    const image = runtime === "bash-3.2" ? BASH_IMAGE : NODE_IMAGES.get(runtime);
    assert.equal(row.image, image, `${row.file}: image mismatch`);
    const bytes = readOwnedFile(root, row.file);
    requireDigest(row.sha256, `${row.file} hash`);
    assert.equal(sha256(bytes), row.sha256, `${row.file}: stale log hash`);
    const parsed = parseLog(bytes.toString("utf8"), {
      file: row.file,
      runtime,
      image,
      sourceCommit,
      generatedAt: manifest.generated_at,
    });
    assert.equal(row.runtime_version, parsed.runtimeVersion, `${row.file}: runtime version differs from log`);
    assert.deepEqual(row.commands, parsed.commands, `${row.file}: commands differ from log`);
    flattened.push(...row.commands.map((command) => ({ runtime, ...command })));
    if (parsed.metadata) {
      verifyReportMetadata(parsed.metadata, binding, manifest, reportContracts.digests, row.file);
      requireDigest(row.report_file_sha256, `${row.file} report file digest`);
      assert.equal(row.report_file_sha256, parsed.metadata.report_file_sha256, `${row.file}: report file digest differs from log`);
      const stable = { ...parsed.metadata };
      delete stable.report_file_sha256;
      delete stable.note_snapshot_digests;
      parsed.metadata.note_snapshot_digests.forEach((digest) => runtimeNoteDigests.add(digest));
      if (stableMetadata === null) stableMetadata = stable;
      else assert.deepEqual(stable, stableMetadata, `${row.file}: report provenance differs across Node runtimes`);
    } else {
      assert.equal(row.report_file_sha256, null, `${row.file}: Bash row must not claim report bytes`);
    }
  }
  assert.deepEqual(manifest.command_inventory, flattened, "manifest command inventory differs from logs");
  assert.deepEqual(manifest.note_snapshot_digests, [...runtimeNoteDigests].sort(), "manifest note digest union differs from runtime logs");
  assert.notEqual(stableMetadata, null, "manifest has no executed report provenance");
  return manifest;
}

function fixtureMetadata(binding, schemaDigests) {
  return {
    schema_version: 1,
    evidence_scope: "offline-framework",
    adapter_id: binding.binding.identifier,
    package_version: binding.packageVersion,
    task_set_digest: binding.taskSetDigest,
    plan_digest: "1".repeat(64),
    schedule_digest: "2".repeat(64),
    report_digest: "3".repeat(64),
    report_file_sha256: "4".repeat(64),
    report_source_commit: binding.taskSetDigest,
    runtime_id: "node-local",
    schema_digests: [...schemaDigests],
    note_snapshot_digests: ["6".repeat(64)],
    missingness_digest: "7".repeat(64),
    claim_anchors: [],
    observation_count: binding.taskSet.tasks.length * 2,
  };
}

function fixtureLog(commit, runtime, image, generatedAt, metadata) {
  const version = runtime.startsWith("node-") ? `v${runtime.slice(5)}.0.0` : "GNU bash, version 3.2.57(1)-release";
  const records = expectedCommands(runtime).flatMap(({ id, command, evidence_scope }) => [
    `EVIDENCE_COMMAND_BEGIN|${id}|${evidence_scope}|${command}`,
    `EVIDENCE_COMMAND_END|${id}|${evidence_scope}|0|pass`,
  ]);
  return [
    "evidence_schema_version=2",
    `source_commit=${commit}`,
    `runtime=${runtime}`,
    `image=${image}`,
    "source_tree_clean=true",
    `generated_at=${generatedAt}`,
    `runtime_version=${version}`,
    "evidence_scope=offline-framework",
    ...records,
    ...(metadata ? [`REPORT_METADATA|${JSON.stringify(metadata)}`] : []),
    `PASS: Phase 19 runtime ${runtime}`,
    "",
  ].join("\n");
}

function writeFixture(directory, commit, overrides = {}) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const binding = committedBinding(ROOT, commit);
  const metadata = fixtureMetadata(binding, committedReportContracts(ROOT, commit).digests);
  const generatedAt = "2026-07-28T00:00:00.000Z";
  const logs = [];
  for (const [runtime, image] of [...NODE_IMAGES, ["bash-3.2", BASH_IMAGE]]) {
    const file = `${runtime}.log`;
    const reportMetadata = runtime.startsWith("node-") ? metadata : null;
    const text = fixtureLog(commit, runtime, image, generatedAt, reportMetadata);
    writeFileSync(join(directory, file), text, { mode: 0o600 });
    logs.push({
      file,
      runtime,
      image,
      source_commit: commit,
      source_tree_clean: true,
      generated_at: generatedAt,
      runtime_version: runtime.startsWith("node-") ? `v${runtime.slice(5)}.0.0` : "GNU bash, version 3.2.57(1)-release",
      sha256: sha256(text),
      report_file_sha256: reportMetadata?.report_file_sha256 ?? null,
      result: "pass",
      commands: expectedCommands(runtime),
    });
  }
  const manifest = {
    schema_version: 2,
    source_commit: commit,
    source_tree_clean: true,
    detached_source: true,
    generated_at: generatedAt,
    evidence_scope: "offline-framework",
    ablated_capabilities: CAPABILITIES,
    adapter_id: binding.binding.identifier,
    package_version: binding.packageVersion,
    task_set_digest: binding.taskSetDigest,
    plan_digest: metadata.plan_digest,
    schedule_digest: metadata.schedule_digest,
    report_digest: metadata.report_digest,
    report_source_commit: metadata.report_source_commit,
    schema_digests: metadata.schema_digests,
    note_snapshot_digests: metadata.note_snapshot_digests,
    missingness_digest: metadata.missingness_digest,
    claim_anchors: [],
    logs,
    command_inventory: logs.flatMap(({ runtime: label, commands }) => commands.map((command) => ({ runtime: label, ...command }))),
    ...overrides,
  };
  writeFileSync(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}

function mutateManifest(directory, mutation) {
  const path = join(directory, "manifest.json");
  const value = JSON.parse(readFileSync(path, "utf8"));
  mutation(value);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function forgeSchemaBinding(directory, schemaDigests) {
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.schema_digests = schemaDigests;
  for (const row of manifest.logs) {
    if (!row.runtime.startsWith("node-")) continue;
    const logPath = join(directory, row.file);
    const lines = readFileSync(logPath, "utf8").split(/\r?\n/).map((line) => {
      if (!line.startsWith("REPORT_METADATA|")) return line;
      const metadata = JSON.parse(line.slice("REPORT_METADATA|".length));
      metadata.schema_digests = schemaDigests;
      return `REPORT_METADATA|${JSON.stringify(metadata)}`;
    });
    const text = lines.join("\n");
    writeFileSync(logPath, text);
    row.sha256 = sha256(text);
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function expectFailure(label, operation) {
  assert.throws(operation, undefined, label);
}

function selfTest() {
  const sourceCommit = requireSuccess(git(ROOT, ["rev-parse", "HEAD"]), "read self-test source commit");
  requireCommit(sourceCommit);
  const reportContracts = committedReportContracts(ROOT, sourceCommit);
  const reorderedRuntime = Object.fromEntries(Object.entries(reportContracts.runtimeDocument).reverse());
  assert.equal(canonicalDigest(reorderedRuntime), reportContracts.digests[0],
    "runtime contract digest changed under object-key reordering");
  const mutatedRuntime = structuredClone(reportContracts.runtimeDocument);
  const deleteConditionLevels = (value) => {
    if (!value || typeof value !== "object") return false;
    if (Object.prototype.hasOwnProperty.call(value, "condition_levels")) {
      delete value.condition_levels;
      return true;
    }
    return Object.values(value).some(deleteConditionLevels);
  };
  assert.equal(deleteConditionLevels(mutatedRuntime), true, "runtime report contract lacks condition-level semantics");
  assert.notEqual(canonicalDigest(mutatedRuntime), reportContracts.digests[0],
    "runtime contract mutation did not change its digest");
  const mutatedPublished = structuredClone(reportContracts.publishedDocument);
  delete mutatedPublished.$defs.aggregate.properties.condition_levels;
  assert.notEqual(canonicalDigest(mutatedPublished), reportContracts.digests[1],
    "published contract mutation did not change its digest");
  const root = mkdtempSync(join(tmpdir(), "cairn-phase19-evidence-"));
  try {
    const valid = join(root, "valid");
    writeFixture(valid, sourceCommit);
    verifyEvidence(valid, sourceCommit);

    const cases = [
      ["stale-source", (dir) => mutateManifest(dir, (value) => { value.source_commit = "b".repeat(40); })],
      ["stale-task", (dir) => mutateManifest(dir, (value) => { value.task_set_digest = "b".repeat(64); })],
      ["stale-plan", (dir) => mutateManifest(dir, (value) => { value.plan_digest = "c".repeat(64); })],
      ["stale-report", (dir) => mutateManifest(dir, (value) => { value.report_digest = "d".repeat(64); })],
      ["stale-note", (dir) => mutateManifest(dir, (value) => { value.note_snapshot_digests = ["e".repeat(64)]; })],
      ["hidden-missingness", (dir) => mutateManifest(dir, (value) => { value.missingness_digest = "f".repeat(64); })],
      ["fake-live", (dir) => mutateManifest(dir, (value) => { value.evidence_scope = "live-evaluation"; })],
      ["fake-claim", (dir) => mutateManifest(dir, (value) => { value.claim_anchors = ["claims/quality"]; })],
      ["forbidden-field", (dir) => mutateManifest(dir, (value) => { value.environment = { TOKEN: "redacted" }; })],
      ["missing-command", (dir) => mutateManifest(dir, (value) => { value.logs[0].commands.pop(); })],
      ["wrong-runtime", (dir) => mutateManifest(dir, (value) => { value.logs[0].runtime_version = "v24.0.0"; })],
    ];
    for (const [label, mutation] of cases) {
      const directory = join(root, label);
      writeFixture(directory, sourceCommit);
      mutation(directory);
      expectFailure(label, () => verifyEvidence(directory, sourceCommit));
    }

    const secret = join(root, "secret-bytes");
    const secretManifest = writeFixture(secret, sourceCommit);
    writeFileSync(join(secret, "node-22.log"), SECRET_SENTINELS[0]);
    mutateManifest(secret, (value) => { value.logs[0].sha256 = sha256(SECRET_SENTINELS[0]); });
    assert.equal(secretManifest.logs.length, 4);
    expectFailure("secret bytes", () => verifyEvidence(secret, sourceCommit));

    const staleLog = join(root, "stale-log");
    writeFixture(staleLog, sourceCommit);
    writeFileSync(join(staleLog, "node-24.log"), `${readFileSync(join(staleLog, "node-24.log"), "utf8")}tampered\n`);
    expectFailure("stale log", () => verifyEvidence(staleLog, sourceCommit));

    const formerLabelDigest = canonicalDigest({ schema_version: 1, contract: "eval-report" });
    const schemaForgeries = [
      ["coherent-schema-forgery", ["8".repeat(64), "9".repeat(64)]],
      ["swapped-schema-digests", [...reportContracts.digests].reverse()],
      ["missing-schema-digest", reportContracts.digests.slice(0, 1)],
      ["stale-label-schema-digest", [formerLabelDigest, reportContracts.digests[1]]],
    ];
    for (const [label, forgedDigests] of schemaForgeries) {
      const directory = join(root, label);
      writeFixture(directory, sourceCommit);
      forgeSchemaBinding(directory, forgedDigests);
      expectFailure(label, () => verifyEvidence(directory, sourceCommit));
    }

    process.stdout.write("PASS: Phase 19 runtime-evidence capture and integrity self-test\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function capture(directory, sourceCommit) {
  const expectedDirectory = resolve(ROOT, EVIDENCE_RELATIVE);
  if (resolve(directory) !== expectedDirectory) throw new Error(`capture output must be ${EVIDENCE_RELATIVE}`);
  resolveCommit(ROOT, sourceCommit);
  assertCallerSourceClean(ROOT, sourceCommit);
  const binding = committedBinding(ROOT, sourceCommit);
  const npmCache = requireSuccess(run("npm", ["config", "get", "cache"]), "resolve npm cache");
  if (!existsSync(npmCache)) throw new Error("local npm cache is unavailable for offline container installs");
  const engine = findContainerEngine();
  for (const image of [...NODE_IMAGES.values(), BASH_IMAGE]) ensureImage(engine, image);

  mkdirSync(dirname(expectedDirectory), { recursive: true, mode: 0o700 });
  const staging = mkdtempSync(join(dirname(expectedDirectory), ".runtime-evidence-staging-"));
  const generatedAt = new Date().toISOString();
  try {
    const logs = withDetachedWorktree(ROOT, sourceCommit, (worktree) => {
      const bundle = join(worktree, ".cairn-runtime-evidence.bundle");
      requireSuccess(git(worktree, ["bundle", "create", bundle, "HEAD"], { timeout: 120_000 }), "create portable evidence history");
      const rows = [];
      for (const [runtime, image] of [...NODE_IMAGES, ["bash-3.2", BASH_IMAGE]]) {
        assertDetachedSourceClean(worktree, sourceCommit);
        const result = runContainer(engine, image, runtime, worktree, npmCache, generatedAt, sourceCommit);
        assertDetachedSourceClean(worktree, sourceCommit);
        const file = `${runtime}.log`;
        const text = result.output.trimEnd().concat("\n");
        writeFileSync(join(staging, file), text, { mode: 0o600 });
        if (result.status !== 0) throw new Error(`${runtime} container failed (exit ${String(result.status)}); sanitized log retained in staging during this process`);
        const parsed = parseLog(text, { file, runtime, image, sourceCommit, generatedAt });
        rows.push({
          file,
          runtime,
          image,
          source_commit: sourceCommit,
          source_tree_clean: true,
          generated_at: generatedAt,
          runtime_version: parsed.runtimeVersion,
          sha256: sha256(text),
          report_file_sha256: parsed.metadata?.report_file_sha256 ?? null,
          result: "pass",
          commands: parsed.commands,
          metadata: parsed.metadata,
        });
      }
      return rows;
    });
    const reference = logs.find(({ metadata }) => metadata)?.metadata;
    if (!reference) throw new Error("Node runtimes produced no report provenance");
    const manifestLogs = logs.map(({ metadata: _metadata, ...row }) => row);
    const manifest = {
      schema_version: 2,
      source_commit: sourceCommit,
      source_tree_clean: true,
      detached_source: true,
      generated_at: generatedAt,
      evidence_scope: "offline-framework",
      ablated_capabilities: CAPABILITIES,
      adapter_id: binding.binding.identifier,
      package_version: binding.packageVersion,
      task_set_digest: binding.taskSetDigest,
      plan_digest: reference.plan_digest,
      schedule_digest: reference.schedule_digest,
      report_digest: reference.report_digest,
      report_source_commit: reference.report_source_commit,
      schema_digests: reference.schema_digests,
      note_snapshot_digests: [...new Set(logs.flatMap(({ metadata }) => metadata?.note_snapshot_digests ?? []))].sort(),
      missingness_digest: reference.missingness_digest,
      claim_anchors: [],
      logs: manifestLogs,
      command_inventory: manifestLogs.flatMap(({ runtime, commands }) => commands.map((command) => ({ runtime, ...command }))),
    };
    writeFileSync(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    verifyEvidence(staging, sourceCommit);
    mkdirSync(expectedDirectory, { recursive: true, mode: 0o700 });
    for (const file of [...EXPECTED_LOGS, "manifest.json"]) renameSync(join(staging, file), join(expectedDirectory, file));
    verifyEvidence(expectedDirectory, sourceCommit);
    process.stdout.write(`PASS: Phase 19 runtime evidence captured for ${sourceCommit}\n`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
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
