// Smoke test for the embeddings module. Verifies cosine math, cache round-trip,
// and (when CAIRN_LLM_API_KEY is set) a live embeddings call that ranks a
// relevant sentence above an unrelated one.
//
// Run: node scripts/smoke-embeddings.mjs   (after `npm run build`)
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    EmbeddingCache,
    cosineSimilarity,
    embedTexts,
    getEmbeddingConfig,
    hashText,
} from "../dist/embeddings.js";

let failures = 0;
function check(name, cond) {
    if (cond) {
        console.log(`ok: ${name}`);
    } else {
        console.error(`FAIL: ${name}`);
        failures += 1;
    }
}

// 1. cosine math
check("cosine identical == 1", Math.abs(cosineSimilarity([1, 2, 3], [1, 2, 3]) - 1) < 1e-9);
check("cosine orthogonal == 0", Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
check("cosine empty == 0", cosineSimilarity([], []) === 0);
check("cosine mismatched length == 0", cosineSimilarity([1, 2], [1, 2, 3]) === 0);

// 2. hash stability
check("hash stable", hashText("abc") === hashText("abc"));
check("hash differs", hashText("abc") !== hashText("abd"));

// 3. cache round-trip + model invalidation
const dir = mkdtempSync(join(tmpdir(), "embcache-"));
try {
    const file = join(dir, "scope.json");
    const c1 = new EmbeddingCache(file, "model-a");
    c1.set("k1", "h1", [0.1, 0.2, 0.3]);
    c1.save();

    const c2 = new EmbeddingCache(file, "model-a");
    check("cache hit after reload", JSON.stringify(c2.get("k1", "h1")) === JSON.stringify([0.1, 0.2, 0.3]));
    check("cache miss on wrong hash", c2.get("k1", "h2") === undefined);

    const c3 = new EmbeddingCache(file, "model-b");
    check("cache invalidated on model change", c3.get("k1", "h1") === undefined);
} finally {
    rmSync(dir, { recursive: true, force: true });
}

// 3b. config requires an explicit model — the core ships no vendor default
{
    const saved = {
        key: process.env.CAIRN_LLM_API_KEY,
        url: process.env.CAIRN_MEMORY_EMBEDDING_URL,
        model: process.env.CAIRN_MEMORY_EMBEDDING_MODEL,
        timeout: process.env.CAIRN_MEMORY_EMBEDDING_TIMEOUT_MS,
    };
    process.env.CAIRN_LLM_API_KEY = "smoke-key";
    process.env.CAIRN_MEMORY_EMBEDDING_URL = "http://127.0.0.1:9/v1";
    delete process.env.CAIRN_MEMORY_EMBEDDING_MODEL;
    check("config null without explicit model", getEmbeddingConfig() === null);
    process.env.CAIRN_MEMORY_EMBEDDING_MODEL = "smoke-model";
    check("config uses explicit model", getEmbeddingConfig()?.model === "smoke-model");
    check("config uses default timeout", getEmbeddingConfig()?.timeoutMs === 15000);
    process.env.CAIRN_MEMORY_EMBEDDING_TIMEOUT_MS = "2500";
    check("config uses explicit timeout", getEmbeddingConfig()?.timeoutMs === 2500);
    for (const [env, value] of [
        ["CAIRN_LLM_API_KEY", saved.key],
        ["CAIRN_MEMORY_EMBEDDING_URL", saved.url],
        ["CAIRN_MEMORY_EMBEDDING_MODEL", saved.model],
        ["CAIRN_MEMORY_EMBEDDING_TIMEOUT_MS", saved.timeout],
    ]) {
        if (value === undefined) delete process.env[env];
        else process.env[env] = value;
    }
}

// 3c. A stalled endpoint is aborted using the configured timeout.
{
    const stalled = createServer(() => {});
    await new Promise((resolve) => stalled.listen(0, "127.0.0.1", resolve));
    const address = stalled.address();
    try {
        let timedOut = false;
        try {
            await embedTexts({
                apiUrl: `http://127.0.0.1:${address.port}`,
                apiKey: "smoke-key",
                model: "smoke-model",
                timeoutMs: 50,
            }, ["timeout probe"]);
        } catch (error) {
            timedOut = error?.name === "TimeoutError";
        }
        check("configured timeout aborts stalled endpoint", timedOut);
    } finally {
        await new Promise((resolve) => stalled.close(resolve));
    }
}

// 4. live embeddings (only if configured)
const config = getEmbeddingConfig();
if (!config) {
    console.log("skip: live embeddings (CAIRN_LLM_API_KEY not set)");
} else {
    console.log(`live: model=${config.model}`);
    const [query, related, unrelated] = await embedTexts(config, [
        "How do we invalidate the cache after a write?",
        "Cache invalidation must happen before validation because replay depends on raw JSON.",
        "The office coffee machine is broken again.",
    ]);
    const simRelated = cosineSimilarity(query, related);
    const simUnrelated = cosineSimilarity(query, unrelated);
    console.log(`  related=${simRelated.toFixed(4)} unrelated=${simUnrelated.toFixed(4)} dims=${query.length}`);
    check("relevant ranks above unrelated", simRelated > simUnrelated);
}

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log("\nAll smoke checks passed");
