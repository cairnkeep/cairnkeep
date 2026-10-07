import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateEvalInputs } from "../dist/eval-plan.js";
import { canonicalJson } from "../dist/eval-schema.js";
import { snapshotTaskNotes } from "../dist/eval-runner.js";
import { indexOkfBundle, planOkfExport } from "../dist/okf.js";
import { loadProgressiveContext, doctorProgressiveContextCache } from "../dist/context-pack-retrieval.js";
import { recordPlaybookReceipt, readPlaybookReceipt } from "../dist/playbook-receipt.js";
import { resolvePlaybookStatus } from "../dist/playbook.js";
import { hardenPrivatePath } from "../dist/platform-security.js";

const fixtureBase = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "cairn-bounded-inputs-")));
fs.mkdirSync(join(fixtureBase, "actual"));
// POSIX aliases exercise the same canonicalization boundary as native Windows
// short temporary-directory names, without requiring Windows symlink privileges.
const fixtureParent = process.platform === "win32" ? fixtureBase : join(fixtureBase, "alias");
if (process.platform !== "win32") fs.symlinkSync("actual", fixtureParent, "dir");
const root = fs.realpathSync(fs.mkdtempSync(join(fixtureParent, "inputs-")));
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const failures = [];
let substitution = 0;
const original = {
    lstat: fs.lstatSync, asyncLstat: fs.promises.lstat, open: fs.openSync,
    asyncOpen: fs.promises.open, read: fs.readSync, readFile: fs.readFileSync,
    asyncReadFile: fs.promises.readFile, writeFile: fs.promises.writeFile,
    copyFile: fs.promises.copyFile,
};
function restore() {
    fs.lstatSync = original.lstat;
    fs.promises.lstat = original.asyncLstat;
    fs.openSync = original.open;
    fs.promises.open = original.asyncOpen;
    fs.readSync = original.read;
    fs.readFileSync = original.readFile;
    fs.promises.readFile = original.asyncReadFile;
    fs.promises.writeFile = original.writeFile;
    fs.promises.copyFile = original.copyFile;
    syncBuiltinESMExports();
}
function write(path, bytes, privateFile = false) {
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, bytes, { mode: privateFile ? 0o600 : 0o644 });
    if (privateFile) hardenPrivatePath(path);
}
async function control(name, operation) {
    try { await operation(); }
    catch (error) { failures.push(`${name}: ${error.message}`); }
}
async function replaceAfterInspection(path, bytes, operation) {
    const candidate = join(root, "substitutions", `${++substitution}.candidate`);
    const inspected = join(root, "substitutions", `${substitution}.inspected`);
    write(candidate, bytes);
    let injected = false;
    function replace(target, info) {
        if (target === path && !injected) {
            injected = true;
            fs.renameSync(path, inspected);
            fs.renameSync(candidate, path);
        }
        return info;
    }
    fs.lstatSync = (target, ...args) => replace(target, original.lstat(target, ...args));
    fs.promises.lstat = async (target, ...args) => replace(target, await original.asyncLstat(target, ...args));
    syncBuiltinESMExports();
    try { await operation(); }
    finally { restore(); assert.equal(injected, true, "the public reader must encounter the substitution"); }
}
// Inject same-inode growth at the first content read, after descriptor/path
// inspection. Track real reads, not a production-only testing hook.
async function growAtRead(path, operation) {
    const before = fs.statSync(path).size;
    const tracked = new Set();
    const requests = [];
    let injected = false;
    let unbounded = false;
    const grow = () => {
        if (!injected) { injected = true; fs.appendFileSync(path, " ".repeat(5 * 1024 * 1024)); }
    };
    fs.openSync = (target, ...args) => {
        const fd = original.open(target, ...args);
        if (target === path) tracked.add(fd);
        return fd;
    };
    fs.promises.open = async (target, ...args) => {
        const handle = await original.asyncOpen(target, ...args);
        if (target === path) {
            const read = handle.readFile.bind(handle);
            handle.readFile = (...readArgs) => { unbounded = true; grow(); return read(...readArgs); };
        }
        return handle;
    };
    fs.readSync = (fd, buffer, offset, length, position) => {
        if (tracked.has(fd)) { grow(); requests.push(buffer.byteLength); }
        return original.read(fd, buffer, offset, length, position);
    };
    fs.readFileSync = (target, ...args) => {
        if (target === path || tracked.has(target)) { unbounded = true; grow(); }
        return original.readFile(target, ...args);
    };
    fs.promises.readFile = (target, ...args) => {
        if (target === path) { unbounded = true; grow(); }
        return original.asyncReadFile(target, ...args);
    };
    syncBuiltinESMExports();
    try { await operation(); }
    finally {
        restore();
        assert.equal(injected, true, "the public reader must encounter growth at the content boundary");
        assert.equal(unbounded, false, "runtime readers must not allocate an unbounded readFile result");
        assert.ok(requests.every((size) => size <= before + 1), "growth must not expand the inspected allocation");
    }
}

async function graphCommand(project, command, identity) {
    const previousCwd = process.cwd();
    const previousArgs = process.argv;
    const previousExit = process.exitCode;
    const previousOut = process.stdout.write;
    const previousErr = process.stderr.write;
    const previousListeners = new Set(process.stdout.listeners("error"));
    let stdout = "";
    let stderr = "";
    try {
        process.chdir(project);
        process.argv = [process.execPath, "graph-cli.js", ...command];
        process.exitCode = 0;
        process.stdout.write = (chunk) => { stdout += chunk; return true; };
        process.stderr.write = (chunk) => { stderr += chunk; return true; };
        await import(`../dist/graph-cli.js?${identity}`);
        return { code: process.exitCode, stdout, stderr };
    } finally {
        process.chdir(previousCwd);
        process.argv = previousArgs;
        process.exitCode = previousExit;
        process.stdout.write = previousOut;
        process.stderr.write = previousErr;
        for (const listener of process.stdout.listeners("error")) {
            if (!previousListeners.has(listener)) process.stdout.removeListener("error", listener);
        }
    }
}

try {
    // Simulate a native checkout even on POSIX. Package-owned bundled inputs
    // require exact bytes, so Git must not rewrite their canonical LF ending.
    const checkout = join(root, "checkout");
    fs.mkdirSync(checkout);
    const git = (...args) => {
        const result = spawnSync("git", ["-C", checkout, ...args], {
            encoding: "utf8", shell: false, windowsHide: true, timeout: 10_000,
        });
        assert.equal(result.status, 0, `fixture Git command failed: ${result.stderr}`);
    };
    git("init", "-q");
    git("config", "core.autocrlf", "true");
    git("config", "user.name", "Evaluation Fixture");
    git("config", "user.email", "eval-fixture@example.invalid");
    const bundledPath = join(repository, "examples", "eval", "task-set.json");
    const canonicalBytes = Buffer.from(`${canonicalJson(JSON.parse(fs.readFileSync(bundledPath, "utf8")))}\n`);
    const fixtureTaskSet = join(checkout, "examples", "eval", "task-set.json");
    write(fixtureTaskSet, canonicalBytes);
    write(join(checkout, "ordinary.txt"), "ordinary text\n");
    const attributes = join(repository, ".gitattributes");
    if (fs.existsSync(attributes)) write(join(checkout, ".gitattributes"), fs.readFileSync(attributes));
    git("add", ".");
    git("-c", "commit.gpgsign=false", "commit", "-qm", "checkout fixture");
    fs.unlinkSync(fixtureTaskSet);
    fs.unlinkSync(join(checkout, "ordinary.txt"));
    git("checkout", "--", "examples/eval/task-set.json", "ordinary.txt");
    assert.equal(fs.readFileSync(join(checkout, "ordinary.txt"), "utf8"), "ordinary text\r\n",
        "the fixture must exercise Git's CRLF checkout conversion");
    assert.deepEqual(fs.readFileSync(fixtureTaskSet), canonicalBytes,
        "bundled evaluation bytes must remain canonical under core.autocrlf=true");

    const adapter = join(root, "adapter.json");
    const adapterValue = {
        schema_version: 1, id: "bounded-control",
        command: { program: process.execPath, args: [] },
        turn_semantics: { id: "bounded-turn", description: "Synthetic fixture turn." },
    };
    write(adapter, JSON.stringify(adapterValue));
    const evalOptions = {
        taskSetPath: bundledPath,
        adapterPath: adapter, outputRoot: join(root, "evaluation"), cwd: root,
    };
    assert.equal(validateEvalInputs(evalOptions).adapter_config.id, "bounded-control");
    await control("evaluation replacement", () => replaceAfterInspection(adapter, JSON.stringify({ ...adapterValue, id: "substituted-control" }), () => {
        assert.throws(() => validateEvalInputs(evalOptions), /unsafe|changed/i);
    }));
    write(adapter, JSON.stringify(adapterValue));
    await control("evaluation growth", () => growAtRead(adapter, () => {
        assert.throws(() => validateEvalInputs(evalOptions), /unsafe|changed/i);
    }));
    write(adapter, Buffer.from([0xff, 0xfe]));
    await control("evaluation encoding", () => { assert.throws(() => validateEvalInputs(evalOptions), /UTF-8/); });

    const bundle = join(root, "bundle");
    const reference = join(bundle, "reference.txt");
    write(reference, "Original reference.\n");
    assert.equal((await indexOkfBundle(bundle, ["reference.txt"])).files.length, 1);
    await control("OKF import replacement", () => replaceAfterInspection(reference, "Substituted reference.\n", async () => {
        await assert.rejects(() => indexOkfBundle(bundle, ["reference.txt"]), /unsafe|changed/i);
    }));
    write(reference, "Original reference.\n");
    await control("OKF import growth", () => growAtRead(reference, async () => {
        await assert.rejects(() => indexOkfBundle(bundle, ["reference.txt"]), /unsafe|changed/i);
    }));

    const project = join(root, "project");
    const document = join(project, "docs", "reviewed.md");
    write(document, "# Reviewed\n\nOriginal guide.\n");
    const exportOptions = { projectRoot: project, outputDirectory: join(root, "export"), files: ["docs/reviewed.md"] };
    assert.equal((await planOkfExport(exportOptions)).output_files.length, 2);
    await control("OKF export replacement", () => replaceAfterInspection(document, "# Substituted\n", async () => {
        await assert.rejects(() => planOkfExport(exportOptions), /unsafe|changed/i);
    }));
    write(document, "# Reviewed\n\nOriginal guide.\n");
    await control("OKF export growth", () => growAtRead(document, async () => {
        await assert.rejects(() => planOkfExport(exportOptions), /unsafe|changed/i);
    }));
    assert.equal(fs.existsSync(exportOptions.outputDirectory), false, "failed planning must not publish output");

    const policy = await resolvePlaybookStatus({ projectRoot: project, env: {} });
    const receipt = await recordPlaybookReceipt({
        projectRoot: project, policyDigest: policy.policy_digest, decisionDigest: "a".repeat(64),
        actor: { id: "fixture", kind: "agent", authenticated: false }, sessionId: "bounded-session",
        event: "finish", action: "verify.tests", outcome: "completed", reason: "Synthetic fixture.",
    });
    const receiptPath = join(project, ".agentfs", "playbooks", "receipts", receipt.receipt_id + ".json");
    assert.deepEqual(await readPlaybookReceipt(receipt.receipt_id, project), receipt);
    await control("playbook receipt growth", () => growAtRead(receiptPath, async () => {
        await assert.rejects(() => readPlaybookReceipt(receipt.receipt_id, project), /unsafe|changed/i);
    }));
    write(receiptPath, JSON.stringify(receipt), true);
    if (process.platform !== "win32") {
        fs.chmodSync(receiptPath, 0o644);
        await assert.rejects(() => readPlaybookReceipt(receipt.receipt_id, project), /unsafe/i);
        fs.chmodSync(receiptPath, 0o600);
    }

    const notesRoot = join(root, "task-notes");
    const notePath = join(notesRoot, "notes", "fixture.txt");
    const snapshotOptions = {
        workspace: { notes_path: notesRoot },
        row: { arm: "baseline", repetition: 0, task_id: "fixture" },
        report_store: { experiment_path: join(root, "report") },
        distiller_id: "fixture", distiller_config_digest: "b".repeat(64), trajectory_ref: "fixture",
    };
    write(notePath, "Reviewed note.\n");
    await control("evaluation snapshot replacement", () => replaceAfterInspection(notePath, "Substituted note.\n", async () => {
        await assert.rejects(() => snapshotTaskNotes(snapshotOptions), /unsafe|changed/i);
    }));
    write(notePath, "Reviewed note.\n");
    await control("evaluation snapshot growth", () => growAtRead(notePath, async () => {
        await assert.rejects(() => snapshotTaskNotes(snapshotOptions), /unsafe|changed/i);
    }));
    await control("snapshot publication", () => {
        assert.equal(fs.existsSync(snapshotOptions.report_store.experiment_path), false, "rejected input must not publish a snapshot");
    });
    write(notePath, "Reviewed note.\n");
    const retainedOptions = { ...snapshotOptions, row: { ...snapshotOptions.row, task_id: "retained" } };
    const destination = join(snapshotOptions.report_store.experiment_path, "snapshots", "baseline-r0-retained", "fixture.txt");
    let changedBeforePublication = false;
    function mutateBeforePublication(target) {
        if (target === destination && !changedBeforePublication) {
            changedBeforePublication = true;
            fs.writeFileSync(notePath, "Changed after collection.\n");
        }
    }
    fs.promises.writeFile = (path, ...args) => { mutateBeforePublication(path); return original.writeFile(path, ...args); };
    fs.promises.copyFile = (source, target, ...args) => { mutateBeforePublication(target); return original.copyFile(source, target, ...args); };
    syncBuiltinESMExports();
    await control("snapshot retained bytes", async () => {
        try {
            const snapshot = await snapshotTaskNotes(retainedOptions);
            assert.equal(changedBeforePublication, true);
            assert.equal(fs.readFileSync(join(snapshot.root_path, "fixture.txt"), "utf8"), "Reviewed note.\n");
            assert.equal(snapshot.manifest[0].bytes, Buffer.byteLength("Reviewed note.\n"));
        } finally { restore(); }
    });
    // A sparse oversized input must be rejected before any content read.
    write(notePath, "");
    fs.truncateSync(notePath, 16 * 1024 * 1024 + 1);
    let oversizedRead = false;
    const snapshotDescriptors = new Set();
    fs.openSync = (path, ...args) => {
        const fd = original.open(path, ...args);
        if (path === notePath) snapshotDescriptors.add(fd);
        return fd;
    };
    fs.readSync = (fd, ...args) => { if (snapshotDescriptors.has(fd)) oversizedRead = true; return original.read(fd, ...args); };
    syncBuiltinESMExports();
    await control("snapshot size admission", async () => {
        try {
            await assert.rejects(() => snapshotTaskNotes({ ...snapshotOptions, row: { ...snapshotOptions.row, task_id: "oversized" } }), /unsafe|limit/i);
            assert.equal(oversizedRead, false, "snapshot admission must precede content allocation");
        } finally { restore(); }
    });

    const cacheRoot = join(root, "cache");
    const cacheFile = {
        pack_id: "fixture", version: "1.0.0", pack_digest: "c".repeat(64),
        pack_title: "Fixture", pack_description: "Synthetic fixture.", path: "guide.md",
        kind: "document", title: "Guide", description: "Fixture guide.", keywords: [],
        file_digest: "d".repeat(64), text: "# Guide\n\nOriginal guide.\n",
    };
    const initialCache = await loadProgressiveContext([cacheFile], cacheRoot);
    const cacheDirectory = join(cacheRoot, cacheFile.pack_digest);
    const cachePath = join(cacheDirectory, fs.readdirSync(cacheDirectory)[0]);
    const cacheBytes = fs.readFileSync(cachePath);
    const packs = [{ pack_digest: cacheFile.pack_digest, files: [cacheFile] }];
    assert.equal((await doctorProgressiveContextCache(cacheRoot, packs)).ok, true);
    await control("cache doctor replacement", () => replaceAfterInspection(cachePath, cacheBytes, async () => {
        assert.equal((await doctorProgressiveContextCache(cacheRoot, packs)).ok, false);
    }));
    write(cachePath, cacheBytes);
    await control("cache doctor growth", () => growAtRead(cachePath, async () => {
        assert.equal((await doctorProgressiveContextCache(cacheRoot, packs)).ok, false);
    }));
    assert.equal(fs.existsSync(cachePath), true, "read-only doctor must not remove unsafe derived entries");
    write(cachePath, cacheBytes);
    await control("cache retrieval growth", () => growAtRead(cachePath, async () => {
        const rebuilt = await loadProgressiveContext([cacheFile], cacheRoot);
        assert.equal(rebuilt[0].files[0].abstract, initialCache[0].files[0].abstract);
    }));
    await control("cache rebuilding", async () => {
        assert.equal((await doctorProgressiveContextCache(cacheRoot, packs)).ok, true, "retrieval must rebuild derived cache after a rejected read");
    });

    // Graph CLI has no test-only exports. Invoke its real status command and
    // restore process state, with substitution after actual file inspection.
    const graphProject = join(root, "graph");
    const graphPath = join(graphProject, ".planning", "graphs", "graph.json");
    write(join(graphProject, ".planning", "config.json"), '{"graphify":{"enabled":true}}');
    write(graphPath, '{"nodes":[],"edges":[]}');
    const graphPositive = await graphCommand(graphProject, ["status"], "positive");
    assert.equal(graphPositive.code, 0, graphPositive.stderr);
    assert.match(graphPositive.stdout, /Graph: 0 nodes, 0 edges/);
    await control("graph replacement", () => replaceAfterInspection(graphPath, '{"nodes":[{"id":"substituted"}],"edges":[]}', async () => {
        const result = await graphCommand(graphProject, ["status"], "replacement");
        assert.equal(result.code, 1, result.stderr);
        assert.match(result.stderr, /unsafe|changed/i);
        assert.doesNotMatch(result.stdout, /Graph:/);
    }));
    write(graphPath, '{"nodes":[],"edges":[]}');
    await control("graph growth", () => growAtRead(graphPath, async () => {
        const result = await graphCommand(graphProject, ["status"], "growth");
        assert.equal(result.code, 1, result.stderr);
        assert.match(result.stderr, /unsafe|changed/i);
    }));
    fs.unlinkSync(graphPath);
    const missingGraph = await graphCommand(graphProject, ["query", "fixture"], "missing");
    assert.equal(missingGraph.code, 1);
    assert.match(missingGraph.stderr, /no published graph found/);
    assert.deepEqual(failures, [], "public input readers must bind bounded reads to inspected descriptors");
} finally {
    restore();
    function writable(path) {
        if (process.platform === "win32") return;
        const info = fs.lstatSync(path);
        fs.chmodSync(path, info.isDirectory() ? 0o700 : 0o600);
        if (info.isDirectory()) for (const entry of fs.readdirSync(path)) writable(join(path, entry));
    }
    writable(root);
    fs.rmSync(fixtureBase, { recursive: true, force: true });
}
console.log("PASS: bounded evaluation, OKF, graph, receipt and progressive-cache input reads");
