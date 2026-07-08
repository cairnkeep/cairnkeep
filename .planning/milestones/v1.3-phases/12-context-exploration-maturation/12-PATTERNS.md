# Phase 12: Context Exploration Maturation - Pattern Map

**Mapped:** 2026-07-07
**Files analyzed:** 8 new/modified
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `mcp-memory-server/src/index.ts` (context_explore handler refactor + cross-ref + cache wiring) | service/controller (MCP tool handler) | request-response | `mcp-memory-server/src/index.ts:1000-1085` (current `context_explore` handler, being refactored in place) | exact |
| `mcp-memory-server/src/index.ts` (new `explore` CLI subcommand) | controller (CLI dispatch branch) | request-response | `mcp-memory-server/src/index.ts:1152-1211` (`wakeup`/`extract` CLI subcommands) | exact |
| `mcp-memory-server/src/index.ts` (`openScope`/`listEntries` `cwd` threading) | utility (data access) | CRUD | `mcp-memory-server/src/index.ts:135-236` (`resolveScopePath`, `openScope`, `listEntries` — same functions, extended) | exact |
| `mcp-memory-server/src/explore-cache.ts` (new) | utility/service (file cache) | file-I/O | `mcp-memory-server/src/embeddings.ts:37-39,113-158` (`hashText`, `EmbeddingCache`) | role-match |
| `claude/hooks/context-explore-pretask.sh` (new) | hook/controller | event-driven | `claude/hooks/memory-recall.sh` (full file) | exact |
| `scripts/sync-claude-assets.sh` (HOOK_EVENTS map entry) | config | event-driven | `scripts/sync-claude-assets.sh:98-102` (existing `HOOK_EVENTS` map) | exact |
| `mcp-memory-server/scripts/smoke-explore-cache.mjs` (new) | test | batch | `mcp-memory-server/scripts/smoke-explore-guard.mjs` (existing offline smoke pattern) | role-match |
| `mcp-memory-server/scripts/smoke-explore-crossref.mjs` (new) | test | batch | `mcp-memory-server/scripts/smoke-explore-guard.mjs` + `opencode/plugins/memory-recall.ts` (`isContained` fixture pattern) | role-match |
| `scripts/verify-explore-maturation.sh` (new) | test | batch | `scripts/verify-token-savings-ab.sh` (wrapper/logging-binary A/B technique) | role-match |
| `opencode/plugins/memory-recall.ts` (`isContained` reused, no new plugin) | utility | transform | itself — reuse in place, no new file (D-08 fallback) | n/a |
| `docs/operating.md` (Configuration table rows) | config/docs | n/a | existing Configuration table rows for `CAIRN_EXPLORE_BINARY` etc. | exact |

## Pattern Assignments

### `mcp-memory-server/src/index.ts` — `context_explore` handler refactor (service, request-response)

**Analog:** itself, `mcp-memory-server/src/index.ts:1000-1085` (current handler, to be extracted into a shared `runContextExplore()` function)

**Current shape to preserve/extract** (lines 1000-1085):
```typescript
server.registerTool(
    "context_explore",
    {
        description: "...",
        inputSchema: z.object({
            query: z.string().min(1),
            repo_root: z.string().min(1).optional(),
            timeout_seconds: z.number().int().min(10).max(600).optional(),
        }),
    },
    async ({ query, repo_root, timeout_seconds }) => {
        // --- Precondition tier: throw (config/environment problems) ---
        const binaryPath = process.env.CAIRN_EXPLORE_BINARY;
        if (!binaryPath) throw new Error("CAIRN_EXPLORE_BINARY is not set.");
        if (!existsSync(binaryPath)) throw new Error(`CAIRN_EXPLORE_BINARY does not exist: ${binaryPath}`);

        const rawRoot = repo_root ?? process.env.CAIRN_EXPLORE_REPO_ROOT;
        if (!rawRoot) throw new Error("No repo_root provided and CAIRN_EXPLORE_REPO_ROOT is not set.");
        const resolvedRoot = resolve(expandHome(rawRoot));
        if (!existsSync(resolvedRoot)) throw new Error(`repo_root does not exist: ${resolvedRoot}`);

        // --- Execution tier: return { ok: false, ... } (runtime problems) ---
        const result = await runCommand(
            binaryPath,
            ["explore", "--query", query, "--repo-root", resolvedRoot],
            (timeout_seconds ?? 120) * 1000,
            { ...process.env, NO_COLOR: "1" },
        );

        if (result.timedOut || result.exitCode !== 0) {
            const payload = { ok: false, error: "...", stderr: result.stderr, exitCode: result.exitCode, timedOut: result.timedOut };
            return { content: [{ type: "text", text: asToolText(payload) }], structuredContent: payload };
        }

        let evidence: { citations: Array<{path,start_line,end_line}>; expanded_snippets: unknown[]; stats: {...} };
        try {
            evidence = JSON.parse(result.stdout.trim());
        } catch {
            const payload = { ok: false, error: "malformed Evidence JSON", stderr: result.stderr, exitCode: result.exitCode };
            return { content: [{ type: "text", text: asToolText(payload) }], structuredContent: payload };
        }

        // --- Success shaping ---
        const payload = { ok: true, ...evidence };
        return {
            content: [{ type: "text", text: renderCitations(evidence) }],
            structuredContent: payload,
        };
    },
);
```

**What changes (per RESEARCH.md Pattern 1 / D-01 / D-09):**
- Extract the body (precondition tier unchanged; execution tier gets a cache check wrapped around `runCommand`) into `async function runContextExplore({ query, repoRoot, timeoutSeconds })`.
- Insert cache lookup (D-09) immediately before the `runCommand` call: compute key, check `explore-cache.ts`, skip `runCommand` on hit, `evidence = cached.evidence`.
- After the `JSON.parse` succeeds (cache hit or miss), run cross-ref enrichment (D-01) before building `payload`/`renderCitations` output.
- The `server.registerTool("context_explore", ...)` callback and the new CLI `explore` branch both call `runContextExplore`.
- Precondition tier (throw) and the two `ok:false` execution-tier returns stay exactly as-is — do not touch.

---

### `mcp-memory-server/src/index.ts` — new `explore` CLI subcommand (controller, request-response)

**Analog:** `mcp-memory-server/src/index.ts:1152-1211` (`wakeup`/`extract`)

**Wakeup pattern to mirror (lines 1152-1188):**
```typescript
const cliCommand = process.argv[2];
if (cliCommand === "wakeup") {
    try {
        // ... best-effort logic, process.stdout.write(...) ...
    } catch {
        // Best-effort wakeup: never fail a session start over memory retrieval.
    }
    process.exit(0);
}
```

**Extract pattern to mirror for error propagation (lines 1190-1211):**
```typescript
if (cliCommand === "extract") {
    try {
        // ... build result ...
        output.write(`${JSON.stringify({ ... }, null, 2)}\n`);
        process.exit(0);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exit(1);
    }
}
```

**New `explore` branch shape (per RESEARCH.md Code Examples):**
```typescript
if (cliCommand === "explore") {
    try {
        const query = process.argv[3];
        const repoRoot = process.env.CAIRN_EXPLORE_REPO_ROOT
            ?? (await gitToplevel(process.cwd()));
        const result = await runContextExplore({ query, repoRoot, timeoutSeconds: 20 });
        process.stdout.write(JSON.stringify(result) + "\n");
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(1);
    }
    process.exit(0);
}
```
Place this new branch alongside `wakeup`/`extract`, before the `httpPort` line (index.ts:1213).

---

### `mcp-memory-server/src/index.ts` — `cwd` threading for cross-ref memory reads (utility, CRUD)

**Analog:** itself — `resolveScopePath` (lines 135-163), `openScope` (181-193), `listEntries` (215-236)

**Current signatures (cwd already on resolveScopePath, missing on the other two):**
```typescript
function resolveScopePath(scope: string, cwd: string = process.cwd()): string { /* already threads cwd */ }

async function openScope(scope: string, create: boolean): Promise<AgentFS | null> {
    const dbPath = resolveScopePath(scope); // <- missing cwd passthrough
    if (!create && !existsSync(dbPath)) return null;
    if (create) ensureParentDir(dbPath);
    return AgentFS.open({ id: scope, path: dbPath });
}

async function listEntries(
    scope: string,
    prefix: string = "",
    options: { includeHistory?: boolean } = {},
): Promise<MemoryEntry[]> {
    const agent = await openScope(scope, false);
    if (!agent) return [];
    try {
        const entries = await agent.kv.list(prefix);
        return visibleEntries(entries.map(({ key, value }) => ({ scope, key, value: normalizeValue(value) })), options.includeHistory ?? false);
    } finally {
        await agent.close();
    }
}
```

**Required change (small, load-bearing — RESEARCH.md Pitfall 2):** add an optional `cwd?: string` to `openScope`'s signature and to `listEntries`'s `options`, threading it into the `resolveScopePath(scope, cwd)` call. Cross-ref code then calls:
```typescript
const projectEntries = await listEntries("project", "", { cwd: resolvedRepoRoot });
```
Never call `listEntries` for cross-refs without `cwd` — it silently reads the server's own cwd otherwise.

---

### `mcp-memory-server/src/explore-cache.ts` (new file: service/utility, file-I/O)

**Analog:** `mcp-memory-server/src/embeddings.ts:37-39` (`hashText`) and `:113-158` (`EmbeddingCache`)

**Hash pattern to reuse (lines 37-39):**
```typescript
export function hashText(text: string): string {
    return createHash("sha1").update(text).digest("hex");
}
```

**Cache class shape to adapt (lines 113-158) — adapt to one-file-per-key, not single blob:**
```typescript
export class EmbeddingCache {
    private readonly path: string;
    private readonly model: string;
    private data: CacheFile;
    private dirty = false;

    constructor(path: string, model: string) {
        this.path = path;
        this.model = model;
        this.data = { model, entries: {} };
        if (existsSync(path)) {
            try {
                const parsed = JSON.parse(readFileSync(path, "utf8")) as CacheFile;
                if (parsed.model === model && parsed.entries) this.data = parsed;
            } catch {
                this.data = { model, entries: {} }; // corrupt/stale — start fresh
            }
        }
    }
    get(key, contentHash) { /* returns undefined on model/hash mismatch */ }
    set(key, contentHash, vector) { this.dirty = true; }
    save() {
        if (!this.dirty) return;
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, JSON.stringify(this.data));
        this.dirty = false;
    }
}
```

**Imports pattern** (`embeddings.ts:2`):
```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
```

**New file-cache shape (per RESEARCH.md Architecture Pattern 3 — one file per key, not a single blob):**
```typescript
import { readdirSync, statSync, unlinkSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function cacheDir(): string {
    const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
    return join(base, "cairn", "explore");
}

function pruneCache(dir: string, cap = 200): void {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    if (files.length <= cap) return;
    const withMtime = files.map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }));
    withMtime.sort((a, b) => a.mtime - b.mtime);
    for (const { f } of withMtime.slice(0, withMtime.length - cap)) unlinkSync(join(dir, f));
}
```
Cache entry payload per D-09/D-12: `{ createdAt, query, repoRoot, head, dirtyHash, evidence }` — **raw evidence only, never the cross-ref-enriched payload** (Pitfall 3).

**Error handling:** wrap read/parse in try/catch exactly like `EmbeddingCache`'s constructor — corrupt/missing cache file = cache miss, never throws up to the tool handler (fail-open, consistent with D-04's enrichment fail-open).

---

### `claude/hooks/context-explore-pretask.sh` (new: hook/controller, event-driven)

**Analog:** `claude/hooks/memory-recall.sh` (full file, read above)

**Structure to mirror line-for-line:**
```bash
#!/usr/bin/env bash
set -euo pipefail

# Fail-open guard: bail before doing any work if preconditions aren't met.
repo="$(pwd)"
[ -n "${CAIRN_EXPLORE_BINARY:-}" ] || exit 0
[ "${CAIRN_EXPLORE_AUTOINVOKE:-0}" = "1" ] || exit 0

INFRA_ROOT="@@INFRA_ROOT@@"
SERVER_ENTRY="$INFRA_ROOT/mcp-memory-server/dist/index.js"

input="$(cat)"
prompt="$(printf '%s' "$input" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print(d.get("prompt") or "")
except Exception: print("")' 2>/dev/null || true)"
[ -n "$prompt" ] || exit 0

# High-signal gate (mirrors memory-recall.sh's stem-length guard, D-07 discretion):
# ponytail: first-pass heuristic, not rigorously derived — tighten if noisy.
[ "${#prompt}" -ge 10 ] || exit 0
[[ "$prompt" != /* ]] || exit 0
if [[ "$prompt" =~ ^(ok|yes|no|thanks?)\.?$ ]]; then exit 0; fi

result="$(CAIRN_EXPLORE_BINARY="$CAIRN_EXPLORE_BINARY" timeout 20 node "$SERVER_ENTRY" explore "$prompt" 2>/dev/null || true)"
[ -n "$result" ] || exit 0

# Inject only on ok:true with non-empty citations (D-07) — mirror memory-recall.sh's
# "inject only when there is something specific" discipline + additionalContext JSON shape.
python3 -c 'import sys,json
try:
    r = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)
if not r.get("ok") or not r.get("citations"):
    sys.exit(0)
ctx = "\n".join(f"- {c[\"path\"]}:{c[\"start_line\"]}-{c[\"end_line\"]}" for c in r["citations"][:20])
print(json.dumps({
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Auto-invoked context exploration for this prompt:\n\n" + ctx
  }
}))
' "$result" 2>/dev/null || true
exit 0
```

**Fail-open discipline (from `memory-recall.sh`'s header comment):** "Fail-open: any error exits 0." — every `python3`/`node` call above uses `|| true` and the script never uses `set -e` in a way that would abort on a benign miss; final `exit 0` is unconditional.

---

### `scripts/sync-claude-assets.sh` — HOOK_EVENTS map entry (config, event-driven)

**Analog:** `scripts/sync-claude-assets.sh:98-102`

**Current map:**
```bash
declare -A HOOK_EVENTS=(
  ["memory-wakeup.sh"]="SessionStart"
  ["memory-capture.sh"]="SessionEnd"
  ["memory-recall.sh"]="PreToolUse:Edit|Write|MultiEdit"
)
```

**Change:** add one line, no other mechanism needed (UserPromptSubmit ignores matchers, bare event with no colon is already handled by existing registration code):
```bash
  ["context-explore-pretask.sh"]="UserPromptSubmit"
```
Per RESEARCH.md Open Question 1, also register an explicit `"timeout": 25`-class field if the registration logic supports a per-hook timeout key (check the loop after line 102 for where `event_spec` is applied to `settings.json`).

---

### `mcp-memory-server/scripts/smoke-explore-cache.mjs` / `smoke-explore-crossref.mjs` (test, batch)

**Analog:** `mcp-memory-server/scripts/smoke-explore-guard.mjs` (existing offline smoke test — plain Node, no framework, asserts against a fake/no binary)

**Pattern:** plain `node` script, no jest/mocha; use `assert` from `node:assert`; seed fixtures (fake `.agentfs/project.db`, `.planning/wiki/sources/*.md`, and for cache tests a wrapper/logging binary that increments a counter file) exactly as `verify-token-savings-ab.sh` does for its binary-not-invoked proof. Wire into `mcp-memory-server/package.json`'s `test:smoke` chain (mirrors how `check:explore-guard`/`check:route-guard` were previously added).

---

### `scripts/verify-explore-maturation.sh` (test, batch)

**Analog:** `scripts/verify-token-savings-ab.sh` (wrapper/logging-binary A/B technique)

**Pattern:** re-runnable bash script proving, per CONTEXT.md's discretion note: (1) cross-ref flag on a seeded match, (2) `cached:true` + binary-not-invoked on repeat, (3) fresh invocation on repo change, (4) hook injects/stays-silent on scripted stdin JSON. Mirror `verify-token-savings-ab.sh`'s self-test + live-stage structure and its wrapper-binary logging trick for proving non-invocation.

---

## Shared Patterns

### Fail-open (hooks and enrichment)
**Source:** `claude/hooks/memory-recall.sh` (header comment + `exit 0` discipline), `opencode/plugins/memory-recall.ts` (`try/catch` around all fs/AgentFS access)
**Apply to:** `context-explore-pretask.sh`, cross-ref enrichment code in `index.ts`, cache read/write in `explore-cache.ts`. Any error in these paths must degrade silently (hook: `exit 0` with no injection; enrichment: return the result without cross-refs; cache: treat as a miss), never throw up into the precondition/execution tiers of the tool itself.

### Path containment for wiki reads
**Source:** `opencode/plugins/memory-recall.ts:41-44`
```typescript
function isContained(baseDir: string, candidate: string): boolean {
  const rel = path.relative(baseDir, candidate);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}
```
**Apply to:** any wiki-source file read in cross-ref matching — confine to `repo_root/.planning/wiki/sources/`. Note the wiki directory itself is only ever listed via a fixed `readdirSync`, citation paths are used only to derive a search token (stem), never concatenated into a read path.

### Subprocess invocation (argv array, never shell string)
**Source:** `mcp-memory-server/src/index.ts:406-451` (`runCommand`, unchanged)
**Apply to:** the new `explore` CLI subcommand's invocation of `runContextExplore`, and the hook's `node ... explore "$prompt"` call — the query string must never be interpolated into a shell command string; `runCommand`'s existing argv-array `spawn` pattern already guarantees this server-side.

### CLI subcommand dispatch
**Source:** `mcp-memory-server/src/index.ts:1152-1211` (`wakeup`, `extract`)
**Apply to:** new `explore` branch — same `if (cliCommand === "...")` chain, same `process.exit(0)`/`process.exit(1)` discipline, same best-effort/never-hang-the-caller framing.

### Content hashing for non-security dedup keys
**Source:** `mcp-memory-server/src/embeddings.ts:37-39` (`hashText`, sha1)
**Apply to:** cache key computation in `explore-cache.ts` (query + repoRoot + HEAD + dirty-state hash) — reuse `hashText` or an identical sha1 call; do not add a slower/salted hash, this is a dedup key not a security boundary.

## No Analog Found

None — every file in scope has a role/data-flow analog already in the repo (see RESEARCH.md's "Don't Hand-Roll" table: memory-recall.sh, embeddings.ts, wakeup CLI dispatch, and the OpenCode plugin's containment check between them cover all six categories of new work).

## Metadata

**Analog search scope:** `mcp-memory-server/src/`, `mcp-memory-server/scripts/`, `claude/hooks/`, `opencode/plugins/`, `scripts/` (sync-claude-assets.sh, verify-*.sh)
**Files scanned:** `index.ts`, `embeddings.ts`, `memory-recall.sh`, `memory-wakeup.sh`, `opencode/plugins/memory-recall.ts`, `sync-claude-assets.sh`, `verify-token-savings-ab.sh`, `verify-docs-parity.sh`, `smoke-explore-guard.mjs`
**Pattern extraction date:** 2026-07-07
