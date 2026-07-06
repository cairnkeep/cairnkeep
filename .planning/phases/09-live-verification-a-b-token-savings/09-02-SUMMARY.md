---
phase: 09-live-verification-a-b-token-savings
plan: 02
subsystem: testing
tags: [context_explore, fastcontext, token-savings, verification]

requires:
  - phase: 09-live-verification-a-b-token-savings
    provides: "09-01's committed offline-self-tested A/B harness (scripts/verify-token-savings-ab.sh)"
provides:
  - "Cairnkeep's own measured (not paper-cited) CTX-07 byte/token-savings number, verified against the real FastContext backend"
  - "09-AB.md verdict doc: recipe table, tight-query A/B, D-01 reliability finding on the broad query set, D-03 verdict, SC-3 transcript"
affects: [milestone-closeout, ctx-07]

tech-stack:
  added: []
  patterns: ["Verdict-doc shape mirrored from 06-SPIKE.md: measured evidence + explicit PASS/FAIL verdict + documented caveats that don't block close-out"]

key-files:
  created:
    - .planning/phases/09-live-verification-a-b-token-savings/09-AB.md
  modified: []

key-decisions:
  - "Recorded the honest tight-query anchor (verified-correct citations, 99.9%+ byte-savings) as the CTX-07 headline number, not the naive ~99.8% broad-set figure which is built on hallucinated/empty citations"
  - "Broad default query set unreliability (1 timeout-wander past the harness's own 120s cap, 4 hallucinated non-existent paths) recorded transparently as a D-01 model-reliability finding, not hidden or silently passed"

patterns-established: []

requirements-completed: [CTX-07]

coverage:
  - id: D1
    description: "09-AB.md records the measured tight-query byte delta + byte-savings % + chars/4 token estimate, with the D-03 PASS verdict, referenced from this SUMMARY"
    requirement: "CTX-07"
    verification:
      - kind: manual_procedural
        ref: ".planning/phases/09-live-verification-a-b-token-savings/09-AB.md (Sections 2 and 4)"
        status: pass
    human_judgment: false
  - id: D2
    description: "SC-3 live /context-explore transcript captured with two independently-verified citations"
    requirement: "CTX-07"
    verification:
      - kind: manual_procedural
        ref: ".planning/phases/09-live-verification-a-b-token-savings/09-AB.md (Section 5)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-06
status: complete
---

# Phase 9 Plan 02: Live CTX-07 A/B Verification Summary

**Measured cairnkeep's own byte/token-savings number live against the real FastContext backend: 99.9%+ byte-savings on verified pinpoint queries, with the harness's broad default query set transparently flagged as a D-01 model-reliability gap rather than a hidden pass.**

## Performance

- **Duration:** 15 min (recording task only; live run itself performed by the orchestrator/operator prior to this task)
- **Tasks:** 1 (Task 2 — Task 1 was the operator-gated checkpoint, already completed by the orchestrator)
- **Files modified:** 1

## Accomplishments
- Created `.planning/phases/09-live-verification-a-b-token-savings/09-AB.md`, recording the CTX-07 A/B result: the native-exploration recipe table (verbatim from the harness header), the measured tight-query A/B (renderCitations 52620→38 bytes = 99.93% byte-savings; runCommand 42154→38 bytes = 99.91% byte-savings), the D-03 PASS verdict, and the SC-3 live transcript.
- Recorded the DEFAULT broad query set's live explore run as a transparent D-01 reliability finding: query 1 wandered to the turn cap at 125s (exceeding the harness's own 120s per-query timeout) with 0 citations; queries 2-5 returned hallucinated, non-existent paths (`agentfs/`, `git2-rs/`, `opencode/plugins/memory-wakeup`, a fabricated `infrastructure/scripts/` prefix) — all verified against the real cairnkeep tree and none dressed up as a pass.
- **09-AB.md reference:** see [09-AB.md](./09-AB.md) for the full recorded evidence — this satisfies SC-2's requirement that the measured number be recorded in the phase's UAT/SUMMARY docs.

## Task Commits

Task 1 (operator-gated checkpoint) was completed by the orchestrator prior to this agent's spawn — no commit from this task (it produced live measurement output only, passed to this agent via the live_run_results context).

1. **Task 2: Record measured A/B + verdict + transcript in 09-AB.md** - `4420366` (docs)

**Plan metadata:** committed separately after this SUMMARY (see final commit).

## Files Created/Modified
- `.planning/phases/09-live-verification-a-b-token-savings/09-AB.md` - CTX-07 A/B verdict doc: recipe table, tight-query measured A/B, D-01 broad-set reliability finding, D-03 verdict, SC-3 transcript.

## Decisions Made
- Used the tight, cairnkeep-specific queries (renderCitations, runCommand) as the CTX-07 headline number rather than the harness's default broad query set, because the broad set's explore-side citations were hallucinated or empty against the live backend — a naive delta computed from them would be a false ~99.8% "pass" built on fabricated paths.
- Followed the 06-SPIKE.md verdict-doc precedent: record model-reliability caveats transparently without letting them block the verdict or close-out (D-04).

## Deviations from Plan

None - plan executed exactly as written. Task 2's recording action matched the plan's <action> block precisely, including the requirement to label hallucinated citations clearly and to exclude any endpoint/model name.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required for this recording task (the live backend bring-up was the operator's Task 1 checkpoint action, already completed).

## Next Phase Readiness
- CTX-07 is closed with cairnkeep's own measured, verified number.
- The D-01 reliability finding on broad queries is documented for awareness in future phases that build on `context_explore` for loosely-worded queries, but does not block milestone close-out.

---
*Phase: 09-live-verification-a-b-token-savings*
*Completed: 2026-07-06*
