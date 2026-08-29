import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentFS } from "agentfs-sdk";

import { createMemoryProposal, applyMemoryProposal, doctorMemoryProposals, listMemoryProposals, showMemoryProposal } from "../dist/memory-proposal-store.js";
import { digestValue } from "../dist/memory-proposal-schema.js";
import { applyProposalCandidates } from "../dist/reviewed-memory-store.js";
import { redactTrajectory } from "../dist/trajectory-redaction.js";
import { putTrajectory } from "../dist/trajectory-store.js";

const scratch = mkdtempSync(join(tmpdir(), "cairn-memory-proposals-"));
const project = join(scratch, "project");
const base = join(scratch, "memory");
const oldEnv = { ...process.env };
const realFetch = globalThis.fetch;

async function setMemory(key, value) {
    const agent = await AgentFS.open({ id: "identity", path: join(base, "identity.db") });
    try { await agent.kv.set(key, value); } finally { await agent.close(); }
}

async function getMemory(key) {
    const agent = await AgentFS.open({ id: "identity", path: join(base, "identity.db") });
    try { return await agent.kv.get(key); } finally { await agent.close(); }
}

try {
    mkdirSync(project, { recursive: true });
    mkdirSync(base, { recursive: true });
    process.env.CAIRN_AGENTFS_BASE_DIR = base;
    process.env.CAIRN_LLM_API_URL = "http://offline.invalid/v1";
    process.env.CAIRN_LLM_EXTRACTION_MODEL = "fixture-model";
    delete process.env.CAIRN_LLM_API_KEY;

    const rawSession = {
        schema_version: 1,
        session_id: "proposal-session-1",
        harness: "claude-code",
        project_root: project,
        started_at: "2026-08-29T10:00:00.000Z",
        ended_at: "2026-08-29T10:01:00.000Z",
        events: [{ sequence: 0, kind: "model_output", payload: { text: "Keep the cache rule. proposal-secret-token-123456" } }],
        capture: { captured_at: "2026-08-29T10:01:01.000Z", omitted_reasoning_blocks: 0, omitted_unknown_records: 0, truncated: false },
    };
    await putTrajectory(project, redactTrajectory(rawSession, project), { sessionMaxBytes: 1024 * 1024, storeMaxBytes: 8 * 1024 * 1024, retentionDays: 30 });
    // Simulate a secret becoming known after capture: proposal creation must re-redact.
    process.env.CAIRN_LLM_API_KEY = "proposal-secret-token-123456";
    await setMemory("decisions/update", "old");
    await setMemory("patterns/noop", "unchanged");

    let outbound = "";
    globalThis.fetch = async (_url, init) => {
        outbound = String(init?.body ?? "");
        const content = JSON.stringify({ candidates: [
            { key: "decisions/create", value: "new", category: "decision", importance: 0.9 },
            { key: "decisions/update", value: "updated", category: "decision" },
            { key: "patterns/noop", value: "unchanged", category: "pattern" },
        ] });
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const proposal = await createMemoryProposal({ projectRoot: project, sessionId: "proposal-session-1", scope: "identity" });
    assert.doesNotMatch(outbound, /proposal-secret-token/);
    assert.deepEqual(proposal.candidates.map(({ operation }) => operation), ["create", "update", "noop"]);
    const storedPath = join(project, ".agentfs", "memory-proposals", `${proposal.digest}.json`);
    assert.equal(existsSync(join(project, ".ai", "memory-proposals")), false, "private proposals must never be written under trackable .ai");
    if (process.platform !== "win32") assert.equal(statSync(storedPath).mode & 0o777, 0o600);
    assert.equal(showMemoryProposal(proposal.digest, project).digest, proposal.digest);
    assert.throws(() => showMemoryProposal(proposal.digest.slice(0, 12), project), /full exact/);
    assert.equal(listMemoryProposals(project).length, 1);
    assert.equal(doctorMemoryProposals(project).ok, true);

    function correctlyReseal(value) {
        const { digest: _discarded, ...body } = value;
        return { ...body, digest: digestValue(body) };
    }

    const invalidHash = structuredClone(proposal);
    invalidHash.candidates[0].value_hash = "0".repeat(64);
    const resealedHash = correctlyReseal(invalidHash);
    const resealedHashPath = join(project, ".agentfs", "memory-proposals", `${resealedHash.digest}.json`);
    writeFileSync(resealedHashPath, `${JSON.stringify(resealedHash)}\n`, { mode: 0o600 });
    assert.throws(() => showMemoryProposal(resealedHash.digest, project), /value hash mismatch/,
        "a valid outer digest must not conceal an inconsistent candidate value hash");
    assert.equal(doctorMemoryProposals(project).ok, false, "doctor must detect correctly resealed candidate hash inconsistency");
    rmSync(resealedHashPath);

    const invalidOperation = structuredClone(proposal);
    invalidOperation.candidates[0].operation = "update";
    const resealedOperation = correctlyReseal(invalidOperation);
    const resealedOperationPath = join(project, ".agentfs", "memory-proposals", `${resealedOperation.digest}.json`);
    writeFileSync(resealedOperationPath, `${JSON.stringify(resealedOperation)}\n`, { mode: 0o600 });
    assert.throws(() => showMemoryProposal(resealedOperation.digest, project), /operation is inconsistent/,
        "a valid outer digest must not conceal an operation inconsistent with its base hash");
    await assert.rejects(
        () => applyProposalCandidates("identity", resealedOperation.digest, resealedOperation.candidates, { cwd: project }),
        /operation is inconsistent/,
        "direct proposal application must independently enforce candidate semantics",
    );
    assert.equal(doctorMemoryProposals(project).ok, false, "doctor must detect correctly resealed operation inconsistency");
    rmSync(resealedOperationPath);

    await setMemory("decisions/update", "drifted");
    await assert.rejects(() => applyMemoryProposal(proposal.digest, project), /stale/);
    assert.equal(await getMemory("decisions/create"), undefined, "stale apply must not partially create another candidate");
    assert.equal(await getMemory("patterns/noop"), "unchanged", "stale apply must leave all existing candidates alone");

    await setMemory("decisions/update", "old");
    const applied = await applyMemoryProposal(proposal.digest, project);
    assert.equal(applied.applied, true);
    assert.equal(await getMemory("decisions/create"), "new");
    assert.equal(await getMemory("decisions/update"), "updated");
    const replay = await applyMemoryProposal(proposal.digest, project);
    assert.equal(replay.idempotent, true);

    const changedSession = structuredClone(rawSession);
    changedSession.events[0].payload.text = "The source changed after review.";
    await putTrajectory(project, redactTrajectory(changedSession, project), { sessionMaxBytes: 1024 * 1024, storeMaxBytes: 8 * 1024 * 1024, retentionDays: 30 });
    await assert.rejects(() => applyMemoryProposal(proposal.digest, project), /source trajectory is stale/);

    globalThis.fetch = async () => { throw new Error("offline extraction failure"); };
    await assert.rejects(() => createMemoryProposal({ projectRoot: project, sessionId: "proposal-session-1", scope: "project" }), /offline extraction failure/);
    assert.equal(listMemoryProposals(project).length, 1, "failed extraction must not persist a proposal");

    const bytes = readFileSync(storedPath, "utf8");
    const tampered = JSON.parse(bytes);
    tampered.created_at = "2026-08-29T11:00:00.000Z";
    writeFileSync(storedPath, `${JSON.stringify(tampered)}\n`, { mode: 0o600 });
    assert.throws(() => showMemoryProposal(proposal.digest, project), /digest mismatch/);
    writeFileSync(storedPath, bytes, { mode: 0o600 });
    assert.ok(bytes.includes(proposal.digest));

    if (process.platform !== "win32") {
        chmodSync(storedPath, 0o644);
        assert.equal(doctorMemoryProposals(project).ok, false, "doctor must reject non-private proposal permissions");
        chmodSync(storedPath, 0o600);
        const linkedProject = join(scratch, "linked-project");
        const linkedTarget = join(scratch, "linked-runtime");
        mkdirSync(linkedProject);
        mkdirSync(linkedTarget);
        symlinkSync(linkedTarget, join(linkedProject, ".agentfs"), "dir");
        assert.equal(doctorMemoryProposals(linkedProject).ok, false, "doctor must reject a symlinked .agentfs runtime root");

        const nestedProject = join(scratch, "nested-linked-project");
        const nestedTarget = join(scratch, "nested-linked-target");
        mkdirSync(join(nestedProject, ".agentfs"), { recursive: true, mode: 0o700 });
        mkdirSync(nestedTarget, { mode: 0o700 });
        const nestedSession = structuredClone(rawSession);
        nestedSession.session_id = "proposal-session-nested";
        nestedSession.project_root = nestedProject;
        await putTrajectory(nestedProject, redactTrajectory(nestedSession, nestedProject), {
            sessionMaxBytes: 1024 * 1024, storeMaxBytes: 8 * 1024 * 1024, retentionDays: 30,
        });
        symlinkSync(nestedTarget, join(nestedProject, ".agentfs", "memory-proposals"), "dir");
        assert.throws(() => listMemoryProposals(nestedProject), /not a regular directory/,
            "listing must reject a symlinked nested proposal store");
        assert.throws(() => showMemoryProposal(proposal.digest, nestedProject), /not a regular directory/,
            "show must reject a symlinked nested proposal store before reading through it");
        assert.equal(doctorMemoryProposals(nestedProject).ok, false,
            "doctor must reject a symlinked nested proposal store");
        globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
            candidates: [{ key: "decisions/nested", value: "must not escape" }],
        }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
        await assert.rejects(
            () => createMemoryProposal({ projectRoot: nestedProject, sessionId: nestedSession.session_id, scope: "identity" }),
            /not a regular directory/,
            "proposal writes must reject a symlinked nested store before persistence",
        );
        assert.deepEqual(readdirSync(nestedTarget), [], "rejected writes must leave the symlink target untouched");
    } else {
        const weakened = spawnSync("icacls.exe", [storedPath, "/grant:r", "*S-1-1-0:(R)"], { windowsHide: true });
        assert.equal(weakened.status, 0, "Windows test must be able to weaken the proposal ACL");
        const inspected = spawnSync("icacls.exe", [storedPath], { encoding: "utf8", windowsHide: true });
        assert.equal(
            doctorMemoryProposals(project).ok,
            false,
            `doctor must reject a broadly readable Windows proposal ACL:\n${inspected.stdout || inspected.stderr || "ACL inspection failed"}`,
        );
    }
    console.log("PASS: review-gated memory proposals are private, immutable, stale-safe, atomic, and idempotent");
} finally {
    globalThis.fetch = realFetch;
    process.env = oldEnv;
    rmSync(scratch, { recursive: true, force: true });
}
