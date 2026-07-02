// Smoke test for the embeddings module. Verifies cosine math, cache round-trip,
// and (when CAIRN_LLM_API_KEY is set) a live embeddings call that ranks a
// relevant sentence above an unrelated one.
//
// Run: node scripts/smoke-embeddings.mjs   (after `npm run build`)
import { mkdtempSync, rmSync } from "node:fs";
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
    };
    process.env.CAIRN_LLM_API_KEY = "smoke-key";
    process.env.CAIRN_MEMORY_EMBEDDING_URL = "http://127.0.0.1:9/v1";
    delete process.env.CAIRN_MEMORY_EMBEDDING_MODEL;
    check("config null without explicit model", getEmbeddingConfig() === null);
    process.env.CAIRN_MEMORY_EMBEDDING_MODEL = "smoke-model";
    check("config uses explicit model", getEmbeddingConfig()?.model === "smoke-model");
    for (const [env, value] of [
        ["CAIRN_LLM_API_KEY", saved.key],
        ["CAIRN_MEMORY_EMBEDDING_URL", saved.url],
        ["CAIRN_MEMORY_EMBEDDING_MODEL", saved.model],
    ]) {
        if (value === undefined) delete process.env[env];
        else process.env[env] = value;
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
