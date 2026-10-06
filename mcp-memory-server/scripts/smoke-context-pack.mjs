import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { linkSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
// The offline baseline must not inherit a developer's optional embedding
// configuration. This process later installs an explicit unreachable fixture
// to verify fallback behavior.
for (const name of [
    "CAIRN_LLM_API_KEY", "CAIRN_LLM_API_URL", "CAIRN_MEMORY_EMBEDDING_URL",
    "CAIRN_MEMORY_EMBEDDING_MODEL", "CAIRN_MEMORY_EMBEDDING_TIMEOUT_MS",
]) delete process.env[name];
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

const compactPack = join(root, "compact-pack");
mkdirSync(compactPack);
for (let index = 0; index < 128; index += 1) writeFileSync(join(compactPack, `f${String(index).padStart(3, "0")}.md`), "x");
await initializeContextPack(compactPack, { id: "compact-pack", version: "1.0.0", title: "Compact", description: "Small-file memory bound", license: "none" });
const externalBeforeCompactValidation = process.memoryUsage().external;
const compactValidated = await validateContextPack(compactPack);
const compactExternalGrowth = process.memoryUsage().external - externalBeforeCompactValidation;
assert.equal(compactValidated.manifest.files.length, 128);
assert.ok(compactExternalGrowth < 16 * 1024 * 1024, `small pack retained excessive external memory: ${compactExternalGrowth}`);

if (process.platform !== "win32") {
    const fifoPack = join(root, "fifo-pack");
    mkdirSync(fifoPack);
    execFileSync("mkfifo", [join(fifoPack, "context-pack.json")]);
    const contextPackModule = pathToFileURL(fileURLToPath(new URL("../dist/context-pack.js", import.meta.url))).href;
    const fifoProbe = execFileSync(process.execPath, ["--input-type=module", "--eval", [
        `const packs = await import(${JSON.stringify(contextPackModule)});`,
        `try { await packs.validateContextPack(${JSON.stringify(fifoPack)}); process.exit(2); } catch {}`,
    ].join("\n")], { encoding: "utf8", timeout: 2_000 });
    assert.equal(fifoProbe, "", "FIFO manifest is rejected without output or blocking");

    const invalidInitCases = [
        ["forbidden-init", [["a?.md", "bad\n"]]],
        ["reserved-init", [["NUL.txt", "bad\n"]]],
        ["manifest-case-init", [["Context-Pack.json", "shadow\n"]]],
    ];
    if (process.platform !== "darwin") invalidInitCases.push(
        ["case-collision-init", [["docs.md", "one\n"], ["Docs.md", "two\n"]]],
        ["normalization-collision-init", [["café.md", "one\n"], ["cafe\u0301.md", "two\n"]]],
    );
    for (const [name, files] of invalidInitCases) {
        const candidate = join(root, name);
        mkdirSync(candidate);
        for (const [path, content] of files) writeFileSync(join(candidate, path), content);
        await assert.rejects(
            () => initializeContextPack(candidate, { id: name, version: "1.0.0", title: name, description: name, license: "none" }),
            /unsafe|portable|duplicate|reserved/i,
        );
        assert.equal(readdirSync(candidate).includes("context-pack.json"), false, "failed init is atomic");
    }

    const decomposedOnly = join(root, "decomposed-only");
    mkdirSync(decomposedOnly);
    const rawName = "e\u0301.md";
    writeFileSync(join(decomposedOnly, rawName), "first\n");
    const initialized = await initializeContextPack(decomposedOnly, { id: "decomposed-only", version: "1.0.0", title: "Decomposed", description: "Raw path", license: "none" });
    assert.equal(initialized.files[0].path, "é.md");
    writeFileSync(join(decomposedOnly, rawName), "second\n");
    const relocked = await lockContextPack(decomposedOnly);
    assert.equal(relocked.files[0].sha256, createHash("sha256").update("second\n").digest("hex"));
    await validateContextPack(decomposedOnly);

    const totalBoundary = join(root, "total-boundary-init");
    mkdirSync(totalBoundary);
    const firstBoundaryFile = join(totalBoundary, "file-00.md");
    writeFileSync(firstBoundaryFile, Buffer.alloc(1024 * 1024, 0x61));
    for (let index = 1; index < 64; index += 1) linkSync(firstBoundaryFile, join(totalBoundary, `file-${String(index).padStart(2, "0")}.md`));
    await assert.rejects(
        () => initializeContextPack(totalBoundary, { id: "total-boundary", version: "1.0.0", title: "Boundary", description: "Boundary", license: "none" }),
        /size limit/i,
    );
    assert.equal(readdirSync(totalBoundary).includes("context-pack.json"), false, "total-size rejection does not write a manifest");

    const lockBoundary = join(root, "lock-boundary");
    mkdirSync(lockBoundary);
    const emptyDigest = createHash("sha256").update("").digest("hex");
    const boundaryFiles = [];
    for (let index = 0; index < 1024; index += 1) {
        const path = `f${String(index).padStart(4, "0")}.md`;
        writeFileSync(join(lockBoundary, path), "");
        boundaryFiles.push({
            path, kind: "document", title: path, description: "x".repeat(810), keywords: [], sha256: emptyDigest,
        });
    }
    const compactBoundaryManifest = Buffer.from(JSON.stringify({
        schema_version: 1,
        id: "lock-boundary",
        version: "1.0.0",
        title: "Lock boundary",
        description: "Atomic lock boundary",
        license: "none",
        files: boundaryFiles,
    }));
    assert.ok(compactBoundaryManifest.byteLength <= 1024 * 1024, "fixture starts below the manifest limit");
    const lockBoundaryManifestPath = join(lockBoundary, "context-pack.json");
    writeFileSync(lockBoundaryManifestPath, compactBoundaryManifest);
    await assert.rejects(() => lockContextPack(lockBoundary), /size limit/i);
    assert.deepEqual(readFileSync(lockBoundaryManifestPath), compactBoundaryManifest, "failed lock preserves original manifest bytes");
}

if (process.platform === "darwin") {
    const decomposed = join(root, "decomposed-source");
    mkdirSync(decomposed);
    writeFileSync(join(decomposed, "cafe\u0301.md"), "macOS normalization\n");
    await initializeContextPack(decomposed, { id: "macos-normalization", version: "1.0.0", title: "macOS", description: "Normalization", license: "none" });
    const normalizedPack = await validateContextPack(decomposed);
    assert.equal(normalizedPack.manifest.files[0].path, "café.md");
}

const installed = await Promise.all([installContextPack(source), installContextPack(source)]);
assert.equal(installed[0].pack.digest, installed[1].pack.digest, "concurrent installs converge");
assert.equal(installed.filter(({ existing }) => existing).length, 1, "concurrent install identifies exactly one existing object");
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
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    cwd: project,
    env: { ...process.env, CAIRN_CONTEXT_PACKS: "1", CAIRN_PACK_BASE_DIR: process.env.CAIRN_PACK_BASE_DIR },
    stderr: "pipe",
});
const client = new Client({ name: "smoke-context-pack", version: "1" }, { capabilities: {} });
await client.connect(transport);
try {
    const names = (await client.listTools()).tools.map(({ name }) => name);
    for (const name of ["context_pack_list", "context_pack_search", "context_pack_read", "context_pack_related"]) assert.ok(names.includes(name));
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
const attributes = "readme.md text eol=crlf\n";
writeFileSync(join(gitSource, ".gitattributes"), attributes);
const gitManifestPath = join(gitSource, "context-pack.json");
const gitManifest = JSON.parse(readFileSync(gitManifestPath, "utf8"));
gitManifest.files.unshift({
    path: ".gitattributes", kind: "document", title: "Git attributes",
    description: "Line-ending checkout fixture.", keywords: ["git"],
    sha256: createHash("sha256").update(attributes).digest("hex"),
});
writeFileSync(gitManifestPath, `${JSON.stringify(gitManifest, null, 2)}\n`);
await lockContextPack(gitSource);
execFileSync("git", ["init", "-q", gitSource]);
execFileSync("git", ["-C", gitSource, "add", "."]);
execFileSync("git", ["-C", gitSource, "-c", "user.name=Cairnkeep", "-c", "user.email=cairn@example.invalid", "commit", "-qm", "fixture"]);
const gitPack = await installContextPack(gitSource, { ref: "HEAD" });
assert.equal(gitPack.source.kind, "git");
assert.match(gitPack.source.commit, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);

// HTTP exposure requires separate consent and keeps project pointers isolated.
await enableContextPack(gitPack.pack.digest, { projectId: "pack-alpha" });
const token = "context-pack-http-token";
const serverEntry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
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
const oversizedManifest = join(root, "oversized-manifest");
mkdirSync(oversizedManifest);
writeFileSync(join(oversizedManifest, "context-pack.json"), `${JSON.stringify({ schema_version: 1, id: "oversized", version: "1.0.0", title: "Oversized", description: "Oversized", license: "none", files: [] })}${" ".repeat(1024 * 1024)}\n`);
await assert.rejects(() => validateContextPack(oversizedManifest), /manifest.*unsafe/i);
const colliding = join(root, "colliding");
mkdirSync(colliding);
writeFileSync(join(colliding, "docs.md"), "portable\n");
const collidingDigest = createHash("sha256").update("portable\n").digest("hex");
writeFileSync(join(colliding, "context-pack.json"), JSON.stringify({
    schema_version: 1, id: "colliding", version: "1.0.0", title: "Colliding",
    description: "Portable collision", license: "none",
    files: ["docs.md", "Docs.md"].map((path) => ({
        path, kind: "document", title: path, description: "", keywords: [], sha256: collidingDigest,
    })),
}));
await assert.rejects(() => validateContextPack(colliding), /duplicate|reserved/i);
if (process.platform !== "darwin" && process.platform !== "win32") {
    const unicodeShadow = join(root, "unicode-shadow");
    mkdirSync(unicodeShadow);
    const composed = "café.md";
    const decomposed = "cafe\u0301.md";
    writeFileSync(join(unicodeShadow, composed), "declared\n");
    writeFileSync(join(unicodeShadow, decomposed), "undeclared shadow\n");
    const digest = createHash("sha256").update("declared\n").digest("hex");
    writeFileSync(join(unicodeShadow, "context-pack.json"), JSON.stringify({
        schema_version: 1, id: "unicode-shadow", version: "1.0.0", title: "Unicode shadow",
        description: "Physical normalization collision", license: "none",
        files: [{ path: composed, kind: "document", title: "Declared", description: "", keywords: [], sha256: digest }],
    }));
    const objectCount = readdirSync(join(process.env.CAIRN_PACK_BASE_DIR, "objects")).length;
    await assert.rejects(() => validateContextPack(unicodeShadow), /duplicate portable/i);
    await assert.rejects(() => installContextPack(unicodeShadow), /duplicate portable/i);
    assert.equal(readdirSync(join(process.env.CAIRN_PACK_BASE_DIR, "objects")).length, objectCount, "rejected shadow bytes were not published");
}
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
