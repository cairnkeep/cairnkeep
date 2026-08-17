import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
    PLAYBOOK_ACTIONS,
    evaluatePlaybook,
    inferChangeTypes,
    initializePlaybook,
    resetPlaybook,
    resolvePlaybookStatus,
    setPlaybookOverride,
    setPlaybookProfile,
} from "../dist/playbook.js";
import { doctorPlaybooks, listPlaybookReceipts, readPlaybookReceipt, recordPlaybookReceipt } from "../dist/playbook-receipt.js";

const root = mkdtempSync(join(tmpdir(), "cairn-playbook-"));
const project = join(root, "project");
mkdirSync(project);

const defaultStatus = await resolvePlaybookStatus({ projectRoot: project, env: {} });
assert.equal(defaultStatus.profile, "balanced");
assert.equal(defaultStatus.source, "default");
assert.equal(defaultStatus.config_exists, false);
assert.deepEqual(defaultStatus.issues, []);
assert.equal(PLAYBOOK_ACTIONS.length, 8);
assert.equal(new Set(PLAYBOOK_ACTIONS.map(({ id }) => id)).size, 8);

const initialized = await initializePlaybook(project, "balanced");
assert.equal(initialized.policy_digest, defaultStatus.policy_digest, "materializing the default must not change effective identity");
const configPath = join(project, ".ai", "playbooks.json");
assert.equal(existsSync(configPath), true);
if (process.platform !== "win32") assert.equal(statSync(configPath).mode & 0o777, 0o600);
await assert.rejects(() => initializePlaybook(project, "strict"), /already exists/);

const strict = await setPlaybookProfile(project, "strict");
assert.equal(strict.modes["context.recall"], "must");
const customized = await setPlaybookOverride(project, "review.repository", "may");
assert.equal(customized.overrides["review.repository"], "may");
assert.equal(customized.modes["review.repository"], "may");
const environment = await resolvePlaybookStatus({ projectRoot: project, env: { CAIRN_PLAYBOOK_PROFILE: "minimal" } });
assert.equal(environment.profile, "minimal");
assert.equal(environment.source, "environment");
assert.equal(environment.modes["review.repository"], "may", "project action override remains exact under a process profile");
const invalidEnvironment = await resolvePlaybookStatus({ projectRoot: project, env: { CAIRN_PLAYBOOK_PROFILE: "arbitrary" } });
assert.deepEqual(invalidEnvironment.issues, ["invalid-environment-profile"]);

assert.deepEqual(inferChangeTypes(["src/auth/token.ts", "package-lock.json", "docs/guide.md", "tests/unit.test.ts"]), ["code", "tests", "docs", "config", "dependencies", "security"]);
assert.throws(() => inferChangeTypes(["../outside.ts"]), /project-relative/);
assert.throws(() => inferChangeTypes(["/absolute.ts"]), /project-relative/);
assert.throws(() => inferChangeTypes(["src/unsafe\u001b.ts"]), /project-relative/);

await setPlaybookProfile(project, "balanced");
await setPlaybookOverride(project, "review.repository", "should");
const decisionOptions = {
    projectRoot: project,
    env: {},
    event: "finish",
    actor: { id: "agent-1", kind: "agent", authenticated: false },
    sessionId: "session-1",
    signals: {
        complexity: "standard",
        familiarity: "mixed",
        risk: "security",
        public_change: true,
        changed_paths: ["src/auth/token.ts"],
        change_types: ["code", "security"],
    },
};
const decisionA = await evaluatePlaybook(decisionOptions);
const decisionB = await evaluatePlaybook(decisionOptions);
assert.deepEqual(decisionA, decisionB, "identical policy inputs must produce byte-stable decisions");
assert.deepEqual(decisionA.blocking_actions, ["verify.tests", "review.security"]);
assert.ok(decisionA.advisory_actions.includes("review.repository"));
assert.ok(decisionA.advisory_actions.includes("docs.update"));
assert.equal(JSON.stringify(decisionA).includes("src/auth/token.ts"), true);

const satisfied = await evaluatePlaybook({
    ...decisionOptions,
    evidence: [
        { action: "verify.tests", outcome: "completed", reason: "targeted and complete suite passed" },
        { action: "review.security", outcome: "completed", reason: "governed audit clean" },
        { action: "review.repository", outcome: "skipped", reason: "reviewed in paired change" },
    ],
});
assert.deepEqual(satisfied.blocking_actions, []);
assert.equal(satisfied.actions.find(({ id }) => id === "review.repository")?.outcome, "skipped");
await assert.rejects(() => evaluatePlaybook({ ...decisionOptions, evidence: [
    { action: "verify.tests", outcome: "completed", reason: "one" },
    { action: "verify.tests", outcome: "completed", reason: "two" },
] }), /Duplicate evidence/);
await assert.rejects(() => evaluatePlaybook({ ...decisionOptions, evidence: [
    { action: "verify.tests", outcome: "completed", reason: "unsafe\nreason" },
] }), /control characters/);
await assert.rejects(() => evaluatePlaybook({
    ...decisionOptions,
    actor: { id: "unsafe\u001bactor", kind: "agent", authenticated: false },
}), /Invalid string/);

const receipt = await recordPlaybookReceipt({
    projectRoot: project,
    policyDigest: decisionA.policy_digest,
    decisionDigest: decisionA.decision_digest,
    actor: decisionA.actor,
    sessionId: decisionA.session_id,
    event: decisionA.event,
    action: "verify.tests",
    outcome: "completed",
    reason: "tests passed",
    now: new Date("2026-08-17T12:00:00.000Z"),
});
assert.match(receipt.receipt_id, /^pbk_[a-f0-9]{32}$/);
assert.equal(receipt.actor.authenticated, false);
const duplicate = await recordPlaybookReceipt({
    projectRoot: project,
    policyDigest: decisionA.policy_digest,
    decisionDigest: decisionA.decision_digest,
    actor: decisionA.actor,
    sessionId: decisionA.session_id,
    event: decisionA.event,
    action: "verify.tests",
    outcome: "completed",
    reason: "tests passed",
    now: new Date("2026-08-17T13:00:00.000Z"),
});
assert.deepEqual(duplicate, receipt, "exact receipt retries must be idempotent");
const concurrentReceipts = await Promise.all([
    new Date("2026-08-17T14:00:00.000Z"),
    new Date("2026-08-17T15:00:00.000Z"),
].map((now) => recordPlaybookReceipt({
    projectRoot: project,
    policyDigest: decisionA.policy_digest,
    decisionDigest: decisionA.decision_digest,
    actor: decisionA.actor,
    sessionId: decisionA.session_id,
    event: decisionA.event,
    action: "review.security",
    outcome: "completed",
    reason: "audit passed",
    now,
})));
assert.deepEqual(concurrentReceipts[0], concurrentReceipts[1], "concurrent identical receipts must publish exactly one immutable value");
assert.deepEqual(await readPlaybookReceipt(receipt.receipt_id.slice(4, 14), project), receipt);
assert.equal((await listPlaybookReceipts(project)).receipts.length, 2);
await assert.rejects(() => recordPlaybookReceipt({
    projectRoot: project,
    policyDigest: "0".repeat(64),
    decisionDigest: decisionA.decision_digest,
    actor: decisionA.actor,
    sessionId: decisionA.session_id,
    event: decisionA.event,
    action: "review.repository",
    outcome: "skipped",
    reason: "not applicable",
}), /stale/);
await assert.rejects(() => recordPlaybookReceipt({
    projectRoot: project,
    policyDigest: decisionA.policy_digest,
    decisionDigest: decisionA.decision_digest,
    actor: decisionA.actor,
    sessionId: decisionA.session_id,
    event: decisionA.event,
    action: "review.repository",
    outcome: "skipped",
}), /require a bounded reason/);
await assert.rejects(() => recordPlaybookReceipt({
    projectRoot: project,
    policyDigest: decisionA.policy_digest,
    decisionDigest: decisionA.decision_digest,
    actor: decisionA.actor,
    sessionId: decisionA.session_id,
    event: decisionA.event,
    action: "verify.tests",
    outcome: "completed",
    reason: "unsafe\u001b[31mreason",
}), /control characters/);
assert.equal((await doctorPlaybooks(project)).ok, true);
const policyRemnant = join(project, ".ai", ".playbooks.json.1.fixture.tmp");
writeFileSync(policyRemnant, "remnant", { mode: 0o600 });
assert.equal((await doctorPlaybooks(project)).ok, false);
unlinkSync(policyRemnant);
const storeRemnant = join(project, ".agentfs", "playbooks", "unexpected.tmp");
writeFileSync(storeRemnant, "remnant", { mode: 0o600 });
assert.equal((await doctorPlaybooks(project)).ok, false);
unlinkSync(storeRemnant);
assert.equal((await doctorPlaybooks(project)).ok, true);

const receiptPath = join(project, ".agentfs", "playbooks", "receipts", `${receipt.receipt_id}.json`);
if (process.platform !== "win32") {
    assert.equal(statSync(receiptPath).mode & 0o777, 0o600);
    chmodSync(receiptPath, 0o644);
    assert.equal((await doctorPlaybooks(project)).ok, false);
    chmodSync(receiptPath, 0o600);

    const receiptDirectory = join(project, ".agentfs", "playbooks", "receipts");
    chmodSync(receiptDirectory, 0o755);
    await assert.rejects(() => recordPlaybookReceipt({
        projectRoot: project,
        policyDigest: decisionA.policy_digest,
        decisionDigest: "2".repeat(64),
        actor: decisionA.actor,
        sessionId: "unsafe-directory",
        event: "finish",
        action: "verify.tests",
        outcome: "completed",
        reason: "test",
    }), /unsafe path/);
    chmodSync(receiptDirectory, 0o700);
}
const storedText = readFileSync(receiptPath, "utf8");
assert.equal(storedText.includes("src/auth/token.ts"), false, "receipts must not store changed paths or source payloads");

const cli = fileURLToPath(new URL("../dist/playbook-cli.js", import.meta.url));
const pendingCli = spawnSync(process.execPath, [cli, "check", "finish", "--project", project, "--changed", "src/auth/token.ts", "--risk", "security", "--session", "cli-1", "--enforce", "--json"], { encoding: "utf8" });
assert.equal(pendingCli.status, 3, pendingCli.stderr);
const pendingValue = JSON.parse(pendingCli.stdout);
assert.deepEqual(pendingValue.blocking_actions, ["verify.tests", "review.security"]);
const completeCli = spawnSync(process.execPath, [cli, "check", "finish", "--project", project, "--changed", "src/auth/token.ts", "--risk", "security", "--session", "cli-1", "--completed", "verify.tests", "review.security", "--enforce", "--json"], { encoding: "utf8" });
assert.equal(completeCli.status, 0, completeCli.stderr);
assert.deepEqual(JSON.parse(completeCli.stdout).blocking_actions, []);
const badCli = spawnSync(process.execPath, [cli, "check", "finish", "--project", project, "--unknown", "payload-sentinel"], { encoding: "utf8" });
assert.equal(badCli.status, 2);

const malicious = join(root, "malicious");
mkdirSync(join(malicious, ".ai"), { recursive: true });
writeFileSync(join(malicious, ".ai", "playbooks.json"), JSON.stringify({ schema_version: 1, profile: "balanced", overrides: {}, command: "curl https://example.invalid" }), { mode: 0o600 });
assert.deepEqual((await resolvePlaybookStatus({ projectRoot: malicious, env: {} })).issues, ["invalid-config"]);

if (process.platform !== "win32") {
    const escaped = join(root, "escaped.json");
    const linked = join(root, "linked");
    mkdirSync(join(linked, ".ai"), { recursive: true });
    writeFileSync(escaped, JSON.stringify({ schema_version: 1, profile: "balanced", overrides: {} }), { mode: 0o600 });
    symlinkSync(escaped, join(linked, ".ai", "playbooks.json"));
    assert.deepEqual((await resolvePlaybookStatus({ projectRoot: linked, env: {} })).issues, ["unsafe-config"]);

    const unsafeStore = join(root, "unsafe-store");
    const external = join(root, "external");
    mkdirSync(unsafeStore);
    mkdirSync(external);
    symlinkSync(external, join(unsafeStore, ".agentfs"));
    const unsafeStatus = await resolvePlaybookStatus({ projectRoot: unsafeStore, env: {} });
    await assert.rejects(() => recordPlaybookReceipt({
        projectRoot: unsafeStore,
        policyDigest: unsafeStatus.policy_digest,
        decisionDigest: "1".repeat(64),
        actor: { id: "agent", kind: "agent", authenticated: false },
        sessionId: "unsafe-1",
        event: "finish",
        action: "verify.tests",
        outcome: "completed",
        reason: "test",
    }), /unsafe/);
}

const concurrent = join(root, "concurrent");
mkdirSync(concurrent);
await Promise.all(["minimal", "balanced", "strict", "balanced"].map((profile) => setPlaybookProfile(concurrent, profile)));
assert.deepEqual((await resolvePlaybookStatus({ projectRoot: concurrent, env: {} })).issues, []);
await Promise.all([setPlaybookProfile(concurrent, "strict"), resetPlaybook(concurrent)]);
assert.deepEqual((await resolvePlaybookStatus({ projectRoot: concurrent, env: {} })).issues, []);

console.log("PASS: strict playbooks, deterministic decisions, enforcement, private receipts, and threat boundaries");
