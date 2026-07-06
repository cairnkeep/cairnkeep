---
phase: 09-live-verification-a-b-token-savings
plan: 01
subsystem: testing
tags: [bash, git-grep, jq, harness, token-estimate, ctx-07]

# Dependency graph
requires:
  - phase: 08-operating-layer-wiring
    provides: "context_explore MCP tool + renderCitations compact citation surface (locked D-02)"
provides:
  - "Committed, re-runnable A/B token-savings harness scripts/verify-token-savings-ab.sh"
  - "Offline --self-test Nyquist backstop covering delta arithmetic, D-03 gate, renderCitations-shape reproduction"
  - "--native offline before-side measurement against cairnkeep's own repo"
  - "--explore/--full operator-gated live stages (fail-loud, D-04)"
affects: [09-02 (live A/B run + 09-AB.md recorded number)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Staged env-driven loopback-safe harness (mirrors verify-fastcontext-reliability.sh): --self-test / --native / --explore / --full / -h"
    - "Byte/char delta as mandatory ground-truth anchor; chars/4 as the provider-neutral token estimate (D-01a)"
    - "Presence-only env logging (log_repo_presence) — never echoes the repo path or binary path"
    - "Fail-loud on missing prerequisite (D-04) rather than silent skip"

key-files:
  created:
    - scripts/verify-token-savings-ab.sh
  modified: []

key-decisions:
  - "D-03 net_savings_gate operates on aggregate byte totals across the whole query set (not the median percentage); the median byte-savings percentage is computed and reported separately as an additional per-query statistic. The gate's own signature (native_bytes, explore_bytes) only accepts byte counts, and 'shows net savings > 0' reads most naturally as an aggregate check — documented inline in run_full()'s comment."
  - "Native recipe patterns picked and verified empirically against cairnkeep's own repo before committing: containment / AgentFS.*scope / git-provider / memory-wakeup / infraRoot, each confirmed to yield >12 git-grep hits (so the 12-hit cap is meaningfully exercised)."
  - "Explore-side binary resolution falls back to `token_miser` on PATH when CAIRN_EXPLORE_BINARY is unset, mirroring context_explore's real env var name for consistency with the actual tool."

patterns-established:
  - "Self-test fixtures for a bash harness: canned JSON test both the PASS and loud-FAIL directions of any gate function, and directly exercise the same helper functions (render_citation_text, net_savings_gate) the live stages call — no duplicated logic between self-test and live paths."

requirements-completed: [CTX-07]

coverage:
  - id: D1
    description: "scripts/verify-token-savings-ab.sh --self-test passes offline (byte/char arithmetic, chars/4 estimate, D-03 gate both directions, renderCitations-shape reproduction)"
    requirement: "CTX-07"
    verification:
      - kind: other
        ref: "scripts/verify-token-savings-ab.sh --self-test (exit 0, prints [self-test] PASSED)"
        status: pass
    human_judgment: false
  - id: D2
    description: "scripts/verify-token-savings-ab.sh --native --repo . computes deterministic per-query native byte/char counts offline, no backend required"
    requirement: "CTX-07"
    verification:
      - kind: other
        ref: "scripts/verify-token-savings-ab.sh --native --repo . (exit 0, per-query query= lines present)"
        status: pass
    human_judgment: false
  - id: D3
    description: "scripts/verify-token-savings-ab.sh --explore fails loud (non-zero, documented-gap message) when no exploration binary is available, per D-04"
    requirement: "CTX-07"
    verification:
      - kind: other
        ref: "CAIRN_EXPLORE_BINARY='' PATH=/usr/bin:/bin scripts/verify-token-savings-ab.sh --explore --repo . (exit 1, 'documented gap' present)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Live --explore/--full runs against a real token_miser backend, and the recorded measured A/B number in 09-AB.md/09-SUMMARY.md"
    verification: []
    human_judgment: true
    rationale: "Requires an operator-provided FastContext + token_miser explore backend (Phase 6 D-07 runtime prerequisite); deferred to Plan 02 per this plan's scope (harness only, not the live run)."

# Metrics
duration: 3min
completed: 2026-07-06
status: complete
---

# Phase 9 Plan 01: A/B Token-Savings Harness Summary

**Committed `scripts/verify-token-savings-ab.sh` — a staged, env-driven, loopback-only harness that computes the native-grep-and-read vs `context_explore` citation-text byte/char delta deterministically, with an offline `--self-test` Nyquist backstop and a fail-loud operator-gated live `--explore` stage.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-07-06T13:05:00+02:00
- **Completed:** 2026-07-06T13:08:30+02:00
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments
- Staged harness (`--self-test` / `--native` / `--explore` / `--full` / `-h`) mirroring the Phase 6 `verify-fastcontext-reliability.sh` discipline: loopback-safe config, presence-only env logging, evidence-log append helper.
- Deterministic offline native-side measurement: 5 curated cairnkeep exploration queries, each paired with a fixed `git grep -nE` pattern, a ±25-line window, and a 12-hit cap — recipe table committed to the header comment for auditability (D-02).
- Explore-side byte counting reproduces `renderCitations()`'s exact `path:start-end` text shape (and its empty-citations note string) via one `jq -e -r` expression, never counting the full Evidence JSON — with fail-loud handling for a missing/non-executable binary, timeout, non-zero exit, or malformed JSON (D-04).
- `--full` computes the per-query byte/char/chars-4-token-estimate delta, the median byte-savings percentage, and applies the D-03 net-savings gate to the aggregate byte totals — a savings ≤ 0 result is a loud, documented finding, never a silent pass.
- Offline `--self-test` proves the byte-delta arithmetic, the D-03 gate in both the PASS and loud-FAIL directions, and the exact `renderCitations`-shape reproduction (populated + empty-citations cases) — the Nyquist backstop for Plan 02's operator-gated live run.

## Task Commits

Each task was committed atomically:

1. **Task 1: Harness scaffold** - `25fc384` (feat)
2. **Task 2: Measurement stages (--native/--explore/--full)** - `c3848a1` (feat)
3. **Task 3: --self-test offline Nyquist backstop** - `ac10b0a` (test)

_Note: this is not a TDD-tagged plan; commits are feat/feat/test in task order, not RED/GREEN/REFACTOR._

## Files Created/Modified
- `scripts/verify-token-savings-ab.sh` - New committed A/B token-savings harness for CTX-07 (557 lines, executable)

## Decisions Made
- D-03 gate applied to aggregate byte totals (sum across all 5 queries), not the per-query median percentage — the gate's own signature only accepts byte counts, and this is the more natural reading of "net savings > 0" as an aggregate/total measure. The median percentage is still computed and reported per the plan's requirement, just as an additional statistic rather than the gate's input. Documented inline in `run_full()`.
- Native-recipe grep patterns (`containment`, `AgentFS.*scope`, `git-provider`, `memory-wakeup`, `infraRoot`) were empirically verified against cairnkeep's own repo before committing — each yields well over the 12-hit cap, so the cap is meaningfully exercised rather than always under-filled.
- `CAIRN_EXPLORE_BINARY` empty-string default plus PATH fallback to `token_miser` mirrors the real `context_explore` MCP tool's env var contract for consistency, even though this harness's `--native` side is an independent offline replica (it never calls the real tool).

## Deviations from Plan

None - plan executed exactly as written. The only judgment call made was the aggregate-vs-median gate-input resolution described above, which is a minor, defensible interpretation of ambiguous plan wording (Task 2's action text), not a deviation from any explicit instruction — documented as a decision, not tracked under the Rule 1-4 deviation framework.

## Issues Encountered

None. `shellcheck` is not installed in this environment, so the shellcheck portion of each task's automated verification was skipped (the plan's verify commands guard this with `if command -v shellcheck`); `bash -n`, `--help`, `--self-test`, `--native --repo .`, and the `--explore`/`--full` fail-loud paths were all run and passed.

## User Setup Required

None - no external service configuration required. Plan 02's live `--explore`/`--full` run will require an operator-provided FastContext + `token_miser` backend (Phase 6 D-07 runtime prerequisite), but that is Plan 02's concern, not this plan's.

## Next Phase Readiness
- The harness is committed, executable, and passes every offline verification bullet in the plan (`--self-test`, `--native --repo .`, `--explore` fail-loud).
- Plan 02 can proceed directly to the operator-gated live run (`--explore`/`--full` against a real `token_miser` backend) and record the measured A/B number in `09-AB.md`/`09-SUMMARY.md`.
- No blockers.

---
*Phase: 09-live-verification-a-b-token-savings*
*Completed: 2026-07-06*

## Self-Check: PASSED

- FOUND: scripts/verify-token-savings-ab.sh
- FOUND: 25fc384
- FOUND: c3848a1
- FOUND: ac10b0a
