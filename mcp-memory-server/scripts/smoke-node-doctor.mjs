import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const RED_MARKER = "PHASE16_RED:NODE_DOCTOR_CONTRACT_MISSING";

function snapshot(root) {
    const files = [];
    if (!readdirSync(root, { withFileTypes: true }).length) return files;
    function walk(path) {
        for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
            const child = join(path, entry.name);
            if (entry.isDirectory()) walk(child);
            else files.push([relative(root, child), readFileSync(child).toString("hex")]);
        }
    }
    walk(root);
    return files;
}

async function noteChecks(root) {
    process.env.CAIRN_AGENTFS_BASE_DIR = root;
    const notes = await import("../dist/note-store.js");
    const absent = notes.doctorNoteStore(false);
    assert.equal(absent.exists, false);
    assert.equal(absent.ok, true);
    assert.ok(Array.isArray(absent.transactions), "Phase 16 note journal diagnosis is absent");

    for (const state of ["prepared", "committing", "committed"]) {
        const storeRoot = join(root, `note-${state}`);
        const projectRoot = join(root, "project");
        mkdirSync(projectRoot, { recursive: true });
        const fixture = await notes.createNoteMutationFixture({ projectRoot, storeRoot, operation: "supersede" });
        await assert.rejects(() => notes.applyNoteMutation({ ...fixture, inject_failure: state, failure_mode: "termination" }));
        const beforeInspection = snapshot(storeRoot);
        const diagnosed = notes.doctorNoteStore(false, { storeRoot });
        assert.equal(diagnosed.ok, false);
        assert.equal(diagnosed.transactions?.[0]?.state, state);
        assert.deepEqual(snapshot(storeRoot), beforeInspection, `${state} inspection changed bytes`);
        const repaired = notes.doctorNoteStore(true, { storeRoot });
        assert.equal(repaired.ok, true);
        assert.equal(repaired.repaired, true);
        if (state === "committed") assert.equal(repaired.transactions?.[0]?.action, "finalized");
        else assert.equal(repaired.transactions?.[0]?.action, "rolled_back");
    }

    const corruptRoot = join(root, "note-corrupt-committed");
    const projectRoot = join(root, "project-corrupt");
    mkdirSync(projectRoot, { recursive: true });
    const corrupt = await notes.createNoteMutationFixture({ projectRoot, storeRoot: corruptRoot, operation: "create" });
    await assert.rejects(() => notes.applyNoteMutation({ ...corrupt, inject_failure: "committed", failure_mode: "termination", corrupt_final_hash: true }));
    const beforeRepair = snapshot(corruptRoot);
    const refused = notes.doctorNoteStore(true, { storeRoot: corruptRoot });
    assert.equal(refused.ok, false);
    assert.equal(refused.issues.some((issue) => /backup|final hash/i.test(issue)), true);
    assert.deepEqual(snapshot(corruptRoot), beforeRepair, "unverifiable committed journal was mutated");
}

async function typedChecks(root) {
    const nodes = await import("../dist/node-store.js");
    const absent = await nodes.doctorNodeStore({ scope: "identity", baseDir: root, repair: false });
    assert.deepEqual(absent, { schema_version: 1, exists: false, ok: true, repaired: false, issues: [] });
    for (const kind of ["malformed_type", "malformed_tags", "orphan_metadata", "divergent_replay"]) {
        const fixture = await nodes.createNodeDoctorFixture({ root: join(root, kind), kind });
        const before = snapshot(fixture.root);
        const diagnosed = await nodes.doctorNodeStore({ scope: "identity", baseDir: fixture.root, repair: false });
        assert.equal(diagnosed.ok, false, `${kind} was not diagnosed`);
        assert.deepEqual(snapshot(fixture.root), before, `${kind} inspection changed bytes`);
        const repaired = await nodes.doctorNodeStore({ scope: "identity", baseDir: fixture.root, repair: true });
        if (kind === "orphan_metadata") {
            assert.equal(repaired.ok, true);
            assert.equal(repaired.repaired, true);
        } else {
            assert.equal(repaired.ok, false, `${kind} authoritative corruption was repaired unsafely`);
            assert.deepEqual(snapshot(fixture.root), before, `${kind} authoritative corruption was mutated`);
        }
    }
}

async function main() {
    const root = mkdtempSync(join(tmpdir(), "cairn-node-doctor-"));
    try {
        if (!process.argv.includes("--typed-only")) await noteChecks(root);
        if (!process.argv.includes("--note-only")) await typedChecks(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

try {
    await main();
} catch (error) {
    if (process.argv.includes("--expect-red") && error instanceof assert.AssertionError && /Phase 16 note journal diagnosis is absent/.test(error.message)) {
        console.error(RED_MARKER);
        process.exit(86);
    }
    throw error;
}

console.log("Phase 16 node and note doctor checks passed");
