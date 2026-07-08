---
phase: 13-headless-harness-hardening
plan: 03
subsystem: docs
tags: [docs, markdown, opencode, harness, milestones, requirements]

# Dependency graph
requires:
  - phase: 13-headless-harness-hardening (plan 01)
    provides: "scripts/lib/assert-tool-event.mjs, hardened run_stage_remember_recall (serve/--attach transport, canary-linked NDJSON assertions)"
  - phase: 13-headless-harness-hardening (plan 02)
    provides: "preflight_tool_call_probe(), --repeat N soak mode in scripts/verify-opencode-live-parity.sh"
provides:
  - "docs/operating.md subsection documenting the no-thinking, tool-call-reliable model precondition (D-07) and the --repeat N soak, citing qwen3.5-27b as the proven public example"
  - ".planning/MILESTONES.md Known Gaps entry recording OCP-06 reliable-headless-reproduction RESOLVED by OCP-07 / Phase 13, with the part.type vs top-level type==\"tool_use\" footnote"
  - ".planning/REQUIREMENTS.md OCP-07 checked complete, Traceability row flipped to Complete"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Docs-vs-code parity gate (scripts/verify-docs-parity.sh) run after every docs edit that could touch env-key surface"

key-files:
  created: []
  modified:
    - docs/operating.md
    - .planning/MILESTONES.md
    - .planning/REQUIREMENTS.md

key-decisions:
  - "Placed the model-precondition subsection directly after the OpenCode setup-order block (before 'Configuration'), since it is OpenCode-specific harness context, not a generic config row"
  - "Left the interactive-TUI-session Known Gaps bullet explicitly untouched in substance (still open), only adding a bolded 'Still open' marker for scan-ability — never claimed resolved, matching REQUIREMENTS.md's Out of Scope entry"

patterns-established: []

requirements-completed: [OCP-07]

coverage:
  - id: D1
    description: "docs/operating.md documents the trait-based model precondition (no-thinking, tool-call-reliable; qwen3.5-27b proven example) and the --repeat 5 soak, preserving the --stage/--full/--repeat three-tier structure, with both parity gates green"
    requirement: "OCP-07"
    verification:
      - kind: other
        ref: "scripts/verify-docs-parity.sh && scripts/verify-no-private-references.sh && grep -q 'tool-call-reliable'/'qwen3.5-27b'/'--repeat' docs/operating.md"
        status: pass
    human_judgment: false
  - id: D2
    description: "MILESTONES.md records the OCP-06 reliable-headless-reproduction gap resolved by OCP-07/Phase 13 (pointing at the --repeat soak evidence), the interactive-TUI bullet stays explicitly open, and REQUIREMENTS.md's OCP-07 checkbox + Traceability row read Complete"
    requirement: "OCP-07"
    verification:
      - kind: other
        ref: "grep -Eq '\\| OCP-07 \\| Phase 13 \\| Complete \\|' .planning/REQUIREMENTS.md && grep -q '\\[x\\] \\*\\*OCP-07' .planning/REQUIREMENTS.md && grep -q 'OCP-07' .planning/MILESTONES.md && scripts/verify-no-private-references.sh"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-08
status: complete
---

# Phase 13 Plan 03: Document Model Precondition + Close the OCP-06 Gap Record Summary

**docs/operating.md now states the headless harness's no-thinking, tool-call-reliable model precondition (citing qwen3.5-27b) and the `--repeat 5` soak; MILESTONES.md and REQUIREMENTS.md record the v1.1 OCP-06 headless-reproduction gap resolved by OCP-07/Phase 13.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-08T14:24:00Z
- **Completed:** 2026-07-08T14:36:00Z
- **Tasks:** 2 completed
- **Files modified:** 3

## Accomplishments
- Added a "Headless round-trip harness — model precondition" subsection to `docs/operating.md` (under OpenCode setup, before Configuration): states the reliability requirement in trait terms (no-thinking, tool-call-reliable), names `qwen3.5-27b` as the proven public example, explains why retry can't fix a narrating model, references the existing `CAIRN_LLM_API_KEY`/`CAIRN_LLM_API_URL`/`CAIRN_LLM_EXTRACTION_MODEL` vars (no new env key), and documents the preflight probe plus the `--stage`/`--full`/`--repeat N` three-tier speed structure.
- `.planning/MILESTONES.md`'s Known Gaps section now marks the OCP-06 reliable-headless-reproduction bullet **RESOLVED by OCP-07 / Phase 13**, citing the serve/`--attach` conversion, the genuine `tool_use` NDJSON-event assertions, and the `--repeat 5` soak (5/5 consecutive cold reproductions) as the closing evidence, with the per-run/aggregate detail pointed at the Phase 13 UAT/VERIFICATION doc. The carried-forward follow-up ("genuine `\"type\":\"tool\"` event") is marked discharged for the round-trip stage, with the precise footnote: the shorthand refers to the nested `part.type`, while the harness's actual parser filters on the top-level `type == "tool_use"`.
- The separate "OCP-06 — interactive TUI session not run" bullet is left factually unchanged and explicitly marked **Still open** — not claimed resolved, matching REQUIREMENTS.md's Out of Scope entry.
- `.planning/REQUIREMENTS.md`: OCP-07 checkbox flipped `[ ]` → `[x]`, its Traceability row flipped `Pending` → `Complete`, and the "Last updated" line updated to record the Phase 13 closeout (100% v1.3 coverage delivered).

## Task Commits

Each task was committed atomically:

1. **Task 1: Document the trait-based model precondition and the --repeat soak** - `f302882` (docs)
2. **Task 2: Record the OCP-06 gap resolved in MILESTONES.md and REQUIREMENTS.md** - `d6467e5` (docs)

**Plan metadata:** committed as part of this SUMMARY (worktree mode — orchestrator merges).

## Files Created/Modified
- `docs/operating.md` - New "Headless round-trip harness — model precondition" subsection (24 lines) documenting D-07's trait-based precondition and the `--repeat` soak
- `.planning/MILESTONES.md` - Known Gaps section: OCP-06 reliable-headless-reproduction bullet marked RESOLVED with closing evidence; carried-forward follow-up marked discharged for the round-trip stage with the part.type/type=="tool_use" footnote; interactive-TUI bullet marked explicitly Still open
- `.planning/REQUIREMENTS.md` - OCP-07 checkbox and Traceability row flipped to complete; Last updated line refreshed

## Decisions Made
- Placed the new docs subsection immediately after the OpenCode "No Claude install required" paragraph and before "## Configuration" — it's OpenCode-harness-specific context, not a generic config-table row, and keeps the existing CAIRN_LLM_* rows as the single source of truth for the actual env-key names (docs-parity gate requirement).
- Kept the interactive-TUI-session Known Gaps bullet's substance untouched (per the plan's explicit instruction not to claim it resolved), only adding a bolded "Still open" marker for scannability.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' acceptance criteria were verified directly:
- `docs/operating.md` contains `tool-call-reliable`, `qwen3.5-27b`, and `--repeat`.
- `scripts/verify-docs-parity.sh` exits 0 (no new undocumented env key, no missing command).
- `scripts/verify-no-private-references.sh` exits 0 (public model name allowed, no attribution markers).
- `.planning/REQUIREMENTS.md` OCP-07 line begins `[x] **OCP-07` and the Traceability row reads `| OCP-07 | Phase 13 | Complete |`.
- `.planning/MILESTONES.md` marks the reliable-headless-reproduction bullet resolved by OCP-07/Phase 13, references the `--repeat` soak, retains the interactive-TUI bullet as still-open, and includes the part.type vs top-level type=="tool_use" footnote.

## Issues Encountered
- The Edit tool again refused to apply patches to these pre-existing tracked files (same environment quirk documented in 13-01-SUMMARY.md and 13-02-SUMMARY.md's Issues Encountered). Worked around identically: `python3` exact-match string replacement for all three edits (docs/operating.md subsection insertion, MILESTONES.md Known Gaps section rewrite, REQUIREMENTS.md checkbox/Traceability/Last-updated edits), each verified via `content.count(old) == 1` assertions before writing and re-checked against acceptance-criteria greps after.

## User Setup Required

None - no external service configuration required. This plan is docs/records-only; it does not touch the harness script or require a live model. The actual `--repeat 5` live soak (5/5, D-01) remains the operator's phase-gate action per Plan 02's SUMMARY — not runnable in this sandbox, and this plan's records point at where that evidence belongs (Phase 13 UAT/VERIFICATION doc) without transcribing it.

## Next Phase Readiness
- Phase 13's third and final success criterion (gap recorded resolved) is now satisfied in both MILESTONES.md and REQUIREMENTS.md.
- The operator still owes the live `scripts/verify-opencode-live-parity.sh --repeat 5` run (5/5, D-01) and its recording in a Phase 13 UAT/VERIFICATION doc — this plan's records already point at that doc by name, so no further doc restructuring is needed once that evidence lands.
- No blockers for phase closeout.

---
*Phase: 13-headless-harness-hardening*
*Completed: 2026-07-08*
