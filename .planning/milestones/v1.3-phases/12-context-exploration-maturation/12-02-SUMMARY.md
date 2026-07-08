---
phase: 12-context-exploration-maturation
plan: 02
subsystem: api
tags: [context_explore, token_miser, mcp-tool, node, memory, wiki, cross-reference]

requires:
  - phase: 12-context-exploration-maturation (Plan 01)
    provides: runContextExplore() shared handler + cache wiring that this plan enriches
  - phase: 07-context-exploration
    provides: the context_explore MCP tool (thin subprocess delegate to token_miser)
provides:
  - cwd-threaded openScope/listEntries so memory reads can target an arbitrary repo_root
  - crossReferenceCitations() enrichment: per-citation memory_refs/wiki_refs from deterministic stem matching
  - hit-only renderCitations markers, byte-identical on ref-less/zero-hit output
  - offline seeded-fixture smoke test (check:explore-crossref) proving hit/no-hit/fail-open behavior
affects: [12-03-PLAN]

tech-stack:
  added: []
  patterns:
    - "cwd-threading through openScope/listEntries so in-process memory reads can target an explored repo_root instead of the server's own cwd"
    - "Fail-open enrichment wrapped end-to-end in try/catch, recomputed on every return (cache hit and miss alike), never part of the cached payload"
    - "isContained() relative()-based containment (reused from opencode/plugins/memory-recall.ts) for wiki page reads"

key-files:
  created:
    - mcp-memory-server/scripts/smoke-explore-crossref.mjs
    - mcp-memory-server/scripts/fixtures/fake-tokenmiser-crossref.sh
  modified:
    - mcp-memory-server/src/index.ts
    - mcp-memory-server/package.json

key-decisions:
  - "openScope(scope, create, cwd?) and listEntries's options.cwd are additive/optional -- every existing no-cwd caller (memory_read, wakeup, etc.) is unaffected; only the new crossReferenceCitations() call threads repo_root through"
  - "Enrichment inserted after the Evidence assignment (cache-hit OR cache-miss) and before payload/renderCitations shaping, so cross-refs recompute every return while the cache itself still stores only raw evidence (D-12)"
  - "New fake-tokenmiser-crossref.sh fixture (src/widget.rs / src/gadget.rs) instead of reusing the existing fake-tokenmiser-cited.sh (src/foo.rs / src/bar.rs): foo/bar stems are only 3 chars, below D-02's >=4-char noise guard, so that fixture can never produce a cross-ref hit at all"

requirements-completed: [CTX-08]

coverage:
  - id: D1
    description: "openScope/listEntries thread an optional cwd through to resolveScopePath so cross-ref memory reads target the explored repo_root, not the server's own cwd; existing no-cwd callers unaffected"
    requirement: "CTX-08"
    verification:
      - kind: integration
        ref: "mcp-memory-server/scripts/smoke-explore-guard.mjs (10 checks, unchanged pass)"
        status: pass
      - kind: integration
        ref: "mcp-memory-server/scripts/smoke-search-e2e.mjs"
        status: pass
    human_judgment: false
  - id: D2
    description: "crossReferenceCitations() derives a >=4-char path stem per unique citation, matches case-insensitively against project-scope memory (cwd-threaded) and .planning/wiki/sources/*.md pages, and is wired into runContextExplore on both cache-hit and cache-miss paths, recomputing every return; wrapped in try/catch for fail-open behavior"
    requirement: "CTX-08"
    verification:
      - kind: integration
        ref: "mcp-memory-server/scripts/smoke-explore-crossref.mjs (matching/non-matching/bare-repo checks)"
        status: pass
    human_judgment: false
  - id: D3
    description: "renderCitations appends a compact marker only to citations with memory_refs/wiki_refs; ref-less citations and the zero-citation message stay byte-identical to the pre-phase output"
    requirement: "CTX-08"
    verification:
      - kind: other
        ref: "bash scripts/verify-token-savings-ab.sh --self-test (renderCitations-shape self-test)"
        status: pass
      - kind: integration
        ref: "mcp-memory-server/scripts/smoke-explore-crossref.mjs (byte-identical bare-repo rendering check)"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-07
status: complete
---

# Phase 12 Plan 02: Context Explore Cross-Reference Enrichment Summary

**`context_explore` citations now carry `memory_refs`/`wiki_refs` from deterministic path-stem matching against the explored repo's project memory and wiki, computed fresh on every call (cache hit or miss) and rendered only when a hit exists -- zero-hit output stays byte-identical to the pre-phase format.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-07T14:20:00Z (approx, following Plan 01's 14:16:13Z completion)
- **Completed:** 2026-07-07T14:30:28Z
- **Tasks:** 3
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `openScope`/`listEntries` in `index.ts` now accept an optional `cwd`, threaded to `resolveScopePath`, so in-process memory reads can target an arbitrary explored repo instead of the server's own process cwd -- every existing no-cwd caller (memory_read, wakeup, etc.) is unaffected.
- `crossReferenceCitations(citations, repoRoot)`: for each unique cited path, derives the basename stem (skipping stems shorter than 4 chars per the `memory-recall.sh` noise guard), then matches case-insensitively against `listEntries("project", "", { cwd: repoRoot })` entries (memory_refs = matching keys) and `<repoRoot>/.planning/wiki/sources/*.md` page names/content (wiki_refs = matching page names), confining wiki reads via the `isContained()` relative()-based idiom. The whole function is wrapped in try/catch -- any failure (missing `.agentfs` db, missing wiki dir, read error) returns citations unchanged with no refs, never throwing into the exploration result.
- Wired into `runContextExplore` immediately after `finalEvidence` is assigned (covers both the cache-hit and cache-miss paths), so cross-refs are recomputed on every return while the file cache continues to store only raw, un-enriched evidence (D-12) -- proven by the existing cache smoke test's "no memory_refs/wiki_refs in cache entry" checks, which still pass.
- `renderCitations` appends a compact ` <- memory: <keys> - wiki: <pages>` marker only to citations that gained refs; a ref-less citation's line, and the zero-citations message, are byte-for-byte unchanged from the pre-phase format -- verified both by the Phase 9 `verify-token-savings-ab.sh --self-test` shape gate and the new smoke test's bare-repo byte-identity assertion.
- New offline smoke test `smoke-explore-crossref.mjs` seeds a temp repo_root's `.agentfs/project.db` + `.planning/wiki/sources` with a "widget" entry/page, drives `context_explore` via the MCP client against a fake `token_miser` binary citing `src/widget.rs` (matching) and `src/gadget.rs` (non-matching), and asserts refs land only on the matching citation; a second bare-repo run proves fail-open with byte-identical plain rendering. Wired into `package.json`'s `test:smoke` chain as `check:explore-crossref`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Thread cwd through openScope/listEntries** - `18e25ce` (feat)
2. **Task 2 (tdd): Cross-ref matcher + enrichment wiring + hit-only rendering** - `4a4d6b5` (feat)
3. **Task 3: Cross-ref smoke test + package.json wiring** - `ae46ec7` (test)

_TDD Gate Compliance: Task 2 is flagged `tdd="true"` in the plan, but its `<files>` scope is limited to `index.ts` only -- the plan's own Task 3 owns creating the dedicated smoke-test file. Per the RED/GREEN discipline, an offline probe against the pre-change server (RED: proved `context_explore` output carried no `memory_refs`/`wiki_refs`) was run before implementation, and the same probe was re-run after implementation (GREEN: proved both refs attach to the matching citation, none to the non-matching one) using a scratch fixture/script outside the repo (not committed, since it duplicated what Task 3's real `smoke-explore-crossref.mjs` formalizes). No separate `test(...)` commit precedes the Task 2 `feat(...)` commit because the task's file scope excluded a test file -- the RED/GREEN cycle was verified manually rather than via a committed failing test. The formal, committed test proof is Task 3's `ae46ec7`._

## Files Created/Modified

- `mcp-memory-server/src/index.ts` - `openScope`/`listEntries` cwd threading; `isContained()`, `citationStem()`, `crossReferenceCitations()`, `renderCrossRefMarker()`; `renderCitations()` updated to append hit-only markers; enrichment wired into `runContextExplore`
- `mcp-memory-server/scripts/smoke-explore-crossref.mjs` - offline seeded-fixture proof of memory/wiki cross-ref hits, non-hits, and fail-open byte-identity
- `mcp-memory-server/scripts/fixtures/fake-tokenmiser-crossref.sh` - fake token_miser binary citing `src/widget.rs`/`src/gadget.rs` (>=4-char stems)
- `mcp-memory-server/package.json` - `check:explore-crossref` script wired into the `test:smoke` chain

## Decisions Made

- Enrichment reuses the existing in-process `listEntries`/`MemoryEntry` machinery rather than shelling out or duplicating scope-resolution logic -- the only change needed was the `cwd` passthrough (Task 1).
- Cross-ref data is attached to a shallow-copied citation object (`{ ...citation, memory_refs?, wiki_refs? }`) rather than mutating the parsed Evidence in place, so a citation with no hits is referentially/structurally identical to its pre-enrichment shape.
- Wiki page name in `wiki_refs` is the bare filename (e.g. `widget-notes.md`), matching the plan's "page names" wording and mirroring `memory-recall.sh`'s `[$(basename "$page")]` convention.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Task 3's suggested fixture reuse (`fake-tokenmiser-cited.sh`) cannot exercise cross-referencing at all**
- **Found during:** Task 2 GREEN verification (an offline probe reusing the existing `fake-tokenmiser-cited.sh` fixture, which cites `src/foo.rs`/`src/bar.rs`)
- **Issue:** The plan's own `must_haves.truths` and D-02 (12-CONTEXT.md) require a path stem of **>= 4 characters** before any cross-ref matching is attempted (a noise guard mirrored from `claude/hooks/memory-recall.sh`). The existing `fake-tokenmiser-cited.sh` fixture -- which Task 3's `read_first`/`action` explicitly names as "the two citations this test discriminates" -- cites `src/foo.rs` and `src/bar.rs`, whose stems ("foo", "bar") are only 3 characters each. Under the plan's own >= 4 char rule, **neither citation could ever produce a cross-ref hit**, making the smoke test's required "matching citation gets memory_refs+wiki_refs" assertion permanently unsatisfiable with that fixture. This was a genuine plan inconsistency between the noise-guard invariant (must-preserve, stated in the frontmatter's `must_haves.truths`) and the suggested test fixture (an implementation detail, not an invariant).
- **Fix:** Created a new fixture `mcp-memory-server/scripts/fixtures/fake-tokenmiser-crossref.sh` citing `src/widget.rs`/`src/gadget.rs` (6/6-char stems, both >= 4 chars), preserving the intended test shape (one path matches seeded memory/wiki, the other doesn't) while keeping the >= 4 char noise guard intact exactly as specified. The existing `fake-tokenmiser-cited.sh` fixture is untouched (still used by `smoke-explore-guard.mjs` for its own, unrelated assertions).
- **Files modified:** `mcp-memory-server/scripts/fixtures/fake-tokenmiser-crossref.sh` (new), `mcp-memory-server/scripts/smoke-explore-crossref.mjs` (new)
- **Verification:** `npm run check:explore-crossref` and the full `npm run test:smoke` chain both pass; the noise guard itself is unit-verifiable by inspection (`CROSSREF_MIN_STEM_LENGTH = 4` in `index.ts`).
- **Committed in:** `ae46ec7` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking issue: a plan-suggested test fixture could not satisfy the plan's own must-preserve invariant)
**Impact on plan:** No scope change to CTX-08's behavior or invariants -- only the smoke test's fixture choice changed, and the deterministic >= 4 char noise guard was preserved exactly as the plan's `must_haves.truths` required.

## Issues Encountered

**Environment: Edit/Write tool "File has not been read yet" bug (same as Plan 01's session).** Both `Edit` and `Write` rejected in-place modifications to pre-existing tracked files (`mcp-memory-server/src/index.ts`, `mcp-memory-server/package.json`) with "File has not been read yet", reproducing immediately after a successful `Read` on the same path. Worked around identically to Plan 01: `python3` performing exact-match string replacement (asserting a single occurrence before replacing), with every change verified by rebuilding and re-running the full smoke suite afterward. Files created fresh via `Write` (`smoke-explore-crossref.mjs`, the new fixture) were unaffected.

`node_modules` was not installed in the worktree at session start; `npm install` restored it from the existing `package-lock.json` (no dependency changes, no lockfile drift this time -- `package-lock.json`'s `license` field was already `Apache-2.0` from Plan 01's earlier fix).

An early debugging session hit an AgentFS SQLite file-locking error when a throwaway diagnostic script tried to seed and then immediately re-open the same `.agentfs/project.db` within one Node process before the MCP server subprocess opened it. This only affected an ad-hoc scratch script (never committed) used to prove the RED/GREEN cycle; the shipped `smoke-explore-crossref.mjs` seeds the db via a short-lived `node -e` subprocess that fully exits before the MCP client connects, avoiding the lock entirely.

## User Setup Required

None - no external service configuration required. No new `CAIRN_*` env keys were introduced by this plan (`verify-docs-parity.sh` confirmed green with no changes needed).

## Next Phase Readiness

- CTX-08 is complete: `context_explore` citations are cross-referenced against the explored repo's memory and wiki, fail-open, recomputed every return, and byte-identical on zero hits.
- Plan 03 (CTX-09 pre-task hook auto-invoke) can build on both Plan 01's cache and this plan's cross-refs without further coordination -- the shared `runContextExplore()` path already carries both features end-to-end for any caller (MCP tool, `explore` CLI, and the upcoming hook).
- No blockers.

---
*Phase: 12-context-exploration-maturation*
*Completed: 2026-07-07*

## Self-Check: PASSED
