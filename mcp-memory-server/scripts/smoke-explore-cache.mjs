// Offline, no-network end-to-end proof of the context_explore cache (CTX-10):
// drives the `explore` CLI subcommand (node dist/index.js explore "<query>")
// against a logging-wrapper fake token_miser binary, so a cache hit can be
// proven by the binary's invocation counter staying flat, not just asserted
// from the payload. Mirrors verify-token-savings-ab.sh's wrapper-binary
// technique. Run: node scripts/smoke-explore-cache.mjs   (after `npm run build`)
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let failures = 0;
function check(name, cond) {
    console.log(`${cond ? "ok" : "FAIL"}: ${name}`);
    if (!cond) failures += 1;
}

const binary = resolve("scripts/fixtures/fake-tokenmiser-logging.sh");
chmodSync(binary, 0o755);

const xdgCacheHome = mkdtempSync(join(tmpdir(), "explore-cache-smoke-xdg-"));
const repoRoot = mkdtempSync(join(tmpdir(), "explore-cache-smoke-repo-"));
const hitLog = join(mkdtempSync(join(tmpdir(), "explore-cache-smoke-log-")), "hits.log");

function git(...args) {
    return execFileSync("git", ["-C", repoRoot, ...args], { encoding: "utf8" });
}
git("init", "-q");
git("config", "user.email", "smoke@example.com");
git("config", "user.name", "smoke");
writeFileSync(join(repoRoot, "a.txt"), "one\n");
git("add", "a.txt");
git("commit", "-q", "-m", "init");

function baseEnv() {
    return {
        ...process.env,
        XDG_CACHE_HOME: xdgCacheHome,
        CAIRN_EXPLORE_BINARY: binary,
        CAIRN_EXPLORE_REPO_ROOT: repoRoot,
        EXPLORE_HIT_LOG: hitLog,
    };
}

function runExplore(query, extraEnv = {}) {
    const stdout = execFileSync("node", ["dist/index.js", "explore", query], {
        encoding: "utf8",
        env: { ...baseEnv(), ...extraEnv },
    });
    return JSON.parse(stdout.trim());
}

function invocationCount() {
    try {
        return readFileSync(hitLog, "utf8").split("\n").filter(Boolean).length;
    } catch {
        return 0;
    }
}

// 1. First call: cache miss -> cached:false, one spawn.
const first = runExplore("find the foo function");
check("first call is ok:true", first.ok === true);
check("first call is cached:false (cache miss)", first.cached === false);
check("first call spawned the binary exactly once", invocationCount() === 1);

// 2. Second identical call: cache hit -> cached:true, binary NOT re-spawned.
const second = runExplore("find the foo function");
check("second identical call is cached:true", second.cached === true);
check("second identical call did NOT re-spawn the binary", invocationCount() === 1);
check(
    "cached result carries the same citations as the original spawn",
    JSON.stringify(second.citations) === JSON.stringify(first.citations),
);

// 3. Repo change (tracked-file edit) forces a fresh invocation.
writeFileSync(join(repoRoot, "a.txt"), "two\n");
const third = runExplore("find the foo function");
check("call after a tracked-file edit is cached:false", third.cached === false);
check("call after a tracked-file edit re-spawns the binary", invocationCount() === 2);

// 3b. A new untracked file also forces a fresh invocation (git diff HEAD alone
// would miss this -- D-10's whole point).
writeFileSync(join(repoRoot, "a.txt"), "one\n"); // back to original tracked content
writeFileSync(join(repoRoot, "untracked.txt"), "new\n");
const untrackedCall = runExplore("find the foo function");
check("call after a new untracked file is cached:false", untrackedCall.cached === false);
check("call after a new untracked file re-spawns the binary", invocationCount() === 3);

// 4. Kill-switch: CAIRN_EXPLORE_CACHE=0 always spawns, never reads/writes.
const killSwitchFirst = runExplore("find the foo function", { CAIRN_EXPLORE_CACHE: "0" });
check("kill-switch call is cached:false", killSwitchFirst.cached === false);
check("kill-switch call spawns the binary", invocationCount() === 4);
const killSwitchSecond = runExplore("find the foo function", { CAIRN_EXPLORE_CACHE: "0" });
check("kill-switch repeat call is still cached:false (bypasses cache)", killSwitchSecond.cached === false);
check("kill-switch repeat call spawns the binary again", invocationCount() === 5);

// 5. Persisted cache entry stores RAW evidence only (D-12) -- no memory_refs
// or wiki_refs (cross-refs don't exist yet, and must never be cached even
// once they land in a later plan).
const cacheDir = join(xdgCacheHome, "cairn", "explore");
mkdirSync(cacheDir, { recursive: true });
const cacheFiles = readdirSync(cacheDir).filter((f) => f.endsWith(".json"));
check("cache wrote at least one entry", cacheFiles.length > 0);
if (cacheFiles.length > 0) {
    const entry = JSON.parse(readFileSync(join(cacheDir, cacheFiles[0]), "utf8"));
    check("cache entry has an evidence field", entry.evidence !== undefined);
    check("cache entry has no memory_refs (raw evidence only, D-12)", entry.memory_refs === undefined);
    check("cache entry has no wiki_refs (raw evidence only, D-12)", entry.wiki_refs === undefined);
}

rmSync(xdgCacheHome, { recursive: true, force: true });
rmSync(repoRoot, { recursive: true, force: true });
rmSync(join(hitLog, ".."), { recursive: true, force: true });

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}
console.log("\nExplore cache checks passed");
