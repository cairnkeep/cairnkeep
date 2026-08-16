import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { readArtifact } from "../dist/artifact-store.js";
import {
    appendWorkEvidenceLink,
    doctorWorkEvidence,
    finishWorkEvidence,
    getWorkEvidenceStorePath,
    inspectGitState,
    listWorkEvidence,
    readWorkEvidence,
    startWorkEvidence,
} from "../dist/work-evidence-store.js";

const root = mkdtempSync(join(tmpdir(), "cairn-work-evidence-"));
const project = join(root, "project");
mkdirSync(project);

function git(args, cwd = project) {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

git(["init", "--quiet"]);
git(["config", "user.email", "fixture@example.invalid"]);
git(["config", "user.name", "Fixture"]);
writeFileSync(join(project, "tracked.txt"), "start\n");
git(["add", "tracked.txt"]);
git(["commit", "--quiet", "-m", "start"]);

const priorEnv = { ...process.env };
process.env.CAIRN_WORK_EVIDENCE = "1";
delete process.env.CAIRN_WORK_EVIDENCE_PATCH;
delete process.env.CAIRN_ARTIFACT_STORE;

const cleanA = inspectGitState(project);
const cleanB = inspectGitState(project);
assert.deepEqual(cleanA, cleanB, "unchanged Git state must be deterministic");
assert.equal(cleanA.snapshot.dirty, false);

const started = startWorkEvidence(project, "codex", new Date("2026-08-17T10:00:00.000Z"));
assert.equal(started.start.head_commit, git(["rev-parse", "HEAD"]));
writeFileSync(join(project, "tracked.txt"), "changed\n");
writeFileSync(join(project, "new.txt"), "new\n");
const completed = await finishWorkEvidence(project, started.evidence_id, 7, { now: new Date("2026-08-17T10:05:00.000Z") });
assert.equal(completed.status, "complete");
assert.equal(completed.exit_status, 7);
assert.deepEqual(completed.touched_paths, ["new.txt", "tracked.txt"]);
assert.equal(completed.patch.artifact_id, null);
assert.equal(completed.patch.unavailable_reason, "not-requested");
assert.match(completed.change_digest, /^[a-f0-9]{64}$/);

const trajectory = await appendWorkEvidenceLink(project, completed.evidence_id, { kind: "trajectory", trajectory_id: "session-1" }, new Date("2026-08-17T10:06:00.000Z"));
const duplicate = await appendWorkEvidenceLink(project, completed.evidence_id, { kind: "trajectory", trajectory_id: "session-1" }, new Date("2026-08-17T10:07:00.000Z"));
assert.equal(trajectory?.link_id, duplicate?.link_id, "links must be idempotent by exact reference");
await appendWorkEvidenceLink(project, completed.evidence_id, { kind: "reviewed_memory", scope: "project", review_id: "review-1", key: "patterns/evidence" });
assert.deepEqual(readWorkEvidence(completed.evidence_id, project).links.map(({ kind }) => kind).sort(), ["reviewed_memory", "trajectory"]);

// Patch consent is deliberately dual-gated.
git(["add", "tracked.txt", "new.txt"]);
git(["commit", "--quiet", "-m", "middle"]);
process.env.CAIRN_WORK_EVIDENCE_PATCH = "1";
const noArtifactStart = startWorkEvidence(project, "pi");
writeFileSync(join(project, "tracked.txt"), "no artifact\n");
const noArtifact = await finishWorkEvidence(project, noArtifactStart.evidence_id, 0);
assert.equal(noArtifact.patch.unavailable_reason, "artifact-store-disabled");

git(["restore", "tracked.txt"]);
process.env.CAIRN_ARTIFACT_STORE = "1";
const patchStart = startWorkEvidence(project, "claude");
writeFileSync(join(project, "tracked.txt"), "patch content\n");
const patched = await finishWorkEvidence(project, patchStart.evidence_id, 0);
assert.match(patched.patch.artifact_id ?? "", /^art_/);
assert.equal(patched.patch.scope, "end-worktree-vs-start-commit");
const artifact = await readArtifact(patched.patch.artifact_id, project);
assert.equal(artifact.kind, "diff");
assert.match(artifact.content.text, /tracked\.txt/);
assert.ok(readWorkEvidence(patched.evidence_id, project).links.some((link) => link.kind === "artifact" && link.artifact_id === patched.patch.artifact_id));

const listed = listWorkEvidence(project);
assert.equal(listed.evidence.length, 3);
assert.equal(doctorWorkEvidence(project).ok, true);
if (process.platform !== "win32") {
    const completedPath = join(getWorkEvidenceStorePath(project), "records", `${completed.evidence_id}.json`);
    assert.equal(statSync(completedPath).mode & 0o777, 0o600, "records must be private");
    chmodSync(completedPath, 0o644);
    assert.ok(doctorWorkEvidence(project).issues.some((issue) => issue.includes("invalid record")), "doctor must report permission drift");
    assert.throws(() => readWorkEvidence(completed.evidence_id, project), /Unsafe work-evidence record/);
    chmodSync(completedPath, 0o600);
}

// Existing trajectory, artifact and reviewed-memory paths append exact links
// without changing their established response payloads.
const linkedProject = join(root, "linked-project");
mkdirSync(linkedProject);
git(["init", "--quiet"], linkedProject);
git(["config", "user.email", "fixture@example.invalid"], linkedProject);
git(["config", "user.name", "Fixture"], linkedProject);
writeFileSync(join(linkedProject, "linked.txt"), "start\n");
git(["add", "linked.txt"], linkedProject);
git(["commit", "--quiet", "-m", "start"], linkedProject);
const linkedStart = startWorkEvidence(linkedProject, "opencode");
const linkedEnv = {
    ...priorEnv,
    CAIRN_WORK_EVIDENCE: "1",
    CAIRN_WORK_EVIDENCE_ID: linkedStart.evidence_id,
    CAIRN_WORK_EVIDENCE_ROOT: linkedProject,
    CAIRN_ARTIFACT_STORE: "1",
};
const serverEntry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const linkTransport = new StdioClientTransport({ command: process.execPath, args: [serverEntry], cwd: linkedProject, env: linkedEnv, stderr: "pipe" });
const linkClient = new Client({ name: "work-evidence-link-smoke", version: "1" }, { capabilities: {} });
await linkClient.connect(linkTransport);
try {
    const reviewed = await linkClient.callTool({ name: "memory_apply_reviewed", arguments: {
        scope: "project", review_id: "review-linked", key: "patterns/linked", value: "linked",
    } });
    assert.deepEqual(Object.keys(reviewed.structuredContent).sort(), ["applied", "idempotent", "key", "ok", "review_id", "scope", "snapshot_key"]);
    const written = await linkClient.callTool({ name: "artifact_write", arguments: {
        kind: "diff",
        session_ref: "linked-session",
        media_type: "text/x-diff",
        provenance: { producer: "fixture" },
        content: { text: "diff --git a/a b/a\n" },
    } });
    assert.ok(written.structuredContent, JSON.stringify(written));
    assert.deepEqual(Object.keys(written.structuredContent).sort(), ["artifact_id", "content_digest", "kind", "logical_bytes", "schema_version", "session_ref", "status", "stored_bytes"]);
} finally {
    await linkClient.close();
}
const trajectoryCli = fileURLToPath(new URL("../dist/trajectory-cli.js", import.meta.url));
const trajectoryFixture = fileURLToPath(new URL("./fixtures/trajectory-opencode.json", import.meta.url));
const trajectoryCapture = spawnSync(process.execPath, [trajectoryCli, "capture-opencode", linkedProject], {
    cwd: linkedProject, env: linkedEnv, input: readFileSync(trajectoryFixture, "utf8"), encoding: "utf8",
});
assert.equal(trajectoryCapture.status, 0, trajectoryCapture.stderr);
assert.deepEqual(readWorkEvidence(linkedStart.evidence_id, linkedProject).links.map(({ kind }) => kind).sort(), ["artifact", "reviewed_memory", "trajectory"]);
await finishWorkEvidence(linkedProject, linkedStart.evidence_id, 0);

// Disabled wrapper path launches the command without invoking Git or creating a store.
const disabled = join(root, "disabled");
const fakeBin = join(root, "fake-bin");
mkdirSync(disabled);
mkdirSync(fakeBin);
const gitMarker = join(root, "git-called");
writeFileSync(join(fakeBin, "git"), `#!/bin/sh\nprintf called > "${gitMarker}"\nexit 99\n`, { mode: 0o755 });
const cli = fileURLToPath(new URL("../dist/work-evidence-cli.js", import.meta.url));
const offEnv = { ...priorEnv, PATH: `${fakeBin}:${priorEnv.PATH ?? ""}` };
delete offEnv.CAIRN_WORK_EVIDENCE;
const off = spawnSync(process.execPath, [cli, "run", "--harness", "codex", "--", process.execPath, "-e", "process.exit(13)"], { cwd: disabled, env: offEnv, encoding: "utf8" });
assert.equal(off.status, 13, off.stderr);
assert.equal(existsSync(gitMarker), false, "disabled wrapper must not invoke Git");
assert.equal(existsSync(getWorkEvidenceStorePath(disabled)), false, "disabled wrapper must not create storage");

// Missing Git is fail-open for launcher execution.
const missing = join(root, "missing-git");
mkdirSync(missing);
const missingEnv = { ...priorEnv, CAIRN_WORK_EVIDENCE: "1", PATH: fakeBin };
writeFileSync(join(fakeBin, "git"), "#!/bin/sh\nexit 127\n", { mode: 0o755 });
const fallback = spawnSync(process.execPath, [cli, "run", "--harness", "qwen", "--", process.execPath, "-e", "process.exit(9)"], { cwd: missing, env: missingEnv, encoding: "utf8" });
assert.equal(fallback.status, 9, fallback.stderr);
assert.match(fallback.stderr, /launching without work evidence/);
assert.equal(existsSync(getWorkEvidenceStorePath(missing)), false);

if (process.platform !== "win32") {
    const unsafe = join(root, "unsafe");
    const escaped = join(root, "escaped");
    mkdirSync(unsafe);
    mkdirSync(escaped);
    git(["init", "--quiet"], unsafe);
    symlinkSync(escaped, join(unsafe, ".agentfs"));
    assert.throws(() => startWorkEvidence(unsafe, "codex"), /real directories/);
    assert.equal(existsSync(join(escaped, "work-evidence")), false, "symlinked storage ancestor must not be followed");
}

// Local MCP exposure is gated and read-only.
async function discovered(extra = {}) {
    const env = { ...priorEnv, ...extra };
    for (const name of ["CAIRN_WORK_EVIDENCE", "CAIRN_MCP_TOOL_PROFILE", "CAIRN_MCP_ALLOWED_TOOLS", "MCP_HTTP_PORT"]) {
        if (!(name in extra)) delete env[name];
    }
    const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry], cwd: project, env, stderr: "pipe" });
    const client = new Client({ name: "work-evidence-smoke", version: "1" }, { capabilities: {} });
    await client.connect(transport);
    try { return (await client.listTools()).tools; } finally { await client.close(); }
}
const defaultNames = (await discovered()).map(({ name }) => name);
assert.equal(defaultNames.includes("work_evidence_list"), false);
const enabledTools = await discovered({ CAIRN_WORK_EVIDENCE: "1" });
for (const name of ["work_evidence_list", "work_evidence_read"]) {
    const tool = enabledTools.find((candidate) => candidate.name === name);
    assert.deepEqual(tool?.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
}
const customNames = (await discovered({ CAIRN_WORK_EVIDENCE: "1", CAIRN_MCP_TOOL_PROFILE: "custom", CAIRN_MCP_ALLOWED_TOOLS: "work_evidence_read" })).map(({ name }) => name);
assert.deepEqual(customNames, ["work_evidence_read"]);

Object.assign(process.env, priorEnv);
console.log("PASS: Git-linked work evidence gates, digests, links, patches, fallback, and MCP retrieval");
