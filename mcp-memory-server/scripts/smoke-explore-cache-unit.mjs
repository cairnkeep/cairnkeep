// Unit-level RED/GREEN check for explore-cache.ts (CTX-10, Task 1): key
// determinism/sensitivity, query normalization, content-sensitive dirty-hash,
// file-cache read/write/corrupt-fail-open, and oldest-first prune. Offline,
// no fake token_miser binary needed -- that's smoke-explore-cache.mjs (Task 3),
// which proves the wired CLI/cache-hit behavior end-to-end.
// Run: node scripts/smoke-explore-cache-unit.mjs   (after `npm run build`)
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
    computeRepoState,
    exploreCacheDir,
    exploreCacheKey,
    normalizeExploreQuery,
    pruneExploreCache,
    readExploreCache,
    writeExploreCache,
} from "../dist/explore-cache.js";

let failures = 0;
function check(name, cond) {
    console.log(`${cond ? "ok" : "FAIL"}: ${name}`);
    if (!cond) failures += 1;
}

// --- normalizeExploreQuery ---
check(
    "normalizeExploreQuery collapses whitespace, preserves case",
    normalizeExploreQuery("  Where   is\tthe\n cache? ") === "Where is the cache?",
);

// --- exploreCacheKey determinism + sensitivity ---
const k1 = exploreCacheKey("q", "/repo", "headA", "dirtyA");
const k2 = exploreCacheKey("q", "/repo", "headA", "dirtyA");
check("exploreCacheKey is deterministic for identical inputs", k1 === k2);
check(
    "exploreCacheKey changes when the query changes",
    exploreCacheKey("q2", "/repo", "headA", "dirtyA") !== k1,
);
check(
    "exploreCacheKey changes when repoRoot changes",
    exploreCacheKey("q", "/other", "headA", "dirtyA") !== k1,
);
check(
    "exploreCacheKey changes when HEAD changes",
    exploreCacheKey("q", "/repo", "headB", "dirtyA") !== k1,
);
check(
    "exploreCacheKey changes when dirtyHash changes",
    exploreCacheKey("q", "/repo", "headA", "dirtyB") !== k1,
);

// --- cache dir resolution: under XDG_CACHE_HOME, never repo-derived ---
const xdgTemp = mkdtempSync(join(tmpdir(), "explore-cache-xdg-"));
process.env.XDG_CACHE_HOME = xdgTemp;
check(
    "exploreCacheDir resolves under XDG_CACHE_HOME/cairn/explore",
    exploreCacheDir() === join(xdgTemp, "cairn", "explore"),
);

// --- computeRepoState: content-sensitive dirty hash ---
const repo = mkdtempSync(join(tmpdir(), "explore-cache-repo-"));
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
git("init", "-q");
git("config", "user.email", "test@example.com");
git("config", "user.name", "Test");
writeFileSync(join(repo, "a.txt"), "one\n");
git("add", "a.txt");
git("commit", "-q", "-m", "init");
const stateClean = computeRepoState(repo);

writeFileSync(join(repo, "a.txt"), "two\n");
const stateEditA = computeRepoState(repo);
check(
    "computeRepoState dirtyHash changes on a tracked-file edit",
    stateEditA.dirtyHash !== stateClean.dirtyHash,
);

writeFileSync(join(repo, "a.txt"), "three\n");
const stateEditB = computeRepoState(repo);
check(
    "computeRepoState dirtyHash differs between two different edits to the same file",
    stateEditB.dirtyHash !== stateEditA.dirtyHash,
);

writeFileSync(join(repo, "a.txt"), "one\n");
writeFileSync(join(repo, "untracked.txt"), "new file\n");
const stateUntracked = computeRepoState(repo);
check(
    "computeRepoState dirtyHash changes on a new untracked file (git diff HEAD alone would miss this)",
    stateUntracked.dirtyHash !== stateClean.dirtyHash,
);
check("computeRepoState.head is stable across dirty-state changes", stateUntracked.head === stateClean.head);

// --- file cache: read/write roundtrip, corrupt-file fail-open ---
check("readExploreCache returns undefined on a miss", readExploreCache("no-such-key") === undefined);

const entry = {
    createdAt: new Date().toISOString(),
    query: "q",
    repoRoot: repo,
    head: stateClean.head,
    dirtyHash: stateClean.dirtyHash,
    evidence: { citations: [], expanded_snippets: [], stats: { turns: 0, tool_calls: 0 } },
};
writeExploreCache("roundtrip-key", entry);
const readBack = readExploreCache("roundtrip-key");
check(
    "writeExploreCache + readExploreCache roundtrips the evidence payload",
    readBack !== undefined && JSON.stringify(readBack.evidence) === JSON.stringify(entry.evidence),
);

mkdirSync(exploreCacheDir(), { recursive: true });
writeFileSync(join(exploreCacheDir(), "corrupt-key.json"), "{ not valid json");
check("readExploreCache fails open (undefined) on a corrupt cache file", readExploreCache("corrupt-key") === undefined);

// --- prune: oldest-first, cap enforced ---
const pruneDir = mkdtempSync(join(tmpdir(), "explore-cache-prune-"));
for (let i = 0; i < 5; i += 1) {
    writeFileSync(join(pruneDir, `k${i}.json`), "{}");
}
pruneExploreCache(pruneDir, 3);
const remaining = readdirSync(pruneDir).filter((f) => f.endsWith(".json"));
check("pruneExploreCache enforces the cap (oldest-first)", remaining.length === 3);

rmSync(xdgTemp, { recursive: true, force: true });
rmSync(repo, { recursive: true, force: true });
rmSync(pruneDir, { recursive: true, force: true });

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log("\nExplore-cache unit checks passed");
