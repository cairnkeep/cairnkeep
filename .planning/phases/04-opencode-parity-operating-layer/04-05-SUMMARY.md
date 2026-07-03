---
phase: 04-opencode-parity-operating-layer
plan: 05
subsystem: operating-layer
tags: [opencode, plugin, memory-recall, tool.execute.before, throw-to-surface, mcp-memory-server]

# Dependency graph
requires:
  - phase: 04-opencode-parity-operating-layer (plan 01, spike)
    provides: confirmed tool.execute.before file-path field (output.args.filePath, for both edit and write)
provides:
  - "opencode/plugins/memory-recall.ts — OCP-02 pre-edit file-specific memory/wiki recall via throw-to-surface"
affects: [04-06, 05-live-opencode-parity-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "tool.execute.before throw-to-surface: throw new Error(context) is the only confirmed non-blocking-alternative channel to get freeform text in front of the model at that hook point"
    - "once-per-file-per-session Set keyed on sessionID:filePath to avoid re-blocking the same edit in a retry loop"
    - "relative()-based containment (SEC-0001 pattern) for wiki source reads, confirmed distinct from the untrusted grep-token derivation"

key-files:
  created: [opencode/plugins/memory-recall.ts]
  modified: []

key-decisions:
  - "Dedupe key is sessionID:filePath (not filePath alone) so recall re-arms per distinct session against the same repo, matching memory-wakeup.ts's per-session semantics"
  - "The catch block re-throws only errors whose message starts with the plugin's own 'Memory recall (auto-injected' prefix — this distinguishes the intentional surface-context throw from any unexpected internal error, which is swallowed to fail open (D-03)"
  - "Case-insensitive stem matching for both the wakeup index grep and the wiki content scan, mirroring memory-recall.sh's grep -iF"

patterns-established:
  - "Throw-to-surface for tool.execute.before: the only way this phase found to get non-blocking-equivalent context in front of the model from this specific hook is a targeted throw, deliberately distinguished from unexpected errors so fail-open (D-03) still holds"

requirements-completed: [OCP-02]

coverage:
  - id: D1
    description: "opencode/plugins/memory-recall.ts surfaces AgentFS facts and wiki pages mentioning the file being edited/written before the edit proceeds, via a stem match against the wakeup index and .planning/wiki/sources/*.md, throwing an Error with the assembled (40-line-capped) context on a match"
    requirement: "OCP-02"
    verification:
      - kind: other
        ref: "grep-based acceptance checks (tool.execute.before, edit/write gating, @@INFRA_ROOT@@, wiki/sources, relative()-based containment, throw, catch) — all pass"
        status: pass
      - kind: other
        ref: "scratch tsc typecheck against @opencode-ai/plugin's local index.d.ts + @types/node (strict mode) — 0 errors"
        status: pass
      - kind: other
        ref: "cd mcp-memory-server && npm run check:extract (shared extract CLI contract unaffected by this plan's TS glue) — pass"
        status: pass
    human_judgment: true
    rationale: "Live throw-then-retry behavior against a real matched edit (does the model actually see the thrown context and proceed sensibly, per Assumption A3 / Open Question 3) is explicitly scoped to Plan 04-06 / Phase 5 per this plan's own <verification> section — this plan's checks confirm code shape, type safety, and the shared-server contract, not a live round trip."

duration: 20min
completed: 2026-07-03
status: complete
---

# Phase 04 Plan 05: OpenCode memory-recall plugin Summary

**`opencode/plugins/memory-recall.ts` blocks-and-surfaces file-specific AgentFS/wiki context before an OpenCode edit or write proceeds, using the confirmed `output.args.filePath` field and a throw-to-surface mechanism with a once-per-file-per-session guard.**

## Performance

- **Duration:** 20 min
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Implemented `tool.execute.before` gating on `edit`/`write` tools only, reading the target path from `output.args.filePath` (falling back to `output.args.path`) per the 04-01 spike's confirmed field
- Derived basename/stem with the D-10 low-noise skip (`stem.length < 4`), matched against a case-insensitive filter of the `node <server> wakeup` index (first 8 hits) and a containment-guarded scan of `.planning/wiki/sources/*.md`
- On any specific match, threw `Error("Memory recall (auto-injected for this file edit):\n\n" + context)` (context capped at 40 lines) so the model sees it as the tool's result — Pattern 2 from 04-RESEARCH.md, the only confirmed injection channel for this hook
- Added a `sessionID:filePath` dedupe `Set` so a matched file is surfaced once per session, then proceeds unmodified on any retry/re-edit within that same session (T-04-09 mitigation)
- Confined all wiki reads to `.planning/wiki/sources/` via `path.relative()`-based containment (the SEC-0001 pattern from Phase 2) — the untrusted `filePath` is only ever used to derive the `stem` grep token, never concatenated into a read path
- Wrapped the entire hook body in try/catch, re-throwing only the plugin's own intentional surface-context error and swallowing everything else to fail open (D-03)
- Documented the subagent-bypass limitation (Pitfall 4 / `anomalyco/opencode#5894`) inline as an out-of-scope, known OpenCode constraint

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement tool.execute.before stem matching and throw-to-surface (OCP-02)** - `b831238` (feat)

## Files Created/Modified
- `opencode/plugins/memory-recall.ts` - `tool.execute.before` hook: stem derivation, wakeup-index + wiki-source matching, throw-to-surface with once-per-file-per-session guard, fail-open try/catch

## Decisions Made
- Dedupe key is `sessionID:filePath` rather than `filePath` alone, so recall re-arms across distinct OpenCode sessions against the same repo (mirrors `memory-wakeup.ts`'s per-session semantics rather than a global once-ever guard)
- The catch block distinguishes the plugin's own intentional surface-context `Error` (prefix check) from any unexpected internal error — only the former is re-thrown to the model; everything else is swallowed so a lookup failure never blocks an edit
- Stem matching is case-insensitive on both the wakeup-index grep and the wiki-content scan, matching `memory-recall.sh`'s `grep -iF` behavior exactly

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. A scratch `tsc --strict` typecheck (against the locally cached `@opencode-ai/plugin` type declarations and `@types/node`, deleted after use — no `package.json` or dependency added to the repo) confirmed the file type-checks cleanly on the first pass; no iteration was needed.

## User Setup Required

None - no external service configuration required. `opencode/plugins/memory-recall.ts` is a loose asset installed later by `scripts/sync-opencode-plugin-assets.sh` (Plan 04-06 renders the `@@INFRA_ROOT@@` token and adds it to that script's `ASSETS[]`, per D-12).

## Next Phase Readiness
- `opencode/plugins/memory-recall.ts` is ready for Plan 04-06 to wire into `sync-opencode-plugin-assets.sh`'s `ASSETS[]` and `@@INFRA_ROOT@@` rendering step alongside `memory-capture.ts`
- Live throw-then-retry model behavior (Assumption A3 / Open Question 3 from 04-RESEARCH.md) remains an open verification item for Phase 5's live OpenCode session walkthrough
- No blockers

---
*Phase: 04-opencode-parity-operating-layer*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: opencode/plugins/memory-recall.ts
- FOUND: .planning/phases/04-opencode-parity-operating-layer/04-05-SUMMARY.md
- FOUND: b831238 (feat commit)
- FOUND: d3fa410 (docs commit)
