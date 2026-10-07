import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { acquireContextPackPointerLock } from "../dist/context-pack-lock.js";

const error = (code) => Object.assign(new Error(code), { code });
const directory = { isDirectory: () => true, isSymbolicLink: () => false };
const file = { isDirectory: () => false, isSymbolicLink: () => false };
const symlink = { isDirectory: () => true, isSymbolicLink: () => true };

function operations(platform, createOutcomes, inspectionOutcomes = [directory]) {
    const counts = { create: 0, inspect: 0, wait: 0, remove: 0 };
    const pick = (outcomes, index) => outcomes[Math.min(index, outcomes.length - 1)];
    return {
        counts,
        platform,
        async create(path) {
            assert.equal(path, "pointer.lock");
            const outcome = pick(createOutcomes, counts.create++);
            if (outcome instanceof Error) throw outcome;
        },
        inspect(path) {
            assert.equal(path, "pointer.lock");
            const outcome = pick(inspectionOutcomes, counts.inspect++);
            if (outcome instanceof Error) throw outcome;
            return outcome;
        },
        async wait(milliseconds) {
            assert.equal(milliseconds, 10);
            counts.wait++;
        },
        async remove(path) {
            assert.equal(path, "pointer.lock");
            counts.remove++;
        },
    };
}

for (const inspection of [directory, error("EPERM"), error("EBUSY"), error("ENOENT")]) {
    const ops = operations("win32", [error("EPERM"), undefined], [inspection]);
    const release = await acquireContextPackPointerLock("pointer.lock", ops);
    assert.equal(ops.counts.create, 2);
    assert.equal(ops.counts.wait, 1, "delete-pending absence is paced, not busy-spun");
    assert.equal(ops.counts.remove, 0, "contenders never remove another writer's lock");
    await release();
    assert.equal(ops.counts.remove, 1);
}

for (const platform of ["linux", "win32"]) {
    const ops = operations(platform, [error("EEXIST"), undefined]);
    const release = await acquireContextPackPointerLock("pointer.lock", ops);
    assert.equal(ops.counts.wait, 1);
    await release();
    const vanished = operations(platform, [error("EEXIST"), undefined], [error("ENOENT")]);
    await (await acquireContextPackPointerLock("pointer.lock", vanished))();
    assert.equal(vanished.counts.create, 2);
    for (const unsafe of [file, symlink]) {
        for (const code of platform === "win32" ? ["EEXIST", "EPERM"] : ["EEXIST"]) {
            const bad = operations(platform, [error(code)], [unsafe]);
            await assert.rejects(() => acquireContextPackPointerLock("pointer.lock", bad), /lock is unsafe/);
            assert.equal(bad.counts.create, 1);
            assert.equal(bad.counts.remove, 0);
        }
    }
}

for (const platform of ["linux", "win32"]) {
    const denied = operations(platform, [error("EACCES")]);
    await assert.rejects(() => acquireContextPackPointerLock("pointer.lock", denied), { code: "EACCES" });
    assert.equal(denied.counts.create, 1);
    assert.equal(denied.counts.inspect, 0);
    const badInspection = operations(platform, [error("EEXIST")], [error("EACCES")]);
    await assert.rejects(() => acquireContextPackPointerLock("pointer.lock", badInspection), { code: "EACCES" });
    assert.equal(badInspection.counts.remove, 0);
}
const posixDenied = operations("linux", [error("EPERM")]);
await assert.rejects(() => acquireContextPackPointerLock("pointer.lock", posixDenied), { code: "EPERM" });
assert.equal(posixDenied.counts.create, 1);
const posixBusy = operations("linux", [error("EEXIST")], [error("EBUSY")]);
await assert.rejects(() => acquireContextPackPointerLock("pointer.lock", posixBusy), { code: "EBUSY" });

for (const inspection of [directory, error("EPERM"), error("EBUSY"), error("ENOENT")]) {
    const persistent = operations("win32", [error("EPERM")], [inspection]);
    await assert.rejects(() => acquireContextPackPointerLock("pointer.lock", persistent), /pointer is locked/);
    assert.equal(persistent.counts.create, 200, "contention retries are bounded");
    assert.equal(persistent.counts.wait, 200);
    assert.equal(persistent.counts.remove, 0, "exhaustion never steals a lock");
}

// Real independent processes exercise the native filesystem as well as the
// deterministic injected controls. Exclusive marker creation detects overlap.
const root = await mkdtemp(join(tmpdir(), "cairn-pointer-lock-"));
const worker = `
    import { mkdir, rm, writeFile } from "node:fs/promises";
    import { join } from "node:path";
    import { acquireContextPackPointerLock } from ${JSON.stringify(new URL("../dist/context-pack-lock.js", import.meta.url).href)};
    const [root, id] = process.argv.slice(1);
    for (let turn = 0; turn < 3; turn++) {
        const release = await acquireContextPackPointerLock(join(root, "pointer.lock"));
        try {
            await mkdir(join(root, "critical"));
            await new Promise(resolve => setTimeout(resolve, 10));
            await writeFile(join(root, id + "-" + turn), "completed", { flag: "wx", mode: 0o600 });
            await rm(join(root, "critical"), { recursive: true });
        } finally { await release(); }
    }
`;
try {
    await Promise.all(Array.from({ length: 4 }, (_, id) => promisify(execFile)(
        process.execPath, ["--input-type=module", "--eval", worker, root, String(id)],
        { timeout: 15_000, windowsHide: true },
    )));
    assert.deepEqual((await readdir(root)).sort(), Array.from({ length: 4 }, (_, id) =>
        Array.from({ length: 3 }, (_, turn) => `${id}-${turn}`)).flat().sort());
} finally {
    await rm(root, { recursive: true, force: true });
}

console.log("PASS: bounded pointer-lock contention, unsafe-lock controls and native cross-process exclusion");
