---
phase: 13-headless-harness-hardening
plan: 01
subsystem: testing
tags: [bash, node, ndjson, opencode, harness, tdd]

# Dependency graph
requires: []
provides:
  - "scripts/lib/assert-tool-event.mjs — standalone NDJSON tool_use event matcher (regex + optional canary linkage)"
  - "scripts/test-remember-recall-assertions.sh — offline fixture test proving the matcher distinguishes genuine tool calls from narrated mentions"
  - "run_stage_remember_recall() converted to opencode serve/--attach transport with parser-based, canary-linked assertions and infra-only retry (LAST_ROUNDTRIP_RETRIES)"
affects: [13-02]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "NDJSON line-by-line parser (try/catch JSON.parse, skip malformed lines) mirroring the existing extract_session_id() idiom"
    - "Infra-vs-narration retry classification: retry only on timeout(124)/empty-output; a clean run with no matching tool event is a hard FAIL"

key-files:
  created:
    - scripts/lib/assert-tool-event.mjs
    - scripts/test-remember-recall-assertions.sh
  modified:
    - scripts/verify-opencode-live-parity.sh

key-decisions:
  - "Retry bound kept symmetric (3 attempts) across both the /remember and /recall halves, per RESEARCH.md's Open Question 1 recommendation"
  - "assert_tool_event() reads TOOL_EVENT_REGEX/TOOL_EVENT_CANARY only from process.env (never argv-interpolated), matching seed_canary()'s existing discipline"

patterns-established:
  - "Standalone Node matcher modules under scripts/lib/ for parsing untrusted-ish CLI NDJSON output, invoked via a thin bash wrapper function"

requirements-completed: [OCP-07]

coverage:
  - id: D1
    description: "assert-tool-event.mjs distinguishes a genuine tool_use event (with optional canary linkage) from a narrated-but-unexecuted text-event mention"
    requirement: "OCP-07"
    verification:
      - kind: unit
        ref: "scripts/test-remember-recall-assertions.sh (5/5 fixture cases: genuine-write PASS, canary-search PASS, missing-canary FAIL, narrated-text FAIL, empty-input FAIL)"
        status: pass
    human_judgment: false
  - id: D2
    description: "run_stage_remember_recall drives both halves through opencode serve/--attach, asserts via the NDJSON parser, and retries only on infra failure"
    requirement: "OCP-07"
    verification:
      - kind: other
        ref: "bash -n scripts/verify-opencode-live-parity.sh (syntax) + structural greps for assert_tool_event/--attach/LAST_ROUNDTRIP_RETRIES"
        status: pass
    human_judgment: true
    rationale: "Live 5/5 soak behavior against a real tool-call-reliable model can only be proven in an environment with CAIRN_LLM_* configured — not runnable in this sandbox; Plan 02's --repeat 5 soak is the live proof point."

duration: 15min
completed: 2026-07-08
status: complete
---

# Phase 13 Plan 01: NDJSON Tool-Event Matcher + Hardened Round-Trip Stage Summary

**Genuine NDJSON tool_use event parsing (with canary linkage) replaces substring greps in `run_stage_remember_recall`, which now drives both remember/recall turns through opencode serve/`--attach` and retries only on infra failure.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-08T16:15:00+02:00
- **Completed:** 2026-07-08T16:24:00+02:00
- **Tasks:** 2 completed
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- Standalone `scripts/lib/assert-tool-event.mjs` module parses `opencode run --format json` NDJSON, matching only genuine `type: "tool_use"` events (never a narrated mention inside a `text` event) — closing the D-08 false-positive class.
- `scripts/test-remember-recall-assertions.sh` offline fixture test (5/5 cases, using verbatim live-captured NDJSON lines from 13-RESEARCH.md) proves the matcher's genuine-vs-narrated and canary-linkage behavior without needing a live model.
- `run_stage_remember_recall()` converted to `opencode serve`/`--attach` transport (D-11) with a bracketed-tag guard when the capture server isn't running, canary-linked NDJSON assertions for both halves (D-09), and D-13's infra-only retry split (timeout/empty-output retries up to 3 attempts per half; a cleanly-completed run with no matching tool event is a hard FAIL, logged via `LAST_ROUNDTRIP_RETRIES`).

## Task Commits

Each task was committed atomically (Task 1 followed TDD RED→GREEN):

1. **Task 1a (RED): failing fixture test** - `5c66ae8` (test)
2. **Task 1b (GREEN): NDJSON tool-event matcher** - `53c462c` (feat)
3. **Task 2: convert run_stage_remember_recall** - `108eff6` (feat)

**Plan metadata:** committed as part of this SUMMARY (worktree mode — orchestrator merges).

## Files Created/Modified
- `scripts/lib/assert-tool-event.mjs` - Standalone Node NDJSON tool-event matcher; reads TOOL_EVENT_REGEX/TOOL_EVENT_CANARY from process.env only
- `scripts/test-remember-recall-assertions.sh` - Offline fixture test, self-contained via inline single-quoted heredocs of the verbatim RESEARCH.md capture lines
- `scripts/verify-opencode-live-parity.sh` - Added `LAST_ROUNDTRIP_RETRIES` global, `assert_tool_event()` wrapper, and converted `run_stage_remember_recall()`

## Decisions Made
- Kept the retry bound symmetric (3 attempts) across both halves rather than preserving the old asymmetric shape (remember had no retry, recall had 3) — the retry's purpose changed from "absorb model narration variance" to "absorb infra flakiness," which applies equally to both halves (per RESEARCH.md Open Question 1's recommendation).
- Continued scanning subsequent tool_use lines when a canary check fails on one match, rather than exiting 1 immediately on first non-canary-matching tool_use line — matches the plan's literal spec ("exit(1) after end-of-stream with no match").

## Deviations from Plan

None — plan executed exactly as written. Both tasks' acceptance criteria were verified directly:
- `scripts/test-remember-recall-assertions.sh` exits 0, all 5 fixture cases pass, file is executable.
- `bash -n scripts/verify-opencode-live-parity.sh` exits 0.
- `grep -c 'assert_tool_event'` returns 7 (>= 3 required: wrapper definition + call sites + doc comments).
- `--attach "$CAPTURE_SERVE_URL"` present on both the /remember and /recall invocations (and the unseeded recall path).
- `LAST_ROUNDTRIP_RETRIES` is assigned (reset at function entry, incremented only on infra retry).
- The stage guards on empty `CAPTURE_SERVE_URL` with a bracketed-tag FAIL message.

## Issues Encountered
- The Edit tool refused to apply patches to this pre-existing tracked file (`scripts/verify-opencode-live-parity.sh`) despite being read immediately beforehand — a previously-seen environment quirk. Worked around by using `python3` exact-match string replacement for the two structural edits (LAST_ROUNDTRIP_RETRIES global, assert_tool_event wrapper, run_stage_remember_recall body), verified byte-for-byte against the plan's specified diff before committing.

## User Setup Required

None - no external service configuration required. (Live execution of the hardened stage still requires an operator-configured `CAIRN_LLM_*` tool-call-reliable local model, per D-05/D-07 — unchanged from before this plan, not a new requirement introduced here.)

## Next Phase Readiness
- `assert-tool-event.mjs` and `assert_tool_event()` are ready for Plan 02's `--repeat N` soak loop to consume directly (no further parser work needed).
- The hardened `run_stage_remember_recall` is ready for a live 5/5 soak once an operator environment with `CAIRN_LLM_API_KEY`/`CAIRN_LLM_API_URL`/`CAIRN_LLM_EXTRACTION_MODEL` is available — this plan's own sandbox has no live model configured, matching RESEARCH.md's documented environment gap.
- No blockers for Plan 02.

---
*Phase: 13-headless-harness-hardening*
*Completed: 2026-07-08*
