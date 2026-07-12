---
phase: 12-context-exploration-maturation
plan: 01
subsystem: api
tags: [context_explore, token_miser, mcp-tool, node, cache, git, cli]

requires:
  - phase: 07-context-exploration
    provides: the context_explore MCP tool (thin subprocess delegate to token_miser)
provides:
  - runContextExplore() shared handler fn (D-06) callable from the MCP tool and a new `explore` CLI subcommand
  - content-sensitive file cache (query + repo_root + HEAD + dirty-state) with a CAIRN_EXPLORE_CACHE=0 kill-switch
  - offline smoke proof of cache hit/miss/invalidation/kill-switch via a logging-wrapper fixture binary
affects: [12-02-PLAN, 12-03-PLAN]

tech-stack:
  added: []
  patterns:
    - "Shared handler extraction (runContextExplore) so an MCP tool and a bare CLI subcommand share one code path"
    - "One-file-per-key JSON cache under XDG_CACHE_HOME with oldest-first prune at write time"
    - "execFileSync (argv arrays, stdio stderr ignored) for git reads, bypassing runCommand's 12000-char truncation"

key-files:
  created:
    - mcp-memory-server/src/explore-cache.ts
    - mcp-memory-server/scripts/smoke-explore-cache-unit.mjs
    - mcp-memory-server/scripts/smoke-explore-cache.mjs
    - mcp-memory-server/scripts/fixtures/fake-tokenmiser-logging.sh
  modified:
    - mcp-memory-server/src/index.ts
    - mcp-memory-server/package.json
    - docs/operating.md

key-decisions:
  - "Cache probe (key/read) wraps the spawn and fails open to an uncached spawn on any git/hash error (D-09/D-12) -- never throws into the execution tier"
  - "repo_root resolution stays caller-specific (tool: param+env / CLI: env+gitToplevel); runContextExplore receives an already-resolved absolute path and owns the shared CAIRN_EXPLORE_BINARY + repo_root-exists precondition checks"
  - "git child-process stderr is ignored (stdio) in computeRepoState/gitToplevel so a fail-open cache-probe failure never leaks 'fatal: not a git repository' noise onto the server's own stderr"

requirements-completed: [CTX-10]

coverage:
  - id: D1
    description: "explore-cache.ts: content-sensitive cache key (query+repoRoot+HEAD+dirty-hash), file get/put, oldest-first prune, all failure modes fail open to a miss"
    requirement: "CTX-10"
    verification:
      - kind: unit
        ref: "mcp-memory-server/scripts/smoke-explore-cache-unit.mjs"
        status: pass
    human_judgment: false
  - id: D2
    description: "runContextExplore() shared handler + explore CLI subcommand; cache wired before the token_miser spawn with a cached boolean in the payload; CAIRN_EXPLORE_CACHE=0 kill-switch; existing precondition/execution-tier behavior unchanged"
    requirement: "CTX-10"
    verification:
      - kind: integration
        ref: "mcp-memory-server/scripts/smoke-explore-guard.mjs (existing 10 checks, unchanged pass)"
        status: pass
    human_judgment: false
  - id: D3
    description: "End-to-end cache hit/miss/invalidation/kill-switch proof via a logging-wrapper fake token_miser binary, wired into test:smoke; CAIRN_EXPLORE_CACHE documented, verify-docs-parity.sh green"
    requirement: "CTX-10"
    verification:
      - kind: integration
        ref: "mcp-memory-server/scripts/smoke-explore-cache.mjs (18 checks, all pass)"
        status: pass
      - kind: other
        ref: "bash scripts/verify-docs-parity.sh"
        status: pass
    human_judgment: false

duration: 16min
completed: 2026-07-07
status: complete
---

# Phase 12 Plan 01: Context Explore Cache + Shared Handler Summary

**Content-sensitive file cache (query+repo HEAD+dirty-state) for `context_explore`, wired through a new shared `runContextExplore()` handler that both the MCP tool and a new `explore` CLI subcommand call.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-07-07T14:00:13Z
- **Completed:** 2026-07-07T14:16:13Z
- **Tasks:** 3
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments

- `explore-cache.ts`: sha1 cache key over (normalized query, repo_root, git HEAD, content-sensitive dirty-hash), one-JSON-file-per-key store under `${XDG_CACHE_HOME:-~/.cache}/cairn/explore/`, oldest-first prune at ~200 entries, every failure mode fails open to a miss.
- `runContextExplore()`: the `context_explore` handler body extracted into a shared async function; both the registered MCP tool and a new `node dist/index.js explore "<query>"` CLI subcommand call it, so cache behavior is identical from either path (D-06).
- Cache wired immediately before the `token_miser` spawn: a hit skips the spawn and returns `cached:true`; a miss spawns as before, then writes the raw evidence (never cross-refs) to cache; `CAIRN_EXPLORE_CACHE=0` bypasses both read and write.
- Offline end-to-end proof (`smoke-explore-cache.mjs` + a logging-wrapper fixture binary): cache miss then hit with the binary's invocation counter staying flat, invalidation on a tracked-file edit AND on a new untracked file, kill-switch bypass, and a persisted cache entry with only an `evidence` field (no `memory_refs`/`wiki_refs`).
- `docs/operating.md` documents `CAIRN_EXPLORE_CACHE` and the cache's behavior; `verify-docs-parity.sh` stays green.

## Task Commits

Each task was committed atomically (Task 1 followed the TDD RED→GREEN cycle per its `tdd="true"` flag):

1. **Task 1 (RED): failing unit checks for explore-cache module** - `5472264` (test)
2. **Task 1 (GREEN): implement explore-cache.ts** - `ac2cccb` (feat)
3. **Task 2: extract runContextExplore(), wire cache, add explore CLI** - `309ddae` (feat)
4. **Task 3: cache smoke test + logging fixture + package.json + docs row** - `7939031` (test)

_TDD Gate Compliance: `test(...)` (5472264) precedes `feat(...)` (ac2cccb) for Task 1 -- RED then GREEN, gate sequence satisfied._

## Files Created/Modified

- `mcp-memory-server/src/explore-cache.ts` - cache key/dirty-hash computation, file get/put/prune
- `mcp-memory-server/src/index.ts` - `runContextExplore()` extraction, cache wiring, `explore` CLI subcommand, `gitToplevel()` helper
- `mcp-memory-server/scripts/smoke-explore-cache-unit.mjs` - unit-level RED/GREEN checks for explore-cache.ts's exported primitives
- `mcp-memory-server/scripts/smoke-explore-cache.mjs` - end-to-end cache hit/miss/invalidation/kill-switch proof via the CLI
- `mcp-memory-server/scripts/fixtures/fake-tokenmiser-logging.sh` - counter-logging fake token_miser binary
- `mcp-memory-server/package.json` - wires `check:explore-cache` into the `test:smoke` chain
- `docs/operating.md` - `CAIRN_EXPLORE_CACHE` config row + cache behavior prose

## Decisions Made

- Cache-probe computation (repo state + key) is isolated behind a single try/catch that returns `undefined` on any failure, so a git error, a non-repo `repo_root`, or a hashing edge case always falls back to an uncached spawn rather than surfacing as a tool error (D-09/D-12 fail-open requirement).
- `repo_root` resolution logic stayed in each caller (the tool's `repo_root` param + `CAIRN_EXPLORE_REPO_ROOT` env fallback vs. the CLI's env + `gitToplevel(cwd)` fallback) rather than moving into `runContextExplore`, since the plan explicitly scoped that function to receive an already-resolved absolute path; `runContextExplore` still owns the `CAIRN_EXPLORE_BINARY` and `repo_root`-exists precondition checks common to both callers.
- Extracted a shared `gitOpts` object in `computeRepoState` (single definition of `{encoding, maxBuffer, stdio}` reused across 3 `execFileSync` calls) required an explicit TS type annotation, since object-literal reuse loses the contextual-typing that made the inline `stdio` array literal work fine in `gitToplevel`'s single call site.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] git child-process stderr leaking onto the server's own stderr on a fail-open cache-probe failure**
- **Found during:** Task 2 verification (`npm run check:explore-guard`, which calls `context_explore` with `repo_root: "/tmp"`, a non-git directory)
- **Issue:** `execFileSync` inherits the child's stderr by default; `computeRepoState`'s git calls printed `fatal: not a git repository ...` directly to the MCP server's own stderr on every failed cache probe, even though the failure was already handled correctly (fail-open to an uncached spawn). This is log noise/hygiene, not a correctness bug, but it pollutes the server's stderr in a way a production deployment would see on every explore call against an unmanaged repo.
- **Fix:** Set `stdio: ["ignore", "pipe", "ignore"]` on the git `execFileSync` calls in both `computeRepoState` (`explore-cache.ts`) and the new `gitToplevel` helper (`index.ts`), so only stdout is captured and the child's stderr is discarded rather than inherited.
- **Files modified:** `mcp-memory-server/src/explore-cache.ts`, `mcp-memory-server/src/index.ts`
- **Verification:** Re-ran `npm run check:explore-guard` and `npm run test:smoke` — all still green, and the "fatal: not a git repository" lines no longer appear in the smoke test's console output.
- **Committed in:** `309ddae` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug/hygiene)
**Impact on plan:** No scope change; fix is contained to the two `execFileSync` call sites the plan already introduced.

## Issues Encountered

**Environment: Edit/Write tool read-tracking bug in this worktree session.** The `Edit` and `Write` tools rejected every attempt to modify pre-existing tracked files (`mcp-memory-server/src/index.ts`, `mcp-memory-server/package.json`, `docs/operating.md`, even `README.md`) with "File has not been read yet" — reproducibly, even immediately after a successful `Read` call on the same path in the same or an adjacent turn. Files created fresh via `Write` during this session were unaffected (`Edit` worked normally on them). Root cause not identified (suspected harness-level file-identity/read-tracking issue specific to this worktree checkout). Workaround: used `Bash`/`python3` to perform the same exact-match string-replacement semantics as `Edit` (asserting `old.count() == 1` before replacing) directly against the affected pre-existing files (`index.ts`, `package.json`, `docs/operating.md`). All resulting diffs were verified by rebuilding and re-running the full smoke suite after each change. No impact on correctness of the delivered code; flagging so the orchestrator/user is aware the harness had this friction in this session.

`node_modules` was not installed in the worktree at session start (`tsc: not found`); ran `npm install` (restores from the existing `package-lock.json`, no new packages) to unblock `npm run build`. This bumped `mcp-memory-server/package-lock.json`'s `license` field from `MIT` to `Apache-2.0` (a pre-existing drift between the lockfile and `package.json`'s `Apache-2.0`, unrelated to this plan's code) — left uncommitted/unstaged since it is out of this plan's scope.

## User Setup Required

None - no external service configuration required. `CAIRN_EXPLORE_CACHE` is optional (default ON); no action needed unless disabling the cache is desired.

## Next Phase Readiness

- `runContextExplore()` is now the single shared path for the MCP tool and the `explore` CLI subcommand (D-06) — Plan 02 (CTX-08 cross-reference enrichment) and Plan 03 (CTX-09 pre-task hook) both compose against this one function by construction.
- The cache stores raw evidence only (D-12) and `cached` is already part of the payload shape, so Plan 02's cross-ref enrichment can be added after the cache check/spawn without touching cache semantics.
- No blockers. One out-of-scope lockfile drift noted above (unrelated `license` field in `package-lock.json`) is left for the user/a later housekeeping pass, not blocking.

---
*Phase: 12-context-exploration-maturation*
*Completed: 2026-07-07*

## Self-Check: PASSED
