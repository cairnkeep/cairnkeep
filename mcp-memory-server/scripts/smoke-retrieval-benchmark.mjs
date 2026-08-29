import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    canonicalBenchmarkReport,
    evaluateRetrievalBenchmark,
    parseRetrievalBenchmarkSuite,
} from "../dist/retrieval-benchmark.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "fixtures", "retrieval-benchmark-suite.json"), "utf8"));
const suite = parseRetrievalBenchmarkSuite(fixture);

assert.equal(suite.schema_version, 1);
assert.throws(() => parseRetrievalBenchmarkSuite({ ...fixture, unexpected: true }), /unrecognized|unknown/i);
assert.throws(() => parseRetrievalBenchmarkSuite({ ...fixture, cases: [...fixture.cases, fixture.cases[0]] }), /duplicate/i);
assert.throws(() => parseRetrievalBenchmarkSuite({
    ...fixture,
    cases: [{ ...fixture.cases[0], unexpected: true }],
}), /unrecognized|unknown/i);
assert.throws(() => parseRetrievalBenchmarkSuite({
    ...fixture,
    cases: [{
        ...fixture.cases[0],
        relevant: ["engineering-guide@1.0.0:skills/deploy.md"],
        forbidden: [],
    }],
}), /suite-forbidden/i);

const rows = new Map([
    ["exact-digest", [{ pack_id: "engineering-guide", version: "1.0.0", path: "storage/immutability.md", text: "digest pinned", score: 2 }]],
    ["lexical-distractor", [
        { pack_id: "engineering-guide", version: "1.0.0", path: "storage/immutability.md", text: "immutable storage", score: 2 },
        { pack_id: "engineering-guide", version: "1.0.0", path: "operations/distractor.md", text: "immutable label", score: 1 },
    ]],
    ["cross-document", [
        { pack_id: "engineering-guide", version: "1.0.0", path: "operations/recovery.md", text: "recovery", score: 2 },
        { pack_id: "engineering-guide", version: "1.0.0", path: "architecture/overview.md", text: "recovery", score: 1 },
    ]],
    ["semantic-paraphrase", []],
    ["hidden-skill", []],
]);

const report = await evaluateRetrievalBenchmark(suite, {
    mode: "substring",
    retrieve: async ({ id }) => rows.get(id) ?? [],
    networkRequests: () => 0,
    filesystemMutations: () => 0,
    now: (() => { let tick = 0; return () => tick++; })(),
});

assert.equal(report.metrics.positive_cases, 4);
assert.equal(report.metrics.negative_cases, 1);
assert.equal(report.metrics.negative_cases_passed, 1);
assert.equal(report.metrics.negative_case_pass_rate, 1);
assert.equal(report.metrics.negative_case_leaks, 0);
assert.equal(report.metrics.hit_at_1, 0.75);
assert.equal(report.metrics.recall_at_5, 0.75);
assert.equal(report.metrics.mean_reciprocal_rank, 0.75);
assert.equal(report.metrics.forbidden_results, 0);
assert.equal(report.metrics.undeclared_results, 0);
assert.equal(report.metrics.network_requests, 0);
assert.equal(report.metrics.filesystem_mutations, 0);
assert.deepEqual(canonicalBenchmarkReport({ ...report, generated_at: "tomorrow", metrics: { ...report.metrics, median_latency_ms: 999, p95_latency_ms: 999 } }), canonicalBenchmarkReport(report));

const crossCaseLeaks = new Map(rows);
crossCaseLeaks.set("exact-digest", [
    ...rows.get("exact-digest"),
    { pack_id: "engineering-guide", version: "1.0.0", path: "skills/deploy.md", text: "hidden skill", score: 1 },
]);
crossCaseLeaks.set("cross-document", [
    ...rows.get("cross-document"),
    { pack_id: "engineering-guide", version: "0.9.0", path: "storage/legacy.md", text: "stale pack", score: 1 },
]);
crossCaseLeaks.set("semantic-paraphrase", [
    { pack_id: "not-declared", version: "9.9.9", path: "unknown.md", text: "undeclared", score: 1 },
]);
const leakedReport = await evaluateRetrievalBenchmark(suite, {
    mode: "substring",
    retrieve: async ({ id }) => crossCaseLeaks.get(id) ?? [],
});
assert.equal(leakedReport.metrics.forbidden_results, 3);
assert.equal(leakedReport.metrics.undeclared_results, 1);
assert.equal(leakedReport.metrics.negative_cases_passed, 1);
assert.equal(leakedReport.metrics.negative_case_leaks, 0);
assert.equal(leakedReport.cases.find(({ id }) => id === "exact-digest").isolation_pass, false);
assert.deepEqual(leakedReport.cases.find(({ id }) => id === "cross-document").leaked_results, [
    "engineering-guide@0.9.0:storage/legacy.md",
]);

const negativeLeak = new Map(rows);
negativeLeak.set("hidden-skill", [
    { pack_id: "engineering-guide", version: "1.0.0", path: "skills/deploy.md", text: "hidden skill", score: 1 },
]);
const negativeLeakReport = await evaluateRetrievalBenchmark(suite, {
    mode: "substring",
    retrieve: async ({ id }) => negativeLeak.get(id) ?? [],
});
assert.equal(negativeLeakReport.metrics.negative_cases, 1);
assert.equal(negativeLeakReport.metrics.negative_cases_passed, 0);
assert.equal(negativeLeakReport.metrics.negative_case_pass_rate, 0);
assert.equal(negativeLeakReport.metrics.negative_case_leaks, 1);

const localForbiddenFixture = structuredClone(fixture);
localForbiddenFixture.cases = [{
    ...localForbiddenFixture.cases[0],
    forbidden: ["engineering-guide@1.0.0:storage/retries.md"],
}];
const localForbiddenReport = await evaluateRetrievalBenchmark(localForbiddenFixture, {
    mode: "substring",
    retrieve: async () => [{
        pack_id: "engineering-guide",
        version: "1.0.0",
        path: "storage/retries.md",
        text: "locally excluded",
    }],
});
assert.equal(localForbiddenReport.metrics.forbidden_results, 1);
assert.equal(localForbiddenReport.metrics.undeclared_results, 0);

console.log("retrieval benchmark contracts: ok");
