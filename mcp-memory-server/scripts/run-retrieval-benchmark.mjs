import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
    enableContextPack,
    initializeContextPack,
    installContextPack,
    lockContextPack,
    searchVisibleContext,
} from "../dist/context-pack.js";
import {
    canonicalBenchmarkReport,
    evaluateRetrievalBenchmark,
    parseRetrievalBenchmarkSuite,
} from "../dist/retrieval-benchmark.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "fixtures", "retrieval-benchmark-suite.json");
const goldenPath = join(here, "fixtures", "retrieval-benchmark-golden.json");
const args = new Set(process.argv.slice(2));
const writeGolden = args.has("--write-golden");
const checkGolden = args.has("--check");
const suite = parseRetrievalBenchmarkSuite(JSON.parse(readFileSync(fixturePath, "utf8")));
const root = mkdtempSync(join(tmpdir(), "cairn-retrieval-benchmark-"));
const projectRoot = join(root, "project");
const packBase = join(root, "packs");
mkdirSync(projectRoot, { recursive: true });
process.env.CAIRN_PACK_BASE_DIR = packBase;
const nativeFetch = globalThis.fetch;
let fetchRequests = 0;
globalThis.fetch = async (...parameters) => {
    fetchRequests += 1;
    return nativeFetch(...parameters);
};

function canonicalDigest(value) {
    const sort = (item) => Array.isArray(item)
        ? item.map(sort)
        : item && typeof item === "object"
            ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, child]) => [key, sort(child)]))
            : item;
    return createHash("sha256").update(JSON.stringify(sort(value))).digest("hex");
}

function fileSnapshot(directory) {
    const result = new Map();
    const walk = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const path = join(current, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (entry.isFile()) result.set(path.slice(directory.length + 1), `${statSync(path).size}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
        }
    };
    try { walk(directory); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    return result;
}

function changedFiles(before, directory) {
    const after = fileSnapshot(directory);
    return new Set([...before.keys(), ...after.keys()].filter((path) => before.get(path) !== after.get(path))).size;
}

function removeFixtureRoot(directory) {
    const makeWritable = (current) => {
        try {
            chmodSync(current, 0o700);
            for (const entry of readdirSync(current, { withFileTypes: true })) {
                const path = join(current, entry.name);
                if (entry.isDirectory()) makeWritable(path);
                else chmodSync(path, 0o600);
            }
        } catch (error) {
            if (error?.code !== "ENOENT") throw error;
        }
    };
    makeWritable(directory);
    rmSync(directory, { recursive: true, force: true });
}

function conceptVector(text) {
    const value = text.toLowerCase();
    const terms = [
        ["atomic", "immutable", "digest", "partial write", "incomplete", "failed install", "old pointer", "previous digest", "content-addressed", "publication", "roll back"],
        ["recovery", "recover", "remnant", "validating", "last complete"],
        ["retry", "lock", "contended", "transaction"],
        ["deployment", "incantation"],
        ["dashboard", "decorative", "label"],
        ["legacy", "mutable", "deprecated"],
    ];
    const vector = terms.map((group) => group.reduce((score, term) => score + (value.includes(term) ? 1 : 0), 0));
    return vector.some(Boolean) ? vector : [0, 0, 0, 0, 0, 0];
}

async function mockEmbeddingServer() {
    let requests = 0;
    const server = createServer((request, response) => {
        if (request.method !== "POST" || request.url !== "/v1/embeddings") {
            response.writeHead(404).end();
            return;
        }
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => {
            requests += 1;
            const input = JSON.parse(body).input;
            response.writeHead(200, { "content-type": "application/json" });
            response.end(JSON.stringify({ data: input.map((text, index) => ({ index, embedding: conceptVector(text) })) }));
        });
    });
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    assert(address && typeof address === "object");
    return {
        url: `http://127.0.0.1:${address.port}/v1`,
        requests: () => requests,
        close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    };
}

async function materializePacks() {
    for (const pack of suite.packs) {
        const source = join(root, "sources", `${pack.id}-${pack.version}`);
        for (const file of pack.files) {
            const target = join(source, file.path);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, file.content);
        }
        await initializeContextPack(source, {
            id: pack.id,
            version: pack.version,
            title: pack.title,
            description: `Retrieval benchmark fixture ${pack.id}@${pack.version}`,
            license: "CC0-1.0",
        });
        const manifestPath = join(source, "context-pack.json");
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        manifest.files = manifest.files.map((entry) => {
            const fixture = pack.files.find(({ path }) => path === entry.path);
            assert(fixture, `missing fixture metadata for ${entry.path}`);
            return { ...entry, kind: fixture.kind, title: fixture.title, description: fixture.description, keywords: fixture.keywords };
        });
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
        await lockContextPack(source);
        const installed = await installContextPack(source);
        if (pack.enabled) await enableContextPack(installed.pack.digest, { projectRoot });
    }
}

async function run(mode, counters = {}) {
    const baseline = fileSnapshot(packBase);
    return evaluateRetrievalBenchmark(suite, {
        mode,
        retrieve: async (benchmarkCase) => {
            const result = await searchVisibleContext(benchmarkCase.query, { projectRoot, limit: benchmarkCase.limit });
            assert.equal(result.search_mode, mode, `${benchmarkCase.id} unexpectedly used ${result.search_mode}`);
            return result.results;
        },
        networkRequests: counters.networkRequests,
        filesystemMutations: () => changedFiles(baseline, packBase),
    });
}

async function assertLeakageDetection() {
    const injected = new Map([
        ["exact-digest", [
            { pack_id: "engineering-guide", version: "1.0.0", path: "skills/deploy.md", text: "cross-case hidden skill" },
        ]],
        ["lexical-distractor", [
            { pack_id: "engineering-guide", version: "0.9.0", path: "storage/legacy.md", text: "cross-case stale pack" },
        ]],
        ["cross-document", [
            { pack_id: "undeclared-pack", version: "1.0.0", path: "unknown.md", text: "undeclared identity" },
        ]],
        ["hidden-skill", [
            { pack_id: "engineering-guide", version: "1.0.0", path: "skills/deploy.md", text: "negative-case hidden skill" },
        ]],
    ]);
    const report = await evaluateRetrievalBenchmark(suite, {
        mode: "leakage-self-check",
        retrieve: async ({ id }) => injected.get(id) ?? [],
    });
    assert.equal(report.metrics.forbidden_results, 4, "suite-wide and undeclared leakage must fail regardless of query case");
    assert.equal(report.metrics.undeclared_results, 1, "undeclared result identities must be counted as leakage");
    assert.equal(report.metrics.negative_cases, 1);
    assert.equal(report.metrics.negative_cases_passed, 0);
    assert.equal(report.metrics.negative_case_pass_rate, 0);
    assert.equal(report.metrics.negative_case_leaks, 1);
}

let embeddingServer;
try {
    await materializePacks();
    delete process.env.CAIRN_LLM_API_KEY;
    delete process.env.CAIRN_MEMORY_EMBEDDING_URL;
    delete process.env.CAIRN_MEMORY_EMBEDDING_MODEL;
    const substring = await run("substring", { networkRequests: () => fetchRequests });
    assert.equal(substring.metrics.network_requests, 0, "substring benchmark must remain offline");
    assert.equal(substring.metrics.filesystem_mutations, 0, "substring search must not mutate pack storage");
    assert.equal(substring.metrics.forbidden_results, 0, "disabled packs and unapproved skills must remain hidden");

    embeddingServer = await mockEmbeddingServer();
    process.env.CAIRN_LLM_API_KEY = "offline-fixture-key";
    process.env.CAIRN_MEMORY_EMBEDDING_URL = embeddingServer.url;
    process.env.CAIRN_MEMORY_EMBEDDING_MODEL = "offline-fixture-v1";
    const embedding = await run("embedding", { networkRequests: () => fetchRequests });
    assert.equal(embedding.metrics.forbidden_results, 0, "embedding search must preserve visibility boundaries");
    assert.equal(embedding.metrics.network_requests, embeddingServer.requests(), "all benchmark network traffic must target the fixture embedding server");
    await assertLeakageDetection();

    const report = {
        schema_version: 1,
        benchmark_id: suite.id,
        suite_digest: canonicalDigest(suite),
        reports: { substring, embedding },
    };
    const canonical = {
        ...report,
        reports: {
            substring: canonicalBenchmarkReport(substring),
            embedding: canonicalBenchmarkReport(embedding),
        },
    };
    if (writeGolden) writeFileSync(goldenPath, `${JSON.stringify(canonical, null, 2)}\n`);
    if (checkGolden) assert.deepEqual(canonical, JSON.parse(readFileSync(goldenPath, "utf8")), "retrieval benchmark changed; inspect and intentionally refresh the golden file");
    if (checkGolden) {
        process.stdout.write(`retrieval benchmark golden: ok (${suite.id})\n`);
    } else {
        process.stdout.write(`${JSON.stringify(writeGolden ? canonical : report, null, 2)}\n`);
    }
} finally {
    globalThis.fetch = nativeFetch;
    if (embeddingServer) await embeddingServer.close();
    removeFixtureRoot(root);
}
