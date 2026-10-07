import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { isGraphCapabilityCompatible } from "../dist/capability-registry.js";
import { getSkillStore, readSkillApplication, readSkillTarget, rollbackSkillApplication } from "../dist/skill-store.js";
import { hardenPrivatePath } from "../dist/platform-security.js";
import { readWorkEvidence, startWorkEvidence } from "../dist/work-evidence-store.js";
import { readStableJson } from "../dist/stable-file.js";

const root = fs.mkdtempSync(join(tmpdir(), "cairn-runtime-reads-"));
const realLstat = fs.lstatSync;
const realAsyncLstat = fs.promises.lstat;
const realOpen = fs.openSync;
const realClose = fs.closeSync;
const realRead = fs.readSync;
const previousEvidence = process.env.CAIRN_WORK_EVIDENCE;
const failures = [];
const digest = (text) => createHash("sha256").update(text).digest("hex");
function write(path, bytes, privateFile = true) {
    fs.writeFileSync(path, bytes, { mode: privateFile ? 0o600 : 0o644 });
    if (privateFile) hardenPrivatePath(path);
}

// Substitute a real file after the actual caller inspects it. No production
// test hooks and no live projects or endpoints are involved.
async function replacedAfterInspection(path, replacement, operation) {
    const candidate = `${path}.candidate`;
    write(candidate, replacement);
    let injected = false;
    function replace(target, info) {
        if (target === path && !injected) {
            injected = true;
            fs.renameSync(path, `${path}.approved`);
            fs.renameSync(candidate, path);
        }
        return info;
    }
    fs.lstatSync = (target, ...args) => replace(target, realLstat(target, ...args));
    fs.promises.lstat = async (target, ...args) => replace(target, await realAsyncLstat(target, ...args));
    syncBuiltinESMExports();
    try { await operation(); }
    finally {
        fs.lstatSync = realLstat;
        fs.promises.lstat = realAsyncLstat;
        syncBuiltinESMExports();
        assert.equal(injected, true, "the real reader must encounter the replacement window");
    }
}

async function control(name, operation) {
    try { await operation(); }
    catch (error) { failures.push(`${name}: ${error.message}`); }
}

try {
    const project = join(root, "project");
    fs.mkdirSync(join(project, ".planning"), { recursive: true });
    const config = join(project, ".planning", "config.json");
    write(config, '{"graphify":{"enabled":true}}', false);
    assert.equal(await isGraphCapabilityCompatible(project), true, "ordinary non-private project config remains compatible");
    write(config, '{"graphify":{"enabled":false}}', false);
    await control("capability config", () => replacedAfterInspection(config, '{"graphify":{"enabled":true}}', async () => {
        assert.equal(await isGraphCapabilityCompatible(project), false, "a swapped config must not enable graph authority");
    }));

    const target = join(project, "SKILL.md");
    write(target, "# Original\n", false);
    assert.equal(readSkillTarget(project, "SKILL.md").content, "# Original\n");
    await control("skill target", () => replacedAfterInspection(target, "# Replaced\n", () => {
        assert.throws(() => readSkillTarget(project, "SKILL.md"), /unsafe|changed/i);
    }));

    const store = getSkillStore(project);
    const applied = "# Applied\n";
    const original = "# Original\n";
    const backup = join(store.backups, "control.md");
    write(backup, original);
    const application = {
        schema_version: 1, id: "application-control", proposal_id: "proposal-control",
        proposal_digest: "a".repeat(64), evaluation_id: "evaluation-control", evaluation_digest: "b".repeat(64),
        target_path: "SKILL.md", before_digest: digest(original), applied_digest: digest(applied),
        backup_path: relative(project, backup).replaceAll("\\", "/"), target_mode: 0o644,
        state: "applied", applied_at: "2026-01-01T00:00:00.000Z", rolled_back_at: null,
    };
    const ledger = join(store.applications, `${application.id}.json`);
    write(ledger, JSON.stringify(application));
    assert.equal(readSkillApplication(project, application.id).state, "applied");
    await control("skill artifact", () => replacedAfterInspection(ledger, JSON.stringify({ ...application, state: "rolled_back" }), () => {
        assert.throws(() => readSkillApplication(project, application.id), /unsafe|changed/i);
    }));
    write(ledger, JSON.stringify(application));
    write(target, applied, false);
    await control("skill rollback backup", () => replacedAfterInspection(backup, original, () => {
        assert.throws(() => rollbackSkillApplication({ projectRoot: project, applicationId: application.id, confirm: true }), /unsafe|changed/i);
        assert.equal(fs.readFileSync(target, "utf8"), applied, "rejected backup must not change the target");
    }));

    execFileSync("git", ["init", "--quiet", project]);
    process.env.CAIRN_WORK_EVIDENCE = "1";
    const evidence = startWorkEvidence(project, "pi");
    const record = join(project, ".agentfs", "work-evidence", "v1", "records", `${evidence.evidence_id}.json`);
    assert.equal(readWorkEvidence(evidence.evidence_id, project).harness, "pi");
    await control("work-evidence record", () => replacedAfterInspection(record, JSON.stringify({ ...evidence, harness: "opencode" }), () => {
        assert.throws(() => readWorkEvidence(evidence.evidence_id, project), /unsafe|changed/i);
    }));
    assert.deepEqual(failures, [], "runtime readers must reject inspection-to-use replacement");

    const bounded = join(root, "bounded.json");
    const options = { label: "Bounded control", maxBytes: 64, private: true };
    const descriptors = new Set();
    const allocations = [];
    let partialReads = false;
    let grow = false;
    let readCount = 0;
    fs.openSync = (target, ...args) => {
        const fd = realOpen(target, ...args);
        if (target === bounded) descriptors.add(fd);
        return fd;
    };
    fs.closeSync = (fd) => { descriptors.delete(fd); return realClose(fd); };
    fs.readSync = (fd, buffer, offset, length, position) => {
        const tracked = descriptors.has(fd);
        const count = realRead(fd, buffer, offset, tracked && partialReads ? Math.min(1, length) : length, position);
        if (tracked) {
            readCount++;
            allocations.push(buffer.byteLength);
            if (grow) { grow = false; fs.appendFileSync(bounded, "x".repeat(1024)); }
        }
        return count;
    };
    syncBuiltinESMExports();
    write(bounded, '{"safe":true}');
    partialReads = true;
    assert.deepEqual(readStableJson(bounded, options), { safe: true }, "partial descriptor reads are supported");
    assert.equal(descriptors.size, 0);
    partialReads = false;
    for (const [bytes, reason] of [
        ["x".repeat(65), /unsafe/],
        ["secret-sentinel-not-json", /invalid JSON/],
        [Buffer.from([0xff, 0xfe]), /invalid UTF-8/],
    ]) {
        write(bounded, bytes);
        const before = readCount;
        assert.throws(() => readStableJson(bounded, options), (error) => {
            assert.match(error.message, reason);
            assert.equal(error.message.includes(root), false);
            assert.equal(error.message.includes("secret-sentinel"), false);
            return true;
        });
        if (bytes.length > options.maxBytes) assert.equal(readCount, before);
        assert.equal(descriptors.size, 0, "failures close opened descriptors");
    }
    write(bounded, '"' + "x".repeat(62) + '"');
    assert.equal(readStableJson(bounded, options), "x".repeat(62));
    write(bounded, '{"safe":true}');
    allocations.length = 0;
    grow = true;
    assert.throws(() => readStableJson(bounded, options), /changed/);
    assert.ok(allocations.every((size) => size <= Buffer.byteLength('{"safe":true}') + 1));
    assert.equal(descriptors.size, 0);

    if (process.platform !== "win32") {
        write(bounded, '{"safe":true}');
        fs.chmodSync(bounded, 0o644);
        const before = readCount;
        assert.throws(() => readStableJson(bounded, options), /unsafe/);
        assert.equal(readCount, before, "non-private descriptors are rejected before reading");
        fs.chmodSync(bounded, 0o600);
        const link = join(root, "linked.json");
        fs.symlinkSync(bounded, link);
        assert.throws(() => readStableJson(link, options), /symlink/);
        const fifo = join(root, "fifo");
        execFileSync("mkfifo", [fifo]);
        const fifoResult = spawnSync(process.execPath, ["--input-type=module", "-e", `
            import assert from "node:assert/strict";
            import fs from "node:fs";
            import { syncBuiltinESMExports } from "node:module";
            import { readStableJson } from ${JSON.stringify(new URL("../dist/stable-file.js", import.meta.url).href)};
            const original = fs.openSync;
            let injected = false;
            fs.openSync = (path, ...args) => {
                if (path === ${JSON.stringify(bounded)} && !injected) {
                    injected = true;
                    fs.renameSync(path, path + ".regular");
                    fs.renameSync(${JSON.stringify(fifo)}, path);
                }
                return original(path, ...args);
            };
            syncBuiltinESMExports();
            assert.throws(() => readStableJson(${JSON.stringify(bounded)}, ${JSON.stringify(options)}), /unsafe/);
            assert.equal(injected, true);
        `], { encoding: "utf8", timeout: 2000 });
        assert.equal(fifoResult.error, undefined, "special-file substitution must never wait for a writer");
        assert.equal(fifoResult.status, 0, fifoResult.stderr);
    }
    assert.equal(descriptors.size, 0);
} finally {
    fs.lstatSync = realLstat;
    fs.promises.lstat = realAsyncLstat;
    fs.openSync = realOpen;
    fs.closeSync = realClose;
    fs.readSync = realRead;
    syncBuiltinESMExports();
    if (previousEvidence === undefined) delete process.env.CAIRN_WORK_EVIDENCE;
    else process.env.CAIRN_WORK_EVIDENCE = previousEvidence;
    fs.rmSync(root, { recursive: true, force: true });
}

console.log("PASS: capability, skill and work-evidence runtime replacement controls");
