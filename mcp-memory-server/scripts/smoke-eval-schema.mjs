import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RED_MARKER = "PHASE19_RED:EVAL_SCHEMA_MISSING";
const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");
const projectRoot = resolve(serverRoot, "..");
const schemaModulePath = join(serverRoot, "dist", "eval-schema.js");
const planModulePath = join(serverRoot, "dist", "eval-plan.js");
const packagePath = join(serverRoot, "package.json");
const MODES = new Set([undefined, "--baseline", "--expected-red", "--schema-only", "--plan-only"]);
const [mode, ...extra] = process.argv.slice(2);

assert.equal(extra.length, 0, "smoke-eval-schema accepts at most one mode");
assert.equal(MODES.has(mode), true, `unknown smoke-eval-schema mode: ${String(mode)}`);

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const COMMIT = "1".repeat(40);
const ZERO_DIGEST = "0".repeat(64);
const CAPABILITY_IDS = [
    "memory.write",
    "memory.search",
    "notes.distill",
    "wiki",
    "graph",
    "security.audit",
    "route.check",
    "context.explore",
];

const taskSet = {
    schema_version: 1,
    id: "fixture-task-set-v1",
    source: { kind: "git", repository: ".", revision: COMMIT },
    tasks: [
        {
            id: "task-alpha",
            input: "Apply the committed fixture change.",
            workspace: { path: "." },
            prepare: { program: process.execPath, args: ["-e", "process.exit(0)"] },
            verify: { program: process.execPath, args: ["-e", "process.exit(0)"] },
            limits: { elapsed_ms: 30_000, stdout_bytes: 65_536 },
        },
        {
            id: "task-beta",
            input: "Preserve the fixture invariant.",
            workspace: { path: "." },
            prepare: { program: process.execPath, args: ["-e", "process.exit(0)"] },
            verify: { program: process.execPath, args: ["-e", "process.exit(1)"] },
            limits: { elapsed_ms: 30_000, stdout_bytes: 65_536 },
        },
    ],
};

const adapterConfig = {
    schema_version: 1,
    id: "offline-fixture-adapter",
    command: { program: process.execPath, args: ["fixture-adapter.mjs"] },
    turn_semantics: { id: "fixture-turn-v1", description: "One completed adapter cycle." },
};

const adapterRequest = {
    schema_version: 1,
    experiment_id: "experiment-fixture",
    task_id: "task-alpha",
    arm: "baseline",
    repetition: 0,
    pass: "run1",
    workspace_path: "source",
    notes_path: null,
    input: taskSet.tasks[0].input,
    limits: taskSet.tasks[0].limits,
    seed: "seed-0",
    expected_capability_digest: ZERO_DIGEST,
    output_path: "output",
};

const adapterResult = {
    schema_version: 1,
    status: "completed",
    turns: { value: 4, semantics: "fixture-turn-v1" },
    usage: { input_tokens: 10, output_tokens: 3, total_tokens: 13 },
    cost: { amount: 0, currency: "USD" },
    harness: { id: "fixture-harness", version: "1" },
    adapter: { id: "offline-fixture-adapter", version: "1" },
    model: { id: "fixture-model", config_id: "fixture-config" },
    observed_capability_digest: ZERO_DIGEST,
    trajectory_ref: "trajectory/task-alpha/run1",
    artifact_refs: ["artifact/task-alpha/run1"],
};

const capabilityState = CAPABILITY_IDS.map((id) => ({ id, enabled: true }));
const observation = {
    schema_version: 1,
    observation_id: "baseline-r0-run1-task-alpha",
    task_id: "task-alpha",
    schedule_index: 0,
    arm: "baseline",
    disabled_capability: null,
    arm_order: 0,
    repetition: 0,
    pass: "run1",
    seed: "seed-0",
    state: "terminal",
    terminal_state: "completed",
    process: { exit_code: 0, signal: null, error_code: null, cleanup: "closed" },
    verifier: { state: "completed", reason: null },
    pass_state: "passed",
    expected_capabilities: capabilityState,
    observed_capabilities: capabilityState,
    expected_capability_digest: ZERO_DIGEST,
    observed_capability_digest: ZERO_DIGEST,
    capability_status: "valid",
    capability_digest_match: true,
    four_cell_id: "baseline-run1",
    notes: {
        distiller_id: null,
        distiller_config_digest: null,
        trajectory_ref: adapterResult.trajectory_ref,
        distillation_outcome: "not_applicable",
        eligibility_reason: "run1",
        note_snapshot_digest: null,
        note_snapshot_manifest: [],
        notes_exposed: false,
    },
    result: adapterResult,
    missing_reasons: [],
};

const aggregate = {
    comparison_id: "memory-run2-minus-run1",
    metric_id: "total_tokens",
    direction: "run2-minus-run1",
    semantics: null,
    currency: null,
    estimate: -2,
    within_arm: { baseline: -2, treatment: null },
    endpoint_delta: null,
    difference_in_differences: null,
    uncertainty: {
        algorithm: "paired-bootstrap",
        version: 1,
        seed: "seed-0",
        stream: "memory-run2-minus-run1/total_tokens",
        iterations: 10_000,
        confidence: 0.95,
        quantile: "percentile-nearest-rank-v1",
        interval: { low: -4, high: 1 },
        null_reason: null,
    },
    warnings: ["small_sample"],
    valid_task_ids: ["task-alpha", "task-beta"],
    valid_pair_count: 2,
    population: { full: 2, executed: 2, eligible: 2, paired: 2, note_eligible: 1 },
    missing: { count: 0, reasons: [] },
};

const report = {
    schema_version: 1,
    experiment_id: "experiment-fixture",
    status: "partial",
    experiment_kind: "two_pass",
    task_set_digest: digest(taskSet),
    adapter_config_digest: digest(adapterConfig),
    source_revision: COMMIT,
    schedule_digest: ZERO_DIGEST,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:01.000Z",
    runtime: { platform: "linux", arch: "x64", node: "22.0.0", cairnkeep: "0.0.0" },
    schedule: [{ observation_id: observation.observation_id, task_id: observation.task_id, arm: "baseline", repetition: 0, pass: "run1", seed: "seed-0" }],
    observations: [observation],
    aggregates: [aggregate],
    missingness: { digest: ZERO_DIGEST, count: 0, reasons: [] },
    warnings: ["small_sample"],
    evidence: {
        schema_version: 1,
        evidence_scope: "offline-framework",
        source_commit: COMMIT,
        package_version: "0.0.0",
        runtime_id: "node-22-linux-x64",
        task_set_digest: digest(taskSet),
        report_digest: ZERO_DIGEST,
        schema_digests: [ZERO_DIGEST],
        note_snapshot_digests: [],
        missingness_digest: ZERO_DIGEST,
        claim_anchors: [],
    },
};

function baselineChecks() {
    assert.deepEqual(taskSet.tasks.map(({ id }) => id), ["task-alpha", "task-beta"], "manifest order drifted");
    assert.equal(new Set(taskSet.tasks.map(({ id }) => id)).size, taskSet.tasks.length);
    assert.deepEqual(CAPABILITY_IDS.length, 8);
    assert.deepEqual(observation.expected_capabilities, observation.observed_capabilities);
    assert.equal(observation.result.pass, undefined, "adapter fixture owns pass state");
    assert.equal(observation.result.verifier_failed, undefined, "adapter fixture owns verifier outcome");
    assert.equal(report.aggregates[0].population.full, taskSet.tasks.length);
    assert.equal(report.aggregates[0].valid_pair_count, report.aggregates[0].valid_task_ids.length);
    assert.equal(report.evidence.evidence_scope, "offline-framework");

    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    assert.equal(packageJson.scripts["test:smoke"].includes("smoke-eval-schema"), false,
        "Wave 0 schema RED contract entered the default suite");
    assert.equal(packageJson.scripts["test:smoke"].includes("smoke-eval-process"), false,
        "Wave 0 process RED contract entered the default suite");
}

async function load(path) {
    return import(`${pathToFileURL(path).href}?phase19=${Date.now()}`);
}

function assertStrict(schema, value, forbiddenKey = "unexpected_phase19_field") {
    assert.deepEqual(schema.parse(value), value);
    assert.equal(schema.safeParse({ ...value, [forbiddenKey]: true }).success, false);
}

async function schemaChecks() {
    const schema = await load(schemaModulePath);
    assert.equal(schema.EVAL_SCHEMA_VERSION, 1);
    assert.deepEqual([...schema.EVAL_ADAPTER_RESULT_STATUSES], ["completed", "adapter_error"]);
    assert.deepEqual([...schema.EVAL_OBSERVATION_TERMINAL_STATES], [
        "completed", "verifier_failed", "timeout", "cancelled", "adapter_error", "invalid_result",
    ]);
    assert.deepEqual([...schema.EVAL_PASS_STATES], ["passed", "failed", "unknown"]);

    assertStrict(schema.evalCommandSchema, taskSet.tasks[0].prepare);
    assertStrict(schema.evalTaskSetSchema, taskSet);
    assertStrict(schema.evalAdapterConfigSchema, adapterConfig);
    assertStrict(schema.evalAdapterRequestSchema, adapterRequest);
    assertStrict(schema.evalAdapterResultSchema, adapterResult);
    assertStrict(schema.evalObservationSchema, observation);
    assertStrict(schema.evalReportSchema, report);

    for (const key of ["pass", "passed", "failed", "pass_state", "verifier_failed", "verifier", "verifier_status", "verifier_reason", "verifier_output"]) {
        assert.equal(schema.evalAdapterResultSchema.safeParse({ ...adapterResult, [key]: key === "pass" ? true : "sentinel" }).success, false,
            `adapter result accepted verifier-owned field ${key}`);
    }
    assert.equal(schema.evalAdapterResultSchema.safeParse({ ...adapterResult, status: "verifier_failed" }).success, false);
    assert.equal(schema.evalAdapterResultSchema.safeParse({ ...adapterResult, usage: { input_tokens: 1, output_tokens: 2 } }).success, true,
        "usage total was inferred/required");
    assert.equal(schema.evalTaskSetSchema.safeParse({ ...taskSet, tasks: [...taskSet.tasks, taskSet.tasks[0]] }).success, false,
        "duplicate task IDs were accepted");
    assert.equal(schema.evalTaskSetSchema.safeParse({ ...taskSet, source: { ...taskSet.source, revision: "HEAD" } }).success, false,
        "mutable revision was accepted");
    assert.equal(schema.evalCommandSchema.safeParse("node fixture.mjs").success, false, "command string was accepted");
    assert.equal(schema.evalTaskSetSchema.safeParse({ ...taskSet, tasks: [{ ...taskSet.tasks[0], workspace: { path: "../escape" } }] }).success, false,
        "path traversal was accepted");

    const root = mkdtempSync(join(tmpdir(), "cairn-eval-schema-symlink-"));
    try {
        writeFileSync(join(root, "target"), "fixture");
        symlinkSync(join(root, "target"), join(root, "link"));
        assert.equal(lstatSync(join(root, "link")).isSymbolicLink(), true, "symlink adversary was not created");
    } finally {
        rmSync(root, { recursive: true, force: true });
    }

    for (const relative of [
        "eval-task-set.schema.json",
        "eval-adapter.schema.json",
        "eval-protocol.schema.json",
        "eval-report.schema.json",
    ]) {
        const path = join(projectRoot, "schemas", relative);
        assert.equal(existsSync(path), true, `missing published schema ${relative}`);
        const published = JSON.parse(readFileSync(path, "utf8"));
        assert.equal(published.$schema, "https://json-schema.org/draft/2020-12/schema");
        assert.equal(JSON.stringify(published).includes('"additionalProperties":false'), true,
            `${relative} does not pin strict object boundaries`);
    }
}

async function planChecks() {
    const plan = await load(planModulePath);
    for (const name of ["isEvalEnabled", "loadEvalPlan", "validateEvalInputs", "buildEvalSchedule"]) {
        assert.equal(typeof plan[name], "function", `missing eval-plan export ${name}`);
    }
    assert.equal(plan.isEvalEnabled(undefined), false);
    assert.equal(plan.isEvalEnabled("false"), false);
    assert.equal(plan.isEvalEnabled("1"), true);

    const schedule = plan.buildEvalSchedule({
        taskSet,
        arms: [{ id: "baseline", disabled_capability: null }],
        repetitions: 2,
        passes: ["run1", "run2"],
        seed: "seed",
    });
    const rows = schedule.rows ?? schedule;
    assert.deepEqual(rows.map(({ arm, repetition, pass, task_id }) => `${arm}:${repetition}:${pass}:${task_id}`), [
        "baseline:0:run1:task-alpha", "baseline:0:run1:task-beta",
        "baseline:0:run2:task-alpha", "baseline:0:run2:task-beta",
        "baseline:1:run1:task-alpha", "baseline:1:run1:task-beta",
        "baseline:1:run2:task-alpha", "baseline:1:run2:task-beta",
    ]);
    assert.equal(rows.every((row) => typeof row.seed === "string" && row.seed.length > 0), true);
}

function onlyMissing(error, expected) {
    return error?.code === "ERR_MODULE_NOT_FOUND" && String(error.message ?? "").includes(expected);
}

baselineChecks();
if (mode === "--baseline") {
    console.log("PASS: Phase 19 schema baseline contract");
} else if (mode === "--expected-red") {
    try {
        await load(schemaModulePath);
    } catch (error) {
        if (onlyMissing(error, "/dist/eval-schema.js")) {
            console.log(RED_MARKER);
            process.exit(0);
        }
        throw error;
    }
    throw new Error("Expected only the Phase 19 eval-schema module to be absent.");
} else if (mode === "--schema-only") {
    await schemaChecks();
    console.log("PASS: Phase 19 runtime/published schema parity contract");
} else if (mode === "--plan-only") {
    await schemaChecks();
    await planChecks();
    console.log("PASS: Phase 19 immutable plan and deterministic schedule contract");
} else {
    await schemaChecks();
    await planChecks();
    console.log("PASS: Phase 19 schema, plan, and disabled-path contract");
}
