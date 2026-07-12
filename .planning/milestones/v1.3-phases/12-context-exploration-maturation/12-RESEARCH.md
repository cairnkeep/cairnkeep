# Phase 12: Context Exploration Maturation - Research

**Researched:** 2026-07-07
**Domain:** MCP tool enrichment (in-process), Claude Code hooks, file-based caching, git dirty-state hashing
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

The user selected all four gray areas and delegated the design decisions
("discuss all the points and decide autonomously what's best"). All decisions
below are Claude's calls, grounded in the LOCKED constraints and the proven
Phase 4/7/10 patterns. The planner has latitude on naming and exact thresholds
but MUST preserve: thin-delegate boundary, env-only opt-in config, fail-open
enrichment/hooks, fail-closed tool tiers, and verify-by-execution proofs.

**Cross-reference mechanics (CTX-08):** D-01 enrichment runs inside the
`context_explore` handler in `mcp-memory-server/src/index.ts`, in-process only,
after the Evidence JSON parse and before output shaping — token-miser stays
untouched. D-02 deterministic stem matching mirroring `memory-recall.sh`: for
each unique cited path, derive the basename stem (skip stems < 4 chars); memory
match = case-insensitive substring hit against the explored repo's
project-scope memory entries; wiki match = stem hit over
`<repo_root>/.planning/wiki/sources/*.md` page names/content. No embeddings for
path matching. Semantic memory_search on the original query is deferred, not
in this phase. D-03 flags render per-citation, silent when empty: optional
`memory_refs`/`wiki_refs` in `structuredContent`; rendered text appends a
compact marker or cross-refs block; citations with no hits get NO annotation —
a zero-hit result renders identically to today's output. D-04 fail-open
enrichment against the explored repo: cross-refs computed against the
`repo_root` passed to the tool (its `.agentfs` db and `.planning/wiki/sources`),
not the server's cwd; missing db/wiki dir or any enrichment error returns the
result without cross-refs, never fails or degrades the exploration result.

**Pre-task hook (CTX-09):** D-05 Claude Code `UserPromptSubmit` hook is the
verified path — new bash hook `claude/hooks/context-explore-pretask.sh`,
registered via the existing filename→event map in
`scripts/sync-claude-assets.sh`. D-06 the hook invokes a new server CLI
subcommand (e.g. `node dist/index.js explore "<query>"`) alongside the
existing `wakeup`/`extract` modes, sharing the same code path as the MCP tool
handler so cache and cross-refs apply identically to hook and tool
invocations. D-07 double opt-in + high-signal gating: inert unless
`CAIRN_EXPLORE_BINARY` is configured AND explicit `CAIRN_EXPLORE_AUTOINVOKE=1`
is set; skip low-signal prompts (shorter than a minimum length, slash
commands, obvious non-task replies — exact heuristics = planner discretion);
inject only when result is `ok:true` with non-empty citations; always
fail-open (`exit 0`). D-08 OpenCode parity is conditional, not required —
CTX-09's success criterion is satisfied by the Claude Code path; if OpenCode's
plugin API lacks a clean prompt-submit event, defer with a documented note.

**Cache design (CTX-10):** D-09 cache lives in the `context_explore` handler,
checked before spawning token_miser, storing the raw parsed Evidence JSON —
cairnkeep-side invocation management, token-miser stays unmodified. D-10
content-sensitive key: hash over (normalized query, resolved repo_root,
`git rev-parse HEAD`, dirty-state hash); the dirty hash must reflect content,
not just file lists — two different edits to the same file must produce
different keys; basis = `git diff HEAD` output plus untracked-files listing
with size/mtime (exact incantation = planner discretion). D-11 file-based
cache outside the explored repo: JSON entries under
`${XDG_CACHE_HOME:-~/.cache}/cairn/explore/` — never write into the explored
repo; simple oldest-first prune at write time (cap ~200 entries); default ON
once shipped, `CAIRN_EXPLORE_CACHE=0` as the kill-switch. D-12 cache stores
raw evidence only; cross-refs recompute every return (memory/wiki evolve
independently of repo HEAD); payload carries `cached: true|false`.

**Auto-invoke latency & output budget:** D-13 synchronous with a bounded
timeout — the pre-task hook runs explore blocking, with a timeout comfortably
inside Claude Code's hook timeout budget; on timeout or any failure it injects
nothing; async/background cache warming is deferred. D-14 inject compact
citations + cross-ref flags only, never `expanded_snippets`; cap the injected
block (line/byte cap in the spirit of the recall hook's `head -40`); the
injected text identifies itself as auto-invoked exploration context.

### Claude's Discretion

Exact rendering of cross-ref markers, hook skip-heuristics, cache entry
format/prune cap, dirty-hash incantation, CLI subcommand name, and verify
script naming/structure — preserve the invariants above. Verification
approach (recorded as intent): a re-runnable `scripts/verify-*.sh` proving
(1) a seeded memory/wiki entry produces a cross-ref flag on a matching
citation, (2) a second identical run returns `cached:true` without invoking
the binary (wrapper/logging binary trick per the A/B script), (3) a repo
change triggers a fresh invocation, (4) the hook injects on a scripted
UserPromptSubmit JSON and stays silent when gated off.

### Deferred Ideas (OUT OF SCOPE)

- Semantic cross-referencing on the original query (embedding-backed
  memory_search of the query text, not just path stems) — deterministic stem
  matching ships first; revisit if stem matching proves too coarse.
- Async/background cache warming (hook returns immediately, explore populates
  the cache for the next prompt) — deliberately not now (D-13); revisit if
  blocking latency annoys in practice.
- OpenCode auto-invoke parity — conditional in-phase (D-08); if the plugin
  API lacks a clean prompt-submit event, it becomes a documented known gap
  alongside the existing #5894 limitation.
- Cache-aware `/context-explore` command UX (e.g. a `--fresh` flag surfaced in
  the command docs) — the env kill-switch covers v1.3; add per-call
  ergonomics only if requested.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CTX-08 | `context_explore` cross-references its citations against memory (`memory_search`) and the wiki, surfacing which cited ranges have related memory/wiki context | Architecture Pattern 2 (cwd-threading for memory reads), Pitfall 2 (false-negative risk), Pitfall 4 (empty-hit output-contract regression risk), Don't Hand-Roll (`isContained()` reuse), Security Domain V12 |
| CTX-09 | A pre-task hook can auto-invoke `context_explore` for a task's query, so exploration runs without a manual `/context-explore` call | Architecture Pattern 1 (shared handler fn), Code Examples (hook registration map extension), Pitfall 1 (hook timeout budget), Environment Availability (`UserPromptSubmit` confirmed; OpenCode gap confirmed), Open Question 1/2 |
| CTX-10 | `context_explore` caches results keyed on (query, repo HEAD + dirty-state), reusing them on a cache hit and invalidating when the repo changes | Architecture Pattern 3 (file-cache design), Architecture Pattern 4 (dirty-hash basis), Pitfall 3 (cache raw-evidence-only, not enriched payload), Validation Architecture (cache hit/miss/invalidation smoke test), Security Domain V12 (prune/DoS) |
</phase_requirements>

## Summary

Phase 12 adds three cairnkeep-side features to the existing `context_explore` MCP
tool (`mcp-memory-server/src/index.ts:1000-1085`) without touching token-miser:
cross-referencing citations against memory/wiki (CTX-08), a pre-task auto-invoke
hook (CTX-09), and a content-sensitive cache (CTX-10). All three decisions are
already locked in `12-CONTEXT.md` — this research verifies the mechanics are
buildable against the actual code and harness APIs, and surfaces the concrete
pitfalls the plan must guard against.

The codebase already has every building block needed: `resolveScopePath`/
`listEntries` (memory reads, need a `cwd` passthrough), `hashText` (sha1, in
`embeddings.ts`, reusable for cache keys), `EmbeddingCache` (precedent for a
JSON file-cache class), `runCommand` (subprocess delegate pattern), the CLI
`wakeup`/`extract` subcommand dispatch at the bottom of `index.ts`, and
`memory-recall.sh` (stem-matching + fail-open hook template, mirrored almost
line-for-line by CTX-08's cross-ref matcher and CTX-09's hook). Verified via
Claude Code's own docs: `UserPromptSubmit` is a real hook event, fires on
every prompt with no matcher support, and carries the prompt text in a
`prompt` field on stdin — confirming D-05/D-09 is buildable exactly as
decided. Its default per-hook timeout (30s for `prompt`-class hooks per
Claude Code docs) is **shorter** than `context_explore`'s own default
120s timeout — this is the single most important pitfall for CTX-09: the
hook's internal call must use a much shorter timeout than the MCP tool's
default, or a cache-miss query will be killed by Claude Code itself before
it can fail open gracefully.

For CTX-09's OpenCode parity check (D-08): verified via the official OpenCode
plugin docs and open GitHub issues (#17637, #27401) that
`experimental.chat.system.transform` — the only chat-adjacent hook — does
**not** currently expose the user's message text as input (this is an open
feature request, not yet shipped). No OpenCode plugin event fires on
prompt-submission with message text available before the LLM call. This
confirms D-08's fallback path: document a known gap, do not attempt a parity
plugin this phase.

**Primary recommendation:** Refactor `context_explore`'s handler body into a
shared async function (cache check → `runCommand` → cross-ref enrichment)
callable from both the MCP tool registration and a new `explore` CLI
subcommand; wire the hook and cache through that one path so CTX-08/09/10
compose correctly by construction rather than by convention.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Citation cross-referencing (CTX-08) | API/Backend (MCP server, in-process) | — | Enrichment is output shaping inside the existing tool handler; no new service boundary |
| Pre-task auto-invoke (CTX-09) | Client harness (Claude Code hook, bash) | API/Backend (CLI subcommand it calls) | The hook is a client-side lifecycle trigger; all logic it invokes lives server-side in the same handler as the MCP tool |
| Result cache (CTX-10) | API/Backend (MCP server process, filesystem) | — | Cache lives in the server's invocation path (before `runCommand`), keyed by git state computed server-side; never delegated to token-miser |
| OpenCode parity (conditional) | Client harness (OpenCode plugin), if buildable | — | Same tier as Claude's hook — client-side event handler; deferred if no clean event exists (confirmed: none does) |

## Standard Stack

No new external dependencies for this phase — every capability is buildable
with Node.js stdlib (`node:crypto`, `node:fs`, `node:child_process` — all
already imported in `index.ts`) plus code already in the repo.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:crypto` (`createHash`) | builtin (Node 22, per `@types/node ^22.15.21`) | Cache key hash + dirty-state hash | Already used for `hashText` in `embeddings.ts:37-39` (sha1); no new dependency, no new hash primitive to justify |
| `node:child_process` (`spawn`, via existing `runCommand`) | builtin | `git rev-parse HEAD`, `git diff HEAD`, `git ls-files --others` for dirty-state | `runCommand` already exists and is argv-array based (no shell injection) — reuse verbatim, do not add a git library |
| `node:fs` | builtin | Cache file read/write/prune under `~/.cache/cairn/explore/` | Matches `EmbeddingCache`'s existing file-cache pattern (`embeddings.ts:113-158`) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `AgentFS` (`agentfs-sdk` ^0.6.4, already a dependency) | existing | Read the explored repo's `project` scope for memory cross-refs | Only when `<repo_root>/.agentfs/project.db` exists (D-04 fail-open) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled sha over `git diff` output | `git stash create` / tree-hash tricks | More "correct" but heavier (creates real git objects) and not necessary — a content hash over `diff` + untracked listing is simpler, sufficient, and matches D-10's own specified basis |
| One-file-per-key cache directory | Single JSON blob (`EmbeddingCache`'s pattern) | D-11 explicitly calls for "JSON entries under .../explore/" (plural) with oldest-first prune at write time — a single blob would need in-memory prune-by-age tracking for no benefit; one-file-per-key makes `mtime`-based oldest-first pruning trivial (`readdir` + stat) |

**Installation:** None — no `npm install` needed for this phase.

**Version verification:** N/A (no new packages). Confirmed via `mcp-memory-server/package.json`: `@modelcontextprotocol/sdk ^1.29.0`, `agentfs-sdk ^0.6.4`, `zod ^3.25.76`, Node types `^22.15.21`, TypeScript `^5.8.3` — all already installed, no bump required for this phase's code.

## Package Legitimacy Audit

**Not applicable.** This phase installs zero new external packages (npm,
PyPI, or otherwise) — every capability is stdlib + existing in-repo code. No
`package-legitimacy check` run was needed.

## Architecture Patterns

### System Architecture Diagram

```
Claude Code                                    cairn-memory MCP server (index.ts)
────────────                                   ───────────────────────────────────
UserPromptSubmit fires                          
  │ (stdin JSON: {prompt, cwd, session_id, ...})
  ▼
context-explore-pretask.sh (new hook)
  │ gated: CAIRN_EXPLORE_BINARY set AND
  │        CAIRN_EXPLORE_AUTOINVOKE=1
  │ skip: low-signal prompt (too short / slash cmd)
  ▼
  node dist/index.js explore "<prompt>"  ───────►  cliCommand === "explore" (new)
  (short internal timeout, e.g. 15-20s)              │
                                                      ▼
                                              runContextExplore({query, repoRoot, timeoutSeconds})
                                              (shared fn — also called by the
                                               registered MCP tool handler)
                                                      │
                                     ┌────────────────┼─────────────────────┐
                                     ▼                ▼                     ▼
                          1. computeCacheKey    2. cache lookup       3. cache miss →
                             (query, repoRoot,     (~/.cache/cairn/       runCommand(token_miser
                             HEAD, dirtyHash)       explore/<key>.json)   explore ...) [unchanged]
                                     │                │  hit                     │
                                     │                ▼                          ▼
                                     │         evidence = cached.evidence   evidence = parsed stdout
                                     │         cached: true                 cache.write(key, evidence)
                                     │                                      cached: false
                                     └──────────────────┬───────────────────┘
                                                          ▼
                                              4. cross-ref enrichment (always, D-12)
                                                 - per citation: stem(path) < 4 chars? skip
                                                 - memory match: listEntries("project", cwd=repoRoot)
                                                   substring hit on stem
                                                 - wiki match: repoRoot/.planning/wiki/sources/*.md
                                                   substring hit on stem
                                                 - fail-open: missing db/wiki dir → no cross-refs,
                                                   never fail the result itself (D-04)
                                                          │
                                                          ▼
                                              5. payload shaping
                                                 { ok, citations[+memory_refs/wiki_refs],
                                                   stats, cached }
                                     ┌────────────────────┴────────────────────┐
                                     ▼                                          ▼
                          MCP tool response                          CLI stdout (compact text,
                          (content[].text = renderCitations           capped per D-14) — hook
                           + cross-ref markers;                       reads this and emits
                           structuredContent = payload)               hookSpecificOutput JSON
                                                                       only if ok && citations.length>0
```

### Recommended Project Structure
```
mcp-memory-server/src/
├── index.ts                    # + runContextExplore() extraction, explore-cache.ts import,
│                                #   cross-ref enrichment, `explore` CLI subcommand
├── explore-cache.ts             # NEW — cache key computation + file-cache get/put/prune
│                                #   (mirrors embeddings.ts's EmbeddingCache shape)
└── embeddings.ts                # unchanged; hashText reused (or duplicated locally — see Pitfall 3)

mcp-memory-server/scripts/
├── smoke-explore-guard.mjs      # existing — must stay green
├── smoke-explore-cache.mjs      # NEW — cache hit/miss/invalidation smoke (offline, fake binary)
└── smoke-explore-crossref.mjs   # NEW — cross-ref matching smoke (seeded .agentfs + wiki fixtures)

claude/hooks/
└── context-explore-pretask.sh   # NEW — UserPromptSubmit hook

scripts/
├── sync-claude-assets.sh        # + HOOK_EVENTS["context-explore-pretask.sh"]="UserPromptSubmit"
└── verify-explore-maturation.sh # NEW — end-to-end proof: cross-ref flag, cache hit
                                  #   (binary-not-invoked proof), cache invalidation on repo
                                  #   change, hook injects/stays-silent

opencode/plugins/
└── (no new file — D-08 fallback: document gap, no parity plugin this phase)

docs/operating.md                # + CAIRN_EXPLORE_AUTOINVOKE, CAIRN_EXPLORE_CACHE rows
                                  # + auto-invoke/cache/cross-ref behavior prose
```

### Pattern 1: Shared handler function for MCP tool + CLI subcommand
**What:** Extract `context_explore`'s current handler body (precondition checks,
`runCommand` call, JSON parse, response shaping) into a standalone
`async function runContextExplore(args): Promise<{ok, citations, ...}>` that
both the `server.registerTool("context_explore", ...)` callback and the new
`if (cliCommand === "explore")` CLI branch call.
**When to use:** Any time a capability must be reachable both from an MCP tool
call and from a bare `node dist/index.js <subcommand>` invocation (the
established pattern — see `wakeup`/`extract` below).
**Example:**
```typescript
// Source: mcp-memory-server/src/index.ts:1152-1188 (wakeup CLI pattern, existing)
const cliCommand = process.argv[2];
if (cliCommand === "wakeup") {
    try {
        const src = resolveScopePath("project");
        // ... reads AgentFS, prints compact index, process.exit(0)
    } catch {
        // Best-effort: never fail a session start over memory retrieval.
    }
    process.exit(0);
}
// NEW: mirror this shape for `explore`
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

### Pattern 2: In-process memory read against an arbitrary repo_root (not server cwd)
**What:** `resolveScopePath(scope, cwd)` already accepts a `cwd` parameter
(defaults to `process.cwd()`) — but `openScope`/`listEntries` do not thread it
through today. CTX-08's D-04 requires cross-refs to read the **explored**
repo's `.agentfs/project.db`, not the server process's own cwd.
**When to use:** Cross-ref memory matching (D-02/D-04).
**Example:**
```typescript
// Source: mcp-memory-server/src/index.ts:135-163, 181-236 (existing, needs a cwd threading change)
// CURRENT signatures (must be extended, not replaced):
function resolveScopePath(scope: string, cwd: string = process.cwd()): string { /* ... already takes cwd ... */ }
async function openScope(scope: string, create: boolean): Promise<AgentFS | null> {
    const dbPath = resolveScopePath(scope); // <- missing cwd passthrough today
    // ...
}
// NEEDED: openScope(scope, create, cwd?) and listEntries(scope, prefix, options & { cwd?: string })
// so cross-ref code can call:
const projectEntries = await listEntries("project", "", { cwd: resolvedRepoRoot });
```
**Why this matters:** Without threading `cwd`, cross-ref reads would
silently hit the MCP server process's own working directory's memory (wrong
repo, or none), producing false negatives that look like "no cross-refs
found" rather than a bug. This is a load-bearing, small (few-line) change the
plan must call out explicitly — not a hand-wave.

### Pattern 3: File-based cache with oldest-first prune (mirrors `EmbeddingCache`)
**What:** One JSON file per cache key under
`${XDG_CACHE_HOME:-~/.cache}/cairn/explore/<sha>.json`, containing
`{ createdAt, query, repoRoot, head, dirtyHash, evidence }`. On write, if the
directory has more than ~200 entries, delete the oldest (by file `mtime`)
beyond the cap.
**When to use:** CTX-10 cache implementation.
**Example:**
```typescript
// Source: mcp-memory-server/src/embeddings.ts:113-158 (EmbeddingCache — single-blob
// precedent to adapt, not reuse directly; D-11 wants one-file-per-key so oldest-first
// prune is a directory scan, not an in-memory age tracker)
import { readdirSync, statSync, unlinkSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

function cacheDir(): string {
    const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
    return join(base, "cairn", "explore");
}

function pruneCache(dir: string, cap = 200): void {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    if (files.length <= cap) return;
    const withMtime = files.map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }));
    withMtime.sort((a, b) => a.mtime - b.mtime);
    for (const { f } of withMtime.slice(0, withMtime.length - cap)) {
        unlinkSync(join(dir, f));
    }
}
```

### Pattern 4: Dirty-state hash basis (D-10's specified incantation)
**What:** `git diff HEAD` (catches staged + unstaged edits to tracked files)
concatenated with a sorted `path size mtime` listing of untracked files
(`git ls-files --others --exclude-standard` for the path list, `stat` for
size/mtime), then sha over the concatenation.
**When to use:** Cache key computation (CTX-10).
**Example:**
```bash
# Verified commands (git 2.x, standard on any dev machine with this repo):
git -C "$REPO_ROOT" rev-parse HEAD                                  # HEAD sha
git -C "$REPO_ROOT" diff HEAD                                       # tracked edits (staged+unstaged)
git -C "$REPO_ROOT" ls-files --others --exclude-standard            # untracked file paths
```
Each untracked path's `size:mtime` (via `stat -c '%s %Y'` or Node's `statSync`)
must be appended per-path so two different untracked-file contents at the
same path produce different hashes even if `git diff` shows nothing for them
(git diff HEAD never touches untracked files).

### Anti-Patterns to Avoid
- **Hashing only `git status --porcelain`:** loses actual content — two
  different edits to the same tracked file both show `M path`; the hash must
  be over `git diff HEAD`'s content, not the status summary (D-10 explicit
  requirement).
- **Reusing the MCP tool's 120s default timeout for the auto-invoke hook:**
  Claude Code's own hook-level timeout for prompt-class hooks is shorter (see
  Pitfall 1) — the hook's internal call must use its own short timeout, not
  inherit the tool's default.
- **Writing cache files inside the explored repo:** `repo_root` may be any
  repo the tool is pointed at (D-11 explicit) — never write under
  `repo_root/.cache` or similar; always the XDG cache dir outside any repo.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cache key hashing | A custom hash mixing function | `node:crypto` `createHash("sha1"/"sha256").update(...).digest("hex")` (already imported pattern via `hashText` in `embeddings.ts`) | Node stdlib crypto is correct, fast, and already the established idiom in this file |
| Semantic memory matching for cross-refs | A new embedding-backed lookup for CTX-08 | Deterministic substring/stem matching only (D-02, explicit) | Semantic cross-ref on the original query is explicitly deferred (see CONTEXT.md Deferred Ideas) — building it now is scope creep the user already declined |
| Prompt-submit event for OpenCode | A polling/synthetic event workaround | Document as a known gap (matches the existing #5894 pattern already in this repo's docs) | Confirmed via official docs + open GitHub issues (#17637, #27401) that no clean event exists; a workaround would be fragile and contradict D-08's "conditional, not required" framing |
| Path containment for wiki grep | A fresh traversal-guard | The existing `isContained()` pattern from `opencode/plugins/memory-recall.ts:41-44` (relative()-based, not resolve()-based) | Already reviewed and hardened in this repo (Phase 2 SEC-0001 pattern per its own comment) — reuse the idiom, don't reinvent |

**Key insight:** Every piece of this phase already has a sibling
implementation in the repo (memory-recall.sh's stem matching, embeddings.ts's
file cache, wakeup's CLI-subcommand dispatch, the OpenCode plugin's path
containment). The work is composition and threading (`cwd` parameter,
shared handler extraction), not invention.

## Common Pitfalls

### Pitfall 1: Hook-level timeout kills the process before it can fail open
**What goes wrong:** `context_explore`'s own default timeout is 120s
(`timeout_seconds` param, `120 * 1000` default at `index.ts:1038`). Claude
Code's documented default timeout for prompt-class hooks (`UserPromptSubmit`)
is 30s. If the auto-invoke hook shells out with anything close to the tool's
120s default, Claude Code kills the hook process at 30s (or whatever the
registered `timeout` is) — the hook never gets to emit its fail-open JSON,
and the failure mode becomes indistinguishable from a hang rather than a
clean "inject nothing."
**Why it happens:** The hook's internal `explore` CLI call and the MCP tool's
own default timeout are easy to conflate since they share the same
underlying `runContextExplore` function.
**How to avoid:** Pass an explicit, short `timeoutSeconds` (e.g. 15-20s) from
the hook's CLI invocation — never rely on the function's own default. Also
explicitly set a `"timeout"` field on the hook's `settings.json` registration
entry (verified field exists per Claude Code hook config docs) so the budget
is documented, not assumed.
**Warning signs:** Hook injects context on some prompts but never on the
first (cold-cache) query against a real repo; hook logs show no output at
all rather than a clean skip.

### Pitfall 2: `cwd` not threaded through memory reads → false-negative cross-refs
**What goes wrong:** `listEntries`/`openScope` resolve scope paths against
`process.cwd()` today (the MCP server process's own directory), not the
`repo_root` the tool was called with. If cross-ref code calls
`listEntries("project")` without extending these functions to accept a
`cwd`/`repoRoot` override, it silently reads the wrong (or no) database.
**Why it happens:** `resolveScopePath` already has the parameter but the two
callers built on top of it (`openScope`, `listEntries`) don't expose it yet —
easy to miss since the code compiles and runs fine, it just reads from the
wrong place.
**How to avoid:** Extend `openScope`/`listEntries` signatures with an
optional `cwd` and pass `resolvedRoot` explicitly from the cross-ref path;
add a smoke test that seeds a **non-cwd** repo's `.agentfs/project.db` and
asserts the cross-ref hits it, not the server's own cwd.
**Warning signs:** Cross-refs never fire in the smoke test unless the test
happens to run from the seeded repo's directory.

### Pitfall 3: Cache staleness masked by cross-refs recomputing (by design) — don't conflate the two
**What goes wrong:** D-12 requires cross-refs to recompute on every return
(cache hit or miss), because memory/wiki evolve independently of repo HEAD.
A naive implementation might cache the *fully enriched* payload (including
cross-refs) instead of just the raw Evidence JSON — this would serve stale
cross-ref flags from a memory-write that happened after the cache entry was
created, even though the repo itself hasn't changed.
**Why it happens:** It's simpler to cache "the whole response" than to
split cache-then-enrich into two explicit stages.
**How to avoid:** Cache only `{ evidence, cached: true }`'s evidence payload
(pre-enrichment); always run cross-ref matching fresh after either the cache
hit or the cache miss, immediately before shaping the final response.
**Warning signs:** A verify script that writes a new memory fact between two
identical `context_explore` calls and expects the second call's cross-refs
to reflect it — if this fails, cross-refs were cached, not recomputed.

### Pitfall 4: Empty-citations output contract must stay byte-identical when there are zero cross-ref hits
**What goes wrong:** D-03 requires "a result with zero cross-ref hits
renders identically to today's output." The existing `verify-token-savings-ab.sh`
A/B harness (Phase 9) reproduces `renderCitations()`'s exact output shape
byte-for-byte as its own regression gate (`render_citation_text()` at
`scripts/verify-token-savings-ab.sh:227-236`). If cross-ref rendering
prepends/appends anything even when there are zero hits, this existing
verify script — which is a milestone gate precedent, not throwaway — would
start failing on its shape-match assertions.
**Why it happens:** It's tempting to add a boilerplate "cross-refs: none"
line for consistency; D-03 explicitly forbids this.
**How to avoid:** Only append the cross-ref marker/block when at least one
citation has a hit; zero-hit citations get zero additional text, and a
zero-total-hits result must produce output `===` to the current
`renderCitations()` output.
**Warning signs:** `verify-token-savings-ab.sh --self-test`'s
`self_test_render()` check (or a re-run of `--native`/`--explore` against
this repo) starts reporting a byte-count regression after this phase ships.

### Pitfall 5: `verify-docs-parity.sh` will fail if new env keys aren't documented in the same phase
**What goes wrong:** `scripts/verify-docs-parity.sh`'s `check_env_keys()`
greps every `CAIRN_[A-Z_]+` token in `mcp-memory-server/src/*.ts` and fails
the build if any such token isn't named in `docs/operating.md` or
`README.md`. Adding `CAIRN_EXPLORE_AUTOINVOKE` and `CAIRN_EXPLORE_CACHE` to
the TypeScript source without a docs update in the same phase breaks this
existing gate.
**Why it happens:** The new env keys are read by the **hook** (bash) primarily,
but if the server-side code also reads `CAIRN_EXPLORE_CACHE` (kill-switch,
D-11) inside `index.ts`, that alone triggers the grep — it doesn't matter
that the primary consumer is a shell script.
**How to avoid:** Add both new keys to the Configuration table in
`docs/operating.md` in the same plan/wave that introduces them in code; run
`scripts/verify-docs-parity.sh` as part of this phase's verification.
**Warning signs:** CI or a manual `verify-docs-parity.sh` run reports
`FATAL: env keys read in mcp-memory-server/src but undocumented`.

## Code Examples

### Reading the current `context_explore` handler shape (extraction target)
```typescript
// Source: mcp-memory-server/src/index.ts:1000-1085 (current, to be refactored)
server.registerTool(
    "context_explore",
    { /* description, inputSchema unchanged */ },
    async ({ query, repo_root, timeout_seconds }) => {
        // precondition tier (throw) — binary path, repo_root resolution — UNCHANGED
        // execution tier (return ok:false) — runCommand + JSON parse — UNCHANGED
        // NEW: cache check wraps the runCommand call (D-09)
        // NEW: cross-ref enrichment after JSON parse, before response shaping (D-01)
    },
);
```

### Existing CLI subcommand dispatch pattern to extend
```typescript
// Source: mcp-memory-server/src/index.ts:1152-1211 (wakeup/extract — the pattern `explore` joins)
const cliCommand = process.argv[2];
if (cliCommand === "wakeup") { /* ... */ }
if (cliCommand === "extract") { /* ... */ }
// NEW: if (cliCommand === "explore") { ... }
```

### Hook registration map to extend (no new registration mechanism needed)
```bash
# Source: scripts/sync-claude-assets.sh:98-102 (existing HOOK_EVENTS map)
declare -A HOOK_EVENTS=(
  ["memory-wakeup.sh"]="SessionStart"
  ["memory-capture.sh"]="SessionEnd"
  ["memory-recall.sh"]="PreToolUse:Edit|Write|MultiEdit"
  # NEW:
  # ["context-explore-pretask.sh"]="UserPromptSubmit"
  #   (no matcher suffix — UserPromptSubmit ignores matchers per Claude Code docs,
  #    and the existing registration code already treats a bare event with no
  #    colon as "no matcher", so no script changes needed beyond this one line)
)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Manual-only `/context-explore <query>` | Manual command + optional auto-invoke hook (CTX-09) | This phase | The manual command is NOT replaced (per CONTEXT.md Deferred Ideas) — both paths remain, sharing the same cache/cross-ref logic |
| `context_explore` re-runs token-miser on every identical query | Cache-backed by (query, HEAD, dirty-state) | This phase | Repeat queries against an unchanged repo become near-instant and free of token-miser cost |

**Deprecated/outdated:** None — this phase is additive to a tool shipped in
Phase 7 of this same milestone track (v1.2); nothing is being replaced.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Claude Code's default timeout for `UserPromptSubmit`-class hooks is ~30s unless a `timeout` field overrides it in `settings.json` | Common Pitfalls #1, Code Examples | If the actual default differs (e.g. it inherits the general 600s command default instead of a lowered prompt-class default), the "must use a short internal timeout" pitfall becomes lower-risk — but setting an explicit short timeout is safe regardless, so this assumption does not change the recommended action, only its urgency framing |
| A2 | `git diff HEAD` plus untracked-file `size:mtime` listing is sufficiently collision-resistant for a cache key in practice (two genuinely different edits producing the same combined hash is treated as effectively impossible, not formally proven) | Architecture Patterns #4 | Astronomically unlikely (sha collision) — no practical risk, noted only because "content-sensitive" was asserted, not exhaustively proven against adversarial input (not a threat model this cache needs to resist, since it's a local, single-user file cache, not a security boundary) |

**If this table is empty:** N/A — see entries above; neither materially
changes the recommended implementation, both are noted for completeness per
the verification protocol.

## Open Questions

1. **Exact `timeout` value to register on the hook in `settings.json`**
   - What we know: Claude Code supports an explicit per-hook `timeout` field
     (seconds); prompt-class hooks default lower than the general 600s
     command default per available docs.
   - What's unclear: The precise numeric default varies across cited
     secondary sources (30s appears in official docs fetch; some community
     guides describe a different generic default). Since the plan will set
     an explicit `timeout` regardless (per Pitfall 1's mitigation), this
     ambiguity doesn't block implementation.
   - Recommendation: Register the hook with an explicit `"timeout": 25`
     (or similar) in `sync-claude-assets.sh`'s registration logic, and set
     the CLI's own internal `runContextExplore` timeout to something safely
     shorter (e.g. 20s) so the CLI process always exits cleanly first.

2. **Exact skip-heuristics for "low-signal prompts" in the hook (D-07)**
   - What we know: CONTEXT.md defers exact thresholds to planner discretion
     (length minimum, slash-command detection, "obvious non-task replies").
   - What's unclear: No numeric length threshold or slash-command regex is
     prescribed anywhere in this repo's existing hooks (memory-recall.sh's
     analogous guard is a 4-char *stem* length, not a prompt length).
   - Recommendation: A simple, documented heuristic is sufficient: skip if
     prompt length < ~10 chars, or prompt starts with `/` (slash command),
     or prompt is a bare acknowledgement (e.g. matches `^(ok|yes|no|thanks?)\.?$`
     case-insensitively). Mark the exact list a `ponytail:`-style inline
     comment noting it's a first-pass heuristic, not a rigorously derived one.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `git` | Dirty-state hashing (CTX-10), repo-root resolution | Present (repo is git-managed; `git rev-parse HEAD` succeeded during this research) | 2.x (system git) | None needed — git is already a hard dependency of every other phase in this repo |
| `node` / `npm` | Server build, CLI subcommand, smoke scripts | Present (existing `mcp-memory-server` builds/tests today) | Node types pinned `^22.15.21` | None needed |
| Claude Code `settings.json` hook support (`UserPromptSubmit` event) | CTX-09 | Confirmed present on this machine's live `~/.claude/settings.json` (an unrelated `UserPromptSubmit` hook is already registered there) and in official docs | — | None — this is the primary, required path (D-05) |
| OpenCode plugin event for prompt-submission | CTX-09 parity (D-08, conditional) | **Not available** — confirmed via official docs + open feature-request issues (#17637, #27401) that no OpenCode hook exposes message text pre-LLM-call | n/a | Document as a known gap in `docs/operating.md`, alongside the existing #5894 limitation; do not build a parity plugin this phase |

**Missing dependencies with no fallback:** None — the one "missing"
dependency (OpenCode prompt-submit event) has an explicit, already-decided
fallback (document the gap, per D-08).

**Missing dependencies with fallback:**
- OpenCode auto-invoke parity — documented gap, Claude Code path is the
  required/sufficient path per CONTEXT.md D-08.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None (offline smoke scripts run via plain `node`, per existing `mcp-memory-server/package.json` `test:smoke` script) — no jest/vitest/mocha in this repo |
| Config file | none — see Wave 0 below |
| Quick run command | `cd mcp-memory-server && npm run build && node scripts/smoke-explore-cache.mjs && node scripts/smoke-explore-crossref.mjs` |
| Full suite command | `cd mcp-memory-server && npm run test:smoke` (existing, must include the two new smoke scripts once added to `package.json`'s `test:smoke` chain) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CTX-08 | A citation whose path stem matches a seeded memory key/wiki page gets a `memory_refs`/`wiki_refs` annotation; a citation with no match gets none; zero-hit result renders byte-identical to pre-phase output | smoke (offline, fake `token_miser` binary + seeded `.agentfs`/wiki fixtures) | `node scripts/smoke-explore-crossref.mjs` | ❌ Wave 0 |
| CTX-09 | A scripted `UserPromptSubmit` JSON on stdin, piped through `context-explore-pretask.sh`, injects `hookSpecificOutput.additionalContext` when gated-on + citations found, stays silent when gated-off/low-signal/no-citations | smoke/integration (bash, offline w/ fake binary) | `bash scripts/verify-explore-maturation.sh --hook` (new script, or a dedicated section of it) | ❌ Wave 0 |
| CTX-10 | Two identical calls against an unchanged repo: second returns `cached:true` and the binary is provably not re-invoked (wrapper/logging-binary technique, per `verify-token-savings-ab.sh` precedent); a repo change (new commit or dirty edit) between calls forces `cached:false` | smoke (offline, wrapper binary that logs invocation count) | `node scripts/smoke-explore-cache.mjs` and/or `bash scripts/verify-explore-maturation.sh --cache` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the relevant new smoke script only (`node scripts/smoke-explore-cache.mjs` or `smoke-explore-crossref.mjs`), plus `npm run build` (fast, offline).
- **Per wave merge:** `cd mcp-memory-server && npm run test:smoke` (full existing offline smoke chain, now including the two new scripts) plus `scripts/verify-docs-parity.sh` and `scripts/sync-claude-assets.sh --check`.
- **Phase gate:** All of the above green, plus a run of the new
  `scripts/verify-explore-maturation.sh` (the CONTEXT.md-specified
  re-runnable proof script covering all three success criteria) before
  `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `mcp-memory-server/scripts/smoke-explore-cache.mjs` — covers CTX-10 (cache hit/miss/invalidation, offline, fake/wrapper binary)
- [ ] `mcp-memory-server/scripts/smoke-explore-crossref.mjs` — covers CTX-08 (cross-ref matching against seeded fixtures)
- [ ] `scripts/verify-explore-maturation.sh` — covers the composed end-to-end proof across CTX-08/09/10 named in CONTEXT.md's "Claude's Discretion" verification-intent note; mirrors `scripts/verify-token-savings-ab.sh`'s self-test/live-stage structure
- [ ] `mcp-memory-server/package.json`'s `test:smoke` chain — must be extended to include the two new `check:*` scripts (mirrors how `check:explore-guard`/`check:route-guard` were added in prior phases)
- [ ] Fixture binaries for cache tests — a "logging wrapper" fake `token_miser` (increments a counter file on each invocation) analogous to the technique `verify-token-savings-ab.sh` documents for A/B proofs, needed to prove "binary was NOT invoked" on a cache hit

*(No framework install needed — this repo's convention is plain-Node smoke scripts, not pytest/jest; adding one now would be inconsistent with the established pattern and is explicitly not required.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | This phase touches no auth surface (stdio MCP tool + local hook, no new HTTP endpoint) |
| V3 Session Management | No | No session concept introduced |
| V4 Access Control | No | No new privilege boundary |
| V5 Input Validation | Yes | The `query` string (from the hook's `prompt` field, potentially attacker-influenced if the user pastes untrusted text) must continue to flow to `token_miser` via `spawn(binary, [...args])` (argv array), never via a shell string — this is already the existing pattern (`runCommand` at `index.ts:406-451`) and must not regress when the `explore` CLI subcommand is added |
| V6 Cryptography | Partial | Cache-key hashing (sha1/sha256 via `node:crypto`) is a non-security use (deduplication key, not a security boundary) — no cryptographic guarantee is being claimed or required here, so a fast hash (sha1, matching `hashText`'s existing choice) is appropriate; do not add a slower/salted hash unnecessarily |
| V12 Files and Resources | Yes | (a) Cache files must never be written inside the explored `repo_root` (D-11, already decided) — write only under `${XDG_CACHE_HOME:-~/.cache}/cairn/explore/`; (b) wiki-source reads for cross-ref matching must stay confined to `repo_root/.planning/wiki/sources/` via the existing `isContained()` relative-path-based containment idiom (`opencode/plugins/memory-recall.ts:41-44`), never a bare `resolve()`/`join()` check; (c) unbounded cache growth is mitigated by the specified ~200-entry oldest-first prune (D-11) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via a crafted citation path or wiki filename used to build a read path outside `.planning/wiki/sources/` | Tampering / Information Disclosure | Reuse the existing `isContained()` relative()-based check; citation paths from `token_miser` are only ever used to derive a *search token* (the stem), never concatenated directly into a filesystem read path for wiki matching — the wiki directory listing itself (`readdirSync` of a fixed dir) is the only read surface |
| Unbounded cache growth (disk exhaustion) from a high-volume auto-invoke hook | Denial of Service | The ~200-entry oldest-first prune at write time (D-11), plus the double opt-in gate (D-07) limiting how often the hook fires at all |
| Hook process outliving Claude Code's kill signal and leaking a runaway `token_miser` subprocess | Denial of Service | `runCommand`'s existing `SIGTERM` timeout-kill (`index.ts:423-426`) already bounds subprocess lifetime; the hook's own shorter timeout (Pitfall 1) is an additional, tighter bound on top |

## Sources

### Primary (HIGH confidence)
- `mcp-memory-server/src/index.ts` (read directly, lines 1-470, 700-1331) — all cited line numbers verified against the actual file, not training-data recall
- `mcp-memory-server/src/embeddings.ts` (read directly, full file) — `hashText`, `EmbeddingCache` verified as-is
- `claude/hooks/memory-recall.sh`, `claude/hooks/memory-wakeup.sh` (read directly) — hook template verified
- `opencode/plugins/memory-recall.ts` (read directly) — `isContained()` pattern, OpenCode limitation comment verified
- `scripts/sync-claude-assets.sh`, `scripts/verify-token-savings-ab.sh`, `scripts/verify-docs-parity.sh` (read directly) — registration mechanism and existing verify-script conventions verified
- `docs/operating.md` (read directly) — existing Configuration table / docs-parity contract verified
- `mcp-memory-server/scripts/smoke-explore-guard.mjs` (read directly) — existing smoke-test pattern verified
- Local `~/.claude/settings.json` (read directly, this machine) — confirms `UserPromptSubmit` is a real, already-registered hook event with `matcher: ".*"` in practice

### Secondary (MEDIUM confidence)
- `code.claude.com/docs/en/hooks` (WebFetch) — `UserPromptSubmit` stdin/stdout JSON schema, exit-code semantics, per-hook `timeout` field
- `opencode.ai/docs/plugins/` (WebFetch) — full OpenCode plugin event list, confirming no prompt-submit-with-message-text event exists
- GitHub issues anomalyco/opencode#17637, #27401 (WebSearch results) — open feature requests confirming `experimental.chat.system.transform` does not yet expose user message text as input

### Tertiary (LOW confidence)
- Community blog posts on Claude Code hook timeout defaults (WebSearch) — used only to cross-check the officially-fetched 30s figure; treated as corroborating, not authoritative (see Assumptions Log A1)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new packages; every primitive verified directly in the existing source
- Architecture: HIGH - extraction/threading patterns verified against actual function signatures in `index.ts`
- Pitfalls: HIGH - each pitfall is grounded in a specific, cited existing file/line or an officially-fetched doc, not speculation
- Hook timeout exact default: MEDIUM - officially fetched but corroborated only loosely by secondary sources (see A1)

**Research date:** 2026-07-07
**Valid until:** 30 days (stable, low-churn domain — internal codebase + a documented, versioned harness API)
