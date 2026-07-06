---
phase: 11-self-consistency-public-positioning
plan: 04
subsystem: docs
tags: [verification, milestones, guard, docs-parity, gh-cli]

requires:
  - phase: 11-self-consistency-public-positioning (Plan 03)
    provides: final docs sweep (README.md, docs/operating.md, docs/git-providers.md) with no drift
provides:
  - Live-run Phase 11 self-consistency gate evidence recorded in MILESTONES.md
  - Fixed a real Stage-2 guard violation carried in three historical Phase 8 docs
affects: [milestone-close, phase-12, phase-13]

tech-stack:
  added: []
  patterns:
    - "verify-by-execution gate evidence recorded as a phase-gate MILESTONES.md entry, not a full shipped-milestone section"

key-files:
  created: []
  modified:
    - .planning/MILESTONES.md
    - .planning/phases/08-operating-layer-wiring/08-01-PLAN.md
    - .planning/phases/08-operating-layer-wiring/08-02-PLAN.md
    - .planning/phases/08-operating-layer-wiring/08-VERIFICATION.md

key-decisions:
  - "Historical Phase 8 docs quoted the specific-denylist literal inside grep-pattern example strings (documenting a negative-scan command); replaced with a neutral placeholder rather than adding a new Stage-2 exemption list, since the guard's specific-term scan has no doc-quoting exemption by design (D-06 fail-closed, any-hit)."

requirements-completed: [SC-03]

coverage:
  - id: D1
    description: "verify-no-private-references.sh run live with CAIRN_GUARD_DENYLIST set (specific-term stage exercised) exits 0 against the final tracked tree"
    requirement: "SC-03"
    verification:
      - kind: other
        ref: "live shell run: CAIRN_GUARD_DENYLIST=<operator file> scripts/verify-no-private-references.sh -> exit 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "verify-docs-parity.sh exits 0 (env-key and command checks both zero-drift)"
    requirement: "SC-02"
    verification:
      - kind: other
        ref: "live shell run: scripts/verify-docs-parity.sh -> exit 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "token-miser PUBLIC verdict captured live via gh"
    requirement: "SC-01"
    verification:
      - kind: other
        ref: "live shell run: gh repo view cairnkeep/token-miser --json visibility -> {\"visibility\":\"PUBLIC\"}"
        status: pass
    human_judgment: false
  - id: D4
    description: "MILESTONES.md Phase 11 gate record added, itself guard-clean, without altering shipped v1.0/v1.1/v1.2 sections"
    requirement: "SC-03"
    verification:
      - kind: other
        ref: "live shell run: guard re-run after the MILESTONES.md edit -> exit 0; git diff shows only an insertion above the v1.2 section"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-07
status: complete
---

# Phase 11 Plan 04: Self-Consistency Gate Recorded Summary

**Ran both Phase 11 gate scripts live against the final tree, fixed one real guard violation found in historical Phase 8 docs, and recorded the SC-01/SC-02/SC-03 evidence triad in MILESTONES.md.**

## Performance

- **Duration:** 12 min
- **Tasks:** 1 (plus 1 in-scope auto-fix)
- **Files modified:** 4

## Accomplishments
- Live run of `scripts/verify-no-private-references.sh` with `CAIRN_GUARD_DENYLIST` set surfaced a real Stage 2 violation (a literal employer term embedded inside historical Phase 8 grep-pattern example strings), fixed it, and re-ran to a clean exit 0.
- Live run of `scripts/verify-docs-parity.sh` confirmed zero drift on both the env-key check and the command check.
- Captured the token-miser PUBLIC verdict live via `gh repo view cairnkeep/token-miser --json visibility`.
- Recorded all three as a single Phase 11 gate entry in `.planning/MILESTONES.md`, then re-ran the guard against the edited file to confirm the record itself introduces no violation.

## Task Commits

1. **Task 1 (auto-fix, Rule 1 - Bug): scrub literal employer term from Phase 8 grep-pattern doc examples** - `6b0f05c` (fix)
2. **Task 1: record Phase 11 self-consistency gate in MILESTONES.md** - `a4266f8` (docs)

**Plan metadata:** committed separately by the orchestrator's final metadata step (worktree mode).

## Files Created/Modified
- `.planning/MILESTONES.md` - new "v1.3 (in progress) — Phase 11 self-consistency gate" record (commands, run date, zero-hit/zero-drift output, PUBLIC verdict)
- `.planning/phases/08-operating-layer-wiring/08-01-PLAN.md` - replaced literal employer term in two grep-pattern example strings with a neutral placeholder
- `.planning/phases/08-operating-layer-wiring/08-02-PLAN.md` - same replacement, one occurrence
- `.planning/phases/08-operating-layer-wiring/08-VERIFICATION.md` - same replacement, one occurrence

## Decisions Made
- The Stage 2 (specific-denylist) guard scan has no doc-quoting exemption (unlike Stage 1's `DETECTOR_DOCS` exclusion for Phase 11 pattern-documentation files) — by design, any literal hit fails closed. Rather than widen the guard's exemption logic (an architectural change to a security-relevant script), the historical Phase 8 docs were edited to replace the literal term with a neutral placeholder in the three grep-pattern example strings where it appeared. This preserves the historical record's intent (documenting what negative-scan command was run) without carrying a real private-term literal in the tracked tree.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed real Stage-2 guard violation in three historical Phase 8 docs**
- **Found during:** Task 1, first live run of `scripts/verify-no-private-references.sh` with `CAIRN_GUARD_DENYLIST` set
- **Issue:** Three Phase 8 planning docs (`08-01-PLAN.md`, `08-02-PLAN.md`, `08-VERIFICATION.md`) quoted a `grep -niE` negative-scan pattern that included the literal employer term as one of its alternation branches (documenting what was checked for, not an actual employer reference) — this is a fixed-string match, so the specific-denylist Stage 2 scan (which has no doc-quoting exemption) flagged all four occurrences as hits.
- **Fix:** Replaced the literal term with a neutral placeholder (`acme-corp`) in all four occurrences across the three files. The grep-pattern documentation still reads correctly as an example negative-scan command; the tracked tree no longer contains the real literal.
- **Files modified:** `.planning/phases/08-operating-layer-wiring/08-01-PLAN.md`, `.planning/phases/08-operating-layer-wiring/08-02-PLAN.md`, `.planning/phases/08-operating-layer-wiring/08-VERIFICATION.md`
- **Verification:** Re-ran `CAIRN_GUARD_DENYLIST=<operator file> scripts/verify-no-private-references.sh` — exit 0, zero-hit.
- **Committed in:** `6b0f05c`

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug, blocking the gate's required exit-0 acceptance criterion)
**Impact on plan:** Necessary to satisfy the plan's own acceptance criteria (the guard must exit 0 live). No scope creep beyond the four flagged lines; no other content in the three Phase 8 files was touched.

## Issues Encountered
- Session context required never printing/quoting the denylist file's contents or its terms in any durable record (MILESTONES.md, SUMMARY.md). The live guard's own stdout printed the offending literal directly (git grep echoes matching lines) as part of confirming the violation exists — this is inherent to how a fixed-string content-scanning tool reports a hit and is distinct from the plan's constraint on what gets *written into the tracked, guard-scanned record*. Neither MILESTONES.md nor this SUMMARY.md contains the denylist path or any of its literal terms; only the guard's OK line and the fix description (referring to "a literal employer term" without repeating it) are recorded.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 11's full SC-01/SC-02/SC-03 evidence triad is now live-verified and recorded together in MILESTONES.md.
- Phases 12 (CTX-08/09/10) and 13 (OCP-07) remain open and are independent of this phase's work.
- No blockers carried forward from this plan.

---
*Phase: 11-self-consistency-public-positioning*
*Completed: 2026-07-07*
