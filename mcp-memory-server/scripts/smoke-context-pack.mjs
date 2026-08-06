import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import {
    applyContextPackUpdate, approvePackSkill, disableContextPack, doctorContextPacks,
    enableContextPack, initializeContextPack, inspectContextPackUpdate, installContextPack,
    listPackSkills, listVisibleContext, lockContextPack, readProjectPointer, readVisibleContext,
    removeContextPack, searchVisibleContext, validateContextPack, visiblePackFiles,
} from "../dist/context-pack.js";

const root = mkdtempSync(join(tmpdir(), "cairn-context-pack-"));
process.env.CAIRN_PACK_BASE_DIR = join(root, "store");
const source = join(root, "source");
const project = join(root, "project");
mkdirSync(source); mkdirSync(project);
writeFileSync(join(source, "guide.md"), "# Guide\n\nUse the immutable local guide. 🪨\n");
writeFileSync(join(source, "skill.md"), "# Private skill\n\nNever visible before approval.\n");
await initializeContextPack(source, { id: "local-guide", version: "1.0.0", title: "Local guide", description: "Offline guide", license: "Apache-2.0" });
let manifest = JSON.parse(readFileSync(join(source, "context-pack.json"), "utf8"));
manifest.files.find(({ path }) => path === "skill.md").kind = "skill";
writeFileSync(join(source, "context-pack.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await lockContextPack(source);
const valid = await validateContextPack(source);
assert.match(valid.digest, /^[a-f0-9]{64}$/);

const installed = await Promise.all([installContextPack(source), installContextPack(source)]);
assert.equal(installed[0].pack.digest, installed[1].pack.digest, "concurrent installs converge");
await enableContextPack(valid.digest, { projectRoot: project });
assert.equal((await visiblePackFiles({ projectRoot: project })).length, 1, "unapproved skill hidden");
assert.equal((await listVisibleContext({ projectRoot: project })).packs[0].files.length, 1);
const search = await searchVisibleContext("immutable", { projectRoot: project });
assert.equal(search.search_mode, "substring");
assert.equal(search.results[0].pack_digest, valid.digest);
process.env.CAIRN_LLM_API_KEY = "offline-test";
process.env.CAIRN_MEMORY_EMBEDDING_URL = "http://127.0.0.1:1";
process.env.CAIRN_MEMORY_EMBEDDING_MODEL = "unreachable-test-model";
process.env.CAIRN_MEMORY_EMBEDDING_TIMEOUT_MS = "100";
const fallbackSearch = await searchVisibleContext("immutable", { projectRoot: project });
assert.equal(fallbackSearch.search_mode, "substring", "embedding failure falls back to deterministic search");
delete process.env.CAIRN_LLM_API_KEY;
delete process.env.CAIRN_MEMORY_EMBEDDING_URL;
delete process.env.CAIRN_MEMORY_EMBEDDING_MODEL;
delete process.env.CAIRN_MEMORY_EMBEDDING_TIMEOUT_MS;
assert.equal((await readVisibleContext("local-guide", "guide.md", { projectRoot: project })).kind, "document");
const guideBytes = Buffer.from(readFileSync(join(source, "guide.md"), "utf8"));
const midCodePoint = guideBytes.indexOf(Buffer.from("🪨")) + 1;
const boundedRead = await readVisibleContext("local-guide", "guide.md", { projectRoot: project, offset: midCodePoint, maxBytes: 16 });
assert.doesNotMatch(boundedRead.text, /�/, "bounded reads never emit partial UTF-8 code points");
assert.ok(boundedRead.next_offset === null || boundedRead.next_offset > midCodePoint);

const skills = await listPackSkills({ projectRoot: project });
assert.equal(skills[0].approved, false);
await assert.rejects(() => approvePackSkill(valid.digest, "skill.md", "0".repeat(64), { projectRoot: project }), /confirmation/);
await approvePackSkill(valid.digest, "skill.md", skills[0].file_digest, { projectRoot: project });
assert.equal((await visiblePackFiles({ projectRoot: project })).length, 2, "approved skill visible");

const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("../dist/index.js", import.meta.url).pathname],
    cwd: project,
    env: { ...process.env, CAIRN_CONTEXT_PACKS: "1", CAIRN_PACK_BASE_DIR: process.env.CAIRN_PACK_BASE_DIR },
    stderr: "pipe",
});
const client = new Client({ name: "smoke-context-pack", version: "1" }, { capabilities: {} });
await client.connect(transport);
try {
    const names = (await client.listTools()).tools.map(({ name }) => name);
    for (const name of ["context_pack_list", "context_pack_search", "context_pack_read"]) assert.ok(names.includes(name));
    const listed = await client.callTool({ name: "context_pack_list", arguments: {} });
    assert.equal(listed.structuredContent.packs[0].files.length, 2);
    const searched = await client.callTool({ name: "context_pack_search", arguments: { query: "immutable" } });
    assert.equal(searched.structuredContent.results[0].pack_digest, valid.digest);
    const read = await client.callTool({ name: "context_pack_read", arguments: { pack: "local-guide", path: "skill.md" } });
    assert.equal(read.structuredContent.file_digest, skills[0].file_digest);
} finally {
    await client.close();
}

// Update inspection is non-switching; applying a confirmed digest switches only this project and invalidates approvals.
writeFileSync(join(source, "guide.md"), "# Guide\n\nUpdated immutable local guide.\n");
manifest = JSON.parse(readFileSync(join(source, "context-pack.json"), "utf8"));
manifest.version = "1.1.0";
writeFileSync(join(source, "context-pack.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await lockContextPack(source);
const update = await inspectContextPackUpdate("local-guide", { projectRoot: project });
assert.equal(update.changed, true);
assert.equal(readProjectPointer({ projectRoot: project }).enabled[0].digest, valid.digest, "check did not switch pointer");
await applyContextPackUpdate("local-guide", update.candidate_digest, { projectRoot: project });
assert.equal((await listPackSkills({ projectRoot: project }))[0].approved, false, "update invalidated approval");

// Local Git installs require and record a pinned ref and retain no checkout metadata.
const gitSource = join(root, "git-source");
mkdirSync(gitSource);
writeFileSync(join(gitSource, "readme.md"), "Pinned git pack.\n");
await initializeContextPack(gitSource, { id: "git-guide", version: "1.0.0", title: "Git guide", description: "Pinned", license: "Apache-2.0" });
execFileSync("git", ["init", "-q", gitSource]);
execFileSync("git", ["-C", gitSource, "add", "."]);
execFileSync("git", ["-C", gitSource, "-c", "user.name=Cairnkeep", "-c", "user.email=cairn@example.invalid", "commit", "-qm", "fixture"]);
const gitPack = await installContextPack(gitSource, { ref: "HEAD" });
assert.equal(gitPack.source.kind, "git");
assert.match(gitPack.source.commit, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);

// HTTP exposure requires separate consent and keeps project pointers isolated.
await enableContextPack(gitPack.pack.digest, { projectId: "pack-alpha" });
const token = "context-pack-http-token";
const serverEntry = new URL("../dist/index.js", import.meta.url).pathname;
const waitForListen = (server) => new Promise((resolveListen, reject) => {
    const timer = setTimeout(() => reject(new Error("context-pack HTTP server did not start")), 5000);
    server.stderr.on("data", (chunk) => {
        if (chunk.toString().includes("listening on")) { clearTimeout(timer); resolveListen(); }
    });
    server.on("exit", (code) => { clearTimeout(timer); reject(new Error(`context-pack HTTP server exited early: ${code}`)); });
});
const stopServer = async (server) => {
    if (server.exitCode !== null) return;
    const exited = new Promise((resolveExit) => server.once("exit", resolveExit));
    server.kill("SIGINT");
    await exited;
};
const connectHttp = async (port, projectId) => {
    const remoteClient = new Client({ name: `context-pack-${projectId}`, version: "1" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}`, "X-Cairn-Project": projectId } },
    });
    await remoteClient.connect(transport);
    return remoteClient;
};
const startHttp = async (port, consent) => {
    const env = {
        ...process.env, MCP_HTTP_PORT: String(port), MCP_HTTP_HOST: "127.0.0.1", CAIRN_MEMORY_HTTP_TOKEN: token,
        CAIRN_CONTEXT_PACKS: "1", CAIRN_PACK_BASE_DIR: process.env.CAIRN_PACK_BASE_DIR,
    };
    delete env.CAIRN_MCP_TOOL_PROFILE;
    delete env.CAIRN_MCP_ALLOWED_TOOLS;
    if (consent) env.CAIRN_CONTEXT_PACK_HTTP = "1"; else delete env.CAIRN_CONTEXT_PACK_HTTP;
    const server = spawn(process.execPath, [serverEntry], { cwd: project, env });
    await waitForListen(server);
    return server;
};
const port = 10500 + (process.pid % 500);
let httpServer = await startHttp(port, false);
let remoteClient = await connectHttp(port, "pack-alpha");
assert.equal((await remoteClient.listTools()).tools.some(({ name }) => name.startsWith("context_pack_")), false);
await remoteClient.close();
await stopServer(httpServer);
httpServer = await startHttp(port + 500, true);
const alphaClient = await connectHttp(port + 500, "pack-alpha");
const betaClient = await connectHttp(port + 500, "pack-beta");
try {
    assert.equal((await alphaClient.listTools()).tools.some(({ name }) => name === "context_pack_list"), true);
    assert.equal((await alphaClient.callTool({ name: "context_pack_list", arguments: {} })).structuredContent.packs.length, 1);
    assert.equal((await betaClient.callTool({ name: "context_pack_list", arguments: {} })).structuredContent.packs.length, 0);
} finally {
    await alphaClient.close();
    await betaClient.close();
    await stopServer(httpServer);
}

// Concurrent project updates serialize without losing either digest-pinned enablement.
const concurrentProject = join(root, "concurrent-project");
mkdirSync(concurrentProject);
const updatedDigest = readProjectPointer({ projectRoot: project }).enabled[0].digest;
await Promise.all([
    enableContextPack(updatedDigest, { projectRoot: concurrentProject }),
    enableContextPack(gitPack.pack.digest, { projectRoot: concurrentProject }),
]);
assert.equal(readProjectPointer({ projectRoot: concurrentProject }).enabled.length, 2, "concurrent enablement preserves both packs");
await Promise.all([
    disableContextPack(updatedDigest, { projectRoot: concurrentProject }),
    disableContextPack(gitPack.pack.digest, { projectRoot: concurrentProject }),
]);
assert.equal(readProjectPointer({ projectRoot: concurrentProject }).enabled.length, 0);

// Malicious and corrupt material is rejected before installation.
const bad = join(root, "bad");
mkdirSync(bad);
writeFileSync(join(bad, "x.md"), "x");
symlinkSync(join(bad, "x.md"), join(bad, "link.md"));
writeFileSync(join(bad, "context-pack.json"), JSON.stringify({ schema_version: 1, id: "bad", version: "1.0.0", title: "Bad", description: "Bad", license: "none", files: [{ path: "link.md", kind: "document", title: "Bad", description: "", keywords: [], sha256: createHash("sha256").update("x").digest("hex") }] }));
await assert.rejects(() => validateContextPack(bad), /symlink|unsafe/i);
const linkedRoot = join(root, "linked-root");
symlinkSync(source, linkedRoot);
await assert.rejects(() => validateContextPack(linkedRoot), /symlink|unsafe/i);
await assert.rejects(() => installContextPack(linkedRoot), /symlink|unsafe/i);
writeFileSync(join(source, "guide.md"), "tampered");
await assert.rejects(() => validateContextPack(source), /digest mismatch/);

const current = readProjectPointer({ projectRoot: project }).enabled[0].digest;
await assert.rejects(() => removeContextPack(current), /enabled by a project/);
await disableContextPack("local-guide", { projectRoot: project });
await removeContextPack(current);

const gitSourceRecord = join(process.env.CAIRN_PACK_BASE_DIR, "sources", `${gitPack.pack.digest}.json`);
const validSourceRecord = JSON.parse(readFileSync(gitSourceRecord, "utf8"));
writeFileSync(gitSourceRecord, `${JSON.stringify({ ...validSourceRecord, unexpected: true })}\n`, { mode: 0o600 });
assert.equal((await doctorContextPacks()).ok, false, "doctor rejects corrupt source indexes");
await installContextPack(gitSource, { ref: "HEAD" });
const interrupted = join(process.env.CAIRN_PACK_BASE_DIR, "objects", ".interrupted.tmp");
mkdirSync(interrupted);
assert.equal((await doctorContextPacks()).ok, false, "doctor reports interrupted install remnants");
rmSync(interrupted, { recursive: true });
const doctor = await doctorContextPacks();
assert.equal(doctor.ok, true, JSON.stringify(doctor));

console.log("PASS: immutable context-pack lifecycle, updates, retrieval, and skill approval");
