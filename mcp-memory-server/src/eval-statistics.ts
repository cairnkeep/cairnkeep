import { createHash } from "node:crypto";

const DEFAULT_ITERATIONS = 10_000;
const DEFAULT_CONFIDENCE = 0.95;

export type PairedRow = {
    task_id: string;
    repetition?: number;
    seed?: string;
    reference: number | null;
    comparison: number | null;
    missing_reason?: string;
};

export type DifferenceInDifferencesRow = {
    task_id: string;
    baseline_run1: number | null;
    baseline_run2: number | null;
    treatment_run1: number | null;
    treatment_run2: number | null;
    missing_reason?: string;
};

export type BootstrapOptions = {
    seed: string;
    comparison_id: string;
    metric_id: string;
    iterations?: number;
    confidence?: number;
};

export type BootstrapInterval = {
    algorithm: "paired-bootstrap";
    version: 1;
    seed: string;
    stream: string;
    iterations: number;
    confidence: number;
    quantile: "percentile-nearest-rank-v1";
    interval: { low: number; high: number } | null;
    null_reason: string | null;
    warnings: string[];
    wording: "estimate" | "inconclusive";
};

export type PairedEstimate = BootstrapInterval & {
    estimate: number | null;
    valid_task_ids: string[];
    valid_pair_count: number;
    missing: {
        count: number;
        reasons: Array<{ reason: string; count: number }>;
    };
};

export type TaskRepetitionSummary = {
    task_id: string;
    reference: number;
    comparison: number;
    difference: number;
    repetitions: number;
};

type EvalPrng = {
    index(population: number): number;
};

function resolvedOptions(options: BootstrapOptions): Required<BootstrapOptions> {
    const iterations = options.iterations ?? DEFAULT_ITERATIONS;
    const confidence = options.confidence ?? DEFAULT_CONFIDENCE;
    if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 1_000_000) {
        throw new Error("Bootstrap iterations must be an integer between 1 and 1000000.");
    }
    if (!Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) {
        throw new Error("Bootstrap confidence must be between zero and one.");
    }
    if (!options.seed || !options.comparison_id || !options.metric_id) {
        throw new Error("Bootstrap seed, comparison_id, and metric_id are required.");
    }
    return { ...options, iterations, confidence };
}

export function createEvalPrng(options: BootstrapOptions): EvalPrng {
    const resolved = resolvedOptions(options);
    let counter = 0;
    let bytes = Buffer.alloc(0);
    let offset = 0;

    return {
        index(population: number): number {
            if (!Number.isSafeInteger(population) || population < 1) {
                throw new Error("PRNG population must be a positive integer.");
            }
            if (offset + 4 > bytes.length) {
                bytes = createHash("sha256")
                    .update(`${resolved.seed}\0${resolved.comparison_id}\0${resolved.metric_id}\0${counter}`)
                    .digest();
                counter += 1;
                offset = 0;
            }
            const value = bytes.readUInt32BE(offset);
            offset += 4;
            return value % population;
        },
    };
}

function finite(value: number | null): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

export function summarizeTaskRepetitions(rows: readonly PairedRow[]): TaskRepetitionSummary[] {
    const grouped = new Map<string, PairedRow[]>();
    for (const row of rows) {
        const taskRows = grouped.get(row.task_id) ?? [];
        taskRows.push(row);
        grouped.set(row.task_id, taskRows);
    }

    const summaries: TaskRepetitionSummary[] = [];
    for (const [taskId, taskRows] of grouped) {
        const paired = taskRows.filter((row) => finite(row.reference) && finite(row.comparison));
        if (paired.length === 0) continue;
        const reference = paired.reduce((sum, row) => sum + (row.reference as number), 0) / paired.length;
        const comparison = paired.reduce((sum, row) => sum + (row.comparison as number), 0) / paired.length;
        summaries.push({
            task_id: taskId,
            reference,
            comparison,
            difference: comparison - reference,
            repetitions: paired.length,
        });
    }
    return summaries;
}

export function bootstrapPairedInterval(
    differences: readonly number[],
    options: BootstrapOptions,
): BootstrapInterval {
    const resolved = resolvedOptions(options);
    const stream = `${resolved.seed}\0${resolved.comparison_id}\0${resolved.metric_id}`;
    const warnings = differences.length < 20 ? ["small_sample"] : [];
    const base = {
        algorithm: "paired-bootstrap" as const,
        version: 1 as const,
        seed: resolved.seed,
        stream,
        iterations: resolved.iterations,
        confidence: resolved.confidence,
        quantile: "percentile-nearest-rank-v1" as const,
        warnings,
    };

    if (differences.length < 2) {
        return {
            ...base,
            interval: null,
            null_reason: "fewer_than_two_pairs",
            wording: "inconclusive",
        };
    }
    if (differences.some((value) => !Number.isFinite(value))) {
        throw new Error("Bootstrap differences must all be finite.");
    }

    const prng = createEvalPrng(resolved);
    const means = new Array<number>(resolved.iterations);
    for (let iteration = 0; iteration < resolved.iterations; iteration += 1) {
        let sum = 0;
        for (let draw = 0; draw < differences.length; draw += 1) {
            sum += differences[prng.index(differences.length)]!;
        }
        means[iteration] = sum / differences.length;
    }
    means.sort((left, right) => left - right);
    const tail = (1 - resolved.confidence) / 2;
    const interval = {
        low: means[Math.floor((means.length - 1) * tail)]!,
        high: means[Math.ceil((means.length - 1) * (1 - tail))]!,
    };
    return {
        ...base,
        interval,
        null_reason: null,
        wording: warnings.length > 0 || (interval.low <= 0 && interval.high >= 0)
            ? "inconclusive"
            : "estimate",
    };
}

function missingSummary(rows: readonly { task_id: string; missing_reason?: string }[], validTaskIds: Set<string>) {
    const byTask = new Map<string, string>();
    for (const row of rows) {
        if (!validTaskIds.has(row.task_id) && !byTask.has(row.task_id)) {
            byTask.set(row.task_id, row.missing_reason ?? "paired_measurement_missing");
        }
    }
    const counts = new Map<string, number>();
    for (const reason of byTask.values()) counts.set(reason, (counts.get(reason) ?? 0) + 1);
    return {
        count: byTask.size,
        reasons: [...counts].map(([reason, count]) => ({ reason, count })),
    };
}

export function computePairedEstimate(
    rows: readonly PairedRow[],
    options: BootstrapOptions,
): PairedEstimate {
    const summaries = summarizeTaskRepetitions(rows);
    const validTaskIds = summaries.map((row) => row.task_id);
    const differences = summaries.map((row) => row.difference);
    const interval = bootstrapPairedInterval(differences, options);
    return {
        ...interval,
        estimate: differences.length === 0
            ? null
            : differences.reduce((sum, value) => sum + value, 0) / differences.length,
        valid_task_ids: validTaskIds,
        valid_pair_count: validTaskIds.length,
        missing: missingSummary(rows, new Set(validTaskIds)),
    };
}

export function computeDifferenceInDifferences(
    rows: readonly DifferenceInDifferencesRow[],
    options: BootstrapOptions,
): PairedEstimate {
    const pairedRows: PairedRow[] = rows.map((row) => {
        const valid = finite(row.baseline_run1)
            && finite(row.baseline_run2)
            && finite(row.treatment_run1)
            && finite(row.treatment_run2);
        return {
            task_id: row.task_id,
            reference: valid ? (row.baseline_run2 as number) - (row.baseline_run1 as number) : null,
            comparison: valid ? (row.treatment_run2 as number) - (row.treatment_run1 as number) : null,
            missing_reason: row.missing_reason,
        };
    });
    return computePairedEstimate(pairedRows, options);
}
