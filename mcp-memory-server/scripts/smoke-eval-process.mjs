import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RED_MARKER = "PHASE19_RED:EVAL_PROCESS_MISSING";
const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");
const processModulePath = join(serverRoot, "dist", "eval-process.js");
const reportModulePath = join(serverRoot, "dist", "eval-report.js");
const MODES = new Set([undefined, "--baseline", "--expected-red", "--checkpoint-only"]);
const [mode, ...extra] = process.argv.slice(2);

assert.equal(extra.length, 0, "smoke-eval-process accepts at most one mode");
assert.equal(MODES.has(mode), true, `unknown smoke-eval-process mode: ${String(mode)}`);

function baselineChecks() {
    let settled = false;
    const terminals = [];
    const settle = (value) => {
        if (settled) return false;
        settled = true;
        terminals.push(value);
        return true;
    };
    assert.equal(settle("close"), true);
    assert.equal(settle("late-error"), false, "double settlement was not detected");
    assert.deepEqual(terminals, ["close"]);

    const descendants = new Set(["fixture-descendant"]);
    const assertClosed = () => assert.deepEqual([...descendants], [], "unclosed descendant detected");
    assert.throws(assertClosed, /unclosed descendant detected/);
    descendants.delete("fixture-descendant");
    assertClosed();
}

async function load(path) {
    return import(`${pathToFileURL(path).href}?phase19=${Date.now()}`);
}

function command(program, args) {
    return { program, args };
}

async function processChecks() {
    const processApi = await load(processModulePath);
    assert.equal(typeof processApi.runBoundedCommand, "function");
    assert.equal(typeof processApi.runBoundedJsonAdapter, "function");

    const raw = await processApi.runBoundedCommand({
        command: command(process.execPath, ["-e", "process.stdout.write('raw-bytes')"]),
        stdout_mode: "raw",
        timeout_ms: 2_000,
        max_stdout_bytes: 1_024,
    });
    assert.deepEqual({ exit_code: raw.exit_code, signal: raw.signal, stdout: raw.stdout },
        { exit_code: 0, signal: null, stdout: "raw-bytes" });

    const exitOnly = await processApi.runBoundedCommand({
        command: command(process.execPath, ["-e", "process.stdout.write('discard-me');process.exit(7)"]),
        stdout_mode: "exit-only",
        timeout_ms: 2_000,
        max_stdout_bytes: 1_024,
    });
    assert.equal(exitOnly.exit_code, 7);
    assert.equal(exitOnly.stdout, undefined, "exit-only mode retained stdout");

    const request = {
        schema_version: 1,
        experiment_id: "fixture",
        task_id: "task-alpha",
        arm: "baseline",
        repetition: 0,
        pass: "run1",
        workspace_path: "source",
        notes_path: null,
        input: "fixture",
        limits: { elapsed_ms: 2_000, stdout_bytes: 1_024 },
        seed: "seed",
        expected_capability_digest: "0".repeat(64),
        output_path: "output",
    };
    const resultDocument = {
        schema_version: 1,
        status: "completed",
        harness: { id: "fixture", version: "1" },
        adapter: { id: "fixture", version: "1" },
        model: { id: "fixture", config_id: "fixture" },
        observed_capability_digest: "0".repeat(64),
        artifact_refs: [],
    };
    const json = await processApi.runBoundedJsonAdapter({
        command: command(process.execPath, ["-e", "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify(" + JSON.stringify(resultDocument) + ")))"]),
        request,
        timeout_ms: 2_000,
        max_stdout_bytes: 4_096,
    });
    assert.deepEqual(json.result ?? json, resultDocument);

    const faultCases = [
        ["stdout_overflow", ["-e", "process.stdout.write('x'.repeat(8192))"], { max_stdout_bytes: 32 }],
        ["invalid_utf8", ["-e", "process.stdout.write(Buffer.from([0xc3,0x28]))"], {}],
        ["multiple_json", ["-e", "process.stdout.write('{}\\n{}')"], {}],
        ["invalid_json", ["-e", "process.stdout.write('{')"], {}],
    ];
    for (const [expectedCode, args, overrides] of faultCases) {
        await assert.rejects(
            processApi.runBoundedJsonAdapter({
                command: command(process.execPath, args), request, timeout_ms: 2_000, max_stdout_bytes: 4_096, ...overrides,
            }),
            (error) => error?.code === expectedCode,
            `${expectedCode} was not classified exactly`,
        );
    }

    await assert.rejects(
        processApi.runBoundedCommand({ command: command(join(tmpdir(), "phase19-missing-executable"), []), stdout_mode: "raw", timeout_ms: 1_000, max_stdout_bytes: 32 }),
        (error) => error?.code === "spawn_error",
    );
    await assert.rejects(
        processApi.runBoundedCommand({ command: command(process.execPath, ["-e", "setInterval(()=>{},1000)"]), stdout_mode: "exit-only", timeout_ms: 50, kill_grace_ms: 50, max_stdout_bytes: 0 }),
        (error) => error?.code === "timeout" && error?.cleanup !== "open",
    );

    const controller = new AbortController();
    const cancelled = processApi.runBoundedCommand({
        command: command(process.execPath, ["-e", "setInterval(()=>{},1000)"]),
        stdout_mode: "exit-only",
        timeout_ms: 2_000,
        kill_grace_ms: 50,
        max_stdout_bytes: 0,
        signal: controller.signal,
    });
    controller.abort();
    await assert.rejects(cancelled, (error) => error?.code === "cancelled" && error?.cleanup !== "open");

    const inherited = spawn(process.execPath, ["-e", "process.stderr.write('phase19-operator-diagnostic')"], { stdio: ["ignore", "ignore", "ignore"] });
    await new Promise((resolveClose, rejectClose) => {
        inherited.once("error", rejectClose);
        inherited.once("close", resolveClose);
    });
}

async function checkpointChecks() {
    const reportApi = await load(reportModulePath);
    for (const name of ["createEvalReportStore", "checkpointEvalReport", "readEvalReport", "diagnoseEvalReport"]) {
        assert.equal(typeof reportApi[name], "function", `missing eval-report export ${name}`);
    }
    const root = mkdtempSync(join(tmpdir(), "cairn-eval-report-"));
    try {
        const store = await reportApi.createEvalReportStore({ root, experiment_id: "fixture-experiment" });
        const report = {
            schema_version: 1,
            experiment_id: "fixture-experiment",
            status: "partial",
            experiment_kind: "two_pass",
            task_set_digest: "0".repeat(64),
            adapter_config_digest: "1".repeat(64),
            source_revision: "2".repeat(40),
            schedule_digest: "3".repeat(64),
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:01.000Z",
            runtime: { platform: "linux", arch: "x64", node: "22.0.0", cairnkeep: "0.0.0" },
            schedule: [], observations: [], aggregates: [],
            missingness: { digest: "4".repeat(64), count: 0, reasons: [] },
            warnings: [],
            evidence: {
                schema_version: 1, evidence_scope: "offline-framework", source_commit: "2".repeat(40), package_version: "0.0.0",
                runtime_id: "node-22-linux-x64", task_set_digest: "0".repeat(64), report_digest: "5".repeat(64),
                schema_digests: ["6".repeat(64)], note_snapshot_digests: [], missingness_digest: "4".repeat(64), claim_anchors: [],
            },
        };
        await reportApi.checkpointEvalReport(store, report);
        assert.deepEqual(await reportApi.readEvalReport(store), report);
        const reportPath = store.report_path ?? join(root, "fixture-experiment", "report.json");
        assert.equal(existsSync(reportPath), true);
        assert.equal(statSync(reportPath).mode & 0o777, 0o600);
        const bytes = readFileSync(reportPath, "utf8");
        for (const sentinel of ["prompt-sentinel", "model-output-sentinel", "adapter-stderr-sentinel", "environment-sentinel"]) {
            assert.equal(bytes.includes(sentinel), false);
        }
        const diagnosis = await reportApi.diagnoseEvalReport(store);
        assert.equal(["ok", "partial"].includes(diagnosis.state ?? diagnosis.status), true);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
}

function onlyMissing(error, expected) {
    return error?.code === "ERR_MODULE_NOT_FOUND" && String(error.message ?? "").includes(expected);
}

baselineChecks();
if (mode === "--baseline") {
    console.log("PASS: Phase 19 process baseline contract");
} else if (mode === "--expected-red") {
    try {
        await load(processModulePath);
    } catch (error) {
        if (onlyMissing(error, "/dist/eval-process.js")) {
            console.log(RED_MARKER);
            process.exit(0);
        }
        throw error;
    }
    throw new Error("Expected only the Phase 19 eval-process module to be absent.");
} else if (mode === "--checkpoint-only") {
    await checkpointChecks();
    console.log("PASS: Phase 19 atomic checkpoint contract");
} else {
    await processChecks();
    await checkpointChecks();
    console.log("PASS: Phase 19 bounded process, cancellation, and checkpoint contract");
}
