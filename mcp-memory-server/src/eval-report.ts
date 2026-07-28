import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import {
    chmod,
    lstat,
    mkdir,
    open,
    readdir,
    realpath,
    rename,
    rm,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
    canonicalDigest,
    canonicalJson,
    evalAggregateSchema,
    evalReportSchema,
    type EvalAggregate,
    type EvalObservation,
    type EvalReport,
} from "./eval-schema.js";
import {
    computeDifferenceInDifferences,
    computePairedEstimate,
    type PairedEstimate,
    type PairedRow,
} from "./eval-statistics.js";

export type EvalReportStore = {
    root_path: string;
    experiment_path: string;
    report_path: string;
    experiment_id: string;
    max_report_bytes: number;
};

export type EvalReportDiagnosis = {
    state: "absent" | "ok" | "partial" | "tampered" | "unsafe";
    code: "report_absent" | "report_ok" | "report_partial" | "report_invalid" | "report_unsafe";
};

export type CreateEvalReportStoreOptions = {
    experiment_id: string;
    root?: string;
    project_root?: string;
    max_report_bytes?: number;
    max_experiments?: number;
};

export type EvalReportCheckpointFault =
    | "after_open"
    | "after_write"
    | "after_sync"
    | "after_close"
    | "after_rename";

export type CheckpointEvalReportOptions = {
    fault?: EvalReportCheckpointFault;
};

export type EvalAggregateSet = EvalAggregate[];

const DEFAULT_MAX_REPORT_BYTES = 16 * 1024 * 1024;
const MAX_ALLOWED_REPORT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_EXPERIMENTS = 10_000;
const EXPERIMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const FORBIDDEN_FIELDS = new Set([
    "prompt",
    "model_output",
    "stdout",
    "stderr",
    "environment",
    "env",
    "error",
    "error_message",
    "request",
]);
const FORBIDDEN_SENTINELS = [
    "prompt-sentinel",
    "model-output-sentinel",
    "adapter-stderr-sentinel",
    "environment-sentinel",
];
const writeQueues = new Map<string, Promise<void>>();

function isContained(root: string, candidate: string): boolean {
    const rel = relative(root, candidate);
    return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

async function ensureSafeDirectory(path: string, privateMode = false): Promise<void> {
    try {
        const info = await lstat(path);
        if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("unsafe_report_directory");
        if (privateMode) await chmod(path, 0o700);
        return;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(path);
    if (parent === path) throw new Error("unsafe_report_directory");
    await ensureSafeDirectory(parent, false);
    await mkdir(path, { mode: 0o700 });
    await chmod(path, 0o700);
}

function assertLimits(maxReportBytes: number, maxExperiments: number): void {
    if (!Number.isSafeInteger(maxReportBytes) || maxReportBytes < 1 || maxReportBytes > MAX_ALLOWED_REPORT_BYTES) {
        throw new Error("invalid_report_limit");
    }
    if (!Number.isSafeInteger(maxExperiments) || maxExperiments < 1 || maxExperiments > DEFAULT_MAX_EXPERIMENTS) {
        throw new Error("invalid_experiment_limit");
    }
}

async function countExperiments(root: string, target: string, limit: number): Promise<void> {
    const entries = await readdir(root, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
        if (entry.name === basename(target)) continue;
        if (entry.isSymbolicLink()) throw new Error("unsafe_report_directory");
        if (entry.isDirectory()) count += 1;
        if (count >= limit) throw new Error("experiment_limit_reached");
    }
}

function assertNoSensitiveFields(value: unknown): void {
    if (typeof value === "string") {
        if (FORBIDDEN_SENTINELS.some((sentinel) => value.includes(sentinel))
            || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)
            || /^Bearer\s+/i.test(value)) {
            throw new Error("sensitive_report_value");
        }
        return;
    }
    if (Array.isArray(value)) {
        value.forEach(assertNoSensitiveFields);
        return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (FORBIDDEN_FIELDS.has(key)) throw new Error("sensitive_report_field");
        assertNoSensitiveFields(child);
    }
}

function validatedReport(value: unknown): EvalReport {
    assertNoSensitiveFields(value);
    const parsed = evalReportSchema.safeParse(value);
    if (!parsed.success) throw new Error("invalid_eval_report");
    return parsed.data;
}

async function readBoundedReport(store: EvalReportStore): Promise<Buffer | undefined> {
    let handle;
    try {
        handle = await open(store.report_path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > store.max_report_bytes) throw new Error("unsafe_eval_report");
        const bytes = await handle.readFile();
        if (bytes.byteLength > store.max_report_bytes) throw new Error("unsafe_eval_report");
        return bytes;
    } finally {
        await handle.close();
    }
}

async function withWriteQueue<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const prior = writeQueues.get(path) ?? Promise.resolve();
    let release = (): void => {};
    const turn = new Promise<void>((resolveTurn) => { release = resolveTurn; });
    const tail = prior.then(() => turn);
    writeQueues.set(path, tail);
    await prior;
    try {
        return await operation();
    } finally {
        release();
        if (writeQueues.get(path) === tail) writeQueues.delete(path);
    }
}

function injectFault(options: CheckpointEvalReportOptions, stage: EvalReportCheckpointFault): void {
    if (options.fault === stage) throw new Error(`injected_${stage}`);
}

async function assertSafeStore(store: EvalReportStore): Promise<void> {
    const root = await realpath(store.root_path);
    const experiment = await realpath(store.experiment_path);
    const info = await lstat(store.experiment_path);
    if (info.isSymbolicLink() || !info.isDirectory()
        || root !== store.root_path
        || experiment !== store.experiment_path
        || !isContained(root, experiment)
        || dirname(store.report_path) !== experiment
        || basename(store.report_path) !== "report.json") {
        throw new Error("unsafe_report_store");
    }
}

export async function createEvalReportStore(options: CreateEvalReportStoreOptions): Promise<EvalReportStore> {
    if (!EXPERIMENT_PATTERN.test(options.experiment_id)) throw new Error("invalid_experiment_id");
    const maxReportBytes = options.max_report_bytes ?? DEFAULT_MAX_REPORT_BYTES;
    const maxExperiments = options.max_experiments ?? DEFAULT_MAX_EXPERIMENTS;
    assertLimits(maxReportBytes, maxExperiments);
    const projectRoot = resolve(options.project_root ?? process.cwd());
    const root = resolve(options.root ?? join(projectRoot, ".agentfs", "eval", "experiments"));
    if (options.root === undefined && !isContained(projectRoot, root)) throw new Error("report_root_escape");
    await ensureSafeDirectory(root, true);
    const realRoot = await realpath(root);
    const experimentPath = resolve(realRoot, options.experiment_id);
    if (!isContained(realRoot, experimentPath) || experimentPath === realRoot) throw new Error("report_path_escape");
    await countExperiments(realRoot, experimentPath, maxExperiments);
    await ensureSafeDirectory(experimentPath, true);
    const realExperiment = await realpath(experimentPath);
    if (!isContained(realRoot, realExperiment)) throw new Error("report_path_escape");
    return {
        root_path: realRoot,
        experiment_path: realExperiment,
        report_path: join(realExperiment, "report.json"),
        experiment_id: options.experiment_id,
        max_report_bytes: maxReportBytes,
    };
}

export async function checkpointEvalReport(
    store: EvalReportStore,
    report: EvalReport,
    options: CheckpointEvalReportOptions = {},
): Promise<void> {
    await withWriteQueue(store.report_path, async () => {
        await assertSafeStore(store);
        refreshEvalReport(report);
        const parsed = validatedReport(report);
        if (parsed.experiment_id !== store.experiment_id) throw new Error("report_experiment_mismatch");
        const bytes = Buffer.from(`${canonicalJson(parsed)}\n`, "utf8");
        if (bytes.byteLength > store.max_report_bytes) throw new Error("report_size_limit");
        const temporary = join(
            store.experiment_path,
            `.report.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
        );
        let handle;
        try {
            handle = await open(temporary, "wx", 0o600);
            injectFault(options, "after_open");
            await handle.writeFile(bytes);
            injectFault(options, "after_write");
            await handle.sync();
            injectFault(options, "after_sync");
            await handle.close();
            handle = undefined;
            injectFault(options, "after_close");
            await rename(temporary, store.report_path);
            await chmod(store.report_path, 0o600);
            injectFault(options, "after_rename");
        } finally {
            if (handle) await handle.close().catch(() => undefined);
            await rm(temporary, { force: true });
        }
    });
}

export async function readEvalReport(store: EvalReportStore): Promise<EvalReport | null> {
    const bytes = await readBoundedReport(store);
    if (!bytes) return null;
    let value: unknown;
    try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
        throw new Error("invalid_eval_report");
    }
    return validatedReport(value);
}

export async function diagnoseEvalReport(store: EvalReportStore): Promise<EvalReportDiagnosis> {
    try {
        const info = await lstat(store.report_path).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
        });
        if (!info) return { state: "absent", code: "report_absent" };
        if (info.isSymbolicLink() || !info.isFile() || (info.mode & 0o077) !== 0) {
            return { state: "unsafe", code: "report_unsafe" };
        }
        const report = await readEvalReport(store);
        if (!report) return { state: "absent", code: "report_absent" };
        return report.status === "partial"
            ? { state: "partial", code: "report_partial" }
            : { state: "ok", code: "report_ok" };
    } catch (error) {
        if (error instanceof Error && error.message === "unsafe_eval_report") {
            return { state: "unsafe", code: "report_unsafe" };
        }
        return { state: "tampered", code: "report_invalid" };
    }
}

type MetricId = "turns" | "total_tokens" | "pass_rate";
type Condition = { arm: "baseline" | "treatment"; pass: "run1" | "run2" };
type ComparisonId = "memory-baseline" | "memory-treatment" | "endpoint-treatment-minus-baseline";
type Comparison = {
    id: ComparisonId;
    direction: string;
    reference: Condition;
    comparison: Condition;
    kind: "within" | "endpoint";
};

function observationKey(observation: EvalObservation): string {
    return `${observation.task_id}\0${observation.repetition}\0${observation.arm}\0${observation.pass}`;
}

function conditionKey(taskId: string, repetition: number, condition: Condition): string {
    return `${taskId}\0${repetition}\0${condition.arm}\0${condition.pass}`;
}

function metricValue(observation: EvalObservation | undefined, metric: MetricId): number | null {
    if (!observation || observation.state !== "terminal" || observation.capability_status !== "valid") return null;
    if (metric === "turns") return observation.result?.turns?.value ?? null;
    if (metric === "total_tokens") return observation.result?.usage?.total_tokens ?? null;
    if (observation.pass_state === "passed") return 1;
    if (observation.pass_state === "failed") return 0;
    return null;
}

function missingReason(observation: EvalObservation | undefined, metric: MetricId): string {
    if (!observation) return "observation_missing";
    if (observation.state !== "terminal") return "observation_pending";
    if (observation.capability_status !== "valid") return `capability_${observation.capability_status}`;
    if (metric === "turns") return observation.result?.turns ? "turn_semantics_mismatch" : "turns_missing";
    if (metric === "total_tokens") return "total_tokens_missing";
    return observation.verifier.reason ?? observation.missing_reasons.find((reason) => reason.includes("verifier")) ?? "verifier_unknown";
}

function relevantTaskIds(report: EvalReport): string[] {
    return [...new Set(report.schedule.map(({ task_id }) => task_id))];
}

function relevantRepetitions(report: EvalReport, taskId: string): number[] {
    return [...new Set(report.schedule.filter(({ task_id }) => task_id).map(({ repetition }) => repetition))];
}

function pairRows(
    report: EvalReport,
    observations: Map<string, EvalObservation>,
    metric: MetricId,
    reference: Condition,
    comparison: Condition,
): PairedRow[] {
    const rows: PairedRow[] = [];
    let turnSemantics: string | undefined;
    for (const taskId of relevantTaskIds(report)) {
        for (const repetition of relevantRepetitions(report, taskId)) {
            const left = observations.get(conditionKey(taskId, repetition, reference));
            const right = observations.get(conditionKey(taskId, repetition, comparison));
            let referenceValue = metricValue(left, metric);
            let comparisonValue = metricValue(right, metric);
            let reason: string | undefined;
            if (metric === "turns" && referenceValue !== null && comparisonValue !== null
                && left?.result?.turns?.semantics !== right?.result?.turns?.semantics) {
                referenceValue = null;
                comparisonValue = null;
                reason = "turn_semantics_mismatch";
            }
            if (metric === "turns" && referenceValue !== null && comparisonValue !== null) {
                const semantics = left?.result?.turns?.semantics;
                turnSemantics ??= semantics;
                if (semantics !== turnSemantics) {
                    referenceValue = null;
                    comparisonValue = null;
                    reason = "turn_semantics_mismatch";
                }
            }
            if (referenceValue !== null && comparisonValue !== null && left?.seed !== right?.seed) {
                referenceValue = null;
                comparisonValue = null;
                reason = "seed_mismatch";
            }
            if (referenceValue === null || comparisonValue === null) {
                reason ??= referenceValue === null ? missingReason(left, metric) : missingReason(right, metric);
            }
            rows.push({
                task_id: taskId,
                repetition,
                seed: left?.seed ?? right?.seed,
                reference: referenceValue,
                comparison: comparisonValue,
                missing_reason: reason,
            });
        }
    }
    return rows;
}

function comparisonPopulation(
    report: EvalReport,
    observations: Map<string, EvalObservation>,
    reference: Condition,
    comparison: Condition,
    paired: number,
): EvalAggregate["population"] {
    const taskIds = relevantTaskIds(report);
    let executed = 0;
    let eligible = 0;
    let noteEligible = 0;
    for (const taskId of taskIds) {
        const repetitions = relevantRepetitions(report, taskId);
        const conditionPairs = repetitions.map((repetition) => [
            observations.get(conditionKey(taskId, repetition, reference)),
            observations.get(conditionKey(taskId, repetition, comparison)),
        ] as const);
        if (conditionPairs.some((pair) => pair.every((row) => row?.state === "terminal"))) executed += 1;
        if (conditionPairs.some((pair) => pair.every((row) => row?.state === "terminal" && row.capability_status === "valid"))) {
            eligible += 1;
        }
        if (conditionPairs.some((pair) => pair
            .filter((row) => row?.pass === "run2")
            .every((row) => row?.notes.notes_exposed === true))) {
            noteEligible += 1;
        }
    }
    return { full: taskIds.length, executed, eligible, paired, note_eligible: noteEligible };
}

function semanticsForRows(rows: PairedRow[], report: EvalReport, metric: MetricId): string | null {
    if (metric === "pass_rate") return "verified-pass-rate";
    if (metric === "total_tokens") return "reported-total-tokens";
    const validTasks = new Set(rows.filter(({ reference, comparison }) => reference !== null && comparison !== null)
        .map(({ task_id }) => task_id));
    const semantics = new Set(report.observations
        .filter(({ task_id }) => validTasks.has(task_id))
        .flatMap(({ result }) => result?.turns?.semantics ? [result.turns.semantics] : []));
    return semantics.size === 1 ? [...semantics][0]! : null;
}

function comparisonConditions(comparisonId: EvalAggregate["comparison_id"]): Condition[] {
    if (comparisonId === "memory-baseline") {
        return [{ arm: "baseline", pass: "run1" }, { arm: "baseline", pass: "run2" }];
    }
    if (comparisonId === "memory-treatment") {
        return [{ arm: "treatment", pass: "run1" }, { arm: "treatment", pass: "run2" }];
    }
    if (comparisonId === "endpoint-treatment-minus-baseline") {
        return [{ arm: "baseline", pass: "run2" }, { arm: "treatment", pass: "run2" }];
    }
    return [
        { arm: "baseline", pass: "run1" },
        { arm: "baseline", pass: "run2" },
        { arm: "treatment", pass: "run1" },
        { arm: "treatment", pass: "run2" },
    ];
}

function buildConditionLevels(
    report: EvalReport,
    observations: Map<string, EvalObservation>,
    comparisonId: EvalAggregate["comparison_id"],
    metric: MetricId,
    semantics: string | null,
) {
    const taskIds = relevantTaskIds(report);
    return comparisonConditions(comparisonId).map((condition) => {
        const taskValues: Array<{ taskId: string; value: number }> = [];
        const missingReasons: string[] = [];
        let executed = 0;
        let eligible = 0;
        for (const taskId of taskIds) {
            const rows = relevantRepetitions(report, taskId)
                .map((repetition) => observations.get(conditionKey(taskId, repetition, condition)));
            if (rows.some((row) => row?.state === "terminal")) executed += 1;
            if (rows.some((row) => row?.state === "terminal" && row.capability_status === "valid")) eligible += 1;
            const values = rows.flatMap((row) => {
                const value = metricValue(row, metric);
                if (value === null) return [];
                if (metric === "turns" && (semantics === null || row?.result?.turns?.semantics !== semantics)) return [];
                return [value];
            });
            if (values.length > 0) {
                taskValues.push({ taskId, value: values.reduce((sum, value) => sum + value, 0) / values.length });
            } else {
                const reason = rows.length === 0
                    ? "observation_missing"
                    : metric === "turns" && rows.some((row) => row?.result?.turns)
                        ? "turn_semantics_mismatch"
                        : missingReason(rows.find((row) => row !== undefined), metric);
                missingReasons.push(reason);
            }
        }
        return {
            arm: condition.arm,
            pass: condition.pass,
            value: taskValues.length === 0
                ? null
                : taskValues.reduce((sum, row) => sum + row.value, 0) / taskValues.length,
            valid_task_ids: taskValues.map(({ taskId }) => taskId),
            valid_task_count: taskValues.length,
            population: { full: taskIds.length, executed, eligible },
            missing: { count: taskIds.length - taskValues.length, reasons: [...new Set(missingReasons)].sort() },
        };
    });
}

function asAggregate(
    report: EvalReport,
    comparison: Comparison,
    metric: MetricId,
    rows: PairedRow[],
    estimate: PairedEstimate,
    observations: Map<string, EvalObservation>,
): EvalAggregate {
    const semantics = semanticsForRows(rows, report, metric);
    return evalAggregateSchema.parse({
        comparison_id: comparison.id,
        metric_id: metric,
        direction: comparison.direction,
        semantics,
        currency: null,
        estimate: estimate.estimate,
        within_arm: {
            baseline: comparison.kind === "within" && comparison.reference.arm === "baseline" ? estimate.estimate : null,
            treatment: comparison.kind === "within" && comparison.reference.arm === "treatment" ? estimate.estimate : null,
        },
        endpoint_delta: comparison.kind === "endpoint" ? estimate.estimate : null,
        difference_in_differences: null,
        uncertainty: {
            algorithm: estimate.algorithm,
            version: estimate.version,
            seed: estimate.seed,
            stream: estimate.stream,
            iterations: estimate.iterations,
            confidence: estimate.confidence,
            quantile: estimate.quantile,
            interval: estimate.interval,
            null_reason: estimate.null_reason,
        },
        warnings: estimate.warnings,
        valid_task_ids: estimate.valid_task_ids,
        valid_pair_count: estimate.valid_pair_count,
        condition_levels: buildConditionLevels(report, observations, comparison.id, metric, semantics),
        population: comparisonPopulation(report, observations, comparison.reference, comparison.comparison, estimate.valid_pair_count),
        missing: { count: estimate.missing.count, reasons: estimate.missing.reasons.map(({ reason }) => reason) },
    });
}

export function buildEvalAggregates(value: EvalReport): EvalAggregateSet {
    const report = validatedReport(value);
    const observationMap = new Map(report.observations.map((observation) => [observationKey(observation), observation]));
    const seed = canonicalDigest(report.schedule.map(({ seed }) => seed));
    const arms = new Set(report.schedule.map(({ arm }) => arm));
    const comparisons: Comparison[] = [];
    if (arms.has("baseline")) comparisons.push({
        id: "memory-baseline", direction: "run2-minus-run1",
        reference: { arm: "baseline", pass: "run1" }, comparison: { arm: "baseline", pass: "run2" }, kind: "within",
    });
    if (arms.has("treatment")) comparisons.push({
        id: "memory-treatment", direction: "run2-minus-run1",
        reference: { arm: "treatment", pass: "run1" }, comparison: { arm: "treatment", pass: "run2" }, kind: "within",
    });
    if (arms.has("baseline") && arms.has("treatment")) comparisons.push({
        id: "endpoint-treatment-minus-baseline", direction: "treatment-run2-minus-baseline-run2",
        reference: { arm: "baseline", pass: "run2" }, comparison: { arm: "treatment", pass: "run2" }, kind: "endpoint",
    });

    const aggregates: EvalAggregate[] = [];
    for (const comparison of comparisons) {
        for (const metric of ["turns", "total_tokens", "pass_rate"] as const) {
            const rows = pairRows(report, observationMap, metric, comparison.reference, comparison.comparison);
            const estimate = computePairedEstimate(rows, {
                seed, comparison_id: comparison.id, metric_id: metric,
            });
            aggregates.push(asAggregate(report, comparison, metric, rows, estimate, observationMap));
        }
    }

    if (arms.has("baseline") && arms.has("treatment")) {
        for (const metric of ["turns", "total_tokens", "pass_rate"] as const) {
            const baseline = pairRows(report, observationMap, metric,
                { arm: "baseline", pass: "run1" }, { arm: "baseline", pass: "run2" });
            const treatment = pairRows(report, observationMap, metric,
                { arm: "treatment", pass: "run1" }, { arm: "treatment", pass: "run2" });
            const treatmentByTask = new Map(treatment.map((row) => [`${row.task_id}\0${row.repetition}`, row]));
            const didRows = baseline.map((row) => {
                const other = treatmentByTask.get(`${row.task_id}\0${row.repetition}`);
                return {
                    task_id: row.task_id,
                    baseline_run1: row.reference,
                    baseline_run2: row.comparison,
                    treatment_run1: other?.reference ?? null,
                    treatment_run2: other?.comparison ?? null,
                    missing_reason: row.missing_reason ?? other?.missing_reason,
                };
            });
            const estimate = computeDifferenceInDifferences(didRows, {
                seed, comparison_id: "difference-in-differences", metric_id: metric,
            });
            const population = comparisonPopulation(report, observationMap,
                { arm: "baseline", pass: "run1" }, { arm: "treatment", pass: "run2" }, estimate.valid_pair_count);
            const semantics = semanticsForRows([...baseline, ...treatment], report, metric);
            aggregates.push(evalAggregateSchema.parse({
                comparison_id: "difference-in-differences",
                metric_id: metric,
                direction: "treatment-run2-minus-run1-minus-baseline-run2-minus-run1",
                semantics, currency: null,
                estimate: estimate.estimate, within_arm: { baseline: null, treatment: null }, endpoint_delta: null,
                difference_in_differences: estimate.estimate,
                uncertainty: {
                    algorithm: estimate.algorithm, version: estimate.version, seed: estimate.seed, stream: estimate.stream,
                    iterations: estimate.iterations, confidence: estimate.confidence, quantile: estimate.quantile,
                    interval: estimate.interval, null_reason: estimate.null_reason,
                },
                warnings: estimate.warnings, valid_task_ids: estimate.valid_task_ids,
                valid_pair_count: estimate.valid_pair_count,
                condition_levels: buildConditionLevels(
                    report,
                    observationMap,
                    "difference-in-differences",
                    metric,
                    semantics,
                ),
                population,
                missing: { count: estimate.missing.count, reasons: estimate.missing.reasons.map(({ reason }) => reason) },
            }));
        }
    }
    return aggregates;
}

function refreshEvalReport(report: EvalReport): void {
    report.aggregates = buildEvalAggregates(report);
    const reasons = [...new Set([
        ...report.observations.flatMap(({ missing_reasons }) => missing_reasons),
        ...report.aggregates.flatMap(({ missing }) => missing.reasons),
    ])].sort();
    const count = report.observations.filter(({ missing_reasons }) => missing_reasons.length > 0).length
        + report.aggregates.reduce((sum, { missing }) => sum + missing.count, 0);
    report.missingness = { count, reasons, digest: canonicalDigest({ count, reasons }) };
    report.evidence.missingness_digest = report.missingness.digest;
    report.warnings = [...new Set([
        ...report.aggregates.flatMap(({ warnings }) => warnings),
        ...(report.evidence.evidence_scope === "offline-framework" ? ["framework_only"] : []),
    ])].sort();
    report.updated_at = new Date().toISOString();
}

function displayNumber(value: number | null): string {
    return value === null ? "missing" : Number.isInteger(value) ? String(value) : value.toPrecision(6).replace(/0+$/, "").replace(/\.$/, "");
}

function conclusion(aggregate: EvalAggregate): "estimate" | "inconclusive" {
    const interval = aggregate.uncertainty.interval;
    return aggregate.warnings.includes("small_sample") || interval === null || (interval.low <= 0 && interval.high >= 0)
        ? "inconclusive"
        : "estimate";
}

export function renderEvalReport(value: EvalReport): string {
    const report = validatedReport(value);
    const lines = [
        `Cairn evaluation report: ${report.experiment_id}`,
        `status: ${report.status}`,
        `evidence: ${report.evidence.evidence_scope === "offline-framework" ? "framework-only" : "live-evaluation"}`,
        "All effects are estimates; small samples, missing intervals, and intervals crossing zero are inconclusive.",
        "",
        "Aggregates",
    ];
    for (const aggregate of report.aggregates) {
        const interval = aggregate.uncertainty.interval;
        lines.push(`${aggregate.comparison_id} / ${aggregate.metric_id}`);
        for (const level of aggregate.condition_levels) {
            lines.push(`  condition=${level.arm}/${level.pass} value=${displayNumber(level.value)} valid=${level.valid_task_count} tasks=${level.valid_task_ids.length > 0 ? level.valid_task_ids.join(",") : "none"} full=${level.population.full} executed=${level.population.executed} eligible=${level.population.eligible} missing=${level.missing.count} reasons=${level.missing.reasons.length > 0 ? level.missing.reasons.join(",") : "none"}`);
        }
        lines.push(`  estimate=${displayNumber(aggregate.estimate)} interval=${interval ? `[${displayNumber(interval.low)}, ${displayNumber(interval.high)}]` : `none (${aggregate.uncertainty.null_reason ?? "unavailable"})`} conclusion=${conclusion(aggregate)}`);
        lines.push(`  full=${aggregate.population.full} executed=${aggregate.population.executed} eligible=${aggregate.population.eligible} paired=${aggregate.valid_pair_count} note-eligible=${aggregate.population.note_eligible}`);
        lines.push(`  missing=${aggregate.missing.count} reasons=${aggregate.missing.reasons.length > 0 ? aggregate.missing.reasons.join(",") : "none"}`);
        lines.push(`  warnings=${aggregate.warnings.length > 0 ? aggregate.warnings.join(",") : "none"}`);
    }
    lines.push("", "Per-task observations");
    for (const observation of report.observations) {
        lines.push(`${observation.task_id} arm=${observation.arm} pass=${observation.pass} repetition=${observation.repetition} terminal=${observation.terminal_state ?? "pending"} verified=${observation.pass_state} turns=${observation.result?.turns ? `${observation.result.turns.value}:${observation.result.turns.semantics}` : "missing"} total_tokens=${observation.result?.usage?.total_tokens ?? "missing"}`);
        lines.push(`  expected capability digest: ${observation.expected_capability_digest}`);
        lines.push(`  observed capability digest: ${observation.observed_capability_digest ?? "missing"}`);
        lines.push(`  notes=${observation.notes.eligibility_reason} exposed=${observation.notes.notes_exposed} missing=${observation.missing_reasons.length > 0 ? observation.missing_reasons.join(",") : "none"}`);
    }
    lines.push("", `report missingness: count=${report.missingness.count} reasons=${report.missingness.reasons.length > 0 ? report.missingness.reasons.join(",") : "none"}`);
    lines.push(`report warnings: ${report.warnings.length > 0 ? report.warnings.join(",") : "none"}`);
    if (report.evidence.evidence_scope === "offline-framework") {
        lines.push("Offline fixture results are framework-only and do not authorize product claims.");
    }
    return `${lines.join("\n")}\n`;
}
