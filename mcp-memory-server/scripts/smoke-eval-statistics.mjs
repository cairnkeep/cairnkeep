import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RED_MARKER = "PHASE19_RED:EVAL_STATISTICS_MISSING";
const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, "..");
const statisticsModulePath = join(serverRoot, "dist", "eval-statistics.js");
const packagePath = join(serverRoot, "package.json");
const MODES = new Set([undefined, "--baseline", "--expected-red"]);
const [mode, ...extra] = process.argv.slice(2);

assert.equal(extra.length, 0, "smoke-eval-statistics accepts at most one mode");
assert.equal(MODES.has(mode), true, `unknown smoke-eval-statistics mode: ${String(mode)}`);

const repetitionRows = [
    { task_id: "task-a", repetition: 0, seed: "a-0", reference: 10, comparison: 8 },
    { task_id: "task-a", repetition: 1, seed: "a-1", reference: 12, comparison: 10 },
    { task_id: "task-b", repetition: 0, seed: "b-0", reference: 20, comparison: 24 },
    { task_id: "task-c", repetition: 0, seed: "c-0", reference: 5, comparison: null, missing_reason: "total_tokens_missing" },
    { task_id: "task-d", repetition: 0, seed: "d-0", reference: 8, comparison: 8 },
];

const passRows = [
    { task_id: "task-a", repetition: 0, seed: "a-0", reference: 1, comparison: 1 },
    { task_id: "task-b", repetition: 0, seed: "b-0", reference: 0, comparison: 1 },
    { task_id: "task-c", repetition: 0, seed: "c-0", reference: null, comparison: 1, missing_reason: "verifier_unknown" },
    { task_id: "task-d", repetition: 0, seed: "d-0", reference: 1, comparison: 0 },
];

const ablationRows = [
    { task_id: "task-a", baseline_run1: 10, baseline_run2: 8, treatment_run1: 11, treatment_run2: 10 },
    { task_id: "task-b", baseline_run1: 20, baseline_run2: 24, treatment_run1: 20, treatment_run2: 22 },
    { task_id: "task-c", baseline_run1: 5, baseline_run2: null, treatment_run1: 5, treatment_run2: 4, missing_reason: "baseline_run2_missing" },
];

const GOLDEN = {
    stream_prefix: {
        total_tokens: [2, 1, 1, 2, 0, 2, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 2, 1, 1, 0, 0, 0, 1, 1],
        pass_rate: [1, 1, 0, 0, 2, 0, 1, 0, 1, 2, 2, 0, 0, 1, 1, 2, 0, 0, 2, 2, 1, 1, 2, 2],
    },
    total_tokens: {
        estimate: 2 / 3,
        interval: { low: -2, high: 8 / 3 },
        valid_task_ids: ["task-a", "task-b", "task-d"],
        valid_pair_count: 3,
        missing: { count: 1, reasons: [{ reason: "total_tokens_missing", count: 1 }] },
    },
    pass_rate: {
        estimate: 0,
        interval: { low: -2 / 3, high: 2 / 3 },
        valid_task_ids: ["task-a", "task-b", "task-d"],
        valid_pair_count: 3,
        missing: { count: 1, reasons: [{ reason: "verifier_unknown", count: 1 }] },
    },
    difference_in_differences: {
        estimate: -0.5,
        interval: { low: -2, high: 1 },
        valid_task_ids: ["task-a", "task-b"],
        valid_pair_count: 2,
        missing: { count: 1, reasons: [{ reason: "baseline_run2_missing", count: 1 }] },
    },
};

function streamIndices(seed, comparisonId, metricId, population, draws) {
    const indices = [];
    let counter = 0;
    while (indices.length < draws) {
        const bytes = createHash("sha256")
            .update(`${seed}\0${comparisonId}\0${metricId}\0${counter}`)
            .digest();
        counter += 1;
        for (let offset = 0; offset + 3 < bytes.length && indices.length < draws; offset += 4) {
            indices.push(bytes.readUInt32BE(offset) % population);
        }
    }
    return indices;
}

function referenceInterval(differences, options) {
    if (differences.length < 2) return { interval: null, null_reason: "fewer_than_two_pairs" };
    const indices = streamIndices(
        options.seed,
        options.comparison_id,
        options.metric_id,
        differences.length,
        differences.length * options.iterations,
    );
    const means = [];
    let cursor = 0;
    for (let iteration = 0; iteration < options.iterations; iteration += 1) {
        let sum = 0;
        for (let draw = 0; draw < differences.length; draw += 1) {
            sum += differences[indices[cursor]];
            cursor += 1;
        }
        means.push(sum / differences.length);
    }
    means.sort((left, right) => left - right);
    return {
        interval: {
            low: means[Math.floor((means.length - 1) * ((1 - options.confidence) / 2))],
            high: means[Math.ceil((means.length - 1) * (1 - ((1 - options.confidence) / 2)))],
        },
        null_reason: null,
    };
}

function baselineChecks() {
    assert.deepEqual(
        streamIndices("seed-19", "memory", "total_tokens", 3, 24),
        GOLDEN.stream_prefix.total_tokens,
        "total-token PRNG stream drifted",
    );
    assert.deepEqual(
        streamIndices("seed-19", "memory", "pass_rate", 3, 24),
        GOLDEN.stream_prefix.pass_rate,
        "metric-specific stream was not independent",
    );
    assert.notDeepEqual(GOLDEN.stream_prefix.total_tokens, GOLDEN.stream_prefix.pass_rate);
    assert.deepEqual(
        referenceInterval([-2, 4, 0], {
            seed: "seed-19", comparison_id: "memory", metric_id: "total_tokens", iterations: 32, confidence: 0.95,
        }).interval,
        GOLDEN.total_tokens.interval,
    );
    assert.deepEqual(
        referenceInterval([0, 1, -1], {
            seed: "seed-19", comparison_id: "memory", metric_id: "pass_rate", iterations: 32, confidence: 0.95,
        }).interval,
        GOLDEN.pass_rate.interval,
    );
    assert.deepEqual(
        referenceInterval([1, -2], {
            seed: "seed-19", comparison_id: "ablation", metric_id: "total_tokens", iterations: 32, confidence: 0.95,
        }).interval,
        GOLDEN.difference_in_differences.interval,
    );
    assert.deepEqual(referenceInterval([1], {
        seed: "seed-19", comparison_id: "degenerate", metric_id: "turns", iterations: 32, confidence: 0.95,
    }), { interval: null, null_reason: "fewer_than_two_pairs" });

    const taskWeights = new Map();
    for (const row of repetitionRows) taskWeights.set(row.task_id, 1);
    assert.deepEqual([...taskWeights], [["task-a", 1], ["task-b", 1], ["task-c", 1], ["task-d", 1]],
        "repetition rows changed task bootstrap weight");

    const paperCalibration = { turns: [64, 61], tokens: [104_000, 93_000], pass_rate: [0.530, 0.544], selected_tasks: 151 };
    assert.equal(JSON.stringify(GOLDEN).includes(JSON.stringify(paperCalibration)), false,
        "paper-only calibration became an expected Cairnkeep result");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    assert.equal(packageJson.scripts["test:smoke"].includes("smoke-eval-statistics"), false,
        "Wave 0 statistics RED contract entered the default suite");
}

function projection(value) {
    return {
        estimate: value.estimate,
        interval: value.interval,
        valid_task_ids: value.valid_task_ids,
        valid_pair_count: value.valid_pair_count,
        missing: value.missing,
    };
}

async function greenChecks() {
    const statistics = await import(`${pathToFileURL(statisticsModulePath).href}?phase19=${Date.now()}`);
    for (const name of [
        "createEvalPrng",
        "summarizeTaskRepetitions",
        "bootstrapPairedInterval",
        "computePairedEstimate",
        "computeDifferenceInDifferences",
    ]) {
        assert.equal(typeof statistics[name], "function", `missing eval-statistics export ${name}`);
    }

    const summarized = statistics.summarizeTaskRepetitions(repetitionRows);
    assert.deepEqual(summarized.find(({ task_id }) => task_id === "task-a"), {
        task_id: "task-a", reference: 11, comparison: 9, difference: -2, repetitions: 2,
    });
    assert.equal(summarized.filter(({ task_id }) => task_id === "task-a").length, 1,
        "one task received repetition-level bootstrap weight");

    const tokenEstimate = statistics.computePairedEstimate(repetitionRows, {
        seed: "seed-19", comparison_id: "memory", metric_id: "total_tokens", iterations: 32, confidence: 0.95,
    });
    assert.deepEqual(projection(tokenEstimate), GOLDEN.total_tokens);
    assert.equal(tokenEstimate.warnings.includes("small_sample"), true);
    assert.equal(tokenEstimate.algorithm, "paired-bootstrap");
    assert.equal(tokenEstimate.version, 1);
    assert.equal(tokenEstimate.quantile, "percentile-nearest-rank-v1");

    const passEstimate = statistics.computePairedEstimate(passRows, {
        seed: "seed-19", comparison_id: "memory", metric_id: "pass_rate", iterations: 32, confidence: 0.95,
    });
    assert.deepEqual(projection(passEstimate), GOLDEN.pass_rate);
    assert.notEqual(tokenEstimate.stream, passEstimate.stream, "adding/missing a metric shifted another metric stream");

    const did = statistics.computeDifferenceInDifferences(ablationRows, {
        seed: "seed-19", comparison_id: "ablation", metric_id: "total_tokens", iterations: 32, confidence: 0.95,
    });
    assert.deepEqual(projection(did), GOLDEN.difference_in_differences);
    assert.equal(did.warnings.includes("small_sample"), true);

    const degenerate = statistics.bootstrapPairedInterval([1], {
        seed: "seed-19", comparison_id: "degenerate", metric_id: "turns", iterations: 32, confidence: 0.95,
    });
    assert.equal(degenerate.interval, null);
    assert.equal(degenerate.null_reason, "fewer_than_two_pairs");
    assert.equal(degenerate.warnings.includes("small_sample"), true);

    const crossingZero = statistics.bootstrapPairedInterval([-2, 4, 0], {
        seed: "seed-19", comparison_id: "memory", metric_id: "total_tokens", iterations: 32, confidence: 0.95,
    });
    assert.equal(crossingZero.interval.low <= 0 && crossingZero.interval.high >= 0, true);
    assert.equal(crossingZero.wording ?? "inconclusive", "inconclusive");
}

function onlyMissing(error) {
    return error?.code === "ERR_MODULE_NOT_FOUND" && String(error.message ?? "").includes("/dist/eval-statistics.js");
}

baselineChecks();
if (mode === "--baseline") {
    console.log("PASS: Phase 19 deterministic statistics baseline vectors");
} else if (mode === "--expected-red") {
    try {
        await import(pathToFileURL(statisticsModulePath).href);
    } catch (error) {
        if (onlyMissing(error)) {
            console.log(RED_MARKER);
            process.exit(0);
        }
        throw error;
    }
    throw new Error("Expected only the Phase 19 eval-statistics module to be absent.");
} else {
    await greenChecks();
    console.log("PASS: Phase 19 clustered paired statistics and missingness contract");
}
