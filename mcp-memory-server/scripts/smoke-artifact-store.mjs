import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    closeSync,
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
    writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { AgentFS } from "agentfs-sdk";

const EXPECTED_RED_EXIT = 86;
const CORE_RED_MARKER = "PHASE17_RED:ARTIFACT_STORE_MISSING";
const LIFECYCLE_RED_MARKER = "PHASE17_RED:ARTIFACT_LIFECYCLE_MISSING";
const DOCTOR_GAP_RED_MARKER = "PHASE17_RED:ARTIFACT_DOCTOR_STATE_GAP";
const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");
const projectRoot = resolve(serverRoot, "..");
const artifactSchemaSource = join(serverRoot, "src", "artifact-schema.ts");
const artifactStoreSource = join(serverRoot, "src", "artifact-store.ts");
const artifactSchemaModule = join(serverRoot, "dist", "artifact-schema.js");
const artifactStoreModule = join(serverRoot, "dist", "artifact-store.js");
const baselineChecks = [
    "smoke-trajectory-roundtrip.mjs",
    "smoke-trajectory-redaction.mjs",
    "smoke-trajectory-retention.mjs",
    "smoke-node-compat.mjs",
    "smoke-typed-nodes.mjs",
    "smoke-memory-import.mjs",
    "smoke-note-mcp.mjs",
    "smoke-node-doctor.mjs",
];

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd ?? projectRoot,
        encoding: "utf8",
        env: { ...process.env, ...options.env },
    });
    assert.equal(
        result.status,
        0,
        `${command} ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`,
    );
}

function assertArtifactModulesAbsent() {
    for (const path of [
        artifactSchemaSource,
        artifactStoreSource,
        artifactSchemaModule,
        artifactStoreModule,
    ]) {
        assert.equal(existsSync(path), false, `pre-feature artifact module is present: ${path}`);
    }
}

function runBaseline() {
    const scratch = mkdtempSync(join(tmpdir(), "cairn-artifact-baseline-"));
    try {
        const artifactDb = join(scratch, ".agentfs", "artifacts.db");
        assertArtifactModulesAbsent();
        assert.equal(existsSync(artifactDb), false, "baseline unexpectedly started with artifacts.db");
        run("npm", ["--prefix", serverRoot, "run", "build"]);
        assert.ok(existsSync(join(serverRoot, "dist", "trajectory-store.js")), "trajectory build output is missing");
        assert.ok(existsSync(join(serverRoot, "dist", "node-store.js")), "typed-node build output is missing");
        assertArtifactModulesAbsent();
        for (const check of baselineChecks) {
            run(process.execPath, [join(here, check)], { cwd: serverRoot });
        }
        assert.equal(existsSync(artifactDb), false, "baseline created artifacts.db");
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

function isMissingCoreModule(error) {
    if (!error || error.code !== "ERR_MODULE_NOT_FOUND") return false;
    const message = String(error.message ?? "");
    return message.includes("artifact-schema.js") || message.includes("artifact-store.js");
}

async function loadCoreModules() {
    const schema = await import(pathToFileURL(artifactSchemaModule).href);
    const store = await import(pathToFileURL(artifactStoreModule).href);
    return { schema, store };
}

function expectRejected(schema, value, label) {
    const result = schema.safeParse(value);
    assert.equal(result.success, false, `${label} must be rejected`);
}

function baseProvenance() {
    return {
        producer: "smoke-artifact-store",
        source_event: "explicit-test",
        harness: "opencode",
        harness_version: "fixture-1",
        native_id: "native-001",
    };
}

function diffWrite(overrides = {}) {
    return {
        kind: "diff",
        session_ref: "opencode:session-001",
        media_type: "text/x-diff",
        provenance: baseProvenance(),
        content: { text: "@@ -1 +1 @@\n-old\n+new\n" },
        ...overrides,
    };
}

function testSchemaContract(schemaModule) {
    const {
        ARTIFACT_KINDS,
        ARTIFACT_SCHEMA_VERSION,
        artifactEnvelopeSchema,
        artifactWriteInputSchema,
    } = schemaModule;
    assert.equal(ARTIFACT_SCHEMA_VERSION, 1);
    assert.deepEqual(ARTIFACT_KINDS, [
        "compaction_summary",
        "diff",
        "test_output",
        "generated_file",
    ]);
    assert.equal(typeof artifactEnvelopeSchema?.safeParse, "function");
    assert.equal(typeof artifactWriteInputSchema?.safeParse, "function");

    const writeCases = [
        {
            kind: "compaction_summary",
            session_ref: "claude-code:session-001",
            media_type: "text/markdown",
            provenance: { producer: "claude-post-compact", harness: "claude-code" },
            content: {
                raw_summary: "Goal\n\nDecision",
                task_goals: ["Keep the contract strict"],
                decisions_made: ["Use immutable records"],
                open_todos: [],
                critical_error_traces: [],
                completeness: {
                    task_goals: "complete",
                    decisions_made: "complete",
                    open_todos: "missing",
                    critical_error_traces: "missing",
                },
                trigger: "manual",
            },
        },
        diffWrite(),
        {
            kind: "test_output",
            session_ref: "cairn:session-002",
            media_type: "text/plain",
            provenance: { producer: "explicit-test-run" },
            content: { text: "2 passing", exit_code: 0, status: "passed" },
        },
        {
            kind: "generated_file",
            session_ref: "cairn:session-003",
            node_ref: {
                scope: "project",
                address_space: "project-notes",
                key: "projects/example/generated-file",
            },
            media_type: "text/plain",
            provenance: { producer: "explicit-generated-file" },
            content: {
                path_label: "src/generated.txt",
                file_digest: "a".repeat(64),
                logical_bytes: 7,
                binary: false,
                snapshot: "content",
            },
        },
    ];
    for (const value of writeCases) artifactWriteInputSchema.parse(value);

    expectRejected(artifactWriteInputSchema, diffWrite({ kind: "custom" }), "arbitrary kind");
    expectRejected(artifactWriteInputSchema, { ...diffWrite(), extra: true }, "extra write property");
    expectRejected(artifactWriteInputSchema, diffWrite({ session_ref: "" }), "missing stable session reference");
    expectRejected(artifactWriteInputSchema, diffWrite({ created_at: new Date().toISOString() }), "caller timestamp");
    expectRejected(artifactWriteInputSchema, diffWrite({ content_digest: "b".repeat(64) }), "caller digest");
    expectRejected(artifactWriteInputSchema, diffWrite({ stored_bytes: 12 }), "caller stored byte count");
    expectRejected(
        artifactWriteInputSchema,
        { ...diffWrite(), content: { text: "ok", path: "/etc/passwd" } },
        "caller-selected path dereference field",
    );
    expectRejected(
        artifactWriteInputSchema,
        {
            ...writeCases[3],
            content: { ...writeCases[3].content, path_label: "../outside.txt" },
        },
        "escaping generated-file label",
    );
    expectRejected(
        artifactWriteInputSchema,
        { ...writeCases[3], content: { text: "wrong kind" } },
        "kind/content mismatch",
    );
    expectRejected(
        artifactWriteInputSchema,
        {
            ...writeCases[3],
            node_ref: { scope: "all", address_space: "project-notes", key: "projects/example" },
        },
        "reserved node scope",
    );

    const envelope = {
        schema_version: 1,
        artifact_id: `art_${crypto.randomUUID()}`,
        kind: "diff",
        created_at: new Date().toISOString(),
        session_ref: "opencode:session-001",
        media_type: "text/x-diff",
        logical_bytes: 24,
        stored_bytes: 24,
        content_digest: "b".repeat(64),
        provenance: baseProvenance(),
        redaction: { applied: false, replacement_count: 0 },
        truncation: { truncated: false, original_bytes: 24, stored_bytes: 24 },
        content: { text: "@@ -1 +1 @@\n-old\n+new\n" },
    };
    artifactEnvelopeSchema.parse(envelope);
    expectRejected(artifactEnvelopeSchema, { ...envelope, artifact_id: crypto.randomUUID() }, "unprefixed artifact ID");
    expectRejected(artifactEnvelopeSchema, { ...envelope, content_digest: "B".repeat(64) }, "uppercase digest");
    expectRejected(artifactEnvelopeSchema, { ...envelope, arbitrary: true }, "extra envelope property");
}

function assertDerivedEnvelope(artifact, input) {
    assert.equal(artifact.schema_version, 1);
    assert.match(artifact.artifact_id, /^art_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(artifact.kind, input.kind);
    assert.equal(artifact.session_ref, input.session_ref);
    assert.equal(artifact.media_type, input.media_type);
    assert.match(artifact.created_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(artifact.content_digest, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(artifact.logical_bytes) && artifact.logical_bytes >= artifact.stored_bytes);
    assert.ok(Number.isSafeInteger(artifact.stored_bytes) && artifact.stored_bytes >= 0);
    assert.equal(artifact.redaction.applied, false);
    assert.equal(artifact.truncation.truncated, false);
    assert.deepEqual(artifact.content, input.content);
}

async function testCoreService(schemaModule, storeModule) {
    const {
        ARTIFACT_DEFAULT_MAX_BYTES,
        ARTIFACT_DEFAULT_RETENTION_DAYS,
        ARTIFACT_DEFAULT_SESSION_MAX_BYTES,
        ARTIFACT_DEFAULT_STORE_MAX_BYTES,
        artifactEnvelopeSchema,
        getArtifactLimits,
    } = schemaModule;
    const {
        doctorArtifactStore,
        getArtifactDbPath,
        listArtifacts,
        putArtifact,
        readArtifact,
        recordUnsupportedCompactionAdapter,
    } = storeModule;
    assert.equal(ARTIFACT_DEFAULT_MAX_BYTES, 1024 * 1024);
    assert.equal(ARTIFACT_DEFAULT_SESSION_MAX_BYTES, 16 * 1024 * 1024);
    assert.equal(ARTIFACT_DEFAULT_STORE_MAX_BYTES, 256 * 1024 * 1024);
    assert.equal(ARTIFACT_DEFAULT_RETENTION_DAYS, 30);
    for (const fn of [
        getArtifactLimits,
        getArtifactDbPath,
        listArtifacts,
        putArtifact,
        readArtifact,
        recordUnsupportedCompactionAdapter,
    ]) {
        assert.equal(typeof fn, "function");
    }

    const diagnosticScratch = mkdtempSync(join(tmpdir(), "cairn-artifact-diagnostic-"));
    try {
        await recordUnsupportedCompactionAdapter(diagnosticScratch, {
            harness: "claude-code",
            harness_version: "unknown-live-version",
            reason: "unsupported_version",
        });
        const diagnosticDoctor = await doctorArtifactStore(diagnosticScratch);
        assert.equal(diagnosticDoctor.ok, true, "a bounded unknown-adapter diagnostic must create a valid store");
        assert.equal(diagnosticDoctor.valid_artifacts, 0);
        assert.deepEqual((await listArtifacts(diagnosticScratch)).artifacts, []);
        assert.doesNotMatch(
            bytesFromExisting(filesUnder(diagnosticScratch)).toString("utf8"),
            /unknown-live-version/,
            "unknown adapter diagnostics must not retain version values",
        );
    } finally {
        rmSync(diagnosticScratch, { recursive: true, force: true });
    }

    const scratch = mkdtempSync(join(tmpdir(), "cairn-artifact-core-"));
    try {
        const limits = getArtifactLimits();
        const input = diffWrite();
        const before = Date.now();
        const writes = await Promise.all(Array.from({ length: 8 }, () => putArtifact(scratch, input, limits)));
        const after = Date.now();
        const ids = new Set(writes.map(({ artifact }) => artifact.artifact_id));
        assert.equal(ids.size, 1, "concurrent identical writes must collapse to one artifact");
        assert.equal(writes.filter(({ idempotent }) => idempotent === false).length, 1);
        assert.ok(writes.every(({ artifact }) => Date.parse(artifact.created_at) >= before));
        assert.ok(writes.every(({ artifact }) => Date.parse(artifact.created_at) <= after));
        const first = writes[0].artifact;
        assertDerivedEnvelope(first, input);
        artifactEnvelopeSchema.parse(first);

        const firstRead = await readArtifact(first.artifact_id, scratch);
        const priorBytes = JSON.stringify(firstRead);
        assert.deepEqual(firstRead, first);
        const replay = await putArtifact(scratch, input, limits);
        assert.equal(replay.idempotent, true);
        assert.equal(replay.artifact.artifact_id, first.artifact_id);

        const changedInput = diffWrite({
            supersedes: first.artifact_id,
            content: { text: "@@ -1 +1 @@\n-old\n+newer\n" },
        });
        const changed = await putArtifact(scratch, changedInput, limits);
        assert.equal(changed.idempotent, false);
        assert.notEqual(changed.artifact.artifact_id, first.artifact_id);
        assert.equal(changed.artifact.supersedes, first.artifact_id);
        assert.equal(JSON.stringify(await readArtifact(first.artifact_id, scratch)), priorBytes, "supersession mutated prior bytes");

        await assert.rejects(
            putArtifact(scratch, { ...diffWrite({ session_ref: "cairn:other" }), supersedes: first.artifact_id }, limits),
            /same session/i,
        );
        await assert.rejects(
            putArtifact(scratch, {
                ...diffWrite({ kind: "test_output", content: { text: "no", status: "failed" } }),
                supersedes: first.artifact_id,
            }, limits),
            /same kind/i,
        );

        const listed = await listArtifacts(scratch);
        assert.equal(listed.schema_version, 1);
        assert.equal(listed.artifacts.length, 2);
        assert.deepEqual(
            new Set(listed.artifacts.map(({ artifact_id }) => artifact_id)),
            new Set([first.artifact_id, changed.artifact.artifact_id]),
        );
        assert.equal(existsSync(getArtifactDbPath(scratch)), true);
        assert.doesNotMatch(readFileSync(getArtifactDbPath(scratch)).toString("utf8"), /\/etc\/passwd/);
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

async function withEnvironment(values, operation) {
    const prior = new Map();
    for (const [name, value] of Object.entries(values)) {
        prior.set(name, process.env[name]);
        if (value === undefined) delete process.env[name];
        else process.env[name] = String(value);
    }
    try {
        return await operation();
    } finally {
        for (const [name, value] of prior) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        }
    }
}

function filesUnder(root) {
    if (!existsSync(root)) return [];
    const files = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const path = join(root, entry.name);
        if (entry.isDirectory()) files.push(...filesUnder(path));
        else files.push(path);
    }
    return files;
}

function bytesFromExisting(paths) {
    return Buffer.concat(paths.filter(existsSync).map((path) => readFileSync(path)));
}

function assertSentinelsAbsent(value, sentinels, surface) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
    for (const sentinel of sentinels) {
        assert.equal(bytes.includes(Buffer.from(sentinel)), false, `${surface} leaked ${sentinel}`);
    }
}

function compactionWrite(sessionRef, suffix, overrides = {}) {
    return {
        kind: "compaction_summary",
        session_ref: sessionRef,
        media_type: "text/markdown",
        provenance: { producer: "compaction-fixture", harness: "claude-code" },
        content: {
            raw_summary: `Goal ${suffix}\n\nDecision ${suffix}`,
            task_goals: [`goal-${suffix}`],
            decisions_made: [`decision-${suffix}`],
            open_todos: [`todo-${suffix}`],
            critical_error_traces: [],
            completeness: {
                task_goals: "complete",
                decisions_made: "complete",
                open_todos: "complete",
                critical_error_traces: "complete",
            },
            trigger: "manual",
        },
        ...overrides,
    };
}

function testLimitContract(schemaModule) {
    const {
        ARTIFACT_DEFAULT_MAX_BYTES,
        ARTIFACT_DEFAULT_RETENTION_DAYS,
        ARTIFACT_DEFAULT_SESSION_MAX_BYTES,
        ARTIFACT_DEFAULT_STORE_MAX_BYTES,
        COMPACTION_DEFAULT_MAX_REVISIONS,
        GENERATED_FILE_MAX_SNAPSHOT_BYTES,
        getArtifactLimits,
    } = schemaModule;
    assert.equal(ARTIFACT_DEFAULT_MAX_BYTES, 1024 * 1024);
    assert.equal(ARTIFACT_DEFAULT_SESSION_MAX_BYTES, 16 * 1024 * 1024);
    assert.equal(ARTIFACT_DEFAULT_STORE_MAX_BYTES, 256 * 1024 * 1024);
    assert.equal(ARTIFACT_DEFAULT_RETENTION_DAYS, 30);
    assert.equal(COMPACTION_DEFAULT_MAX_REVISIONS, 8);
    assert.equal(GENERATED_FILE_MAX_SNAPSHOT_BYTES, 256 * 1024);

    const envKeys = {
        CAIRN_ARTIFACT_MAX_BYTES: "2048",
        CAIRN_ARTIFACT_SESSION_MAX_BYTES: "4096",
        CAIRN_ARTIFACT_STORE_MAX_BYTES: "8192",
        CAIRN_ARTIFACT_RETENTION_DAYS: "7",
        CAIRN_COMPACTION_MAX_REVISIONS: "3",
        CAIRN_ARTIFACT_GENERATED_FILE_SNAPSHOT_MAX_BYTES: "1024",
    };
    return withEnvironment(envKeys, () => {
        assert.deepEqual(getArtifactLimits(), {
            artifactMaxBytes: 2048,
            sessionMaxBytes: 4096,
            storeMaxBytes: 8192,
            retentionDays: 7,
            compactionMaxRevisions: 3,
            generatedFileSnapshotMaxBytes: 1024,
        });
        return withEnvironment({ CAIRN_ARTIFACT_SESSION_MAX_BYTES: "1024" }, () => {
            assert.throws(() => getArtifactLimits(), /session.*artifact|artifact.*session/i);
            return withEnvironment({
                CAIRN_ARTIFACT_SESSION_MAX_BYTES: "4096",
                CAIRN_ARTIFACT_STORE_MAX_BYTES: "2048",
            }, () => assert.throws(() => getArtifactLimits(), /store.*session|session.*store/i));
        });
    });
}

async function testRedactionAndBounds(schemaModule, storeModule) {
    const {
        getArtifactLimits,
    } = schemaModule;
    const {
        deleteArtifact,
        doctorArtifactStore,
        getArtifactDbPath,
        listArtifacts,
        putArtifact,
        readArtifact,
        readLatestCompaction,
    } = storeModule;
    const scratch = mkdtempSync(join(tmpdir(), "cairn-artifact-privacy-"));
    const config = join(scratch, ".ai", "artifact-redaction.json");
    const sentinels = [
        "sk-artifact-body-12345678",
        "ARTIFACT-CUSTOM-7788",
        "env-artifact-secret-9911",
        "node-secret-7788",
        "generated-label-7788",
    ];
    try {
        mkdirSync(dirname(config), { recursive: true });
        writeFileSync(config, JSON.stringify({
            version: 1,
            patterns: [
                { pattern: "ARTIFACT-CUSTOM-[0-9]+", flags: "g" },
                { pattern: "generated-label-[0-9]+", flags: "g", replacement: "redacted-label" },
            ],
        }));
        await withEnvironment({
            CAIRN_REDACTION_FILE: ".ai/artifact-redaction.json",
            ARTIFACT_TEST_TOKEN: "env-artifact-secret-9911",
        }, async () => {
            const limits = getArtifactLimits();
            const secretCompaction = compactionWrite("claude-code:privacy", "privacy", {
                provenance: {
                    producer: "ARTIFACT-CUSTOM-7788",
                    source_event: "env-artifact-secret-9911",
                    harness: "claude-code",
                    native_id: "native-ARTIFACT-CUSTOM-7788",
                },
                content: {
                    ...compactionWrite("claude-code:privacy", "privacy").content,
                    raw_summary: "sk-artifact-body-12345678 env-artifact-secret-9911",
                    task_goals: ["ARTIFACT-CUSTOM-7788"],
                    decisions_made: ["safe"],
                    open_todos: [],
                    critical_error_traces: [],
                },
            });
            const stored = await putArtifact(scratch, secretCompaction, limits);
            assert.equal(stored.artifact.redaction.applied, true);
            assert.ok(stored.artifact.redaction.replacement_count >= 4);
            const recovered = await readLatestCompaction(scratch, "claude-code:privacy");
            const listed = await listArtifacts(scratch, { session_ref: "claude-code:privacy" });
            const read = await readArtifact(stored.artifact.artifact_id, scratch);

            const generated = await putArtifact(scratch, {
                kind: "generated_file",
                session_ref: "cairn:generated",
                node_ref: {
                    scope: "project",
                    address_space: "project-notes",
                    key: "projects/generated-file",
                },
                media_type: "text/plain",
                provenance: { producer: "generated-label-7788" },
                content: {
                    path_label: "generated/generated-label-7788.txt",
                    file_digest: "c".repeat(64),
                    logical_bytes: 12,
                    binary: false,
                    snapshot: "ARTIFACT-CUSTOM-7788",
                },
            }, limits);
            assert.doesNotMatch(generated.artifact.content.path_label, /generated-label-7788/);
            assertSentinelsAbsent(
                JSON.stringify({ stored, recovered, listed, read, generated }),
                sentinels,
                "read/list/recovery output",
            );

            const rejectedOutputs = [];
            await assert.rejects(async () => {
                try {
                    await putArtifact(scratch, {
                        ...diffWrite({
                            session_ref: "cairn:invalid-node",
                            node_ref: {
                                scope: "project",
                                address_space: "project-notes",
                                key: "projects/node-secret-7788",
                            },
                        }),
                    }, limits);
                } catch (error) {
                    rejectedOutputs.push(String(error));
                    throw error;
                }
            });
            assertSentinelsAbsent(rejectedOutputs.join("\n"), sentinels, "validation output");

            const utf8 = await withEnvironment({
                CAIRN_ARTIFACT_MAX_BYTES: "1024",
                CAIRN_ARTIFACT_SESSION_MAX_BYTES: "8192",
                CAIRN_ARTIFACT_STORE_MAX_BYTES: "32768",
            }, () => putArtifact(scratch, {
                kind: "test_output",
                session_ref: "cairn:utf8",
                media_type: "text/plain",
                provenance: { producer: "utf8-boundary" },
                content: { text: `prefix-${"🙂".repeat(2048)}-suffix`, status: "passed" },
            }, getArtifactLimits()));
            assert.equal(utf8.artifact.truncation.truncated, true);
            assert.equal(utf8.artifact.truncation.original_bytes > utf8.artifact.truncation.stored_bytes, true);
            assert.ok(utf8.artifact.stored_bytes <= 1024);
            assert.doesNotMatch(JSON.stringify(utf8.artifact), /�/);

            const binary = await putArtifact(scratch, {
                kind: "generated_file",
                session_ref: "cairn:binary",
                media_type: "application/octet-stream",
                provenance: { producer: "binary-fixture" },
                content: {
                    path_label: "dist/output.bin",
                    file_digest: "d".repeat(64),
                    logical_bytes: 512,
                    binary: true,
                    snapshot: "must-not-survive",
                },
            }, limits);
            assert.equal(binary.artifact.content.snapshot, undefined);
            assert.equal(binary.artifact.content.metadata_only, true);

            const oversized = await putArtifact(scratch, {
                kind: "generated_file",
                session_ref: "cairn:oversized",
                media_type: "text/plain",
                provenance: { producer: "oversized-fixture" },
                content: {
                    path_label: "dist/large.txt",
                    file_digest: "e".repeat(64),
                    logical_bytes: 300 * 1024,
                    binary: false,
                    snapshot: "x".repeat(300 * 1024),
                },
            }, limits);
            assert.equal(oversized.artifact.content.snapshot, undefined);
            assert.equal(oversized.artifact.content.metadata_only, true);

            const deletion = await deleteArtifact(generated.artifact.artifact_id, scratch);
            const doctor = await doctorArtifactStore(scratch, false, limits);
            assertSentinelsAbsent(JSON.stringify({ deletion, doctor }), sentinels, "delete/doctor output");
            assert.equal(deletion.content, undefined, "delete result must not echo a body");
            assert.equal(doctor.ok, true);

            const dbPath = getArtifactDbPath(scratch);
            const durableBytes = bytesFromExisting([dbPath, `${dbPath}-wal`, `${dbPath}-shm`]);
            assertSentinelsAbsent(durableBytes, sentinels, "database/WAL/SHM bytes");
            const cairnFiles = filesUnder(scratch).filter((path) => !path.startsWith(join(scratch, ".ai")));
            assertSentinelsAbsent(bytesFromExisting(cairnFiles), sentinels, "Cairnkeep files");
            assert.equal(
                filesUnder(scratch).some((path) => /(?:artifact|cairn).*(?:tmp|temp)$/i.test(path)),
                false,
                "raw candidate must not be copied to a Cairnkeep temporary file",
            );
        });
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

async function openRawStore(projectRoot) {
    return AgentFS.open({ id: "artifacts", path: join(projectRoot, ".agentfs", "artifacts.db") });
}

function stableRows(rows) {
    return [...rows]
        .sort((left, right) => left.key.localeCompare(right.key))
        .map(({ key, value }) => ({ key, value }));
}

async function readRawRows(projectRoot, prefix = "") {
    const raw = await openRawStore(projectRoot);
    try {
        return stableRows(await raw.kv.list(prefix));
    } finally {
        await raw.close();
    }
}

function doctorStateGap(message) {
    const error = new Error(message);
    error.code = "ERR_ARTIFACT_DOCTOR_STATE_GAP";
    return error;
}

async function testDoctorGapContract(schemaModule, storeModule) {
    const {
        deleteArtifact,
        doctorArtifactStore,
        getArtifactDbPath,
        putArtifact,
    } = storeModule;
    const gaps = [];
    const permissiveLimits = {
        artifactMaxBytes: 4096,
        sessionMaxBytes: 65536,
        storeMaxBytes: 262144,
        retentionDays: 3650,
        compactionMaxRevisions: 8,
        generatedFileSnapshotMaxBytes: 4096,
    };
    const issueNames = {
        dedupeMissing: "Missing or stale artifact dedupe binding.",
        dedupeOrphan: "Orphan artifact dedupe binding.",
        sequenceLow: "Missing or regressed compaction sequence.",
        sequenceUnsafe: "Invalid non-derivable compaction sequence.",
        age: "Artifact retention age limit exceeded.",
        revision: "Compaction revision retention limit exceeded.",
        session: "Artifact session logical byte limit exceeded.",
        store: "Artifact store logical byte limit exceeded.",
    };
    const note = (condition, message) => {
        if (!condition) gaps.push(message);
    };

    const derivedRoot = mkdtempSync(join(tmpdir(), "cairn-artifact-doctor-gap-derived-"));
    try {
        const sessionRef = "claude-code:doctor-gap";
        const first = await putArtifact(
            derivedRoot,
            compactionWrite(sessionRef, "first"),
            permissiveLimits,
            { now: new Date("2026-07-01T00:00:00.000Z") },
        );
        const second = await putArtifact(
            derivedRoot,
            compactionWrite(sessionRef, "second"),
            permissiveLimits,
            { now: new Date("2026-07-01T00:00:01.000Z") },
        );
        assert.deepEqual(
            [first.artifact.content.revision, second.artifact.content.revision],
            [1, 2],
            "doctor gap fixture must retain two monotonic compaction revisions",
        );
        const healthy = await doctorArtifactStore(derivedRoot, false, permissiveLimits);
        assert.equal(healthy.ok, true, `doctor gap fixture is not initially healthy: ${JSON.stringify(healthy)}`);
        const authoritativeBefore = await readRawRows(derivedRoot, "artifact/full/");
        const expectedDedupe = await readRawRows(derivedRoot, "artifact/index/dedupe/");
        assert.equal(expectedDedupe.length, 2, "doctor gap fixture must start with two canonical dedupe bindings");

        const raw = await openRawStore(derivedRoot);
        try {
            await raw.kv.delete(expectedDedupe[0].key);
            await raw.kv.set("artifact/index/dedupe/orphan-doctor-gap", first.artifact.artifact_id);
            await raw.kv.set(`compaction/sequence/${sessionRef}`, 0);
        } finally {
            await raw.close();
        }

        const diagnosed = await doctorArtifactStore(derivedRoot, false, permissiveLimits);
        note(diagnosed.ok === false, "doctor accepted missing/stale/orphan dedupe and a regressed sequence");
        note(diagnosed.issues.includes(issueNames.dedupeMissing), "doctor omitted the missing/stale dedupe issue category");
        note(diagnosed.issues.includes(issueNames.dedupeOrphan), "doctor omitted the orphan dedupe issue category");
        note(diagnosed.issues.includes(issueNames.sequenceLow), "doctor omitted the regressed sequence issue category");
        note(
            !diagnosed.issues.some((issue) => issue.includes(sessionRef)
                || issue.includes(first.artifact.artifact_id)
                || issue.includes(second.artifact.artifact_id)),
            "doctor derived-state issues disclosed record values",
        );

        const repaired = await doctorArtifactStore(derivedRoot, true, permissiveLimits);
        note(repaired.ok === true && repaired.repaired === true, "doctor did not safely repair derivable dedupe/sequence state");
        note(
            JSON.stringify(await readRawRows(derivedRoot, "artifact/index/dedupe/")) === JSON.stringify(expectedDedupe),
            "doctor did not rebuild the exact canonical dedupe map",
        );
        const repairedRaw = await openRawStore(derivedRoot);
        try {
            note(
                await repairedRaw.kv.get(`compaction/sequence/${sessionRef}`) === 2,
                "doctor did not raise the regressed sequence to the highest retained revision",
            );
            await repairedRaw.kv.set(`compaction/sequence/${sessionRef}`, 9);
        } finally {
            await repairedRaw.close();
        }
        const higher = await doctorArtifactStore(derivedRoot, true, permissiveLimits);
        const higherRaw = await openRawStore(derivedRoot);
        try {
            note(higher.ok === true, "doctor rejected a valid higher historical sequence");
            note(
                await higherRaw.kv.get(`compaction/sequence/${sessionRef}`) === 9,
                "doctor lowered a valid higher historical sequence",
            );
        } finally {
            await higherRaw.close();
        }
        const idempotent = await doctorArtifactStore(derivedRoot, true, permissiveLimits);
        note(idempotent.ok === true && idempotent.repaired === false, "a second doctor repair was not idempotent");
        assert.deepEqual(
            await readRawRows(derivedRoot, "artifact/full/"),
            authoritativeBefore,
            "derived-state repair changed authoritative full records",
        );
    } finally {
        rmSync(derivedRoot, { recursive: true, force: true });
    }

    const retentionCases = [
        {
            label: "age",
            issue: issueNames.age,
            limits: { ...permissiveLimits, retentionDays: 0 },
            write: async (root) => {
                await putArtifact(root, diffWrite({ session_ref: "cairn:doctor-age", content: { text: "old" } }), permissiveLimits, {
                    now: new Date("2026-01-01T00:00:00.000Z"),
                });
            },
        },
        {
            label: "revision",
            issue: issueNames.revision,
            limits: { ...permissiveLimits, compactionMaxRevisions: 1 },
            write: async (root) => {
                for (const [index, suffix] of ["one", "two", "three"].entries()) {
                    await putArtifact(root, compactionWrite("claude-code:doctor-revision", suffix), permissiveLimits, {
                        now: new Date(`2026-07-01T00:00:0${index}.000Z`),
                    });
                }
            },
        },
        {
            label: "session",
            issue: issueNames.session,
            limits: { ...permissiveLimits, artifactMaxBytes: 1024, sessionMaxBytes: 2048 },
            write: async (root) => {
                for (const suffix of ["one", "two"]) {
                    await putArtifact(root, diffWrite({
                        session_ref: "cairn:doctor-session",
                        content: { text: `${suffix}-${"s".repeat(1400)}` },
                    }), permissiveLimits);
                }
            },
        },
        {
            label: "store",
            issue: issueNames.store,
            limits: { ...permissiveLimits, artifactMaxBytes: 1024, sessionMaxBytes: 4096, storeMaxBytes: 4096 },
            write: async (root) => {
                for (const suffix of ["one", "two", "three"]) {
                    await putArtifact(root, diffWrite({
                        session_ref: `cairn:doctor-store-${suffix}`,
                        content: { text: `${suffix}-${"t".repeat(1600)}` },
                    }), permissiveLimits);
                }
            },
        },
    ];
    for (const retentionCase of retentionCases) {
        const root = mkdtempSync(join(tmpdir(), `cairn-artifact-doctor-gap-${retentionCase.label}-`));
        try {
            await retentionCase.write(root);
            const authoritativeBefore = await readRawRows(root, "artifact/full/");
            const diagnosed = await doctorArtifactStore(root, false, retentionCase.limits);
            note(diagnosed.ok === false, `doctor accepted an over-${retentionCase.label} store`);
            note(diagnosed.issues.includes(retentionCase.issue), `doctor omitted the ${retentionCase.label} limit issue category`);
            const repaired = await doctorArtifactStore(root, true, retentionCase.limits);
            note(repaired.ok === false, `doctor repair cleared an unresolved ${retentionCase.label} limit violation`);
            assert.deepEqual(
                await readRawRows(root, "artifact/full/"),
                authoritativeBefore,
                `doctor repair changed authoritative full records for ${retentionCase.label} limits`,
            );
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }

    for (const corruption of ["digest", "full-record"]) {
        const root = mkdtempSync(join(tmpdir(), `cairn-artifact-doctor-gap-${corruption}-`));
        try {
            const written = await putArtifact(root, diffWrite({ session_ref: `cairn:doctor-${corruption}` }), permissiveLimits);
            const key = `artifact/full/${written.artifact.artifact_id}`;
            const raw = await openRawStore(root);
            try {
                const stored = await raw.kv.get(key);
                await raw.kv.set(key, corruption === "digest"
                    ? { ...stored, content: { ...stored.content, text: "corrupt-authority" } }
                    : { invalid: true });
            } finally {
                await raw.close();
            }
            const corruptedRows = await readRawRows(root, "artifact/full/");
            const result = await doctorArtifactStore(root, true, permissiveLimits);
            assert.equal(result.ok, false, `${corruption} corruption must remain failed`);
            assert.equal(result.repaired, false, `${corruption} corruption must not be repaired`);
            assert.deepEqual(await readRawRows(root, "artifact/full/"), corruptedRows, `${corruption} corruption was modified`);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }

    const unsafeSequenceRoot = mkdtempSync(join(tmpdir(), "cairn-artifact-doctor-gap-unsafe-sequence-"));
    try {
        const sessionRef = "claude-code:doctor-historical";
        const written = await putArtifact(unsafeSequenceRoot, compactionWrite(sessionRef, "historical"), permissiveLimits);
        await deleteArtifact(written.artifact.artifact_id, unsafeSequenceRoot);
        const raw = await openRawStore(unsafeSequenceRoot);
        try {
            assert.equal(await raw.kv.get(`compaction/sequence/${sessionRef}`), 1, "delete removed a valid historical counter");
            await raw.kv.set(`compaction/sequence/${sessionRef}`, 0);
        } finally {
            await raw.close();
        }
        const before = await readRawRows(unsafeSequenceRoot);
        const result = await doctorArtifactStore(unsafeSequenceRoot, true, permissiveLimits);
        note(result.ok === false, "doctor accepted a non-derivable invalid historical sequence");
        note(result.repaired === false, "doctor guessed a repair for a non-derivable historical sequence");
        note(result.issues.includes(issueNames.sequenceUnsafe), "doctor omitted the non-derivable sequence issue category");
        note(
            JSON.stringify(await readRawRows(unsafeSequenceRoot)) === JSON.stringify(before),
            "doctor modified a non-derivable historical sequence",
        );
    } finally {
        rmSync(unsafeSequenceRoot, { recursive: true, force: true });
    }

    const sqliteRoot = mkdtempSync(join(tmpdir(), "cairn-artifact-doctor-gap-sqlite-"));
    try {
        await putArtifact(sqliteRoot, diffWrite({ session_ref: "cairn:doctor-sqlite" }), permissiveLimits);
        const sqlitePath = getArtifactDbPath(sqliteRoot);
        const fd = openSync(sqlitePath, "r+");
        try {
            writeSync(fd, Buffer.from("BROKEN-SQLITE!!!"), 0, 16, 0);
        } finally {
            closeSync(fd);
        }
        const before = readFileSync(sqlitePath);
        const result = await doctorArtifactStore(sqliteRoot, true, permissiveLimits);
        assert.equal(result.ok, false, "SQLite corruption must remain failed");
        assert.equal(result.repaired, false, "SQLite corruption must not be repaired");
        assert.deepEqual(readFileSync(sqlitePath), before, "doctor modified SQLite corruption");
    } finally {
        rmSync(sqliteRoot, { recursive: true, force: true });
    }

    assert.equal(schemaModule.ARTIFACT_SCHEMA_VERSION, 1, "doctor gap ran against an unexpected artifact schema");
    if (gaps.length > 0) throw doctorStateGap(gaps.join("\n"));
}

async function runDoctorGap() {
    const { schema, store } = await loadCoreModules();
    await testDoctorGapContract(schema, store);
}

async function testAutomaticBudgetsAndAge(storeModule) {
    const { listArtifacts, pruneArtifacts, putArtifact } = storeModule;
    const scratch = mkdtempSync(join(tmpdir(), "cairn-artifact-budgets-"));
    const ageRoot = join(scratch, "age");
    const budgetRoot = join(scratch, "budget");
    const baseLimits = {
        artifactMaxBytes: 2048,
        sessionMaxBytes: 3600,
        storeMaxBytes: 5000,
        retentionDays: 365,
        compactionMaxRevisions: 8,
        generatedFileSnapshotMaxBytes: 2048,
    };
    const body = (label) => `${label}-${"x".repeat(1400)}`;
    try {
        const one = await putArtifact(budgetRoot, diffWrite({
            session_ref: "cairn:budget-a",
            content: { text: body("one") },
        }), baseLimits, { now: new Date("2026-01-01T00:00:00.000Z") });
        const two = await putArtifact(budgetRoot, {
            kind: "test_output",
            session_ref: "cairn:budget-a",
            media_type: "text/plain",
            provenance: { producer: "budget-fixture" },
            content: { text: body("two"), status: "passed" },
        }, baseLimits, { now: new Date("2026-01-01T00:00:01.000Z") });
        const three = await putArtifact(budgetRoot, diffWrite({
            session_ref: "cairn:budget-a",
            content: { text: body("three") },
        }), baseLimits, { now: new Date("2026-01-01T00:00:02.000Z") });
        let listed = await listArtifacts(budgetRoot, { session_ref: "cairn:budget-a" });
        assert.equal(listed.artifacts.some(({ artifact_id }) => artifact_id === one.artifact.artifact_id), false);
        assert.deepEqual(
            new Set(listed.artifacts.map(({ artifact_id }) => artifact_id)),
            new Set([two.artifact.artifact_id, three.artifact.artifact_id]),
            "per-session pruning must remove the oldest eligible artifact across kinds",
        );

        const four = await putArtifact(budgetRoot, diffWrite({
            session_ref: "cairn:budget-b",
            content: { text: body("four") },
        }), baseLimits, { now: new Date("2026-01-01T00:00:03.000Z") });
        const five = await putArtifact(budgetRoot, diffWrite({
            session_ref: "cairn:budget-c",
            content: { text: body("five") },
        }), baseLimits, { now: new Date("2026-01-01T00:00:04.000Z") });
        listed = await listArtifacts(budgetRoot);
        assert.equal(listed.artifacts.some(({ artifact_id }) => artifact_id === two.artifact.artifact_id), false);
        assert.deepEqual(
            new Set(listed.artifacts.map(({ artifact_id }) => artifact_id)),
            new Set([three.artifact.artifact_id, four.artifact.artifact_id, five.artifact.artifact_id]),
            "store pruning must be global oldest-first without collapsing kinds",
        );
        assert.ok(listed.logical_bytes <= baseLimits.storeMaxBytes);

        const oldest = await putArtifact(ageRoot, diffWrite({
            session_ref: "cairn:age-a",
            content: { text: "oldest" },
        }), baseLimits, { now: new Date("2026-01-01T00:00:00.000Z") });
        const older = await putArtifact(ageRoot, {
            kind: "test_output",
            session_ref: "cairn:age-b",
            media_type: "text/plain",
            provenance: { producer: "age-fixture" },
            content: { text: "older", status: "passed" },
        }, baseLimits, { now: new Date("2026-01-02T00:00:00.000Z") });
        const ageLimits = { ...baseLimits, retentionDays: 30 };
        const ageDryRun = await pruneArtifacts(ageRoot, ageLimits, {
            dryRun: true,
            includeProtected: false,
            now: new Date("2026-03-01T00:00:00.000Z"),
        });
        assert.deepEqual(
            ageDryRun.removed.map(({ artifact_id, reason }) => [artifact_id, reason]),
            [
                [oldest.artifact.artifact_id, "age"],
                [older.artifact.artifact_id, "age"],
            ],
            "age pruning must report eligible artifacts oldest-first",
        );
        const fresh = await putArtifact(ageRoot, diffWrite({
            session_ref: "cairn:age-new",
            content: { text: "fresh" },
        }), ageLimits, { now: new Date("2026-03-01T00:00:00.000Z") });
        listed = await listArtifacts(ageRoot);
        assert.deepEqual(listed.artifacts.map(({ artifact_id }) => artifact_id), [fresh.artifact.artifact_id]);
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

async function testLifecycleStore(schemaModule, storeModule) {
    const { getArtifactLimits } = schemaModule;
    const {
        deleteArtifact,
        doctorArtifactStore,
        getArtifactDbPath,
        listArtifacts,
        pruneArtifacts,
        putArtifact,
        readArtifact,
        readLatestCompaction,
    } = storeModule;
    for (const fn of [deleteArtifact, doctorArtifactStore, pruneArtifacts, readLatestCompaction]) {
        assert.equal(typeof fn, "function", "artifact lifecycle export is missing");
    }
    await testAutomaticBudgetsAndAge(storeModule);
    const scratch = mkdtempSync(join(tmpdir(), "cairn-artifact-lifecycle-"));
    try {
        const limits = await withEnvironment({
            CAIRN_ARTIFACT_MAX_BYTES: "4096",
            CAIRN_ARTIFACT_SESSION_MAX_BYTES: "16384",
            CAIRN_ARTIFACT_STORE_MAX_BYTES: "65536",
            CAIRN_ARTIFACT_RETENTION_DAYS: "30",
            CAIRN_COMPACTION_MAX_REVISIONS: "8",
        }, () => getArtifactLimits());
        const first = await putArtifact(scratch, compactionWrite("claude-code:lifecycle", "one"), limits);
        const kindAware = await putArtifact(scratch, diffWrite({
            session_ref: "claude-code:lifecycle",
            content: { text: "kind-aware-survivor" },
        }), limits);
        const concurrent = await Promise.all(["two", "three", "four"].map((suffix) => (
            putArtifact(scratch, compactionWrite("claude-code:lifecycle", suffix), limits)
        )));
        const revisions = [first, ...concurrent].map(({ artifact }) => artifact.content.revision).sort((a, b) => a - b);
        assert.deepEqual(revisions, [1, 2, 3, 4]);
        const latest = await readLatestCompaction(scratch, "claude-code:lifecycle");
        assert.equal(latest.content.revision, 4);
        const latestProject = await readLatestCompaction(scratch);
        assert.equal(latestProject.artifact_id, latest.artifact_id);

        const beforeFault = await listArtifacts(scratch);
        await assert.rejects(
            putArtifact(scratch, diffWrite({ session_ref: "cairn:fault", content: { text: "fault-body" } }), limits, {
                fault: "after-full-write",
            }),
            /fault/i,
        );
        assert.deepEqual(await listArtifacts(scratch), beforeFault, "fault injection split the transaction");

        const dryRun = await pruneArtifacts(scratch, {
            ...limits,
            compactionMaxRevisions: 2,
        }, { dryRun: true, includeProtected: false });
        assert.equal(dryRun.removed.filter(({ reason }) => reason === "revision").length, 2);
        assert.equal((await listArtifacts(scratch)).artifacts.length, beforeFault.artifacts.length);
        const pruned = await pruneArtifacts(scratch, {
            ...limits,
            compactionMaxRevisions: 2,
        }, { dryRun: false, includeProtected: false });
        assert.equal(pruned.removed.filter(({ reason }) => reason === "revision").length, 2);
        assert.equal(
            (await listArtifacts(scratch)).artifacts.some(({ artifact_id }) => artifact_id === kindAware.artifact.artifact_id),
            true,
            "compaction revision pruning must not remove other artifact kinds",
        );
        assert.equal((await readLatestCompaction(scratch)).artifact_id, latest.artifact_id);

        const protectedPrune = await pruneArtifacts(scratch, {
            ...limits,
            retentionDays: 0,
            sessionMaxBytes: 4096,
            storeMaxBytes: 4096,
        }, { dryRun: false, includeProtected: false, now: new Date(Date.now() + 1000) });
        assert.equal(
            protectedPrune.removed.some(({ artifact_id }) => artifact_id === latest.artifact_id),
            false,
            "automatic prune removed the newest valid project compaction",
        );
        assert.equal((await readLatestCompaction(scratch)).artifact_id, latest.artifact_id);
        const explicitPrune = await pruneArtifacts(scratch, {
            ...limits,
            retentionDays: 0,
            sessionMaxBytes: 4096,
            storeMaxBytes: 4096,
        }, { dryRun: false, includeProtected: true, now: new Date(Date.now() + 2000) });
        assert.equal(
            explicitPrune.removed.some(({ artifact_id }) => artifact_id === latest.artifact_id),
            true,
            "includeProtected prune must be able to remove the protected compaction",
        );
        assert.equal(await readLatestCompaction(scratch), null);

        const afterPrune = await putArtifact(scratch, compactionWrite("claude-code:lifecycle", "after-prune"), limits);
        assert.equal(afterPrune.artifact.content.revision, 5, "compaction revisions must never be reused");
        const deletionSentinel = "deleted-body-must-not-remain-8822";
        const doomed = await putArtifact(scratch, diffWrite({
            session_ref: "cairn:delete",
            content: { text: deletionSentinel },
        }), limits);
        const deletion = await deleteArtifact(doomed.artifact.artifact_id, scratch);
        assert.equal(deletion.deleted, true);
        assert.equal(JSON.stringify(deletion).includes(deletionSentinel), false);
        await assert.rejects(readArtifact(doomed.artifact.artifact_id, scratch), /not found/i);
        const raw = await openRawStore(scratch);
        try {
            const allRows = await raw.kv.list("");
            const serialized = JSON.stringify(allRows);
            assert.equal(serialized.includes(doomed.artifact.artifact_id), false, "delete left an index/dedupe/pointer reference");
            assert.equal(serialized.includes(deletionSentinel), false, "delete left a body or tombstone");
            assert.equal(allRows.some(({ key }) => /tombstone|deleted/i.test(key)), false, "delete created a tombstone");
        } finally {
            await raw.close();
        }
        assert.equal(
            bytesFromExisting([getArtifactDbPath(scratch), `${getArtifactDbPath(scratch)}-wal`, `${getArtifactDbPath(scratch)}-shm`])
                .includes(Buffer.from(deletionSentinel)),
            false,
            "hard delete left body bytes in SQLite storage",
        );

        const repairTarget = await putArtifact(scratch, compactionWrite("claude-code:repair", "repair"), limits);
        const corrupt = await openRawStore(scratch);
        try {
            const indexRows = await corrupt.kv.list("artifact/index/");
            const pointerRows = await corrupt.kv.list("compaction/latest/");
            assert.ok(indexRows.length >= 1 && pointerRows.length >= 1);
            await corrupt.kv.delete(indexRows[0].key);
            await corrupt.kv.delete(pointerRows[0].key);
        } finally {
            await corrupt.close();
        }
        const detected = await doctorArtifactStore(scratch, false, limits);
        assert.equal(detected.ok, false);
        assert.ok(detected.issues.some((issue) => /index|pointer/i.test(issue)));
        const repaired = await doctorArtifactStore(scratch, true, limits);
        assert.equal(repaired.ok, true);
        assert.equal(repaired.repaired, true);
        assert.equal((await readArtifact(repairTarget.artifact.artifact_id, scratch)).artifact_id, repairTarget.artifact.artifact_id);

        const authority = await openRawStore(scratch);
        const fullKey = `artifact/full/${repairTarget.artifact.artifact_id}`;
        let corruptBody;
        try {
            corruptBody = await authority.kv.get(fullKey);
            assert.ok(corruptBody);
            await authority.kv.set(fullKey, {
                ...corruptBody,
                content: { ...corruptBody.content, raw_summary: "authoritative-corruption" },
            });
        } finally {
            await authority.close();
        }
        const authorityFailed = await doctorArtifactStore(scratch, true, limits);
        assert.equal(authorityFailed.ok, false);
        assert.equal(authorityFailed.repaired, false);
        assert.ok(authorityFailed.issues.some((issue) => /digest|authoritative|full record/i.test(issue)));
        const authorityAfter = await openRawStore(scratch);
        try {
            assert.deepEqual(await authorityAfter.kv.get(fullKey), {
                ...corruptBody,
                content: { ...corruptBody.content, raw_summary: "authoritative-corruption" },
            });
        } finally {
            await authorityAfter.close();
        }

        const sqliteRoot = join(scratch, "sqlite-corrupt");
        mkdirSync(join(sqliteRoot, ".agentfs"), { recursive: true });
        const sqlitePath = join(sqliteRoot, ".agentfs", "artifacts.db");
        copyFileSync(getArtifactDbPath(scratch), sqlitePath);
        const fd = openSync(sqlitePath, "r+");
        try {
            writeSync(fd, Buffer.from("BROKEN-SQLITE!!!"), 0, 16, 0);
        } finally {
            closeSync(fd);
        }
        const sqliteBytes = readFileSync(sqlitePath);
        const sqliteFailed = await doctorArtifactStore(sqliteRoot, true, limits);
        assert.equal(sqliteFailed.ok, false);
        assert.equal(sqliteFailed.repaired, false);
        assert.equal(sqliteFailed.integrity, "failed");
        assert.deepEqual(readFileSync(sqlitePath), sqliteBytes, "doctor modified authoritative SQLite corruption");
        if (process.platform !== "win32") {
            assert.equal(statSync(getArtifactDbPath(scratch)).mode & 0o777, 0o600);
        }
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
}

async function runLifecycle(mode) {
    const { schema, store } = await loadCoreModules();
    const required = [
        "deleteArtifact",
        "doctorArtifactStore",
        "pruneArtifacts",
        "readLatestCompaction",
    ];
    const missing = required.filter((name) => typeof store[name] !== "function");
    if (missing.length > 0) {
        const error = new Error(`Missing artifact lifecycle exports: ${missing.join(", ")}`);
        error.code = "ERR_ARTIFACT_LIFECYCLE_MISSING";
        throw error;
    }
    await testLimitContract(schema);
    await testRedactionAndBounds(schema, store);
    if (mode !== "--schema-redaction-only") await testLifecycleStore(schema, store);
}

async function runCore(mode) {
    const { schema, store } = await loadCoreModules();
    if (mode !== "--service-only") testSchemaContract(schema);
    if (mode !== "--schema-redaction-only") await testCoreService(schema, store);
}

async function main() {
    const [mode, ...extra] = process.argv.slice(2);
    assert.equal(extra.length, 0, "smoke-artifact-store accepts at most one mode");
    if (mode === "--baseline") {
        runBaseline();
        console.log("PASS: artifact store pre-feature baseline");
        return;
    }
    if (mode === "--expect-red-core") {
        runBaseline();
        try {
            await runCore();
        } catch (error) {
            if (isMissingCoreModule(error)) {
                console.log(CORE_RED_MARKER);
                process.exitCode = EXPECTED_RED_EXIT;
                return;
            }
            throw error;
        }
        throw new Error("Artifact store core unexpectedly exists; run the GREEN contract instead.");
    }
    if (mode === "--expect-red-lifecycle") {
        runBaseline();
        try {
            await runLifecycle();
        } catch (error) {
            if (isMissingCoreModule(error) || error?.code === "ERR_ARTIFACT_LIFECYCLE_MISSING") {
                console.log(LIFECYCLE_RED_MARKER);
                process.exitCode = EXPECTED_RED_EXIT;
                return;
            }
            throw error;
        }
        throw new Error("Artifact lifecycle unexpectedly exists; run the GREEN contract instead.");
    }
    if (mode === "--doctor-gap-only") {
        await runDoctorGap();
        console.log("PASS: artifact doctor derived-state, sequence, retention and corruption contract");
        return;
    }
    if (mode === "--expect-red-doctor-gap") {
        await runCore();
        await runLifecycle();
        try {
            await runDoctorGap();
        } catch (error) {
            if (error?.code === "ERR_ARTIFACT_DOCTOR_STATE_GAP") {
                console.log(DOCTOR_GAP_RED_MARKER);
                process.exitCode = EXPECTED_RED_EXIT;
                return;
            }
            throw error;
        }
        throw new Error("Artifact doctor gap unexpectedly closed; run the GREEN contract instead.");
    }
    if (mode && !["--schema-redaction-only", "--service-only"].includes(mode)) {
        throw new Error(`Unknown smoke-artifact-store mode: ${mode}`);
    }
    await runCore(mode);
    await runLifecycle(mode);
    if (mode === undefined) await runDoctorGap();
    console.log("PASS: artifact schema, privacy and lifecycle store contract");
}

await main();
