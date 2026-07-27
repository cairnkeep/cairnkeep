import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { AgentFS } from "agentfs-sdk";

const EXPECTED_RED_EXIT = 86;
const RED_MARKER = "PHASE18_RED:CAPABILITY_HARNESS_BOUNDARY";
const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");
const projectRoot = resolve(serverRoot, "..");
const coordinatorPath = join(serverRoot, "dist", "capability-harness.js");
const capabilityCliPath = join(serverRoot, "dist", "capability-cli.js");
const loggingSmokePath = join(here, "smoke-capability-logging.mjs");
const fixturePath = join(projectRoot, "scripts", "fixtures", "capability-harness-contracts.json");
const DB_RELATIVE = join(".agentfs", "trajectory.db");
const PENDING_PREFIX = "capability-callback/v1/pending/";
const FINAL_PREFIX = "capability-callback/v1/record/";
const SENTINELS = [
    "prompt-sentinel-18-17",
    "argument-sentinel-18-17",
    "result-sentinel-18-17",
    "raw-error-sentinel-18-17",
];
const ALLOW = { schema_version: 1, decision: "allow" };
const BLOCK = { schema_version: 1, decision: "block", reason: "capability-disabled" };

function mode() {
    const [selected, ...extra] = process.argv.slice(2);
    assert.equal(extra.length, 0, "smoke-capability-harness accepts at most one mode");
    assert.equal([undefined, "--expect-red", "--core", "--crash-cwd", "--session-isolation"].includes(selected), true,
        `unknown smoke-capability-harness mode: ${String(selected)}`);
    return selected;
}

function run(command, args, options = {}) {
    return spawnSync(command, args, {
        cwd: options.cwd ?? projectRoot,
        encoding: "utf8",
        env: { ...process.env, ...options.env },
        input: options.input,
        timeout: 120_000,
    });
}

function assertSuccess(result, label) {
    assert.equal(result.status, 0, `${label} failed:\n${result.stdout}${result.stderr}`);
}

function runPrerequisites() {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
    assert.equal(fixture.claude?.version, "2.1.220");
    assert.equal(fixture.opencode?.version, "1.17.20");
    assert.equal(fixture.opencode?.source?.commit, "4473fc3c9055046183990a965d68df3db7ea6f62");
    assertSuccess(
        run(process.execPath, [loggingSmokePath, "--operating-finish-only"], { cwd: projectRoot }),
        "existing consent/provenance contract",
    );
}

function isOnlyMissingCoordinator(error) {
    return error?.code === "ERR_MODULE_NOT_FOUND"
        && String(error.message ?? "").includes("/dist/capability-harness.js");
}

async function loadCoordinator() {
    return import(pathToFileURL(coordinatorPath).href);
}

function assertCoordinatorSurface(coordinator) {
    for (const name of [
        "harnessCapabilityBeforeInputSchema",
        "harnessCapabilityTerminalInputSchema",
        "beginHarnessCapability",
        "finishHarnessCapability",
        "abandonHarnessCapability",
        "recoverHarnessCapabilities",
        "observeHarnessCwdChanged",
        "getHarnessCapabilityLeaseDirectory",
    ]) {
        assert.notEqual(coordinator[name], undefined, `missing coordinator export ${name}`);
    }
}

function fullEnvironment(overrides = {}) {
    return {
        CAIRN_CAPABILITY_CONTRACT: "1",
        CAIRN_CAPABILITY_LOGGING: "1",
        CAIRN_TRAJECTORY_CAPTURE: "1",
        CAIRN_CAPABILITY_WIKI: "1",
        CAIRN_CAPABILITY_GRAPH: "1",
        CAIRN_CAPABILITY_SECURITY_AUDIT: "1",
        ...overrides,
    };
}

async function withEnvironment(changes, operation) {
    const previous = new Map(Object.keys(changes).map((key) => [key, process.env[key]]));
    for (const [key, value] of Object.entries(changes)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
    try {
        return await operation();
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
}

function fixtureRoot(label) {
    const base = mkdtempSync(join(tmpdir(), `cairn-harness-${label}-`));
    const original = join(base, "original");
    const decoy = join(base, "decoy");
    const state = join(base, "state");
    for (const directory of [original, decoy, state]) {
        // realpath requires the directories to exist; mkdtemp gives only base.
        const result = run(process.execPath, ["-e", `require("node:fs").mkdirSync(${JSON.stringify(directory)},{recursive:true})`]);
        assertSuccess(result, `create ${label} fixture directory`);
    }
    return { base, original: realpathSync(original), decoy: realpathSync(decoy), state: realpathSync(state) };
}

function beforeInput(root, overrides = {}) {
    return {
        schema_version: 1,
        harness: "claude-code",
        command: "wiki-query",
        session_id: "session-18-17",
        project_root: root,
        ...overrides,
    };
}

function terminalInput(overrides = {}) {
    return {
        schema_version: 1,
        harness: "claude-code",
        session_id: "session-18-17",
        outcome: "success",
        ...overrides,
    };
}

async function rows(root, prefix) {
    const dbPath = join(root, DB_RELATIVE);
    if (!existsSync(dbPath)) return [];
    const agent = await AgentFS.open({ id: "trajectory", path: dbPath });
    try {
        return await agent.kv.list(prefix);
    } finally {
        await agent.close();
    }
}

function allFiles(root) {
    if (!existsSync(root)) return [];
    const found = [];
    for (const name of readdirSync(root)) {
        const path = join(root, name);
        if (statSync(path).isDirectory()) found.push(...allFiles(path));
        else found.push(path);
    }
    return found;
}

function rawBytes(root, stateRoot) {
    const dbDir = join(root, ".agentfs");
    const files = [
        ...allFiles(stateRoot),
        ...(existsSync(dbDir) ? readdirSync(dbDir)
            .filter((name) => /^trajectory\.db(?:-(?:wal|shm))?$/.test(name))
            .map((name) => join(dbDir, name)) : []),
    ];
    return Buffer.concat(files.map((path) => readFileSync(path)));
}

async function assertNoState(root, stateRoot, label) {
    assert.equal(existsSync(join(root, DB_RELATIVE)), false, `${label} created the callback database`);
    assert.deepEqual(allFiles(stateRoot), [], `${label} created a recoverable lease`);
}

async function assertSettledCount(root, stateRoot, outcome, count) {
    assert.equal((await rows(root, PENDING_PREFIX)).length, 0, "settlement left pending state");
    const finals = await rows(root, FINAL_PREFIX);
    assert.equal(finals.length, count, `settlement did not retain exactly ${count} final rows`);
    assert.equal(finals.every(({ value }) => value.outcome === outcome), true);
    assert.deepEqual(allFiles(stateRoot), [], "settlement left a recoverable lease");
    return finals.map(({ value }) => value);
}

async function assertSettledOnce(root, stateRoot, outcome) {
    return assertSettledCount(root, stateRoot, outcome, 1);
}

function assertLeasePolicy(coordinator, project, stateRoot) {
    const leaseDir = coordinator.getHarnessCapabilityLeaseDirectory({ state_root: stateRoot });
    assert.equal(resolve(leaseDir).startsWith(`${resolve(stateRoot)}/`) || resolve(leaseDir) === resolve(stateRoot), true);
    for (const path of allFiles(leaseDir)) {
        assert.equal(statSync(path).mode & 0o077, 0, "lease is not mode restricted");
        assert.equal(statSync(path).size <= 4096, true, "lease is not bounded");
        const bytes = readFileSync(path, "utf8");
        assert.equal(bytes.includes(realpathSync(project)), true, "lease omitted its validated project locator");
        for (const sentinel of SENTINELS) assert.equal(bytes.includes(sentinel), false, `lease leaked ${sentinel}`);
    }
}

async function coreChecks(coordinator) {
    assertCoordinatorSurface(coordinator);
    const commandCases = new Map([
        ["wiki-ingest", "wiki"],
        ["wiki-query", "wiki"],
        ["wiki-lint", "wiki"],
        ["graphify", "graph"],
        ["security-audit", "security.audit"],
    ]);
    for (const [command, capability] of commandCases) {
        const parsed = coordinator.harnessCapabilityBeforeInputSchema.parse(beforeInput("/fixture/project", { command }));
        assert.equal(parsed.command, command);
        assert.equal(coordinator.commandCapability(command), capability);
    }

    const masterOff = fixtureRoot("master-off");
    try {
        const legacyResult = { ok: true, value: SENTINELS[2] };
        let coordinatorCalls = 0;
        const owner = () => legacyResult;
        const actual = await withEnvironment(fullEnvironment({ CAIRN_CAPABILITY_CONTRACT: "0", CAIRN_HARNESS_STATE_DIR: masterOff.state }), async () => {
            if (/^(?:1|true|yes|on)$/i.test(process.env.CAIRN_CAPABILITY_CONTRACT ?? "")) {
                coordinatorCalls += 1;
                await coordinator.beginHarnessCapability(beforeInput(masterOff.original));
            }
            return owner();
        });
        assert.equal(actual, legacyResult);
        assert.equal(coordinatorCalls, 0, "master-off path invoked the coordinator");
        await assertNoState(masterOff.original, masterOff.state, "master off");
    } finally {
        rmSync(masterOff.base, { recursive: true, force: true });
    }

    for (const [label, consentEnv] of [
        ["logging off", { CAIRN_CAPABILITY_LOGGING: "0" }],
        ["capture off", { CAIRN_TRAJECTORY_CAPTURE: "0" }],
    ]) {
        const disabled = fixtureRoot(`disabled-${label.replace(" ", "-")}`);
        try {
            const env = fullEnvironment({ CAIRN_CAPABILITY_WIKI: "0", CAIRN_HARNESS_STATE_DIR: disabled.state, ...consentEnv });
            const result = await withEnvironment(env, () => coordinator.beginHarnessCapability(beforeInput(disabled.original)));
            assert.deepEqual(result, { schema_version: 1, decision: "block", reason: "capability-disabled" });
            await assertNoState(disabled.original, disabled.state, `disabled ${label}`);
        } finally {
            rmSync(disabled.base, { recursive: true, force: true });
        }
    }

    const disabledMeasured = fixtureRoot("disabled-measured");
    try {
        const session = "session-disabled-measured-18-31";
        const env = fullEnvironment({ CAIRN_CAPABILITY_WIKI: "0", CAIRN_HARNESS_STATE_DIR: disabledMeasured.state });
        const input = beforeInput(disabledMeasured.original, { session_id: session });
        const first = await withEnvironment(env, () => coordinator.beginHarnessCapability(input));
        const second = await withEnvironment(env, () => coordinator.beginHarnessCapability(input));
        assert.deepEqual(first, { schema_version: 1, decision: "block", reason: "capability-disabled" });
        assert.deepEqual(second, first);
        const finals = await assertSettledCount(disabledMeasured.original, disabledMeasured.state, "disabled", 2);
        assert.equal(new Set(finals.map(({ invocation_id }) => invocation_id)).size, 2,
            "schema-identical disabled admissions reused an invocation ID");
        assert.equal(finals.every(({ correlation_id }) => correlation_id === session), true,
            "schema-identical disabled admissions changed the shared session correlation");
    } finally {
        rmSync(disabledMeasured.base, { recursive: true, force: true });
    }

    for (const [label, consentEnv] of [
        ["logging off", { CAIRN_CAPABILITY_LOGGING: "0" }],
        ["capture off", { CAIRN_TRAJECTORY_CAPTURE: "0" }],
    ]) {
        const enabled = fixtureRoot(`enabled-${label.replace(" ", "-")}`);
        try {
            const env = fullEnvironment({ CAIRN_HARNESS_STATE_DIR: enabled.state, ...consentEnv });
            const before = await withEnvironment(env, () => coordinator.beginHarnessCapability(beforeInput(enabled.original)));
            assert.deepEqual(before, { schema_version: 1, decision: "allow" });
            const ownerResult = { ok: true, value: SENTINELS[2] };
            assert.equal((() => ownerResult)(), ownerResult, `${label} changed owner identity`);
            await assertNoState(enabled.original, enabled.state, `enabled ${label}`);
        } finally {
            rmSync(enabled.base, { recursive: true, force: true });
        }
    }

    for (const outcome of ["success", "error", "timeout"]) {
        const enabled = fixtureRoot(`enabled-${outcome}`);
        try {
            const env = fullEnvironment({ CAIRN_HARNESS_STATE_DIR: enabled.state });
            const before = await withEnvironment(env, () => coordinator.beginHarnessCapability(beforeInput(enabled.original)));
            assert.deepEqual(before, { schema_version: 1, decision: "allow" });
            assertLeasePolicy(coordinator, enabled.original, enabled.state);
            await withEnvironment(env, () => coordinator.finishHarnessCapability(terminalInput({ outcome })));
            await withEnvironment(env, () => coordinator.finishHarnessCapability(terminalInput({ outcome })));
            await withEnvironment(env, () => coordinator.abandonHarnessCapability({ schema_version: 1, harness: "claude-code", session_id: "session-18-17" }));
            await assertSettledOnce(enabled.original, enabled.state, outcome);
        } finally {
            rmSync(enabled.base, { recursive: true, force: true });
        }
    }
}

async function crashAndCwdChecks(coordinator) {
    assertCoordinatorSurface(coordinator);
    for (const crashPoint of ["before-claim", "after-claim", "after-settlement"]) {
        const fixture = fixtureRoot(`crash-${crashPoint}`);
        try {
            const env = fullEnvironment({ CAIRN_HARNESS_STATE_DIR: fixture.state });
            await withEnvironment(env, () => coordinator.beginHarnessCapability(beforeInput(fixture.original)));
            await assert.rejects(
                withEnvironment(env, () => coordinator.finishHarnessCapability(
                    terminalInput(),
                    { testCrashAt: crashPoint },
                )),
                (error) => error?.name === "HarnessCrashInjection",
            );
            await withEnvironment(env, () => coordinator.recoverHarnessCapabilities({ state_root: fixture.state }));
            await withEnvironment(env, () => coordinator.recoverHarnessCapabilities({ state_root: fixture.state }));
            await assertSettledOnce(fixture.original, fixture.state, "success");
        } finally {
            rmSync(fixture.base, { recursive: true, force: true });
        }
    }

    const drift = fixtureRoot("cwd-drift");
    const previousCwd = process.cwd();
    try {
        const env = fullEnvironment({ CAIRN_HARNESS_STATE_DIR: drift.state });
        await withEnvironment(env, () => coordinator.beginHarnessCapability(beforeInput(drift.original)));
        await withEnvironment(env, () => coordinator.observeHarnessCwdChanged({
            schema_version: 1,
            harness: "claude-code",
            session_id: "session-18-17",
            old_cwd: drift.original,
            new_cwd: drift.decoy,
        }));
        process.chdir(drift.decoy);
        await withEnvironment(env, () => coordinator.finishHarnessCapability(terminalInput()));
        await assertSettledOnce(drift.original, drift.state, "success");
        await assertNoState(drift.decoy, join(drift.base, "unused-state"), "decoy project");
    } finally {
        process.chdir(previousCwd);
        const bytes = rawBytes(drift.original, drift.state).toString("utf8");
        for (const sentinel of SENTINELS) assert.equal(bytes.includes(sentinel), false, `state leaked ${sentinel}`);
        rmSync(drift.base, { recursive: true, force: true });
    }

    const stale = fixtureRoot("stale");
    try {
        const env = fullEnvironment({ CAIRN_HARNESS_STATE_DIR: stale.state });
        await withEnvironment(env, () => coordinator.beginHarnessCapability(beforeInput(stale.original)));
        const leasePath = allFiles(coordinator.getHarnessCapabilityLeaseDirectory({ state_root: stale.state }))[0];
        const lease = JSON.parse(readFileSync(leasePath, "utf8"));
        writeFileSync(leasePath, `${JSON.stringify({ ...lease, expires_at: "2020-01-01T00:00:00.000Z" })}\n`, { mode: 0o600 });
        chmodSync(leasePath, 0o600);
        await withEnvironment(env, () => coordinator.recoverHarnessCapabilities({ state_root: stale.state }));
        await withEnvironment(env, () => coordinator.recoverHarnessCapabilities({ state_root: stale.state }));
        await assertSettledOnce(stale.original, stale.state, "timeout");
    } finally {
        rmSync(stale.base, { recursive: true, force: true });
    }

    const unsafe = fixtureRoot("unsafe");
    try {
        const leaseDir = coordinator.getHarnessCapabilityLeaseDirectory({ state_root: unsafe.state });
        mkdirSync(leaseDir, { recursive: true, mode: 0o700 });
        const malformed = join(leaseDir, `${"a".repeat(64)}.json`);
        writeFileSync(malformed, "{malformed", { mode: 0o600 });
        await coordinator.recoverHarnessCapabilities({ state_root: unsafe.state });
        assert.deepEqual(allFiles(unsafe.state), [], "malformed lease was not pruned");
    } finally {
        rmSync(unsafe.base, { recursive: true, force: true });
    }

    const mismatch = fixtureRoot("identity-mismatch");
    try {
        const env = fullEnvironment({ CAIRN_HARNESS_STATE_DIR: mismatch.state });
        await withEnvironment(env, () => coordinator.beginHarnessCapability(beforeInput(mismatch.original)));
        const leasePath = allFiles(coordinator.getHarnessCapabilityLeaseDirectory({ state_root: mismatch.state }))[0];
        const lease = JSON.parse(readFileSync(leasePath, "utf8"));
        writeFileSync(leasePath, `${JSON.stringify({ ...lease, project_root: mismatch.decoy })}\n`, { mode: 0o600 });
        chmodSync(leasePath, 0o600);
        const result = await withEnvironment(env, () => coordinator.finishHarnessCapability(terminalInput()));
        assert.deepEqual(result, { schema_version: 1, finalized: false });
        assert.deepEqual(allFiles(mismatch.state), [], "identity-mismatched lease was not pruned");
        assert.equal((await rows(mismatch.decoy, FINAL_PREFIX)).length, 0, "identity mismatch redirected settlement");
    } finally {
        rmSync(mismatch.base, { recursive: true, force: true });
    }
}

async function sessionIsolationChecks(coordinator) {
    assertCoordinatorSurface(coordinator);

    for (const [label, overrides] of [
        ["master off", { CAIRN_CAPABILITY_CONTRACT: "0" }],
        ["logging off", { CAIRN_CAPABILITY_LOGGING: "0" }],
        ["trajectory capture off", { CAIRN_TRAJECTORY_CAPTURE: "0" }],
    ]) {
        const fixture = fixtureRoot(`session-isolation-${label.replaceAll(" ", "-")}`);
        try {
            const env = fullEnvironment({ CAIRN_HARNESS_STATE_DIR: fixture.state, ...overrides });
            const decision = await withEnvironment(env, () => coordinator.beginHarnessCapability(beforeInput(fixture.original)));
            assert.deepEqual(decision, ALLOW, `${label} changed the legacy allow decision`);
            await assertNoState(fixture.original, fixture.state, label);
            const bytes = rawBytes(fixture.original, fixture.state).toString("utf8");
            for (const sentinel of SENTINELS) assert.equal(bytes.includes(sentinel), false, `${label} leaked ${sentinel}`);
        } finally {
            rmSync(fixture.base, { recursive: true, force: true });
        }
    }

    const collision = fixtureRoot("session-isolation-collision");
    try {
        const session = "session-isolation-collision-18-28";
        const env = fullEnvironment({
            CAIRN_HARNESS_STATE_DIR: collision.state,
            CAIRN_CAPABILITY_SECURITY_AUDIT: "0",
        });
        const wiki = await withEnvironment(env, () => coordinator.beginHarnessCapability(beforeInput(collision.original, {
            session_id: session,
            command: "wiki-query",
        })));
        assert.deepEqual(wiki, { schema_version: 1, decision: "allow" });
        assert.equal((await rows(collision.original, PENDING_PREFIX)).length, 1, "active wiki omitted its pending issuance");
        assert.equal(allFiles(collision.state).length, 1, "active wiki omitted its lease");

        const security = await withEnvironment(env, () => coordinator.beginHarnessCapability(beforeInput(collision.original, {
            session_id: session,
            command: "security-audit",
        })));
        let securityOwnerCalls = 0;
        if (security.decision === "allow") securityOwnerCalls += 1;
        assert.deepEqual(security, { schema_version: 1, decision: "block", reason: "capability-disabled" });
        assert.equal(securityOwnerCalls, 0, "disabled security owner was reached");
        const finals = (await rows(collision.original, FINAL_PREFIX)).map(({ value }) => value);
        assert.equal(finals.filter(({ capability_id, outcome }) => capability_id === "security.audit" && outcome === "disabled").length, 1,
            "blocked security invocation did not retain one disabled final");
        assert.equal((await rows(collision.original, PENDING_PREFIX)).length, 1,
            "blocked security invocation consumed the active wiki issuance");
        assert.equal(allFiles(collision.state).some((path) => JSON.parse(readFileSync(path, "utf8")).command === "wiki-query"), true,
            "blocked security invocation overwrote the active wiki lease");

        const firstTerminal = await withEnvironment(env, () => coordinator.finishHarnessCapability(terminalInput({
            session_id: session,
            outcome: "success",
        })));
        assert.equal(firstTerminal.finalized, true, "wiki terminal did not settle its own invocation");
        const repeatedTerminal = await withEnvironment(env, () => coordinator.finishHarnessCapability(terminalInput({
            session_id: session,
            outcome: "success",
        })));
        assert.deepEqual(repeatedTerminal, { schema_version: 1, finalized: false },
            "repeated session terminal after lease consumption appended another final");
        const collisionFinals = (await rows(collision.original, FINAL_PREFIX)).map(({ value }) => value);
        assert.equal(collisionFinals.filter(({ capability_id }) => capability_id === "wiki").length, 1,
            "collision did not retain exactly one wiki final");
        assert.equal(collisionFinals.length, 2, "collision retained the wrong total final count");
        assert.equal((await rows(collision.original, PENDING_PREFIX)).length, 0, "collision settlement left pending rows");
        assert.deepEqual(allFiles(collision.state), [], "collision settlement left a lease");
        const bytes = rawBytes(collision.original, collision.state).toString("utf8");
        for (const sentinel of SENTINELS) assert.equal(bytes.includes(sentinel), false, `collision state leaked ${sentinel}`);
    } finally {
        rmSync(collision.base, { recursive: true, force: true });
    }

    for (const [label, command, overrides, expectedDecision, expectedOutcome] of [
        ["enabled", "wiki-query", {}, { schema_version: 1, decision: "allow" }, "success"],
        ["disabled", "security-audit", { CAIRN_CAPABILITY_SECURITY_AUDIT: "0" }, BLOCK, "disabled"],
    ]) {
        const fixture = fixtureRoot(`session-isolation-sequential-${label}`);
        try {
            const session = `session-isolation-sequential-${label}-18-28`;
            const env = fullEnvironment({ CAIRN_HARNESS_STATE_DIR: fixture.state, ...overrides });
            for (let index = 0; index < 2; index += 1) {
                const decision = await withEnvironment(env, () => coordinator.beginHarnessCapability(beforeInput(fixture.original, {
                    session_id: session,
                    command,
                })));
                assert.deepEqual(decision, expectedDecision, `${label} invocation ${index + 1} changed its policy decision`);
                if (expectedOutcome === "success") {
                    const terminal = await withEnvironment(env, () => coordinator.finishHarnessCapability(terminalInput({
                        session_id: session,
                        outcome: "success",
                    })));
                    assert.equal(terminal.finalized, true, `${label} invocation ${index + 1} did not finalize`);
                    const repeatedTerminal = await withEnvironment(env, () => coordinator.finishHarnessCapability(terminalInput({
                        session_id: session,
                        outcome: "success",
                    })));
                    assert.deepEqual(repeatedTerminal, { schema_version: 1, finalized: false },
                        `${label} repeated session terminal finalized after lease consumption`);
                }
            }
            const finals = (await rows(fixture.original, FINAL_PREFIX)).map(({ value }) => value);
            assert.equal(finals.length, 2, `${label} sequential invocations did not retain two finals`);
            assert.equal(new Set(finals.map(({ invocation_id }) => invocation_id)).size, finals.length,
                `${label} sequential finals reused an invocation ID`);
            assert.equal(finals.every(({ correlation_id }) => correlation_id === session), true,
                `${label} sequential finals changed the explicit session correlation`);
            assert.equal(finals.every(({ outcome }) => outcome === expectedOutcome), true,
                `${label} sequential final used the wrong outcome`);
            assert.equal((await rows(fixture.original, PENDING_PREFIX)).length, 0, `${label} sequential path left pending rows`);
            assert.deepEqual(allFiles(fixture.state), [], `${label} sequential path left a lease`);
            const bytes = rawBytes(fixture.original, fixture.state).toString("utf8");
            for (const sentinel of SENTINELS) assert.equal(bytes.includes(sentinel), false, `${label} sequential state leaked ${sentinel}`);
        } finally {
            rmSync(fixture.base, { recursive: true, force: true });
        }
    }

}

async function cliChecks() {
    const help = run(process.execPath, [capabilityCliPath, "--help"]);
    assertSuccess(help, "capability CLI public help");
    for (const operation of ["harness-before", "harness-terminal", "harness-cwd", "harness-recover", "harness-prune"]) {
        assert.equal(help.stdout.includes(operation), false, `public help exposed ${operation}`);
    }

    const fixture = fixtureRoot("cli");
    try {
        const env = fullEnvironment({ CAIRN_HARNESS_STATE_DIR: fixture.state });
        const before = run(process.execPath, [capabilityCliPath, "harness-before"], {
            cwd: fixture.decoy,
            env,
            input: JSON.stringify(beforeInput(fixture.original)),
        });
        assertSuccess(before, "hidden harness before");
        assert.deepEqual(JSON.parse(before.stdout), { schema_version: 1, decision: "allow" });

        const cwd = run(process.execPath, [capabilityCliPath, "harness-cwd"], {
            cwd: fixture.decoy,
            env,
            input: JSON.stringify({
                schema_version: 1,
                harness: "claude-code",
                session_id: "session-18-17",
                old_cwd: fixture.original,
                new_cwd: fixture.decoy,
            }),
        });
        assertSuccess(cwd, "hidden harness CWD observation");
        assert.deepEqual(JSON.parse(cwd.stdout), { schema_version: 1, observed: true });

        const terminal = run(process.execPath, [capabilityCliPath, "harness-terminal"], {
            cwd: fixture.decoy,
            env,
            input: JSON.stringify(terminalInput()),
        });
        assertSuccess(terminal, "hidden harness terminal");
        assert.deepEqual(JSON.parse(terminal.stdout), { schema_version: 1, finalized: true });

        const replay = run(process.execPath, [capabilityCliPath, "harness-terminal"], {
            cwd: fixture.decoy,
            env,
            input: JSON.stringify(terminalInput()),
        });
        assertSuccess(replay, "hidden harness terminal replay");
        assert.deepEqual(JSON.parse(replay.stdout), { schema_version: 1, finalized: false });
        await assertSettledOnce(fixture.original, fixture.state, "success");

        const invalid = run(process.execPath, [capabilityCliPath, "harness-terminal"], {
            cwd: fixture.decoy,
            env,
            input: JSON.stringify({ ...terminalInput(), handle: SENTINELS[0] }),
        });
        assertSuccess(invalid, "hidden harness terminal strict rejection");
        assert.deepEqual(JSON.parse(invalid.stdout), { schema_version: 1, finalized: false });
        assert.equal(`${invalid.stdout}${invalid.stderr}`.includes(SENTINELS[0]), false, "hidden CLI echoed rejected input");

        const recovered = run(process.execPath, [capabilityCliPath, "harness-recover"], { env });
        assertSuccess(recovered, "hidden harness recovery");
        assert.deepEqual(JSON.parse(recovered.stdout), {
            schema_version: 1,
            recovered: 0,
            pruned: 0,
            pending: 0,
        });
        const pruned = run(process.execPath, [capabilityCliPath, "harness-prune"], { env });
        assertSuccess(pruned, "hidden harness prune");
        assert.deepEqual(JSON.parse(pruned.stdout), JSON.parse(recovered.stdout));
    } finally {
        rmSync(fixture.base, { recursive: true, force: true });
    }
}

async function main() {
    const selected = mode();
    runPrerequisites();
    let coordinator;
    try {
        coordinator = await loadCoordinator();
    } catch (error) {
        if (selected === "--expect-red" && isOnlyMissingCoordinator(error)) {
            console.log(RED_MARKER);
            process.exitCode = EXPECTED_RED_EXIT;
            return;
        }
        throw error;
    }
    if (selected === "--expect-red") {
        throw new Error("The shared harness coordinator unexpectedly exists; run the GREEN modes instead.");
    }
    if (selected === "--session-isolation") {
        await sessionIsolationChecks(coordinator);
        console.log("PASS: capability harness session policy and invocation isolation contract");
        return;
    }
    if (selected !== "--crash-cwd") {
        await coreChecks(coordinator);
        await sessionIsolationChecks(coordinator);
    }
    if (selected !== "--core") await crashAndCwdChecks(coordinator);
    if (selected === undefined) await cliChecks();
    console.log("PASS: capability harness lifecycle, consent, crash, privacy, and CWD contract");
}

await main();
