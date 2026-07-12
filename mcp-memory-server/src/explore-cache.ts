import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// File-based cache for context_explore (CTX-10). Keyed on (normalized query,
// resolved repo_root, git HEAD, content-sensitive dirty-state hash) so an
// unchanged repo reuses a prior result and any repo change forces a fresh
// token_miser invocation. Never a security boundary (RESEARCH Security V6) --
// sha1 is a dedup key here, matching the existing hashText idiom in
// embeddings.ts, not a cryptographic guarantee.

export type ExploreEvidence = {
    citations: Array<{ path: string; start_line: number; end_line: number }>;
    expanded_snippets: unknown[];
    stats: { turns: number; tool_calls: number };
};

export type ExploreCacheEntry = {
    createdAt: string;
    query: string;
    repoRoot: string;
    head: string;
    dirtyHash: string;
    evidence: ExploreEvidence;
};

export type RepoState = { head: string; dirtyHash: string };

const PRUNE_CAP = 200;
const MAX_BUFFER = 64 * 1024 * 1024;

// D-11: cache dir lives OUTSIDE any explored repo -- never build it from
// repoRoot.
export function exploreCacheDir(): string {
    const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
    return join(base, "cairn", "explore");
}

// Trim + collapse internal whitespace runs to a single space; case preserved.
// Two prompts differing only in whitespace produce the same cache key.
export function normalizeExploreQuery(query: string): string {
    return query.trim().replace(/\s+/g, " ");
}

export function exploreCacheKey(
    normalizedQuery: string,
    resolvedRepoRoot: string,
    head: string,
    dirtyHash: string,
): string {
    return createHash("sha1")
        .update(`${normalizedQuery}\0${resolvedRepoRoot}\0${head}\0${dirtyHash}`)
        .digest("hex");
}

// D-10/Pattern 4: dirty-state hash basis is CONTENT, not just a file list --
// `git diff HEAD` (staged+unstaged tracked edits) plus each untracked path's
// size+mtime (git diff never touches untracked files, so two different
// untracked contents at the same path must still hash differently).
// execFileSync with argv arrays only (V5) -- never a shell string, and never
// runCommand, whose 12000-char truncateOutput cap would silently erode
// content-sensitivity for a large diff (D-10 is load-bearing, not stylistic).
export function computeRepoState(repoRoot: string): RepoState {
    // stdio ignores the child's stderr so a non-git repoRoot (or any git
    // failure) doesn't leak "fatal: not a git repository" noise onto the
    // server's own stderr -- callers already fail this open to a cache miss.
    const gitOpts: { encoding: "utf8"; maxBuffer: number; stdio: ["ignore", "pipe", "ignore"] } = {
        encoding: "utf8",
        maxBuffer: MAX_BUFFER,
        stdio: ["ignore", "pipe", "ignore"],
    };

    const head = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], gitOpts).trim();

    const diff = execFileSync("git", ["-C", repoRoot, "diff", "HEAD"], gitOpts);

    const untrackedRaw = execFileSync(
        "git",
        ["-C", repoRoot, "ls-files", "--others", "--exclude-standard", "-z"],
        gitOpts,
    );
    const untrackedPaths = untrackedRaw.split("\0").filter(Boolean).sort();
    const untrackedStatLines = untrackedPaths.map((path) => {
        const stat = statSync(join(repoRoot, path));
        return `${path}:${stat.size}:${stat.mtimeMs}`;
    });

    const dirtyHash = createHash("sha1")
        .update(`${diff}\0${untrackedStatLines.join("\n")}`)
        .digest("hex");

    return { head, dirtyHash };
}

// Fail-open: a missing dir/file or corrupt/unparseable JSON is always a miss,
// never a throw (mirrors EmbeddingCache's constructor try/catch shape).
export function readExploreCache(key: string): ExploreCacheEntry | undefined {
    try {
        const path = join(exploreCacheDir(), `${key}.json`);
        if (!existsSync(path)) {
            return undefined;
        }
        return JSON.parse(readFileSync(path, "utf8")) as ExploreCacheEntry;
    } catch {
        return undefined;
    }
}

// One JSON file per key; entry carries RAW evidence only (D-12) -- cross-refs
// are never part of the cached payload.
export function writeExploreCache(key: string, entry: ExploreCacheEntry): void {
    try {
        const dir = exploreCacheDir();
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${key}.json`), JSON.stringify(entry));
        pruneExploreCache(dir);
    } catch {
        // Best-effort cache write -- a write failure must never break exploration.
    }
}

// Oldest-first prune by mtime once the directory exceeds the cap
// (RESEARCH Security V12 DoS mitigation).
export function pruneExploreCache(dir: string = exploreCacheDir(), cap: number = PRUNE_CAP): void {
    try {
        const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
        if (files.length <= cap) {
            return;
        }
        const withMtime = files.map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }));
        withMtime.sort((a, b) => a.mtime - b.mtime);
        for (const { f } of withMtime.slice(0, withMtime.length - cap)) {
            unlinkSync(join(dir, f));
        }
    } catch {
        // Prune is best-effort housekeeping -- never fail a cache write over it.
    }
}
