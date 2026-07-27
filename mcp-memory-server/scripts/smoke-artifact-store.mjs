import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
    existsSync,
    mkdtempSync,
    readFileSync,
    rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const EXPECTED_RED_EXIT = 86;
const CORE_RED_MARKER = "PHASE17_RED:ARTIFACT_STORE_MISSING";
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
        getArtifactDbPath,
        listArtifacts,
        putArtifact,
        readArtifact,
    } = storeModule;
    assert.equal(ARTIFACT_DEFAULT_MAX_BYTES, 1024 * 1024);
    assert.equal(ARTIFACT_DEFAULT_SESSION_MAX_BYTES, 16 * 1024 * 1024);
    assert.equal(ARTIFACT_DEFAULT_STORE_MAX_BYTES, 256 * 1024 * 1024);
    assert.equal(ARTIFACT_DEFAULT_RETENTION_DAYS, 30);
    for (const fn of [getArtifactLimits, getArtifactDbPath, listArtifacts, putArtifact, readArtifact]) {
        assert.equal(typeof fn, "function");
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
    if (mode && !["--schema-redaction-only", "--service-only"].includes(mode)) {
        throw new Error(`Unknown smoke-artifact-store mode: ${mode}`);
    }
    await runCore(mode);
    console.log("PASS: artifact schema and immutable core store contract");
}

await main();
