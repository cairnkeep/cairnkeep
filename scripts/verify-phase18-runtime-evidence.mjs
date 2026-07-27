#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

function usage() {
  return `Usage:
  node scripts/verify-phase18-runtime-evidence.mjs --self-test
  node scripts/verify-phase18-runtime-evidence.mjs --capture <evidence-dir> <source-commit>
  node scripts/verify-phase18-runtime-evidence.mjs --verify-only <evidence-dir> <source-commit>\n`;
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

function nodeSuite(runtime) {
  return `set -eu
mkdir -p /work/source /tmp/npm-logs
cp -a /source/. /work/source/
cd /work/source
printf 'command=node --version\\n'
printf 'node_version=%s\\n' "$(node --version)"
printf 'command=npm ci --offline\\n'
npm ci --offline --cache /npm-cache --logs-dir /tmp/npm-logs --no-audit --no-fund
printf 'command=npm --prefix mcp-memory-server ci --offline\\n'
npm --prefix mcp-memory-server ci --offline --cache /npm-cache --logs-dir /tmp/npm-logs --no-audit --no-fund
printf 'command=npm --prefix mcp-memory-server run build\\n'
npm --prefix mcp-memory-server run build
printf 'command=npm --prefix mcp-memory-server test\\n'
npm --prefix mcp-memory-server test
printf 'PASS: Phase 18 runtime ${runtime}\\n'`;
}

function bashSuite() {
  return `set -eu
mkdir -p /work/source /tmp/live
cp -a /source/. /work/source/
cd /work/source
printf 'command=bash --version\\n'
printf 'bash_version=%s\\n' "$(bash --version | head -n 1)"
printf 'command=bash -n scripts/test-phase18-capability-lifecycle.sh templates/start-claude.sh.template templates/start-opencode.sh.template\\n'
bash -n scripts/test-phase18-capability-lifecycle.sh templates/start-claude.sh.template templates/start-opencode.sh.template
for script in scripts/sync-claude-assets.sh scripts/sync-opencode-explore-assets.sh scripts/sync-opencode-wiki-assets.sh scripts/sync-pi-assets.sh; do
  printf 'command=bash %s --check --live-root /tmp/live\\n' "$script"
  output=$(bash "$script" --check --live-root /tmp/live 2>&1) || true
  if printf '%s\\n' "$output" | grep -qiE 'unbound variable|command not found|mapfile:|readarray:|syntax error'; then
    printf '%s\\n' "$output"
    exit 1
  fi
done
printf 'command=bash scripts/test-portable-sh.sh\\n'
bash scripts/test-portable-sh.sh
printf 'PASS: Phase 18 runtime bash-3.2\\n'`;
}

function runContainer(engine, image, runtime, worktree, npmCache) {
  const script = runtime.startsWith("node-") ? nodeSuite(runtime) : bashSuite();
  const args = ["run", "--rm", "--network", "none", "--mount",
    `type=bind,src=${worktree},dst=/source,readonly`];
  if (runtime.startsWith("node-")) {
    args.push("--mount", `type=bind,src=${npmCache},dst=/npm-cache`);
  }
  args.push("-w", "/work", image, "bash", "-c", script);
  const command = renderCommand(engine, args);
  const result = run(engine, args, { timeout: 900_000 });
  if (result.status !== 0) {
    throw new Error(`${runtime} container failed (exit ${String(result.status)}):\n${combined(result)}`);
  }
  return { command, output: combined(result) };
}

function logHeader(sourceCommit, runtime, image, command) {
  return [
    `source_commit=${sourceCommit}`,
    `runtime=${runtime}`,
    `container_image=${image}`,
    `container_command=${command}`,
    "source_tree_clean=true",
  ].join("\n");
}

function requireLog(text, expected) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== `source_commit=${expected.commit}`) throw new Error(`${expected.file}: wrong source commit header.`);
  if (lines[1] !== `runtime=${expected.runtime}`) throw new Error(`${expected.file}: wrong runtime label.`);
  if (lines[2] !== `container_image=${expected.image}`) throw new Error(`${expected.file}: wrong container image.`);
  if (!lines[3]?.startsWith("container_command=") || !lines[3].includes(expected.image)) {
    throw new Error(`${expected.file}: missing exact container command.`);
  }
  if (lines[4] !== "source_tree_clean=true") throw new Error(`${expected.file}: detached source was not recorded clean.`);
  if (expected.runtime.startsWith("node-")) {
    const major = expected.runtime.slice("node-".length);
    for (const marker of [
      `node_version=v${major}.`,
      "command=npm ci --offline",
      "command=npm --prefix mcp-memory-server ci --offline",
      "command=npm --prefix mcp-memory-server run build",
      "command=npm --prefix mcp-memory-server test",
      `PASS: Phase 18 runtime ${expected.runtime}`,
    ]) {
      if (!text.includes(marker)) throw new Error(`${expected.file}: missing ${marker}.`);
    }
  } else {
    for (const marker of [
      "bash_version=GNU bash, version 3.2",
      "command=bash -n scripts/test-phase18-capability-lifecycle.sh",
      "command=bash scripts/sync-claude-assets.sh --check --live-root /tmp/live",
      "command=bash scripts/sync-opencode-wiki-assets.sh --check --live-root /tmp/live",
      "command=bash scripts/test-portable-sh.sh",
      "PASS: Phase 18 runtime bash-3.2",
    ]) {
      if (!text.includes(marker)) throw new Error(`${expected.file}: missing ${marker}.`);
    }
  }
}

function verifyEvidence(evidenceDirectory, sourceCommit) {
  requireCommit(sourceCommit);
  const manifestPath = join(evidenceDirectory, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("Evidence manifest is missing.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.schema_version, 1, "manifest schema version mismatch");
  assert.equal(manifest.source_commit, sourceCommit, "manifest source commit mismatch");
  assert.equal(manifest.source_tree_clean, true, "manifest detached source is not clean");
  assert.equal(manifest.detached_source, true, "manifest did not record detached source");
  assert.deepEqual(manifest.logs?.map(({ file }) => file), EXPECTED_LOGS, "manifest log names mismatch");
  assert.equal(manifest.logs.length, EXPECTED_LOGS.length, "manifest log count mismatch");

  for (const row of manifest.logs) {
    assert.equal(row.source_commit, sourceCommit, `${row.file}: manifest mixed source commit`);
    assert.equal(row.source_tree_clean, true, `${row.file}: manifest source not clean`);
    assert.equal(typeof row.container_command, "string", `${row.file}: manifest command missing`);
    const expectedImage = row.runtime === "bash-3.2" ? BASH_IMAGE : NODE_IMAGES.get(row.runtime);
    assert.equal(row.image, expectedImage, `${row.file}: manifest image mismatch`);
    const text = readFileSync(join(evidenceDirectory, row.file), "utf8");
    requireLog(text, {
      file: row.file,
      runtime: row.runtime,
      image: expectedImage,
      commit: sourceCommit,
    });
  }
  return manifest;
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

  const staging = mkdtempSync(join(tmpdir(), "cairn-phase18-evidence-"));
  try {
    const logs = withDetachedWorktree(SCRIPT_ROOT, sourceCommit, (worktree) => {
      const rows = [];
      for (const [runtime, image] of [...NODE_IMAGES, ["bash-3.2", BASH_IMAGE]]) {
        assertDetachedSourceClean(worktree, sourceCommit);
        const result = runContainer(engine, image, runtime, worktree, npmCache);
        assertDetachedSourceClean(worktree, sourceCommit);
        const file = `${runtime}.log`;
        const text = `${logHeader(sourceCommit, runtime, image, result.command)}\n${result.output.trimEnd()}\n`;
        writeFileSync(join(staging, file), text, { encoding: "utf8", mode: 0o600 });
        rows.push({
          file,
          runtime,
          image,
          container_command: result.command,
          source_commit: sourceCommit,
          source_tree_clean: true,
        });
      }
      return rows;
    });
    const manifest = {
      schema_version: 1,
      source_commit: sourceCommit,
      source_tree_clean: true,
      detached_source: true,
      generated_at: new Date().toISOString(),
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
  const body = runtime.startsWith("node-")
    ? `command=node --version\nnode_version=v${runtime.slice(5)}.0.0\ncommand=npm ci --offline\ncommand=npm --prefix mcp-memory-server ci --offline\ncommand=npm --prefix mcp-memory-server run build\ncommand=npm --prefix mcp-memory-server test\nPASS: Phase 18 runtime ${runtime}`
    : "command=bash --version\nbash_version=GNU bash, version 3.2.57(1)-release\ncommand=bash -n scripts/test-phase18-capability-lifecycle.sh templates/start-claude.sh.template templates/start-opencode.sh.template\ncommand=bash scripts/sync-claude-assets.sh --check --live-root /tmp/live\ncommand=bash scripts/sync-opencode-wiki-assets.sh --check --live-root /tmp/live\ncommand=bash scripts/test-portable-sh.sh\nPASS: Phase 18 runtime bash-3.2";
  return `${logHeader(commit, runtime, image, command)}\n${body}\n`;
}

function writeFixture(directory, commit) {
  mkdirSync(directory, { recursive: true });
  const logs = [];
  for (const [runtime, image] of [...NODE_IMAGES, ["bash-3.2", BASH_IMAGE]]) {
    const file = `${runtime}.log`;
    writeFileSync(join(directory, file), fixtureLog(commit, runtime, image));
    logs.push({
      file,
      runtime,
      image,
      container_command: `docker run --rm ${image}`,
      source_commit: commit,
      source_tree_clean: true,
    });
  }
  writeFileSync(join(directory, "manifest.json"), `${JSON.stringify({
    schema_version: 1,
    source_commit: commit,
    source_tree_clean: true,
    detached_source: true,
    generated_at: "2026-07-27T00:00:00.000Z",
    logs,
  }, null, 2)}\n`);
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
      readFileSync(join(wrongVersion, "node-22.log"), "utf8").replace("node_version=v22.", "node_version=v24."),
    );
    expectFailure("wrong runtime version", () => verifyEvidence(wrongVersion, commit));

    const missingCommand = join(root, "missing-command");
    writeFixture(missingCommand, commit);
    writeFileSync(
      join(missingCommand, "node-24.log"),
      readFileSync(join(missingCommand, "node-24.log"), "utf8").replace("command=npm --prefix mcp-memory-server test", "command=omitted"),
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
  if (mode === "--self-test" && evidenceDirectory === undefined && sourceCommit === undefined && extra.length === 0) {
    selfTest();
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
