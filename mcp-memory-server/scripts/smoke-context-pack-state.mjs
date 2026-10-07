import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readProjectPointer } from "../dist/context-pack.js";
import { hardenPrivatePath } from "../dist/platform-security.js";
import { readPrivatePackJson } from "../dist/context-pack-state.js";

const root = fs.mkdtempSync(join(tmpdir(), "cairn-pack-state-"));
const previousBase = process.env.CAIRN_PACK_BASE_DIR;
process.env.CAIRN_PACK_BASE_DIR = root;
const directory = join(root, "projects");
fs.mkdirSync(directory, { mode: 0o700 });
const path = join(directory, "remote-race-control.json");
const original = {
    schema_version: 1, project_id: "remote:race-control", enabled: [], skill_approvals: [],
};
const replacement = {
    ...original,
    enabled: [{ id: "forged", version: "1.0.0", digest: "a".repeat(64) }],
    skill_approvals: [{ pack_digest: "a".repeat(64), path: "skill.md", file_digest: "b".repeat(64), approved_at: "2026-01-01T00:00:00.000Z" }],
};
fs.writeFileSync(path, JSON.stringify(original), { mode: 0o600 });
const candidate = join(directory, "replacement.json");
fs.writeFileSync(candidate, JSON.stringify(replacement), { mode: 0o600 });
hardenPrivatePath(path);
hardenPrivatePath(candidate);
const realLstat = fs.lstatSync;
const realOpen = fs.openSync;
const realClose = fs.closeSync;
const realRead = fs.readSync;
function setStateMode(path, mode) {
    const descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
        assert.ok(fs.fstatSync(descriptor).isFile(), "permission controls only modify regular fixture files");
        fs.fchmodSync(descriptor, mode);
    } finally { fs.closeSync(descriptor); }
}
let substituted = false;
try {
    fs.lstatSync = function (target, ...args) {
        const info = realLstat(target, ...args);
        if (target === path && !substituted) {
            substituted = true;
            fs.renameSync(path, join(directory, "approved-before.json"));
            fs.renameSync(candidate, path);
        }
        return info;
    };
    syncBuiltinESMExports();
    assert.throws(() => {
        const accepted = readProjectPointer({ projectId: "race-control" });
        assert.deepEqual(accepted, replacement, "the RED control substitutes a valid forged pointer");
    }, /changed|unsafe/i,
        "replacement after inspection must not introduce forged pack/skill authority");
    assert.equal(substituted, true, "the actual reader must encounter the injected replacement");
    fs.lstatSync = realLstat;
    syncBuiltinESMExports();
    fs.writeFileSync(path, JSON.stringify(original));
    assert.deepEqual(readProjectPointer({ projectId: "race-control" }), original);
    assert.deepEqual(readProjectPointer({ projectId: "absent-control" }), {
        ...original, project_id: "remote:absent-control",
    });

    const state = join(root, "state.json");
    const options = { label: "Private state control", maxBytes: 64 };
    fs.writeFileSync(state, '{"safe":true}', { mode: 0o600 });
    hardenPrivatePath(state);
    const descriptors = new Set();
    let reads = 0;
    let growOnRead = false;
    const allocations = [];
    fs.openSync = function (target, ...args) {
        const fd = realOpen(target, ...args);
        if (target === state) descriptors.add(fd);
        return fd;
    };
    fs.closeSync = function (fd) {
        descriptors.delete(fd);
        return realClose(fd);
    };
    fs.readSync = function (fd, buffer, ...args) {
        const count = realRead(fd, buffer, ...args);
        if (descriptors.has(fd)) {
            reads++;
            allocations.push(buffer.byteLength);
            if (growOnRead) {
                growOnRead = false;
                fs.appendFileSync(state, "x".repeat(1024));
            }
        }
        return count;
    };
    syncBuiltinESMExports();
    assert.deepEqual(readPrivatePackJson(state, options), { safe: true });
    assert.equal(descriptors.size, 0, "successful reads close their descriptor");
    for (const [bytes, reason] of [
        ["x".repeat(65), /too large/],
        ["private-sentinel-not-json", /invalid JSON/],
        [Buffer.from([0xff, 0xfe]), /invalid UTF-8/],
    ]) {
        fs.writeFileSync(state, bytes);
        const before = reads;
        assert.throws(() => readPrivatePackJson(state, options), (error) => {
            assert.match(error.message, reason);
            assert.equal(error.message.includes("private-sentinel"), false, "parse diagnostics never quote private content");
            return true;
        });
        if (bytes.length > options.maxBytes) assert.equal(reads, before, "oversized metadata is rejected before content reads");
        assert.equal(descriptors.size, 0, "failed reads close their descriptor");
    }
    const bounded = '"' + "x".repeat(62) + '"';
    fs.writeFileSync(state, bounded);
    assert.equal(readPrivatePackJson(state, options), "x".repeat(62), "exact size boundary is valid");
    const approvedContent = '{"safe":true}';
    fs.writeFileSync(state, approvedContent);
    const approvedSize = Buffer.byteLength(approvedContent);
    allocations.length = 0;
    growOnRead = true;
    assert.throws(() => readPrivatePackJson(state, options), /changed/);
    assert.ok(allocations.every((size) => size <= approvedSize + 1), "growth cannot enlarge the approved allocation");
    assert.equal(descriptors.size, 0);

    if (process.platform !== "win32") {
        fs.writeFileSync(state, '{"safe":true}');
        setStateMode(state, 0o644);
        const before = reads;
        assert.throws(() => readPrivatePackJson(state, options), /unsafe/);
        assert.equal(reads, before, "non-private descriptors are rejected before reading");
        setStateMode(state, 0o600);
        const link = join(root, "state-link.json");
        fs.symlinkSync(state, link);
        assert.throws(() => readPrivatePackJson(link, options), /unsafe/);
        const dangling = join(root, "dangling.json");
        fs.symlinkSync(join(root, "missing-target"), dangling);
        assert.throws(() => readPrivatePackJson(dangling, { ...options, optional: true }), /unsafe/);

        const fifo = join(root, "fifo.json");
        execFileSync("mkfifo", [fifo]);
        const module = pathToFileURL(fileURLToPath(new URL("../dist/context-pack-state.js", import.meta.url))).href;
        execFileSync(process.execPath, ["--input-type=module", "--eval", [
            `import { readPrivatePackJson } from ${JSON.stringify(module)};`,
            `try { readPrivatePackJson(${JSON.stringify(fifo)}, {label:'FIFO control',maxBytes:64}); process.exit(2); }`,
            "catch(error) { if (!/unsafe/.test(error.message)) process.exit(3); }",
        ].join("\n")], { timeout: 2000 });
    }
    const linkDirectory = join(root, "linked-projects");
    fs.symlinkSync(directory, linkDirectory, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => readPrivatePackJson(join(linkDirectory, "remote-race-control.json"), { ...options, maxBytes: 1024 * 1024 }), /unsafe/);
    assert.throws(() => readPrivatePackJson(join(linkDirectory, "absent.json"), { ...options, optional: true }), /unsafe/);
    assert.equal(readPrivatePackJson(join(root, "absent.json"), { ...options, optional: true }), undefined);
    assert.equal(readPrivatePackJson(join(root, "absent-directory", "state.json"), { ...options, optional: true }), undefined);
    assert.equal(descriptors.size, 0);
} finally {
    fs.lstatSync = realLstat;
    fs.openSync = realOpen;
    fs.closeSync = realClose;
    fs.readSync = realRead;
    syncBuiltinESMExports();
    if (previousBase === undefined) delete process.env.CAIRN_PACK_BASE_DIR;
    else process.env.CAIRN_PACK_BASE_DIR = previousBase;
    fs.rmSync(root, { recursive: true, force: true });
}

console.log("PASS: descriptor-bound pack state, replacement/denial/growth controls and bounded private parsing");
