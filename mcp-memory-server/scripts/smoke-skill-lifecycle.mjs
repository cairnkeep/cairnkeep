import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { canonicalDigest } from "../dist/eval-schema.js";
import { evaluateSkillProposal, summarizeSkillReport } from "../dist/skill-evaluation.js";
import {
    applySkillEdits,
    applySkillProposal,
    approveSkillCandidate,
    harvestSkillCandidates,
    proposeSkill,
    rollbackSkillApplication,
} from "../dist/skill-store.js";
import { distillProject } from "../dist/note-distiller.js";
import { getTrajectoryLimits, trajectorySessionSchema } from "../dist/trajectory-schema.js";
import { putTrajectory } from "../dist/trajectory-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "fixtures", "notes", "lifecycle-sessions.json"), "utf8"));
const publishedAdapterSchema = z.fromJSONSchema(JSON.parse(readFileSync(
    join(here, "..", "..", "schemas", "skill-adapter.schema.json"), "utf8",
)));
const publishedProtocolSchema = z.fromJSONSchema(JSON.parse(readFileSync(
    join(here, "..", "..", "schemas", "skill-proposal-protocol.schema.json"), "utf8",
)));
const scratch = mkdtempSync(join(tmpdir(), "cairn-skill-lifecycle-"));
const project = join(scratch, "project");
const store = join(scratch, "store");
mkdirSync(project, { recursive: true });
process.env.CAIRN_AGENTFS_BASE_DIR = store;
process.env.CAIRN_NOTE_DISTILLATION = "1";

function session(name) {
    return trajectorySessionSchema.parse(JSON.parse(JSON.stringify(fixture[name]).replaceAll("$PROJECT_ROOT", project)));
}

async function addSession(name, id) {
    await putTrajectory(project, session(name), getTrajectoryLimits());
    await distillProject({ projectRoot: project, sessionId: id });
}

function observation(arm, passState, id) {
    return {
        task_id: id,
        repetition: 0,
        pass: "run1",
        arm,
        state: "terminal",
        capability_status: "valid",
        pass_state: passState,
    };
}

function git(...args) {
    const result = spawnSync("git", ["-C", project, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
}

try {
    assert.equal(applySkillEdits("before TOKEN after", [{
        operation: "replace", anchor: "TOKEN", content: "$& literal", rationale: "literal replacement fixture",
    }]), "before $& literal after");
    await addSession("failure", "note-failure-001");
    assert.equal(harvestSkillCandidates({ projectRoot: project }).candidates.length, 0, "unresolved evidence was harvested");
    await addSession("fix", "note-fix-001");
    await addSession("recurrence", "note-recurrence-001");
    const harvested = harvestSkillCandidates({ projectRoot: project });
    assert.equal(harvested.candidates.length, 1);
    assert.equal(harvested.candidates[0].status, "pending_review");
    const approved = approveSkillCandidate(project, harvested.candidates[0].id);
    assert.equal(approved.status, "approved");

    const target = join(project, "SKILL.md");
    const baseline = "# Review generated API clients\n";
    writeFileSync(target, baseline, { mode: 0o640 });
    const adapterProgram = join(scratch, "proposal-adapter.mjs");
    writeFileSync(adapterProgram, `#!/usr/bin/env node
let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
if (process.env.LEAK_SENTINEL) process.exit(41);
process.stdout.write(JSON.stringify({
  schema_version: 1,
  status: "completed",
  edits: [{ operation: "add", anchor: null, content: "## Generated methods\\n\\nVerify the generated method exists before relying on it.", rationale: request.candidate.failure_family }]
}));
`, { mode: 0o700 });
    chmodSync(adapterProgram, 0o700);
    const adapterConfig = join(scratch, "proposal-adapter.json");
    writeFileSync(adapterConfig, `${JSON.stringify({
        schema_version: 1,
        id: "fixture-proposal-adapter",
        command: { program: adapterProgram, args: [] },
        environment_allowlist: [],
        limits: { elapsed_ms: 10_000, stdout_bytes: 64 * 1024 },
    })}\n`);
    publishedAdapterSchema.parse(JSON.parse(readFileSync(adapterConfig, "utf8")));
    process.env.LEAK_SENTINEL = "must-not-cross-adapter-boundary";
    const proposal = await proposeSkill({
        projectRoot: project,
        candidateId: approved.id,
        targetPath: "SKILL.md",
        adapterPath: adapterConfig,
    });
    assert.equal(readFileSync(target, "utf8"), baseline, "proposal changed the live target");
    assert.match(proposal.candidate_content, /Verify the generated method exists/);
    publishedProtocolSchema.parse({
        schema_version: 1,
        operation: "propose",
        candidate: approved,
        candidate_digest: canonicalDigest(approved),
        target: { path: "SKILL.md", baseline_digest: proposal.baseline_digest, content: baseline },
        edit_budget: 4,
    });
    publishedProtocolSchema.parse({
        schema_version: 1,
        status: "completed",
        edits: proposal.edits,
    });
    const unsafeAdapterConfig = join(scratch, "unsafe-proposal-adapter.json");
    writeFileSync(unsafeAdapterConfig, `${JSON.stringify({
        schema_version: 1,
        id: "unsafe-proposal-adapter",
        command: { program: adapterProgram, args: [] },
        environment_allowlist: ["HOME"],
        limits: { elapsed_ms: 10_000, stdout_bytes: 64 * 1024 },
    })}\n`);
    await assert.rejects(() => proposeSkill({
        projectRoot: project,
        candidateId: approved.id,
        targetPath: "SKILL.md",
        adapterPath: unsafeAdapterConfig,
    }), /isolation-controlled/);
    await assert.rejects(() => proposeSkill({
        projectRoot: project,
        candidateId: harvested.candidates[0].id.replace("candidate", "missing"),
        targetPath: "SKILL.md",
        adapterPath: adapterConfig,
    }));
    mkdirSync(join(project, "linked"));
    symlinkSync(target, join(project, "linked", "SKILL.md"));
    await assert.rejects(() => proposeSkill({
        projectRoot: project,
        candidateId: approved.id,
        targetPath: "linked/SKILL.md",
        adapterPath: adapterConfig,
    }), /symlink/);

    git("init", "-q");
    git("config", "user.name", "Cairn Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("add", "SKILL.md");
    git("commit", "-q", "-m", "fixture source");
    const sourceRevision = git("rev-parse", "HEAD");
    const evalAdapter = join(scratch, "eval-adapter.mjs");
    writeFileSync(evalAdapter, `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const workspace = join(process.cwd(), request.workspace_path);
if (existsSync(join(workspace, "SKILL.md")) && readFileSync(join(workspace, "SKILL.md"), "utf8").includes("Verify the generated method exists")) {
  writeFileSync(join(workspace, "skill-pass"), "ok\\n");
}
process.stdout.write(JSON.stringify({
  schema_version: 1,
  status: "completed",
  observed_capability_digest: request.expected_capability_digest
}));
`, { mode: 0o700 });
    chmodSync(evalAdapter, 0o700);
    const evalAdapterConfig = join(scratch, "eval-adapter.json");
    writeFileSync(evalAdapterConfig, `${JSON.stringify({
        schema_version: 1,
        id: "fixture-eval-adapter",
        command: { program: evalAdapter, args: [] },
        turn_semantics: { id: "fixture-turn", description: "One deterministic fixture transition." },
    })}\n`);
    const task = (id) => ({
        id,
        input: `Use the project skill and complete fixture ${id}.`,
        workspace: { path: "." },
        prepare: { program: "node", args: ["-e", "process.exit(0)"] },
        verify: { program: "node", args: ["-e", "process.exit(require('node:fs').existsSync('skill-pass') ? 0 : 9)"] },
        limits: { elapsed_ms: 10_000, stdout_bytes: 64 * 1024 },
    });
    const taskSet = (id, tasks) => ({
        schema_version: 1,
        id,
        source: { kind: "git", repository: ".", revision: sourceRevision },
        tasks,
    });
    writeFileSync(join(project, "skill-exploration.json"), `${JSON.stringify(taskSet("skill-exploration", [
        task("explore-alpha"), task("explore-beta"),
    ]))}\n`);
    writeFileSync(join(project, "skill-confirmation.json"), `${JSON.stringify(taskSet("skill-confirmation", [
        task("confirm-alpha"), task("confirm-beta"),
    ]))}\n`);
    git("add", "skill-exploration.json", "skill-confirmation.json");
    git("commit", "-q", "-m", "fixture task sets");
    process.env.CAIRN_EVAL = "1";
    const measuredEvaluation = await evaluateSkillProposal({
        projectRoot: project,
        proposalId: proposal.id,
        explorationTaskSetPath: "skill-exploration.json",
        confirmationTaskSetPath: "skill-confirmation.json",
        adapterPath: evalAdapterConfig,
        repetitions: 1,
        minimumImprovement: 1,
        confirm: true,
    });
    assert.equal(measuredEvaluation.status, "eligible");
    assert.equal(measuredEvaluation.exploration.improvements, 2);
    assert.equal(measuredEvaluation.confirmation?.improvements, 2);

    const report = {
        status: "final",
        experiment_kind: "skill_candidate",
        task_set_digest: "1".repeat(64),
        experiment_id: "fixture-skill-eval",
        schedule: [{}, {}, {}, {}],
        observations: [
            observation("baseline", "failed", "task-a"),
            observation("treatment", "passed", "task-a"),
            observation("baseline", "passed", "task-b"),
            observation("treatment", "passed", "task-b"),
        ],
    };
    const summary = summarizeSkillReport(report);
    assert.equal(summary.eligible_pairs, 2);
    assert.equal(summary.improvements, 1);
    assert.equal(summary.regressions, 0);
    assert.equal(summary.unknown, 0);

    const proposalDigest = canonicalDigest(proposal);
    assert.throws(() => applySkillProposal({
        projectRoot: project,
        proposalId: proposal.id,
        evaluationId: measuredEvaluation.id,
        confirmDigest: "0".repeat(64),
    }), /Confirmation digest/);
    const application = applySkillProposal({
        projectRoot: project,
        proposalId: proposal.id,
        evaluationId: measuredEvaluation.id,
        confirmDigest: proposalDigest,
    });
    assert.equal(readFileSync(target, "utf8"), proposal.candidate_content);
    assert.equal(readFileSync(target).byteLength > 0, true);
    const rolledBack = rollbackSkillApplication({ projectRoot: project, applicationId: application.id, confirm: true });
    assert.equal(rolledBack.state, "rolled_back");
    assert.equal(readFileSync(target, "utf8"), baseline);
    assert.throws(() => rollbackSkillApplication({ projectRoot: project, applicationId: application.id, confirm: true }), /applied state/);

    console.log("PASS: reviewed skill proposal, evaluation summary, exact apply and rollback lifecycle");
} finally {
    delete process.env.LEAK_SENTINEL;
    rmSync(scratch, { recursive: true, force: true });
}
