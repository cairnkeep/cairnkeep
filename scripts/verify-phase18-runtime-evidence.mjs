#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EVIDENCE_RELATIVE = join(
  ".planning",
  "phases",
  "18-typed-capability-contract",
  "runtime-evidence",
);
const EXPECTED_LOGS = ["node-22.log", "node-24.log", "node-26.log", "bash-3.2.log"];
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const NODE_IMAGES = new Map([
  ["node-22", "node:22-bookworm"],
  ["node-24", "node:24-bookworm"],
  ["node-26", "node:26-bookworm"],
]);
const BASH_IMAGE = "docker.io/library/bash:3.2";
const CANONICAL_CAPABILITIES = [
  "memory.write",
  "memory.search",
  "notes.distill",
  "wiki",
  "graph",
  "security.audit",
  "route.check",
  "context.explore",
];
const PUBLIC_OPERATIONS = new Map([
  ["memory.write", "memory_write"],
  ["memory.search", "memory_search"],
  ["notes.distill", "cairn note distill"],
  ["wiki", "wiki-query"],
  ["graph", "graphify"],
  ["security.audit", "security-audit"],
  ["route.check", "route_check"],
  ["context.explore", "context_explore"],
]);
const DUAL_HARNESS_OWNERS = new Set(["wiki", "graph", "security.audit"]);
const NODE_COMMANDS = [
  ["node-version", "node --version", "runtime-identity"],
  [
    "fixture-git-init",
    "rm -f .git && git init -q && git config user.name 'Runtime Evidence' && git config user.email 'runtime-evidence@example.invalid' && git add -A && git commit -qm runtime-evidence-fixture",
    "runtime-setup",
  ],
  ["root-install", "npm ci --offline", "runtime-setup"],
  ["server-install", "npm --prefix mcp-memory-server ci --offline", "runtime-setup"],
  ["server-build", "npm --prefix mcp-memory-server run build", "core-lifecycle"],
  ["server-test", "npm --prefix mcp-memory-server test", "core-lifecycle"],
  ["capability-lifecycle", "bash scripts/test-phase18-capability-lifecycle.sh full", "core-lifecycle"],
  ["native-boundary", "bash scripts/test-phase18-capability-lifecycle.sh native-boundary", "native-boundary"],
  ["claude-native", "bash scripts/test-phase18-harness-boundary.sh claude-hooks", "claude-native"],
  ["opencode-native", "bash scripts/test-phase18-harness-boundary.sh opencode-plugin", "opencode-native"],
  ["opencode-overlay", "bash scripts/test-phase18-harness-boundary.sh opencode-sync-modes", "install-lifecycle"],
  ["launcher-overlay", "bash scripts/test-launcher-hooks.sh opencode-all-sync-modes", "install-lifecycle"],
  ["package-install", "bash scripts/test-package-install.sh", "install-lifecycle"],
  ["uninstall", "bash scripts/test-uninstall.sh", "install-lifecycle"],
  ["docs-parity", "bash scripts/verify-docs-parity.sh", "documentation-parity"],
];
const BASH_COMMANDS = [
  ["bash-version", "bash --version", "runtime-identity"],
  [
    "bash-syntax",
    "bash -n scripts/test-phase18-capability-lifecycle.sh scripts/test-phase18-harness-boundary.sh templates/start-claude.sh.template templates/start-opencode.sh.template",
    "runtime-portability",
  ],
  ["portable-shell", "bash scripts/test-portable-sh.sh", "runtime-portability"],
];
const SUPPORTED_EVIDENCE_SCOPES = new Set([
  "runtime-identity",
  "runtime-setup",
  "runtime-portability",
  "core-lifecycle",
  "native-boundary",
  "claude-native",
  "opencode-native",
  "install-lifecycle",
  "documentation-parity",
]);

function usage() {
  return `Usage:
  node scripts/verify-phase18-runtime-evidence.mjs
  node scripts/verify-phase18-runtime-evidence.mjs --self-test
  node scripts/verify-phase18-runtime-evidence.mjs --capture <evidence-dir> <source-commit>
  node scripts/verify-phase18-runtime-evidence.mjs --verify-only <evidence-dir> <source-commit>
  node scripts/verify-phase18-runtime-evidence.mjs --live-matrix <matrix-path>\n`;
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd ?? SCRIPT_ROOT,
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
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${String(result.status)}):\n${combined(result)}`);
  }
  return String(result.stdout ?? "").trim();
}

function requireCommit(value, label = "source commit") {
  if (!COMMIT_PATTERN.test(value)) throw new Error(`${label} must be one lowercase 40-hex commit.`);
  return value;
}

function git(repo, args, options = {}) {
  return run("git", ["-C", repo, ...args], options);
}

function resolveCommit(repo, value) {
  requireCommit(value);
  const resolved = requireSuccess(git(repo, ["rev-parse", `${value}^{commit}`]), "resolve source commit");
  if (resolved !== value) throw new Error("The supplied source commit does not resolve exactly.");
  return resolved;
}

function assertCallerSourceClean(repo, sourceCommit) {
  const head = requireSuccess(git(repo, ["rev-parse", "HEAD"]), "read caller HEAD");
  if (head !== sourceCommit) throw new Error("Caller HEAD does not match the supplied source commit.");
  for (const [label, args] of [
    ["worktree", ["diff", "--quiet", "HEAD", "--", ".", ":(exclude).planning/**"]],
    ["index", ["diff", "--cached", "--quiet", "--", ".", ":(exclude).planning/**"]],
  ]) {
    const result = git(repo, args);
    if (result.status !== 0) throw new Error(`Caller tracked source ${label} differs from HEAD.`);
  }
}

function assertDetachedSourceClean(worktree, sourceCommit) {
  const head = requireSuccess(git(worktree, ["rev-parse", "HEAD"]), "read detached HEAD");
  if (head !== sourceCommit) throw new Error("Detached source commit does not match the requested commit.");
  const status = requireSuccess(
    git(worktree, ["status", "--porcelain", "--untracked-files=no"]),
    "inspect detached tracked source",
  );
  if (status !== "") throw new Error("Detached source has tracked differences.");
  if (git(worktree, ["diff", "--quiet", "HEAD", "--", "."]).status !== 0
    || git(worktree, ["diff", "--cached", "--quiet", "--", "."]).status !== 0) {
    throw new Error("Detached source worktree or index differs from HEAD.");
  }
}

function withDetachedWorktree(repo, sourceCommit, operation) {
  const parent = mkdtempSync(join(tmpdir(), "cairn-phase18-detached-"));
  const worktree = join(parent, "source");
  let added = false;
  try {
    requireSuccess(
      git(repo, ["worktree", "add", "--detach", worktree, sourceCommit], { timeout: 120_000 }),
      "create detached source worktree",
    );
    added = true;
    assertDetachedSourceClean(worktree, sourceCommit);
    return operation(worktree);
  } finally {
    if (added) git(repo, ["worktree", "remove", "--force", worktree], { timeout: 120_000 });
    rmSync(parent, { recursive: true, force: true });
  }
}

function findContainerEngine() {
  for (const engine of ["docker", "podman"]) {
    if (run(engine, ["--version"]).status === 0) return engine;
  }
  throw new Error("Docker or Podman is required for Phase 18 runtime evidence.");
}

function ensureImage(engine, image) {
  if (run(engine, ["image", "inspect", image], { timeout: 120_000 }).status === 0) return;
  requireSuccess(run(engine, ["pull", image], { timeout: 600_000 }), `pull standard image ${image}`);
}

function renderCommand(command, args) {
  return [command, ...args].map((value) => JSON.stringify(String(value))).join(" ");
}

function shellEvidenceRunner() {
  return `run_evidence() {
  evidence_id="$1"
  evidence_scope="$2"
  evidence_command="$3"
  printf 'EVIDENCE_COMMAND_BEGIN|%s|%s|%s\\n' "$evidence_id" "$evidence_scope" "$evidence_command"
  set +e
  bash -c "$evidence_command"
  evidence_status=$?
  set -e
  if [ "$evidence_status" -eq 0 ]; then evidence_result=pass; else evidence_result=fail; fi
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

function suiteHeader(runtime, versionCommand) {
  return `printf 'generated_at=%s\\n' "$CAIRN_EVIDENCE_TIMESTAMP"
printf 'runtime_version=%s\\n' "$(${versionCommand})"
printf 'fixture_claude_version=%s\\n' "$CAIRN_CLAUDE_FIXTURE_VERSION"
printf 'fixture_opencode_version=%s\\n' "$CAIRN_OPENCODE_FIXTURE_VERSION"
printf 'acceptance=blocked-pending-live-matrix\\n'
printf 'evidence_scope=deterministic-native-lifecycle\\n'
`;
}

function nodeSuite(runtime) {
  return `set -eu
exec 2>&1
mkdir -p /work/source /tmp/npm-logs
cp -a /source/. /work/source/
cd /work/source
export NPM_CONFIG_CACHE=/npm-cache
export NPM_CONFIG_LOGS_DIR=/tmp/npm-logs
export NPM_CONFIG_OFFLINE=true
export NPM_CONFIG_AUDIT=false
export NPM_CONFIG_FUND=false
${suiteHeader(runtime, "node --version")}${shellEvidenceRunner()}${shellCommandRows(NODE_COMMANDS)}
printf 'PASS: Phase 18 runtime ${runtime}\\n'`;
}

function bashSuite() {
  return `set -eu
exec 2>&1
mkdir -p /work/source
cp -a /source/. /work/source/
cd /work/source
${suiteHeader("bash-3.2", "bash --version | head -n 1")}${shellEvidenceRunner()}${shellCommandRows(BASH_COMMANDS)}
printf 'PASS: Phase 18 runtime bash-3.2\\n'`;
}

function runContainer(engine, image, runtime, worktree, npmCache, generatedAt, fixtureVersions) {
  const script = runtime.startsWith("node-") ? nodeSuite(runtime) : bashSuite();
  const args = ["run", "--rm", "--network", "none", "--mount",
    `type=bind,src=${worktree},dst=/source,readonly`,
    "--env", `CAIRN_EVIDENCE_TIMESTAMP=${generatedAt}`,
    "--env", `CAIRN_CLAUDE_FIXTURE_VERSION=${fixtureVersions.claude}`,
    "--env", `CAIRN_OPENCODE_FIXTURE_VERSION=${fixtureVersions.opencode}`];
  if (runtime.startsWith("node-")) {
    args.push("--mount", `type=bind,src=${npmCache},dst=/npm-cache`);
  }
  args.push(image, "bash", "-c", script);
  const command = renderCommand(engine, args);
  const result = run(engine, args, { timeout: 900_000 });
  return { command, output: combined(result), status: result.status };
}

function logHeader(sourceCommit, runtime, image, command) {
  return [
    "evidence_schema_version=2",
    `source_commit=${sourceCommit}`,
    `runtime=${runtime}`,
    `container_image=${image}`,
    `container_command=${command}`,
    "source_tree_clean=true",
  ].join("\n");
}

function requireLog(text, expected) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "evidence_schema_version=2") throw new Error(`${expected.file}: wrong log schema version.`);
  if (lines[1] !== `source_commit=${expected.commit}`) throw new Error(`${expected.file}: wrong source commit header.`);
  if (lines[2] !== `runtime=${expected.runtime}`) throw new Error(`${expected.file}: wrong runtime label.`);
  if (lines[3] !== `container_image=${expected.image}`) throw new Error(`${expected.file}: wrong container image.`);
  if (lines[4] !== `container_command=${expected.command}` || !lines[4].includes(expected.image)) {
    throw new Error(`${expected.file}: missing exact container command.`);
  }
  if (lines[5] !== "source_tree_clean=true") throw new Error(`${expected.file}: detached source was not recorded clean.`);
  const expectedMajor = expected.runtime.startsWith("node-") ? `v${expected.runtime.slice(5)}.` : "GNU bash, version 3.2";
  for (const marker of [
    `generated_at=${expected.generatedAt}`,
    `runtime_version=${expectedMajor}`,
    "fixture_claude_version=2.1.220",
    "fixture_opencode_version=1.17.20",
    "acceptance=blocked-pending-live-matrix",
    "evidence_scope=deterministic-native-lifecycle",
    `PASS: Phase 18 runtime ${expected.runtime}`,
  ]) {
    if (!text.includes(marker)) throw new Error(`${expected.file}: missing ${marker}.`);
  }
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function parseCommandRecords(text, file) {
  const records = [];
  let pending = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("EVIDENCE_COMMAND_BEGIN|")) {
      if (pending !== null) throw new Error(`${file}: nested command evidence.`);
      const [marker, id, evidenceScope, ...commandParts] = line.split("|");
      const command = commandParts.join("|");
      if (marker !== "EVIDENCE_COMMAND_BEGIN" || !id || !evidenceScope || !command) {
        throw new Error(`${file}: malformed command start record.`);
      }
      pending = { id, command, evidence_scope: evidenceScope };
    } else if (line.startsWith("EVIDENCE_COMMAND_END|")) {
      const [marker, id, evidenceScope, statusText, result] = line.split("|");
      if (marker !== "EVIDENCE_COMMAND_END" || pending === null) {
        throw new Error(`${file}: command end has no matching start.`);
      }
      if (id !== pending.id || evidenceScope !== pending.evidence_scope) {
        throw new Error(`${file}: command evidence identity changed during execution.`);
      }
      const exitStatus = Number(statusText);
      if (!Number.isSafeInteger(exitStatus) || exitStatus < 0 || !["pass", "fail"].includes(result)) {
        throw new Error(`${file}: malformed command result record.`);
      }
      records.push({ ...pending, exit_status: exitStatus, result });
      pending = null;
    }
  }
  if (pending !== null) throw new Error(`${file}: command evidence is missing its exit record.`);
  return records;
}

function expectedCommands(runtime) {
  return (runtime.startsWith("node-") ? NODE_COMMANDS : BASH_COMMANDS).map(
    ([id, command, evidence_scope]) => ({ id, command, evidence_scope, exit_status: 0, result: "pass" }),
  );
}

function requireIsoTimestamp(value, label) {
  assert.equal(typeof value, "string", `${label}: timestamp missing`);
  assert.equal(new Date(value).toISOString(), value, `${label}: timestamp is not canonical ISO-8601`);
}

function verifyEvidence(evidenceDirectory, sourceCommit) {
  requireCommit(sourceCommit);
  const manifestPath = join(evidenceDirectory, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("Evidence manifest is missing.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.schema_version, 2, "manifest schema version mismatch");
  assert.equal(manifest.source_commit, sourceCommit, "manifest source commit mismatch");
  assert.equal(manifest.source_tree_clean, true, "manifest detached source is not clean");
  assert.equal(manifest.detached_source, true, "manifest did not record detached source");
  requireIsoTimestamp(manifest.generated_at, "manifest");
  assert.equal(manifest.evidence_scope, "deterministic-native-lifecycle", "manifest evidence scope mismatch");
  assert.deepEqual(manifest.acceptance, {
    status: "blocked-pending-live-matrix",
    accepted: false,
    required_cells: 56,
  }, "deterministic evidence cannot claim Phase 18 acceptance");
  assert.deepEqual(manifest.logs?.map(({ file }) => file), EXPECTED_LOGS, "manifest log names mismatch");
  assert.equal(manifest.logs.length, EXPECTED_LOGS.length, "manifest log count mismatch");

  for (const row of manifest.logs) {
    const expectedRuntime = row.file === "bash-3.2.log" ? "bash-3.2" : row.file.replace(/\.log$/, "");
    assert.equal(row.runtime, expectedRuntime, `${row.file}: manifest runtime mismatch`);
    assert.equal(row.source_commit, sourceCommit, `${row.file}: manifest mixed source commit`);
    assert.equal(row.source_tree_clean, true, `${row.file}: manifest source not clean`);
    assert.equal(typeof row.container_command, "string", `${row.file}: manifest command missing`);
    const expectedImage = row.runtime === "bash-3.2" ? BASH_IMAGE : NODE_IMAGES.get(row.runtime);
    assert.equal(row.image, expectedImage, `${row.file}: manifest image mismatch`);
    assert.equal(row.result, "pass", `${row.file}: runtime result is not passing`);
    requireIsoTimestamp(row.generated_at, row.file);
    assert.equal(row.generated_at, manifest.generated_at, `${row.file}: timestamp differs from manifest`);
    const logPath = join(evidenceDirectory, row.file);
    if (!existsSync(logPath)) throw new Error(`${row.file}: runtime log is missing.`);
    const text = readFileSync(logPath, "utf8");
    assert.match(row.sha256, /^[0-9a-f]{64}$/, `${row.file}: SHA-256 is missing`);
    assert.equal(sha256(text), row.sha256, `${row.file}: stale log hash`);
    requireLog(text, {
      file: row.file,
      runtime: row.runtime,
      image: expectedImage,
      commit: sourceCommit,
      generatedAt: row.generated_at,
      command: row.container_command,
    });
    const records = parseCommandRecords(text, row.file);
    assert.deepEqual(records, expectedCommands(row.runtime), `${row.file}: required command inventory mismatch`);
    assert.deepEqual(row.commands, records, `${row.file}: manifest command records differ from log`);
    for (const command of row.commands) {
      assert.equal(SUPPORTED_EVIDENCE_SCOPES.has(command.evidence_scope), true,
        `${row.file}: unsupported evidence scope ${command.evidence_scope}`);
      assert.equal(command.exit_status, 0, `${row.file}: ${command.id} failed`);
      assert.equal(command.result, "pass", `${row.file}: ${command.id} did not pass`);
    }
  }
  return manifest;
}

function requireObservation(value, label) {
  assert.equal(value !== null && typeof value === "object" && !Array.isArray(value), true,
    `${label}: observation must be an object`);
  assert.equal(typeof value.result, "string", `${label}: result is missing`);
  assert.equal(value.result.length > 0, true, `${label}: result is empty`);
  assert.equal(value.error === null || typeof value.error === "string", true, `${label}: error is invalid`);
  assert.equal(typeof value.timeout, "boolean", `${label}: timeout is missing`);
  assert.equal(typeof value.trace, "string", `${label}: trace is missing`);
  assert.equal(value.trace.length > 0, true, `${label}: trace is empty`);
  assert.equal(typeof value.delegate_identity, "string", `${label}: delegate identity is missing`);
  assert.equal(value.delegate_identity.length > 0, true, `${label}: delegate identity is empty`);
}

function validateLiveMatrix(matrixPath) {
  if (!existsSync(matrixPath)) throw new Error("Live matrix file is missing.");
  const matrix = JSON.parse(readFileSync(matrixPath, "utf8"));
  assert.equal(matrix.schema_version, 1, "live matrix schema version mismatch");
  assert.equal(matrix.status, "pass", "live matrix status must be pass");
  assert.equal(Array.isArray(matrix.cells), true, "live matrix cells are missing");
  assert.equal(matrix.cells.length, 56, "live matrix must contain exactly 56 cells");
  const expectedPairs = new Set();
  for (const disabledCapability of CANONICAL_CAPABILITIES) {
    for (const survivingOwner of CANONICAL_CAPABILITIES) {
      if (disabledCapability !== survivingOwner) expectedPairs.add(`${disabledCapability}\0${survivingOwner}`);
    }
  }
  const seen = new Set();
  for (const [index, cell] of matrix.cells.entries()) {
    const label = `live matrix cell ${index + 1}`;
    assert.equal(cell !== null && typeof cell === "object" && !Array.isArray(cell), true, `${label}: invalid cell`);
    assert.equal(CANONICAL_CAPABILITIES.includes(cell.disabled_capability), true,
      `${label}: disabled capability is not canonical`);
    assert.equal(CANONICAL_CAPABILITIES.includes(cell.surviving_owner), true,
      `${label}: surviving owner is not canonical`);
    assert.notEqual(cell.disabled_capability, cell.surviving_owner, `${label}: owner cannot survive its own ablation`);
    const pair = `${cell.disabled_capability}\0${cell.surviving_owner}`;
    assert.equal(expectedPairs.has(pair), true, `${label}: unexpected matrix pair`);
    assert.equal(seen.has(pair), false, `${label}: duplicate matrix pair`);
    seen.add(pair);
    assert.equal(cell.operation, PUBLIC_OPERATIONS.get(cell.surviving_owner), `${label}: wrong public owner operation`);
    assert.equal(cell.real_operation, true, `${label}: spies or simulations cannot satisfy a cell`);
    assert.equal(cell.supported_seam, "public-installed-owner", `${label}: supported public seam is missing`);
    assert.equal(cell.availability, "available", `${label}: unavailable providers, credentials, runtimes, or seams fail`);
    requireObservation(cell.baseline, `${label} baseline`);
    requireObservation(cell.observed, `${label} observed`);
    assert.deepEqual(cell.observed, cell.baseline, `${label}: observed owner behavior differs from baseline`);
    assert.equal(cell.equality, "pass", `${label}: baseline comparison did not pass`);
    assert.equal(typeof cell.evidence_ref, "string", `${label}: evidence reference is missing`);
    assert.equal(cell.evidence_ref.length > 0, true, `${label}: evidence reference is empty`);
    if (DUAL_HARNESS_OWNERS.has(cell.surviving_owner)) {
      for (const harness of ["claude", "opencode"]) {
        const proof = cell.installed_harnesses?.[harness];
        assert.equal(proof?.result, "success", `${label}: ${harness} installed-owner observation did not succeed`);
        assert.equal(typeof proof?.evidence_ref, "string", `${label}: ${harness} evidence reference is missing`);
        assert.equal(proof.evidence_ref.length > 0, true, `${label}: ${harness} evidence reference is empty`);
      }
    }
  }
  assert.deepEqual(seen, expectedPairs, "live matrix does not cover the exact eight-by-seven cross product");
  return matrix;
}

function captureEvidence(evidenceDirectory, sourceCommit) {
  const expectedDirectory = resolve(SCRIPT_ROOT, EVIDENCE_RELATIVE);
  if (resolve(evidenceDirectory) !== expectedDirectory) {
    throw new Error(`Capture output must be ${EVIDENCE_RELATIVE}.`);
  }
  resolveCommit(SCRIPT_ROOT, sourceCommit);
  assertCallerSourceClean(SCRIPT_ROOT, sourceCommit);
  const npmCache = requireSuccess(run("npm", ["config", "get", "cache"]), "resolve npm cache");
  if (!existsSync(npmCache)) throw new Error("The local npm cache is unavailable for offline container installs.");
  const engine = findContainerEngine();
  for (const image of [...NODE_IMAGES.values(), BASH_IMAGE]) ensureImage(engine, image);

  mkdirSync(dirname(expectedDirectory), { recursive: true, mode: 0o700 });
  const staging = mkdtempSync(join(dirname(expectedDirectory), ".runtime-evidence-staging-"));
  const generatedAt = new Date().toISOString();
  try {
    const logs = withDetachedWorktree(SCRIPT_ROOT, sourceCommit, (worktree) => {
      const fixture = JSON.parse(readFileSync(join(worktree, "scripts", "fixtures", "capability-harness-contracts.json"), "utf8"));
      const fixtureVersions = {
        claude: fixture?.claude?.version,
        opencode: fixture?.opencode?.version,
      };
      assert.equal(fixtureVersions.claude, "2.1.220", "Claude fixture version changed");
      assert.equal(fixtureVersions.opencode, "1.17.20", "OpenCode fixture version changed");
      const rows = [];
      for (const [runtime, image] of [...NODE_IMAGES, ["bash-3.2", BASH_IMAGE]]) {
        assertDetachedSourceClean(worktree, sourceCommit);
        const result = runContainer(engine, image, runtime, worktree, npmCache, generatedAt, fixtureVersions);
        assertDetachedSourceClean(worktree, sourceCommit);
        const file = `${runtime}.log`;
        const text = `${logHeader(sourceCommit, runtime, image, result.command)}\n${result.output.trimEnd()}\n`;
        writeFileSync(join(staging, file), text, { encoding: "utf8", mode: 0o600 });
        const commands = parseCommandRecords(text, file);
        rows.push({
          file,
          runtime,
          image,
          container_command: result.command,
          source_commit: sourceCommit,
          source_tree_clean: true,
          generated_at: generatedAt,
          sha256: sha256(text),
          result: result.status === 0 ? "pass" : "fail",
          commands,
        });
        if (result.status !== 0) {
          throw new Error(`${runtime} container failed (exit ${String(result.status)}):\n${result.output}`);
        }
      }
      return rows;
    });
    const manifest = {
      schema_version: 2,
      source_commit: sourceCommit,
      source_tree_clean: true,
      detached_source: true,
      generated_at: generatedAt,
      evidence_scope: "deterministic-native-lifecycle",
      acceptance: {
        status: "blocked-pending-live-matrix",
        accepted: false,
        required_cells: 56,
      },
      logs,
    };
    writeFileSync(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    verifyEvidence(staging, sourceCommit);

    mkdirSync(expectedDirectory, { recursive: true, mode: 0o700 });
    for (const file of [...EXPECTED_LOGS, "manifest.json"]) {
      renameSync(join(staging, file), join(expectedDirectory, file));
    }
    verifyEvidence(expectedDirectory, sourceCommit);
    process.stdout.write(`PASS: Phase 18 runtime evidence captured for ${sourceCommit}\n`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function fixtureLog(commit, runtime, image) {
  const command = `docker run --rm ${image}`;
  const commands = runtime.startsWith("node-") ? NODE_COMMANDS : BASH_COMMANDS;
  const version = runtime.startsWith("node-")
    ? `runtime_version=v${runtime.slice(5)}.0.0`
    : "runtime_version=GNU bash, version 3.2.57(1)-release";
  const records = commands.flatMap(([id, exact, scope]) => [
    `EVIDENCE_COMMAND_BEGIN|${id}|${scope}|${exact}`,
    id === "node-version" || id === "bash-version" ? version : `PASS: ${id}`,
    `EVIDENCE_COMMAND_END|${id}|${scope}|0|pass`,
  ]);
  return [
    logHeader(commit, runtime, image, command),
    "generated_at=2026-07-27T00:00:00.000Z",
    "fixture_claude_version=2.1.220",
    "fixture_opencode_version=1.17.20",
    "acceptance=blocked-pending-live-matrix",
    "evidence_scope=deterministic-native-lifecycle",
    ...records,
    `PASS: Phase 18 runtime ${runtime}`,
    "",
  ].join("\n");
}

function writeFixture(directory, commit) {
  mkdirSync(directory, { recursive: true });
  const logs = [];
  for (const [runtime, image] of [...NODE_IMAGES, ["bash-3.2", BASH_IMAGE]]) {
    const file = `${runtime}.log`;
    const text = fixtureLog(commit, runtime, image);
    writeFileSync(join(directory, file), text);
    const commands = (runtime.startsWith("node-") ? NODE_COMMANDS : BASH_COMMANDS).map(
      ([id, command, evidence_scope]) => ({ id, command, evidence_scope, exit_status: 0, result: "pass" }),
    );
    logs.push({
      file,
      runtime,
      image,
      container_command: `docker run --rm ${image}`,
      source_commit: commit,
      source_tree_clean: true,
      generated_at: "2026-07-27T00:00:00.000Z",
      sha256: createHash("sha256").update(text).digest("hex"),
      result: "pass",
      commands,
    });
  }
  writeFileSync(join(directory, "manifest.json"), `${JSON.stringify({
    schema_version: 2,
    source_commit: commit,
    source_tree_clean: true,
    detached_source: true,
    generated_at: "2026-07-27T00:00:00.000Z",
    evidence_scope: "deterministic-native-lifecycle",
    acceptance: {
      status: "blocked-pending-live-matrix",
      accepted: false,
      required_cells: 56,
    },
    logs,
  }, null, 2)}\n`);
}

function writeLiveMatrixFixture(path) {
  const cells = [];
  for (const disabledCapability of CANONICAL_CAPABILITIES) {
    for (const survivingOwner of CANONICAL_CAPABILITIES) {
      if (disabledCapability === survivingOwner) continue;
      const observation = {
        result: "success",
        error: null,
        timeout: false,
        trace: `trace:${disabledCapability}:${survivingOwner}`,
        delegate_identity: `owner:${survivingOwner}`,
      };
      const cell = {
        disabled_capability: disabledCapability,
        surviving_owner: survivingOwner,
        operation: PUBLIC_OPERATIONS.get(survivingOwner),
        real_operation: true,
        supported_seam: "public-installed-owner",
        availability: "available",
        baseline: observation,
        observed: { ...observation },
        equality: "pass",
        evidence_ref: `evidence/${disabledCapability}/${survivingOwner}.json`,
      };
      if (DUAL_HARNESS_OWNERS.has(survivingOwner)) {
        cell.installed_harnesses = {
          claude: { result: "success", evidence_ref: `${cell.evidence_ref}#claude` },
          opencode: { result: "success", evidence_ref: `${cell.evidence_ref}#opencode` },
        };
      }
      cells.push(cell);
    }
  }
  writeFileSync(path, `${JSON.stringify({ schema_version: 1, status: "pass", cells }, null, 2)}\n`);
}

function expectFailure(label, operation) {
  assert.throws(operation, undefined, label);
}

function selfTest() {
  const root = mkdtempSync(join(tmpdir(), "cairn-phase18-verifier-test-"));
  const commit = "a".repeat(40);
  try {
    const valid = join(root, "valid");
    writeFixture(valid, commit);
    verifyEvidence(valid, commit);
    expectFailure("short commit", () => verifyEvidence(valid, commit.slice(0, 39)));

    const mixed = join(root, "mixed");
    writeFixture(mixed, commit);
    const mixedManifest = JSON.parse(readFileSync(join(mixed, "manifest.json"), "utf8"));
    mixedManifest.logs[1].source_commit = "b".repeat(40);
    writeFileSync(join(mixed, "manifest.json"), JSON.stringify(mixedManifest));
    expectFailure("mixed commit", () => verifyEvidence(mixed, commit));

    const wrongRuntime = join(root, "wrong-runtime");
    writeFixture(wrongRuntime, commit);
    writeFileSync(
      join(wrongRuntime, "node-22.log"),
      readFileSync(join(wrongRuntime, "node-22.log"), "utf8").replace("runtime=node-22", "runtime=node-24"),
    );
    expectFailure("wrong runtime label", () => verifyEvidence(wrongRuntime, commit));

    const wrongVersion = join(root, "wrong-version");
    writeFixture(wrongVersion, commit);
    writeFileSync(
      join(wrongVersion, "node-22.log"),
      readFileSync(join(wrongVersion, "node-22.log"), "utf8").replace("runtime_version=v22.", "runtime_version=v24."),
    );
    expectFailure("wrong runtime version", () => verifyEvidence(wrongVersion, commit));

    const missingCommand = join(root, "missing-command");
    writeFixture(missingCommand, commit);
    writeFileSync(
      join(missingCommand, "node-24.log"),
      readFileSync(join(missingCommand, "node-24.log"), "utf8").replace(
        "npm --prefix mcp-memory-server test",
        "omitted-server-test-command",
      ),
    );
    expectFailure("missing command", () => verifyEvidence(missingCommand, commit));

    const missingPass = join(root, "missing-pass");
    writeFixture(missingPass, commit);
    writeFileSync(
      join(missingPass, "bash-3.2.log"),
      readFileSync(join(missingPass, "bash-3.2.log"), "utf8").replace("PASS: Phase 18 runtime bash-3.2", "FAIL"),
    );
    expectFailure("missing PASS", () => verifyEvidence(missingPass, commit));

    const manifestMismatch = join(root, "manifest-mismatch");
    writeFixture(manifestMismatch, commit);
    const manifest = JSON.parse(readFileSync(join(manifestMismatch, "manifest.json"), "utf8"));
    manifest.logs[0].file = "unexpected.log";
    writeFileSync(join(manifestMismatch, "manifest.json"), JSON.stringify(manifest));
    expectFailure("manifest names", () => verifyEvidence(manifestMismatch, commit));

    const missingLog = join(root, "missing-log");
    writeFixture(missingLog, commit);
    rmSync(join(missingLog, "node-26.log"));
    expectFailure("missing runtime log", () => verifyEvidence(missingLog, commit));

    const overstatedAcceptance = join(root, "overstated-acceptance");
    writeFixture(overstatedAcceptance, commit);
    const acceptanceManifest = JSON.parse(readFileSync(join(overstatedAcceptance, "manifest.json"), "utf8"));
    acceptanceManifest.acceptance = { status: "pass", accepted: true, required_cells: 56 };
    writeFileSync(join(overstatedAcceptance, "manifest.json"), JSON.stringify(acceptanceManifest));
    expectFailure("deterministic evidence acceptance overstatement", () => verifyEvidence(overstatedAcceptance, commit));

    const staleHash = join(root, "stale-hash");
    writeFixture(staleHash, commit);
    writeFileSync(join(staleHash, "node-22.log"), `${readFileSync(join(staleHash, "node-22.log"), "utf8")}tampered\n`);
    expectFailure("stale log hash", () => verifyEvidence(staleHash, commit));

    const unsupportedScope = join(root, "unsupported-scope");
    writeFixture(unsupportedScope, commit);
    const unsupportedManifest = JSON.parse(readFileSync(join(unsupportedScope, "manifest.json"), "utf8"));
    unsupportedManifest.logs[0].commands[0].evidence_scope = "synthetic-owner-acceptance";
    writeFileSync(join(unsupportedScope, "manifest.json"), JSON.stringify(unsupportedManifest));
    expectFailure("unsupported evidence scope", () => verifyEvidence(unsupportedScope, commit));

    const omittedCommand = join(root, "omitted-command");
    writeFixture(omittedCommand, commit);
    const omittedManifest = JSON.parse(readFileSync(join(omittedCommand, "manifest.json"), "utf8"));
    omittedManifest.logs[1].commands.pop();
    writeFileSync(join(omittedCommand, "manifest.json"), JSON.stringify(omittedManifest));
    expectFailure("omitted required command", () => verifyEvidence(omittedCommand, commit));

    const liveMatrix = join(root, "live-matrix.json");
    writeLiveMatrixFixture(liveMatrix);
    validateLiveMatrix(liveMatrix);
    const duplicateMatrix = JSON.parse(readFileSync(liveMatrix, "utf8"));
    duplicateMatrix.cells[55] = structuredClone(duplicateMatrix.cells[0]);
    writeFileSync(liveMatrix, JSON.stringify(duplicateMatrix));
    expectFailure("duplicate live matrix cell", () => validateLiveMatrix(liveMatrix));
    writeLiveMatrixFixture(liveMatrix);
    const unavailableMatrix = JSON.parse(readFileSync(liveMatrix, "utf8"));
    unavailableMatrix.cells[0].availability = "credentials-unavailable";
    writeFileSync(liveMatrix, JSON.stringify(unavailableMatrix));
    expectFailure("unavailable live matrix cell", () => validateLiveMatrix(liveMatrix));
    writeLiveMatrixFixture(liveMatrix);
    const spyOnlyMatrix = JSON.parse(readFileSync(liveMatrix, "utf8"));
    spyOnlyMatrix.cells[0].real_operation = false;
    writeFileSync(liveMatrix, JSON.stringify(spyOnlyMatrix));
    expectFailure("spy-only live matrix cell", () => validateLiveMatrix(liveMatrix));
    writeLiveMatrixFixture(liveMatrix);
    const missingHarnessMatrix = JSON.parse(readFileSync(liveMatrix, "utf8"));
    const dualCell = missingHarnessMatrix.cells.find((cell) => cell.surviving_owner === "wiki");
    delete dualCell.installed_harnesses.opencode;
    writeFileSync(liveMatrix, JSON.stringify(missingHarnessMatrix));
    expectFailure("missing installed harness proof", () => validateLiveMatrix(liveMatrix));

    const failureProbe = run(process.execPath, ["-e", "process.stdout.write('saved failure evidence\\n'); process.exit(19)"]);
    const failureEvidence = join(root, "intentional-failure.log");
    writeFileSync(failureEvidence, combined(failureProbe));
    assert.equal(failureProbe.status, 19, "intentional command exit status was not propagated");
    assert.equal(readFileSync(failureEvidence, "utf8"), "saved failure evidence\n",
      "intentional command evidence was not saved");

    const repo = join(root, "repo");
    mkdirSync(repo);
    requireSuccess(git(repo, ["init", "-q"]), "initialize self-test repository");
    requireSuccess(git(repo, ["config", "user.name", "Runtime Evidence Test"]), "configure test name");
    requireSuccess(git(repo, ["config", "user.email", "runtime-evidence@example.invalid"]), "configure test email");
    writeFileSync(join(repo, "source.txt"), "clean\n");
    requireSuccess(git(repo, ["add", "source.txt"]), "stage self-test source");
    requireSuccess(git(repo, ["commit", "-qm", "fixture"]), "commit self-test source");
    const repoCommit = requireSuccess(git(repo, ["rev-parse", "HEAD"]), "read self-test commit");
    assertCallerSourceClean(repo, repoCommit);
    let detachedPath;
    expectFailure("detached cleanup callback", () => withDetachedWorktree(repo, repoCommit, (path) => {
      detachedPath = path;
      throw new Error("intentional cleanup probe");
    }));
    assert.equal(existsSync(detachedPath), false, "detached source was not removed in finally");
    assert.equal(requireSuccess(git(repo, ["worktree", "list", "--porcelain"]), "list self-test worktrees").includes(detachedPath), false);
    writeFileSync(join(repo, "source.txt"), "dirty\n");
    expectFailure("tracked source difference", () => assertCallerSourceClean(repo, repoCommit));

    process.stdout.write("PASS: Phase 18 runtime-evidence verifier self-test\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function main() {
  const [mode, evidenceDirectory, sourceCommit, ...extra] = process.argv.slice(2);
  if (mode === undefined && evidenceDirectory === undefined && sourceCommit === undefined && extra.length === 0) {
    const evidencePath = resolve(SCRIPT_ROOT, EVIDENCE_RELATIVE);
    const manifestPath = join(evidencePath, "manifest.json");
    if (!existsSync(manifestPath)) throw new Error("Evidence manifest is missing.");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    verifyEvidence(evidencePath, manifest.source_commit);
    process.stdout.write(`PASS: Phase 18 deterministic runtime evidence verified for ${manifest.source_commit}\n`);
    process.stdout.write("BLOCKED: Phase 18 acceptance still requires --live-matrix with 56 genuine real-owner cells\n");
    return;
  }
  if (mode === "--self-test" && evidenceDirectory === undefined && sourceCommit === undefined && extra.length === 0) {
    selfTest();
    return;
  }
  if (mode === "--live-matrix" && evidenceDirectory !== undefined && sourceCommit === undefined && extra.length === 0) {
    validateLiveMatrix(resolve(evidenceDirectory));
    process.stdout.write("PASS: Phase 18 live matrix contains 56 genuine passing real-owner cells\n");
    return;
  }
  if ((mode === "--capture" || mode === "--verify-only")
    && evidenceDirectory !== undefined && sourceCommit !== undefined && extra.length === 0) {
    if (mode === "--capture") captureEvidence(evidenceDirectory, sourceCommit);
    else {
      verifyEvidence(resolve(evidenceDirectory), sourceCommit);
      process.stdout.write(`PASS: Phase 18 runtime evidence verified for ${sourceCommit}\n`);
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
