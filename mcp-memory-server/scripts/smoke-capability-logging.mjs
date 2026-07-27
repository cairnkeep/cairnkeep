import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { AgentFS } from "agentfs-sdk";

const EXPECTED_RED_EXIT = 86;
const RED_MARKER = "PHASE18_RED:CAPABILITY_LOGGING_MISSING";
const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");
const projectRoot = resolve(serverRoot, "..");
const publicSchemaPath = join(projectRoot, "schemas", "capability-callback.schema.json");
const storeModulePath = join(serverRoot, "dist", "capability-store.js");
const adapterModulePath = join(serverRoot, "dist", "capability-adapter.js");
const capabilityCliPath = join(serverRoot, "dist", "capability-cli.js");
const trajectoryDbRelative = join(".agentfs", "trajectory.db");
const RECORD_PREFIX = "capability-callback/v1/record/";
const PENDING_PREFIX = "capability-callback/v1/pending/";
const OPERATING_RED_MARKER = "PHASE18_RED:OPERATING_FINISH_CONSENT_PROVENANCE";
const OPERATING_SEQUENTIAL_RED_MARKER = "PHASE18_RED:INVOCATION_SCOPED_CORRELATION";
const META_KEY = "capability-callback/meta/schema-version";
const ALLOWED_FIELDS = [
    "capability_id",
    "configuration_digest",
    "correlation_id",
    "duration_ms",
    "error_code",
    "finished_at",
    "harness",
    "invocation_id",
    "outcome",
    "schema_version",
    "source",
    "started_at",
    "state_source",
    "transport",
];
const REQUIRED_FIELDS = ALLOWED_FIELDS.filter((field) => field !== "error_code");
const OUTCOMES = ["success", "error", "timeout", "disabled"];
const ERROR_CODES = ["callback-error", "callback-timeout", "result-error", "result-timeout", "capability-disabled"];
const SENTINELS = [
    "argument-sentinel-18-02",
    "result-sentinel-18-02",
    "prompt-sentinel-18-02",
    "query-sentinel-18-02",
    "memory-value-sentinel-18-02",
    "/private/path/sentinel-18-02",
    "stack-sentinel-18-02",
    "thrown-error-sentinel-18-02",
    "returned-error-sentinel-18-02",
    "secret-sentinel-18-02",
    "metadata-sentinel-18-02",
];
const ALL_CONSENTS = {
    contract_enabled: true,
    logging: { enabled: true, source: "project" },
};
const DIGEST = "a".repeat(64);

function assertMode() {
    const [mode, ...extra] = process.argv.slice(2);
    const modes = [
        undefined,
        "--baseline",
        "--expect-red",
        "--schema-only",
        "--store-only",
        "--adapter-only",
        "--notes-only",
        "--operating-finish-only",
        "--expect-red-operating-finish",
        "--operating-sequential-only",
    ];
    assert.equal(extra.length, 0, "smoke-capability-logging accepts at most one mode");
    assert.equal(modes.includes(mode), true, `Unknown smoke-capability-logging mode: ${String(mode)}`);
    return mode;
}

function run(command, args, options = {}) {
    return spawnSync(command, args, {
        cwd: options.cwd ?? projectRoot,
        encoding: "utf8",
        input: options.input,
        timeout: options.timeout ?? 120_000,
        env: { ...process.env, ...options.env },
    });
}

function assertSuccessful(result, label) {
    assert.equal(result.status, 0, `${label} failed:\n${result.stdout}${result.stderr}`);
}

function runBaseline() {
    const packageJson = JSON.parse(readFileSync(join(serverRoot, "package.json"), "utf8"));
    assert.equal(packageJson.scripts["check:capability-logging"], "node scripts/smoke-capability-logging.mjs");
    assert.equal(packageJson.scripts["test:smoke"].includes("check:capability-logging"), true, "GREEN logging contract is missing from the default suite");
    for (const script of ["smoke-trajectory-redaction.mjs", "smoke-trajectory-retention.mjs"]) {
        assertSuccessful(run(process.execPath, [join(here, script)], { cwd: serverRoot }), `baseline ${script}`);
    }
}

function isMissingLoggingModule(error) {
    if (!error || error.code !== "ERR_MODULE_NOT_FOUND") return false;
    const message = String(error.message ?? "");
    return message.includes("/dist/capability-store.js") || message.includes("/dist/capability-adapter.js");
}

async function loadStore() {
    return import(pathToFileURL(storeModulePath).href);
}

async function loadAdapter() {
    return import(pathToFileURL(adapterModulePath).href);
}

function finalRecord(overrides = {}) {
    return {
        schema_version: 1,
        capability_id: "memory.write",
        invocation_id: `cap:${randomUUID()}`,
        correlation_id: "claude-code:session-18-02",
        harness: "claude-code",
        source: "mcp",
        transport: "stdio",
        started_at: "2026-07-27T08:00:00.000Z",
        finished_at: "2026-07-27T08:00:00.125Z",
        duration_ms: 125,
        outcome: "success",
        state_source: "project",
        configuration_digest: DIGEST,
        ...overrides,
    };
}

function assertExactRecord(record) {
    assert.deepEqual(Object.keys(record).sort(), record.error_code === undefined ? REQUIRED_FIELDS : ALLOWED_FIELDS);
    assert.equal(record.schema_version, 1);
    assert.match(record.invocation_id, /^cap:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.match(record.correlation_id, /^(?:cairn:)?[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/);
    assert.match(record.configuration_digest, /^[0-9a-f]{64}$/);
    assert.equal(OUTCOMES.includes(record.outcome), true);
    if (record.error_code !== undefined) assert.equal(ERROR_CODES.includes(record.error_code), true);
    const serialized = JSON.stringify(record);
    for (const sentinel of SENTINELS) assert.equal(serialized.includes(sentinel), false, `record disclosed ${sentinel}`);
    for (const forbidden of ["arguments", "result", "prompt", "query", "memory", "path", "stack", "error", "secret", "metadata", "message", "detail"]) {
        assert.equal(Object.hasOwn(record, forbidden), false, `record admitted forbidden field ${forbidden}`);
    }
}

async function schemaChecks() {
    const store = await loadStore();
    assert.equal(store.CAPABILITY_CALLBACK_SCHEMA_VERSION, 1);
    assert.equal(store.CAPABILITY_CALLBACK_RECORD_PREFIX, RECORD_PREFIX);
    assert.equal(store.CAPABILITY_CALLBACK_RECORD_MAX_COUNT, 10_000);
    assert.equal(typeof store.capabilityCallbackRecordSchema?.safeParse, "function");

    const samples = [
        finalRecord(),
        finalRecord({ outcome: "error", error_code: "callback-error" }),
        finalRecord({ outcome: "timeout", error_code: "result-timeout" }),
        finalRecord({ outcome: "disabled", error_code: "capability-disabled" }),
    ];
    for (const sample of samples) {
        const parsed = store.capabilityCallbackRecordSchema.parse(sample);
        assert.deepEqual(parsed, sample);
        assertExactRecord(parsed);
    }
    for (const [label, value] of [
        ["extra property", { ...samples[0], metadata: SENTINELS.at(-1) }],
        ["raw error", { ...samples[0], error: SENTINELS[7] }],
        ["bad invocation", { ...samples[0], invocation_id: "cap:not-a-uuid" }],
        ["ambiguous correlation", { ...samples[0], correlation_id: "unknown" }],
        ["uppercase digest", { ...samples[0], configuration_digest: "A".repeat(64) }],
        ["error code on success", { ...samples[0], error_code: "callback-error" }],
        ["missing error code", { ...samples[1], error_code: undefined }],
    ]) {
        assert.equal(store.capabilityCallbackRecordSchema.safeParse(value).success, false, `${label} must be rejected`);
    }

    const publicSchema = JSON.parse(readFileSync(publicSchemaPath, "utf8"));
    assert.equal(publicSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.equal(publicSchema.additionalProperties, false);
    assert.deepEqual(Object.keys(publicSchema.properties).sort(), ALLOWED_FIELDS);
    assert.deepEqual([...publicSchema.required].sort(), REQUIRED_FIELDS);
    assert.deepEqual(publicSchema.properties.outcome.enum, OUTCOMES);
    assert.deepEqual(publicSchema.properties.error_code.enum, ERROR_CODES);
}

function trajectorySession(id) {
    return {
        schema_version: 1,
        session_id: id,
        harness: "opencode",
        project_root: "/fixture/project",
        started_at: "2026-07-27T07:00:00.000Z",
        ended_at: "2026-07-27T07:00:01.000Z",
        events: [],
        capture: {
            captured_at: "2026-07-27T07:00:02.000Z",
            omitted_reasoning_blocks: 0,
            omitted_unknown_records: 0,
            truncated: false,
        },
    };
}

async function rawRows(root) {
    const dbPath = join(root, trajectoryDbRelative);
    if (!existsSync(dbPath)) return [];
    const agent = await AgentFS.open({ id: "trajectory", path: dbPath });
    try {
        return await agent.kv.list("");
    } finally {
        await agent.close();
    }
}

function callbackRows(rows) {
    return rows.filter(({ key }) => key === META_KEY || key.startsWith(RECORD_PREFIX));
}

function trajectoryRows(rows) {
    return rows.filter(({ key }) => key.startsWith("trajectory/"));
}

function rawStoreBytes(root) {
    const directory = join(root, ".agentfs");
    if (!existsSync(directory)) return Buffer.alloc(0);
    return Buffer.concat(readdirSync(directory)
        .filter((name) => /^trajectory\.db(?:-(?:wal|shm))?$/.test(name))
        .sort()
        .map((name) => readFileSync(join(directory, name))));
}

function operatingEnvironment(overrides = {}) {
    return {
        CAIRN_CAPABILITY_CONTRACT: "1",
        CAIRN_CAPABILITY_LOGGING: "1",
        CAIRN_TRAJECTORY_CAPTURE: "1",
        CAIRN_CAPABILITY_MEMORY_WRITE: "1",
        CAIRN_CAPABILITY_MEMORY_SEARCH: "1",
        CAIRN_CAPABILITY_NOTES_DISTILL: "1",
        CAIRN_CAPABILITY_WIKI: "1",
        CAIRN_CAPABILITY_GRAPH: "1",
        CAIRN_CAPABILITY_SECURITY_AUDIT: "1",
        CAIRN_CAPABILITY_ROUTE_CHECK: "1",
        CAIRN_CAPABILITY_CONTEXT_EXPLORE: "1",
        ...overrides,
    };
}

function runOperatingCli(root, args, env = operatingEnvironment()) {
    const result = run(process.execPath, [capabilityCliPath, ...args], { cwd: root, env });
    assertSuccessful(result, `capability CLI ${args[0]}`);
    assert.equal(result.stderr, "", `capability CLI ${args[0]} wrote stderr`);
    return JSON.parse(result.stdout);
}

function startOperating(root, env = operatingEnvironment()) {
    const handle = runOperatingCli(root, [
        "start",
        "wiki",
        "--harness", "claude-code",
        "--source", "operating-workflow",
        "--transport", "harness-command",
        "--session", "claude-code:operating-finish-18-15",
    ], env);
    assert.deepEqual(Object.keys(handle).sort(), [
        "capability_id",
        "configuration_digest",
        "correlation_id",
        "harness",
        "invocation_id",
        "schema_version",
        "source",
        "started_at",
        "state_source",
        "transport",
    ]);
    return handle;
}

function finishOperating(root, handle, env = operatingEnvironment()) {
    return runOperatingCli(root, [
        "finish",
        "--handle", JSON.stringify(handle),
        "--outcome", "success",
    ], env);
}

function safeFinishResult(handle) {
    return {
        schema_version: 1,
        invocation_id: handle.invocation_id,
        finalized: false,
    };
}

function sequentialIssuance(invocationId, startedAt) {
    return {
        schema_version: 1,
        capability_id: "wiki",
        invocation_id: invocationId,
        correlation_id: "claude-code:shared-session-18-28",
        harness: "claude-code",
        source: "operating-command",
        transport: "harness-command",
        started_at: startedAt,
        state_source: "environment",
        configuration_digest: DIGEST,
    };
}

function sequentialFinal(handle, finishedAt) {
    return finalRecord({
        ...handle,
        finished_at: finishedAt,
        duration_ms: Math.max(0, Date.parse(finishedAt) - Date.parse(handle.started_at)),
    });
}

async function finalRecords(root) {
    if (!existsSync(join(root, trajectoryDbRelative))) return [];
    const script = [
        'import { AgentFS } from "agentfs-sdk";',
        'const agent = await AgentFS.open({ id: "trajectory", path: process.env.CAIRN_TEST_DB });',
        `const rows = await agent.kv.list(${JSON.stringify(RECORD_PREFIX)});`,
        'await agent.close();',
        'process.stdout.write(JSON.stringify(rows.map(({ value }) => value)));',
    ].join("\n");
    const result = run(process.execPath, ["--input-type=module", "-e", script], {
        cwd: serverRoot,
        env: { CAIRN_TEST_DB: join(root, trajectoryDbRelative) },
    });
    assertSuccessful(result, "fresh-process final-record inspection");
    return JSON.parse(result.stdout);
}

async function assertNoFinalRecord(root, handle, label) {
    const records = await finalRecords(root);
    assert.equal(records.some(({ invocation_id }) => invocation_id === handle.invocation_id), false, `${label} wrote a final record`);
    assert.equal((await finalRecords(root)).length, 0, `${label} wrote a final-record key`);
    const bytes = rawStoreBytes(root).toString("utf8");
    assert.equal(bytes.includes(RECORD_PREFIX), false, `${label} left a final-record namespace in raw SQLite bytes`);
    for (const sentinel of SENTINELS) assert.equal(bytes.includes(sentinel), false, `${label} leaked ${sentinel}`);
}

async function operatingFinishChecks() {
    const consentCases = [
        { label: "contract consent revoked", finishEnv: operatingEnvironment({ CAIRN_CAPABILITY_CONTRACT: "0" }) },
        { label: "managed logging consent revoked", finishEnv: operatingEnvironment({ CAIRN_CAPABILITY_LOGGING: "0" }) },
        { label: "trajectory capture consent revoked", finishEnv: operatingEnvironment({ CAIRN_TRAJECTORY_CAPTURE: "0" }) },
    ];
    for (const testCase of consentCases) {
        const root = mkdtempSync(join(tmpdir(), "cairn-operating-consent-"));
        try {
            const handle = startOperating(root);
            assert.deepEqual(
                finishOperating(root, handle, testCase.finishEnv),
                safeFinishResult(handle),
                `${testCase.label} finish must not finalize`,
            );
            await assertNoFinalRecord(root, handle, testCase.label);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }

    const forgedRoot = mkdtempSync(join(tmpdir(), "cairn-operating-forged-"));
    try {
        const forged = {
            schema_version: 1,
            capability_id: "wiki",
            invocation_id: `cap:${randomUUID()}`,
            correlation_id: "claude-code:forged-18-15",
            harness: "claude-code",
            source: "operating-workflow",
            transport: "harness-command",
            started_at: new Date().toISOString(),
            state_source: "environment",
            configuration_digest: "f".repeat(64),
        };
        assert.deepEqual(finishOperating(forgedRoot, forged), safeFinishResult(forged), "unissued handle must not finalize");
        await assertNoStore(forgedRoot, "unissued handle");
    } finally {
        rmSync(forgedRoot, { recursive: true, force: true });
    }

    const mutations = [
        ["correlation_id", "claude-code:mismatched-18-15"],
        ["capability_id", "security.audit"],
        ["state_source", "project"],
    ];
    for (const [field, value] of mutations) {
        const root = mkdtempSync(join(tmpdir(), "cairn-operating-mismatch-"));
        try {
            const handle = startOperating(root);
            const mismatched = { ...handle, [field]: value };
            assert.deepEqual(finishOperating(root, mismatched), safeFinishResult(handle), `${field} mismatch must not finalize`);
            await assertNoFinalRecord(root, handle, `${field} mismatch`);
            assert.deepEqual(finishOperating(root, handle), { ...safeFinishResult(handle), finalized: true }, `${field} mismatch consumed authentic issuance`);
            assert.deepEqual(finishOperating(root, handle), safeFinishResult(handle), `${field} authentic replay finalized`);
            const records = (await finalRecords(root)).filter(({ invocation_id }) => invocation_id === handle.invocation_id);
            assert.equal(records.length, 1, `${field} authentic settlement did not retain exactly one final row`);
            assert.equal(records[0][field], handle[field], `${field} mismatch contaminated the final row`);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }

    const staleRoot = mkdtempSync(join(tmpdir(), "cairn-operating-stale-"));
    try {
        const handle = startOperating(staleRoot);
        const changed = operatingEnvironment({ CAIRN_CAPABILITY_MEMORY_WRITE: "0" });
        assert.deepEqual(finishOperating(staleRoot, handle, changed), safeFinishResult(handle), "stale configuration must not finalize");
        await assertNoFinalRecord(staleRoot, handle, "stale configuration");
        assert.deepEqual(finishOperating(staleRoot, handle), safeFinishResult(handle), "stale issuance was resurrected after re-enable");
    } finally {
        rmSync(staleRoot, { recursive: true, force: true });
    }

    const replayRoot = mkdtempSync(join(tmpdir(), "cairn-operating-replay-"));
    try {
        const handle = startOperating(replayRoot);
        assert.deepEqual(finishOperating(replayRoot, handle), { ...safeFinishResult(handle), finalized: true });
        assert.deepEqual(finishOperating(replayRoot, handle), safeFinishResult(handle), "replayed handle must not finalize");
        const records = (await finalRecords(replayRoot)).filter(({ invocation_id }) => invocation_id === handle.invocation_id);
        assert.equal(records.length, 1, "replay changed the legitimate final-row count");
        assertExactRecord(records[0]);
        const bytes = rawStoreBytes(replayRoot).toString("utf8");
        for (const sentinel of SENTINELS) assert.equal(bytes.includes(sentinel), false, `replay store leaked ${sentinel}`);
    } finally {
        rmSync(replayRoot, { recursive: true, force: true });
    }
}

async function operatingSequentialChecks() {
    const store = await loadStore();

    for (const [label, overrides] of [
        ["master off", { CAIRN_CAPABILITY_CONTRACT: "0" }],
        ["logging off", { CAIRN_CAPABILITY_LOGGING: "0" }],
        ["trajectory capture off", { CAIRN_TRAJECTORY_CAPTURE: "0" }],
    ]) {
        const root = mkdtempSync(join(tmpdir(), "cairn-operating-sequential-inert-"));
        try {
            const result = runOperatingCli(root, [
                "start",
                "wiki",
                "--harness", "claude-code",
                "--source", "operating-command",
                "--transport", "harness-command",
                "--session", "claude-code:shared-session-18-28",
            ], operatingEnvironment(overrides));
            assert.deepEqual(result, {
                schema_version: 1,
                capability_id: "wiki",
                disabled: false,
                measured: false,
            }, `${label} did not retain the payload-free bypass result`);
            await assertNoStore(root, label);
            const bytes = rawStoreBytes(root).toString("utf8");
            for (const sentinel of SENTINELS) assert.equal(bytes.includes(sentinel), false, `${label} leaked ${sentinel}`);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }

    const root = mkdtempSync(join(tmpdir(), "cairn-operating-sequential-"));
    try {
        const first = sequentialIssuance(`cap:${randomUUID()}`, "2026-07-27T08:28:00.000Z");
        const second = sequentialIssuance(`cap:${randomUUID()}`, "2026-07-27T08:28:01.000Z");
        assert.notEqual(first.invocation_id, second.invocation_id);
        assert.equal(first.correlation_id, second.correlation_id);

        assert.equal(await store.issueOperatingCapability(root, first), true, "first invocation was not issued");
        assert.equal(await store.issueOperatingCapability(root, first), false, "duplicate first invocation was reissued");
        assert.equal(
            await store.settleOperatingCapability(root, first, sequentialFinal(first, "2026-07-27T08:28:00.125Z")),
            true,
            "first invocation was not settled",
        );
        assert.equal(
            await store.settleOperatingCapability(root, first, sequentialFinal(first, "2026-07-27T08:28:00.250Z")),
            false,
            "first terminal replay settled twice",
        );

        const secondIssued = await store.issueOperatingCapability(root, second);
        if (!secondIssued) {
            const pending = await rawRows(root);
            const finals = (await store.listCapabilityRecords(root)).records;
            assert.equal(pending.filter(({ key }) => key.startsWith(PENDING_PREFIX)).length, 0,
                "known correlation defect left a second pending issuance");
            assert.deepEqual(finals.map(({ invocation_id }) => invocation_id), [first.invocation_id],
                "known correlation defect did not retain exactly the first final");
            throw new Error("expected-invocation-scoped-correlation-defect");
        }

        assert.equal(
            await store.settleOperatingCapability(root, second, sequentialFinal(second, "2026-07-27T08:28:01.125Z")),
            true,
            "second invocation was not settled",
        );
        assert.equal(
            await store.settleOperatingCapability(root, second, sequentialFinal(second, "2026-07-27T08:28:01.250Z")),
            false,
            "second terminal replay settled twice",
        );
        const rows = await rawRows(root);
        assert.equal(rows.filter(({ key }) => key.startsWith(PENDING_PREFIX)).length, 0, "sequential settlement left pending rows");
        const finals = (await store.listCapabilityRecords(root)).records;
        assert.equal(finals.length, 2, "sequential invocations did not retain two finals");
        assert.equal(new Set(finals.map(({ invocation_id }) => invocation_id)).size, 2, "sequential finals reused an invocation ID");
        assert.equal(finals.every(({ correlation_id }) => correlation_id === first.correlation_id), true,
            "sequential finals did not retain the explicit shared session correlation");
        for (const record of finals) assertExactRecord(record);
        const bytes = rawStoreBytes(root).toString("utf8");
        for (const sentinel of SENTINELS) assert.equal(bytes.includes(sentinel), false, `sequential store leaked ${sentinel}`);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

async function storeChecks() {
    const store = await loadStore();
    assert.equal(store.CAPABILITY_CALLBACK_PENDING_PREFIX, "capability-callback/v1/pending/");
    for (const name of [
        "appendCapabilityRecord",
        "issueOperatingCapability",
        "settleOperatingCapability",
        "listCapabilityRecords",
        "doctorCapabilityRecords",
        "getCapabilityDbPath",
    ]) {
        assert.equal(typeof store[name], "function", `missing capability store export ${name}`);
    }
    const trajectorySchema = await import("../dist/trajectory-schema.js");
    const trajectoryStore = await import("../dist/trajectory-store.js");
    const root = mkdtempSync(join(tmpdir(), "cairn-capability-store-"));
    try {
        const beforeSession = trajectorySchema.trajectorySessionSchema.parse(trajectorySession("preexisting-session"));
        await trajectoryStore.putTrajectory(root, beforeSession, trajectorySchema.getTrajectoryLimits());
        const beforeRows = await rawRows(root);
        const beforeTrajectoryRows = trajectoryRows(beforeRows);
        const dbPath = join(root, trajectoryDbRelative);
        assert.equal(store.getCapabilityDbPath(root), dbPath);

        const records = [
            finalRecord({ invocation_id: `cap:${randomUUID()}`, finished_at: "2026-07-27T08:00:00.001Z" }),
            finalRecord({ invocation_id: `cap:${randomUUID()}`, finished_at: "2026-07-27T08:00:00.002Z", outcome: "error", error_code: "result-error" }),
            finalRecord({ invocation_id: `cap:${randomUUID()}`, finished_at: "2026-07-27T08:00:00.003Z", outcome: "timeout", error_code: "callback-timeout" }),
            finalRecord({ invocation_id: `cap:${randomUUID()}`, finished_at: "2026-07-27T08:00:00.004Z", outcome: "disabled", error_code: "capability-disabled" }),
        ];
        for (const record of records) await store.appendCapabilityRecord(root, record);
        let listed = await store.listCapabilityRecords(root);
        assert.equal(listed.schema_version, 1);
        assert.deepEqual(listed.records, [...records].reverse());
        for (const record of listed.records) assertExactRecord(record);

        const afterRows = await rawRows(root);
        assert.deepEqual(trajectoryRows(afterRows), beforeTrajectoryRows, "callback writes changed existing trajectory rows");
        assert.equal(callbackRows(afterRows).filter(({ key }) => key.startsWith(RECORD_PREFIX)).length, records.length);
        assert.equal(statSync(dbPath).mode & 0o777, 0o600);

        const old = finalRecord({
            invocation_id: `cap:${randomUUID()}`,
            started_at: "2020-01-01T00:00:00.000Z",
            finished_at: "2020-01-01T00:00:01.000Z",
            duration_ms: 1000,
        });
        await store.appendCapabilityRecord(root, old);
        listed = await store.listCapabilityRecords(root);
        assert.equal(listed.records.some(({ invocation_id }) => invocation_id === old.invocation_id), false, "retention did not reuse trajectory days");

        const capRoot = mkdtempSync(join(tmpdir(), "cairn-capability-cap-"));
        try {
            const capped = Array.from({ length: 4 }, (_, index) => finalRecord({
                invocation_id: `cap:${randomUUID()}`,
                finished_at: `2026-07-27T08:00:0${index}.000Z`,
            }));
            for (const record of capped) {
                await store.appendCapabilityRecord(capRoot, record, { testMaxRecords: 3 });
            }
            const cappedList = await store.listCapabilityRecords(capRoot);
            assert.deepEqual(cappedList.records.map(({ invocation_id }) => invocation_id), capped.slice(1).reverse().map(({ invocation_id }) => invocation_id));
        } finally {
            rmSync(capRoot, { recursive: true, force: true });
        }

        const doctor = await store.doctorCapabilityRecords(root);
        assert.deepEqual({ schema_version: doctor.schema_version, exists: doctor.exists, ok: doctor.ok }, { schema_version: 1, exists: true, ok: true });
        const serializedDoctor = JSON.stringify(doctor);
        for (const sentinel of SENTINELS) assert.equal(serializedDoctor.includes(sentinel), false);
        const bytes = rawStoreBytes(root).toString("utf8");
        for (const sentinel of SENTINELS) assert.equal(bytes.includes(sentinel), false, `raw SQLite bytes disclosed ${sentinel}`);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function capabilitySnapshot(overrides = {}) {
    return {
        schema_version: 1,
        ...ALL_CONSENTS,
        configuration_digest: DIGEST,
        capabilities: [{ id: "memory.write", kind: "mcp-tool", enabled: true, source: "project", restart_required: true }],
        issues: [],
        ...overrides,
    };
}

function adapterOptions(root, overrides = {}) {
    return {
        projectRoot: root,
        snapshot: capabilitySnapshot(),
        capabilityId: "memory.write",
        classification: { harness: "claude-code", source: "mcp", transport: "stdio" },
        correlationId: "claude-code:session-18-02",
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

async function assertNoStore(root, label) {
    assert.equal(existsSync(join(root, trajectoryDbRelative)), false, `${label} opened the callback database`);
}

async function adapterChecks() {
    const adapter = await loadAdapter();
    const capabilityConfig = await import("../dist/capability-config.js");
    const store = await loadStore();
    for (const name of ["withCapability", "startOperatingCapability", "finishOperatingCapability"]) {
        assert.equal(typeof adapter[name], "function", `missing capability adapter export ${name}`);
    }

    const consentCases = [
        { label: "contract off", snapshot: capabilitySnapshot({ contract_enabled: false }), capture: "1" },
        { label: "logging off", snapshot: capabilitySnapshot({ logging: { enabled: false, source: "project" } }), capture: "1" },
        { label: "trajectory capture off", snapshot: capabilitySnapshot(), capture: "0" },
    ];
    for (const testCase of consentCases) {
        const root = mkdtempSync(join(tmpdir(), "cairn-capability-consent-"));
        try {
            const ownerResult = { ok: true, sentinel: SENTINELS[1] };
            const owner = async () => ownerResult;
            const wrapped = adapter.withCapability(adapterOptions(root, { snapshot: testCase.snapshot }), owner);
            const actual = await withEnvironment({ CAIRN_TRAJECTORY_CAPTURE: testCase.capture }, () => wrapped({ sentinel: SENTINELS[0] }));
            assert.equal(actual, ownerResult, `${testCase.label} changed owner result identity`);
            await assertNoStore(root, testCase.label);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }

    const httpRoot = mkdtempSync(join(tmpdir(), "cairn-capability-http-"));
    try {
        const ownerResult = { ok: true };
        const wrapped = adapter.withCapability(adapterOptions(httpRoot, {
            classification: { harness: "claude-code", source: "mcp", transport: "http" },
        }), async () => ownerResult);
        assert.equal(await withEnvironment({ CAIRN_TRAJECTORY_CAPTURE: "1" }, () => wrapped()), ownerResult);
        await assertNoStore(httpRoot, "HTTP transport");
    } finally {
        rmSync(httpRoot, { recursive: true, force: true });
    }

    const root = mkdtempSync(join(tmpdir(), "cairn-capability-adapter-"));
    try {
        const success = { ok: true, value: SENTINELS[1] };
        const returnedError = { structuredContent: { ok: false, error: SENTINELS[8] } };
        const returnedTimeout = { structuredContent: { ok: false, timedOut: true, detail: SENTINELS[6] } };
        const thrown = new Error(SENTINELS[7]);
        thrown.stack = SENTINELS[6];
        const callbacks = [
            async () => success,
            async () => returnedError,
            async () => returnedTimeout,
            async () => { throw thrown; },
        ];
        await withEnvironment({ CAIRN_TRAJECTORY_CAPTURE: "1" }, async () => {
            assert.equal(await adapter.withCapability(adapterOptions(root), callbacks[0])({ prompt: SENTINELS[2] }), success);
            assert.equal(await adapter.withCapability(adapterOptions(root), callbacks[1])({ query: SENTINELS[3] }), returnedError);
            assert.equal(await adapter.withCapability(adapterOptions(root), callbacks[2])({ path: SENTINELS[5] }), returnedTimeout);
            await assert.rejects(
                adapter.withCapability(adapterOptions(root), callbacks[3])({ secret: SENTINELS[9] }),
                (error) => error === thrown,
            );
        });

        const listed = await store.listCapabilityRecords(root);
        assert.equal(listed.records.length, 4, "adapter did not write exactly one final row per settled callback");
        assert.deepEqual(new Set(listed.records.map(({ outcome }) => outcome)), new Set(["success", "error", "timeout"]));
        assert.equal(new Set(listed.records.map(({ invocation_id }) => invocation_id)).size, 4, "invocation IDs are not unique");
        assert.equal(listed.records.every(({ correlation_id }) => correlation_id === "claude-code:session-18-02"), true);
        for (const record of listed.records) assertExactRecord(record);

        const fallbackRoot = mkdtempSync(join(tmpdir(), "cairn-capability-fallback-"));
        try {
            const wrapped = adapter.withCapability(adapterOptions(fallbackRoot, { correlationId: undefined }), async () => ({ ok: true }));
            await withEnvironment({ CAIRN_TRAJECTORY_CAPTURE: "1" }, async () => {
                await wrapped();
                await wrapped();
            });
            const fallbackRows = (await store.listCapabilityRecords(fallbackRoot)).records;
            assert.equal(fallbackRows.length, 2);
            assert.equal(new Set(fallbackRows.map(({ correlation_id }) => correlation_id)).size, 1);
            assert.match(fallbackRows[0].correlation_id, /^cairn:[0-9a-f-]{36}$/i);
            assert.equal(new Set(fallbackRows.map(({ invocation_id }) => invocation_id)).size, 2);
        } finally {
            rmSync(fallbackRoot, { recursive: true, force: true });
        }

        for (const fault of ["open", "lock", "schema", "write"]) {
            const ownerResult = { ok: true, fault };
            const ownerError = new Error(`owner-${fault}`);
            const resultWrapper = adapter.withCapability(adapterOptions(root, { testStoreFault: fault }), async () => ownerResult);
            const errorWrapper = adapter.withCapability(adapterOptions(root, { testStoreFault: fault }), async () => { throw ownerError; });
            await withEnvironment({ CAIRN_TRAJECTORY_CAPTURE: "1" }, async () => {
                assert.equal(await resultWrapper(), ownerResult, `${fault} changed returned identity`);
                await assert.rejects(errorWrapper(), (error) => error === ownerError, `${fault} changed thrown identity`);
            });
        }

        const operatingEnv = operatingEnvironment();
        const operatingSnapshot = await withEnvironment(operatingEnv, () => capabilityConfig.resolveCapabilityStatus({ projectRoot: root }));
        const handle = await withEnvironment(operatingEnv, () => adapter.startOperatingCapability({
            projectRoot: root,
            snapshot: operatingSnapshot,
            capabilityId: "memory.write",
            classification: { harness: "claude-code", source: "operating-command", transport: "harness-command" },
        }));
        assert.deepEqual(Object.keys(handle).sort(), [
            "capability_id", "configuration_digest", "correlation_id", "harness", "invocation_id", "schema_version", "source", "started_at", "state_source", "transport",
        ]);
        const disabledHandle = await withEnvironment({ CAIRN_TRAJECTORY_CAPTURE: "1" }, () => adapter.startOperatingCapability({
            projectRoot: root,
            snapshot: capabilitySnapshot({ capabilities: [{ id: "memory.write", kind: "mcp-tool", enabled: false, source: "project", restart_required: true }] }),
            capabilityId: "memory.write",
            classification: { harness: "claude-code", source: "operating-command", transport: "harness-command" },
        }));
        assert.equal(disabledHandle.disabled, true);
        await withEnvironment(operatingEnv, async () => {
            await adapter.finishOperatingCapability(root, handle, { outcome: "success" });
            await adapter.finishOperatingCapability(root, handle, { outcome: "success" });
        });
        const finalRows = (await store.listCapabilityRecords(root)).records;
        assert.equal(finalRows.filter(({ invocation_id }) => invocation_id === handle.invocation_id).length, 1, "duplicate finish created two rows");
        assert.equal(finalRows.some(({ outcome }) => outcome === "disabled"), true, "disabled operating invocation was not recorded");

        for (const fault of ["open", "lock", "schema", "write"]) {
            const faultRoot = mkdtempSync(join(tmpdir(), "cairn-capability-operating-fault-"));
            try {
                const faultSnapshot = await withEnvironment(operatingEnv, () => capabilityConfig.resolveCapabilityStatus({ projectRoot: faultRoot }));
                const result = await withEnvironment(operatingEnv, () => adapter.startOperatingCapability({
                    projectRoot: faultRoot,
                    snapshot: faultSnapshot,
                    capabilityId: "memory.write",
                    classification: { harness: "claude-code", source: "operating-command", transport: "harness-command" },
                    testStoreFault: fault,
                }));
                assert.deepEqual(result, {
                    schema_version: 1,
                    capability_id: "memory.write",
                    disabled: false,
                    measured: false,
                }, `${fault} operating issuance fault did not fail open`);
            } finally {
                rmSync(faultRoot, { recursive: true, force: true });
            }
        }

        const bytes = rawStoreBytes(root).toString("utf8");
        for (const sentinel of SENTINELS) assert.equal(bytes.includes(sentinel), false, `adapter leaked ${sentinel} to SQLite/WAL/SHM`);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

async function notesChecks() {
    await adapterChecks();
    const root = mkdtempSync(join(tmpdir(), "cairn-capability-notes-"));
    const configPath = join(root, ".ai", "capabilities.json");
    try {
        mkdirSync(dirname(configPath), { recursive: true });
        const baseEnv = {
            CAIRN_CAPABILITY_CONTRACT: "1",
            CAIRN_CAPABILITY_LOGGING: "1",
            CAIRN_TRAJECTORY_CAPTURE: "1",
            CAIRN_NOTE_DISTILLATION: "0",
        };
        const disabled = run(process.execPath, [join(serverRoot, "dist", "note-cli.js"), "distill", "--project", root, "--json"], { cwd: root, env: baseEnv });
        assertSuccessful(disabled, "managed disabled notes invocation");
        assert.deepEqual(JSON.parse(disabled.stdout), { schema_version: 1, enabled: false, reason: "CAIRN_NOTE_DISTILLATION is disabled" });

        writeFileSync(configPath, `${JSON.stringify({ schema_version: 1, capabilities: { "notes.distill": false }, logging: { callbacks: true } })}\n`, { mode: 0o600 });
        chmodSync(configPath, 0o600);
        const explicitDisabled = run(process.execPath, [join(serverRoot, "dist", "note-cli.js"), "distill", "--project", root, "--json"], {
            cwd: root,
            env: { ...baseEnv, CAIRN_NOTE_DISTILLATION: "1" },
        });
        assertSuccessful(explicitDisabled, "explicit managed notes disable");
        assert.equal(JSON.parse(explicitDisabled.stdout).enabled, false);

        writeFileSync(configPath, `${JSON.stringify({ schema_version: 1, capabilities: { "notes.distill": true }, logging: { callbacks: true } })}\n`, { mode: 0o600 });
        const enabled = run(process.execPath, [join(serverRoot, "dist", "note-cli.js"), "distill", "--project", root, "--json"], {
            cwd: root,
            env: { ...baseEnv, CAIRN_NOTE_DISTILLATION: "0" },
        });
        assertSuccessful(enabled, "explicit managed notes enable");
        assert.equal(JSON.parse(enabled.stdout).enabled, true);

        const store = await loadStore();
        const records = (await store.listCapabilityRecords(root)).records.filter(({ capability_id }) => capability_id === "notes.distill");
        assert.deepEqual(records.map(({ outcome }) => outcome).sort(), ["disabled", "disabled", "success"]);
        assert.equal(records.every(({ source, transport }) => source === "notes-cli" && transport === "local-process"), true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

async function main() {
    const mode = assertMode();
    if (mode === "--baseline") {
        runBaseline();
        console.log("PASS: capability logging legacy baseline");
        return;
    }
    if (mode === "--expect-red") {
        runBaseline();
        try {
            await schemaChecks();
        } catch (error) {
            if (isMissingLoggingModule(error)) {
                console.log(RED_MARKER);
                process.exitCode = EXPECTED_RED_EXIT;
                return;
            }
            throw error;
        }
        throw new Error("Capability logging production modules unexpectedly exist; run the GREEN contract instead.");
    }
    if (mode === "--expect-red-operating-finish") {
        await schemaChecks();
        await storeChecks();
        await adapterChecks();
        try {
            await operatingFinishChecks();
        } catch (error) {
            if (error instanceof assert.AssertionError
                && error.message.includes("contract consent revoked finish must not finalize")) {
                console.log(OPERATING_RED_MARKER);
                process.exitCode = EXPECTED_RED_EXIT;
                return;
            }
            throw error;
        }
        throw new Error("Operating finish consent/provenance bypass is no longer present; run the GREEN contract instead.");
    }
    if (mode === "--schema-only") {
        await schemaChecks();
        console.log("PASS: capability callback strict schema contract");
        return;
    }
    if (mode === "--store-only") {
        await schemaChecks();
        await storeChecks();
        console.log("PASS: capability callback local bounded store contract");
        return;
    }
    if (mode === "--notes-only") {
        await notesChecks();
        console.log("PASS: capability note callback ownership contract");
        return;
    }
    if (mode === "--operating-finish-only") {
        await operatingFinishChecks();
        console.log("PASS: operating finish consent and issued-start provenance contract");
        return;
    }
    if (mode === "--operating-sequential-only") {
        await schemaChecks();
        try {
            await operatingSequentialChecks();
        } catch (error) {
            if (error instanceof Error && error.message === "expected-invocation-scoped-correlation-defect") {
                console.log(OPERATING_SEQUENTIAL_RED_MARKER);
                process.exitCode = EXPECTED_RED_EXIT;
                return;
            }
            throw error;
        }
        throw new Error("Invocation-scoped correlation is no longer RED; promote the regression to the GREEN suite.");
    }
    await schemaChecks();
    await storeChecks();
    await adapterChecks();
    await operatingFinishChecks();
    console.log("PASS: capability callback privacy, consent and fail-open contract");
}

await main();
