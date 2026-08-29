import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod";

const benchmarkFileSchema = z.object({
    path: z.string().min(1).regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+$/),
    kind: z.enum(["document", "skill"]),
    title: z.string().min(1),
    description: z.string(),
    keywords: z.array(z.string()),
    content: z.string(),
}).strict();

const benchmarkPackSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    version: z.string().regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/),
    title: z.string().min(1),
    enabled: z.boolean(),
    files: z.array(benchmarkFileSchema).min(1).max(1_024),
}).strict();

const benchmarkCaseSchema = z.object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    query: z.string().min(1),
    relevant: z.array(z.string().min(1)),
    forbidden: z.array(z.string().min(1)),
    limit: z.number().int().min(1).max(100),
}).strict();

const retrievalBenchmarkSuiteSchema = z.object({
    schema_version: z.literal(1),
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    description: z.string().min(1),
    packs: z.array(benchmarkPackSchema).min(1).max(32),
    cases: z.array(benchmarkCaseSchema).min(1).max(1_024),
}).strict();

export type RetrievalBenchmarkSuite = z.infer<typeof retrievalBenchmarkSuiteSchema>;
export type RetrievalBenchmarkCase = RetrievalBenchmarkSuite["cases"][number];

export type RetrievalBenchmarkRow = {
    pack_id: string;
    version: string;
    path: string;
    text: string;
    score?: number;
    [key: string]: unknown;
};

export type RetrievalBenchmarkCaseResult = {
    id: string;
    query: string;
    relevant: string[];
    forbidden: string[];
    returned: string[];
    leaked_results: string[];
    isolation_case: boolean;
    isolation_pass: boolean;
    hit_at_1: number;
    recall_at_5: number;
    reciprocal_rank: number;
    relevant_bytes: number;
    irrelevant_bytes: number;
    estimated_context_tokens: number;
    forbidden_results: number;
    undeclared_results: number;
    latency_ms: number;
};

export type RetrievalBenchmarkReport = {
    schema_version: 1;
    benchmark_id: string;
    mode: string;
    generated_at: string;
    cases: RetrievalBenchmarkCaseResult[];
    metrics: {
        cases: number;
        positive_cases: number;
        negative_cases: number;
        negative_cases_passed: number;
        negative_case_pass_rate: number;
        negative_case_leaks: number;
        hit_at_1: number;
        recall_at_5: number;
        mean_reciprocal_rank: number;
        relevant_bytes: number;
        irrelevant_bytes: number;
        estimated_context_tokens: number;
        median_latency_ms: number;
        p95_latency_ms: number;
        network_requests: number;
        filesystem_mutations: number;
        forbidden_results: number;
        undeclared_results: number;
    };
    report_digest: string;
};

export type RetrievalBenchmarkAdapter = {
    mode: string;
    retrieve: (benchmarkCase: RetrievalBenchmarkCase) => Promise<RetrievalBenchmarkRow[]>;
    networkRequests?: () => number;
    filesystemMutations?: () => number;
    now?: () => number;
};

function assertUnique(values: string[], label: string): void {
    if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}

function resultKey(row: RetrievalBenchmarkRow): string {
    return `${row.pack_id}@${row.version}:${row.path}`;
}

function resultIdentity(pack: RetrievalBenchmarkSuite["packs"][number], path: string): string {
    return `${pack.id}@${pack.version}:${path}`;
}

function suiteVisibilityPolicy(suite: RetrievalBenchmarkSuite): { declared: Set<string>; forbidden: Set<string> } {
    const declared = new Set<string>();
    const forbidden = new Set<string>();
    for (const pack of suite.packs) {
        for (const file of pack.files) {
            const identity = resultIdentity(pack, file.path);
            declared.add(identity);
            if (!pack.enabled || file.kind === "skill") forbidden.add(identity);
        }
    }
    return { declared, forbidden };
}

function round(value: number): number {
    return Number(value.toFixed(6));
}

function quantile(values: number[], percentile: number): number {
    if (values.length === 0) return 0;
    const ordered = [...values].sort((a, b) => a - b);
    return ordered[Math.ceil(percentile * ordered.length) - 1] ?? ordered[ordered.length - 1];
}

function stable(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right, "en"))
            .map(([key, item]) => [key, stable(item)]));
    }
    return value;
}

function digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function parseRetrievalBenchmarkSuite(value: unknown): RetrievalBenchmarkSuite {
    const suite = retrievalBenchmarkSuiteSchema.parse(value);
    assertUnique(suite.packs.map(({ id, version }) => `${id}@${version}`), "benchmark pack id and version");
    assertUnique(suite.cases.map(({ id }) => id), "benchmark case id");
    for (const pack of suite.packs) {
        assertUnique(pack.files.map(({ path }) => path), `file path in ${pack.id}@${pack.version}`);
    }
    const { declared, forbidden: suiteForbidden } = suiteVisibilityPolicy(suite);
    for (const benchmarkCase of suite.cases) {
        assertUnique(benchmarkCase.relevant, `relevant result in ${benchmarkCase.id}`);
        assertUnique(benchmarkCase.forbidden, `forbidden result in ${benchmarkCase.id}`);
        if (benchmarkCase.relevant.some((key) => benchmarkCase.forbidden.includes(key))) {
            throw new Error(`Benchmark case ${benchmarkCase.id} marks a result both relevant and forbidden`);
        }
        const forbiddenRelevant = benchmarkCase.relevant.find((key) => suiteForbidden.has(key));
        if (forbiddenRelevant) {
            throw new Error(`Benchmark case ${benchmarkCase.id} marks suite-forbidden result ${forbiddenRelevant} as relevant`);
        }
        for (const key of [...benchmarkCase.relevant, ...benchmarkCase.forbidden]) {
            if (!declared.has(key)) throw new Error(`Benchmark case ${benchmarkCase.id} references undeclared result ${key}`);
        }
    }
    return suite;
}

export function canonicalBenchmarkReport(report: RetrievalBenchmarkReport): Record<string, unknown> {
    const { generated_at: _generatedAt, report_digest: _reportDigest, ...rest } = report;
    return stable({
        ...rest,
        cases: rest.cases.map(({ latency_ms: _latency, ...benchmarkCase }) => benchmarkCase),
        metrics: {
            ...rest.metrics,
            median_latency_ms: 0,
            p95_latency_ms: 0,
        },
    }) as Record<string, unknown>;
}

export async function evaluateRetrievalBenchmark(
    suiteValue: RetrievalBenchmarkSuite | unknown,
    adapter: RetrievalBenchmarkAdapter,
): Promise<RetrievalBenchmarkReport> {
    const suite = parseRetrievalBenchmarkSuite(suiteValue);
    const clock = adapter.now ?? (() => performance.now());
    const networkBefore = adapter.networkRequests?.() ?? 0;
    const mutationsBefore = adapter.filesystemMutations?.() ?? 0;
    const cases: RetrievalBenchmarkCaseResult[] = [];
    const { declared, forbidden: suiteForbidden } = suiteVisibilityPolicy(suite);

    for (const benchmarkCase of suite.cases) {
        const started = clock();
        const rows = (await adapter.retrieve(benchmarkCase)).slice(0, benchmarkCase.limit);
        const latency = Math.max(0, clock() - started);
        const relevant = new Set(benchmarkCase.relevant);
        const forbidden = new Set([...suiteForbidden, ...benchmarkCase.forbidden]);
        const returned = rows.map(resultKey);
        const leakedResults = returned.filter((key) => forbidden.has(key) || !declared.has(key));
        const undeclaredResults = returned.filter((key) => !declared.has(key)).length;
        const uniqueTopFive = new Set(returned.slice(0, 5).filter((key) => relevant.has(key)));
        const firstRelevant = returned.findIndex((key) => relevant.has(key));
        let relevantBytes = 0;
        let irrelevantBytes = 0;
        for (const [index, row] of rows.entries()) {
            const bytes = Buffer.byteLength(row.text, "utf8");
            if (relevant.has(returned[index])) relevantBytes += bytes;
            else irrelevantBytes += bytes;
        }
        cases.push({
            id: benchmarkCase.id,
            query: benchmarkCase.query,
            relevant: [...benchmarkCase.relevant],
            forbidden: [...forbidden].sort((left, right) => left.localeCompare(right, "en")),
            returned,
            leaked_results: leakedResults,
            isolation_case: relevant.size === 0,
            isolation_pass: leakedResults.length === 0,
            hit_at_1: returned[0] && relevant.has(returned[0]) ? 1 : 0,
            recall_at_5: relevant.size ? round(uniqueTopFive.size / relevant.size) : 0,
            reciprocal_rank: firstRelevant < 0 ? 0 : round(1 / (firstRelevant + 1)),
            relevant_bytes: relevantBytes,
            irrelevant_bytes: irrelevantBytes,
            estimated_context_tokens: Math.ceil((relevantBytes + irrelevantBytes) / 4),
            forbidden_results: leakedResults.length,
            undeclared_results: undeclaredResults,
            latency_ms: round(latency),
        });
    }

    const count = cases.length;
    const sum = (field: keyof RetrievalBenchmarkCaseResult): number => cases.reduce((total, item) => total + Number(item[field]), 0);
    const positiveCases = cases.filter(({ isolation_case }) => !isolation_case);
    const negativeCases = cases.filter(({ isolation_case }) => isolation_case);
    const sumPositive = (field: "hit_at_1" | "recall_at_5" | "reciprocal_rank"): number =>
        positiveCases.reduce((total, item) => total + item[field], 0);
    const negativeCasesPassed = negativeCases.filter(({ isolation_pass }) => isolation_pass).length;
    const negativeCaseLeaks = negativeCases.reduce((total, item) => total + item.forbidden_results, 0);
    const report = {
        schema_version: 1 as const,
        benchmark_id: suite.id,
        mode: adapter.mode,
        generated_at: new Date().toISOString(),
        cases,
        metrics: {
            cases: count,
            positive_cases: positiveCases.length,
            negative_cases: negativeCases.length,
            negative_cases_passed: negativeCasesPassed,
            negative_case_pass_rate: negativeCases.length ? round(negativeCasesPassed / negativeCases.length) : 1,
            negative_case_leaks: negativeCaseLeaks,
            hit_at_1: positiveCases.length ? round(sumPositive("hit_at_1") / positiveCases.length) : 0,
            recall_at_5: positiveCases.length ? round(sumPositive("recall_at_5") / positiveCases.length) : 0,
            mean_reciprocal_rank: positiveCases.length ? round(sumPositive("reciprocal_rank") / positiveCases.length) : 0,
            relevant_bytes: sum("relevant_bytes"),
            irrelevant_bytes: sum("irrelevant_bytes"),
            estimated_context_tokens: sum("estimated_context_tokens"),
            median_latency_ms: round(quantile(cases.map(({ latency_ms }) => latency_ms), 0.5)),
            p95_latency_ms: round(quantile(cases.map(({ latency_ms }) => latency_ms), 0.95)),
            network_requests: Math.max(0, (adapter.networkRequests?.() ?? networkBefore) - networkBefore),
            filesystem_mutations: Math.max(0, (adapter.filesystemMutations?.() ?? mutationsBefore) - mutationsBefore),
            forbidden_results: sum("forbidden_results"),
            undeclared_results: sum("undeclared_results"),
        },
        report_digest: "",
    } satisfies RetrievalBenchmarkReport;
    report.report_digest = digest(canonicalBenchmarkReport(report));
    return report;
}
