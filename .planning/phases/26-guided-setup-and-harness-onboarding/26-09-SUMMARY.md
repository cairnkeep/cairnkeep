---
phase: 26-guided-setup-and-harness-onboarding
plan: "09"
subsystem: learning-and-release-verification
tags: [guided-setup, pi, mcp, curriculum, acceptance-testing]

requires:
  - phase: 26-guided-setup-and-harness-onboarding
    provides: guided setup runtime, compatibility lifecycle, Pi bridge, overlays, and public operator documentation
provides:
  - Ready L23 guided setup lesson with consistent curriculum and track routing
  - Exact five-contract Phase 26 routine test dispatch
  - Provider-neutral real-Pi minimum/current release acceptance runner
affects: [release-readiness, public-learning, root-test-dispatch, pi-mcp-compatibility]

tech-stack:
  added: []
  patterns: [shared-manifest dispatch verification, isolated executable acceptance fixtures, sanitized machine-readable release evidence]

key-files:
  created:
    - docs/learning/lessons/L23-guided-setup.md
    - scripts/verify-pi-mcp-bridge.mjs
  modified:
    - docs/learning/README.md
    - docs/learning/CURRICULUM-MAP.md
    - docs/learning/FEATURE-GUIDE.md
    - docs/learning/tracks/quickstart.md
    - docs/learning/tracks/operator.md
    - scripts/phase26-test-manifest.mjs
    - scripts/run-repository-tests.mjs

key-decisions:
  - "Keep Pi 0.84.1 provisional in public learning material until the required-release runner passes against real minimum and current executables."
  - "Preserve annotations in trusted bridge metadata and call details without claiming unsupported native Pi annotation fields."
  - "Keep real-Pi acceptance outside automatic test discovery while making required-release mode structurally non-skippable."

patterns-established:
  - "Curriculum readiness: publish the canonical lesson and all required track routes before switching its runtime contracts to routine dispatch."
  - "Release acceptance: isolate executable runs, compare direct and bridged catalogs exactly, and emit only allow-listed evidence."

requirements-completed: [SETUP-05, SETUP-06, PI-MCP-01, PI-MCP-02, PI-MCP-03]

coverage:
  - id: D1
    description: "Ready L23 teaches deterministic guided setup, Git-less limits, Pi stdio operation, recovery, uninstall, privacy, and the annotation boundary."
    requirement: SETUP-05
    verification:
      - kind: integration
        ref: "bash scripts/test-learning-docs.sh"
        status: pass
      - kind: integration
        ref: "bash scripts/verify-docs-parity.sh"
        status: pass
    human_judgment: false
  - id: D2
    description: "Quickstart and Operator tracks route to the same provisional Ready L23 lesson without release claims."
    requirement: SETUP-06
    verification:
      - kind: integration
        ref: "bash scripts/test-learning-docs.sh"
        status: pass
    human_judgment: false
  - id: D3
    description: "Root dispatch schedules each of the five Phase 26 setup and Pi contracts exactly once through the shared routine manifest."
    requirement: PI-MCP-01
    verification:
      - kind: integration
        ref: "node scripts/run-repository-tests.mjs --verify-phase26-registration=routine"
        status: pass
      - kind: integration
        ref: "npm test"
        status: pass
    human_judgment: false
  - id: D4
    description: "Real-Pi acceptance validates minimum/current versions, profile catalogs, trusted metadata, calls, cancellation, shutdown, and orphan cleanup with non-skipping release semantics."
    requirement: PI-MCP-03
    verification:
      - kind: integration
        ref: "node scripts/verify-pi-mcp-bridge.mjs --self-test"
        status: pass
      - kind: integration
        ref: "node scripts/verify-pi-mcp-bridge.mjs"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-08-12
status: complete
---

# Phase 26 Plan 09: Guided Setup Learning and Real-Pi Acceptance Summary

**Ready guided-setup curriculum, exact routine contract dispatch, and an isolated real-Pi release gate covering catalogs, trusted details, calls, cancellation, shutdown, and child cleanup**

## Performance

- **Duration:** 22 min
- **Started:** 2026-08-12T11:21:06Z
- **Completed:** 2026-08-12T11:42:28Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- Published Ready L23 and linked it consistently from every curriculum index plus the Quickstart and Operator tracks.
- Activated the exact five Phase 26 contracts in routine root dispatch and added an executable proof of their paths, order, and uniqueness.
- Added a sanitized real-Pi acceptance runner with explicit default SKIP, non-skipping required-release mode, minimum/current version checks, three profile catalogs, trusted metadata/details comparison, harmless calls, cancellation, shutdown, and bounded orphan detection.

## Task Commits

Each task was committed atomically:

1. **Task 1: Publish the Ready L23 lesson and curriculum indexes** - `95aac3f` (feat)
2. **Task 2: Route Quickstart and Operator to L23, then activate the complete routine manifest** - `0faa3ba` (feat)
3. **Task 3: Create the executable real-Pi minimum/current acceptance runner** - `3e988bc` (feat)

## Files Created/Modified

- `docs/learning/lessons/L23-guided-setup.md` - Canonical guided setup, Pi operation, recovery, uninstall, privacy, and compatibility lesson.
- `docs/learning/README.md` - Adds L23 to the public lesson index.
- `docs/learning/CURRICULUM-MAP.md` - Records the Ready lesson sequence and tested surface.
- `docs/learning/FEATURE-GUIDE.md` - Maps guided setup and Pi onboarding features to L23.
- `docs/learning/tracks/quickstart.md` - Adds L23 to the Quickstart sequence.
- `docs/learning/tracks/operator.md` - Adds L23 to the Operator sequence.
- `scripts/phase26-test-manifest.mjs` - Promotes all five Phase 26 contracts to routine dispatch.
- `scripts/run-repository-tests.mjs` - Verifies the shared dispatcher schedules the exact five routine contracts once.
- `scripts/verify-pi-mcp-bridge.mjs` - Runs isolated minimum/current Pi conformance and deterministic self-tests.

## Decisions Made

- Public learning material identifies Pi 0.84.1 as a provisional minimum; release confidence requires an explicit current version and both real executables.
- The acceptance boundary compares annotations through trusted bridge catalogs and call details and rejects a native-registration annotation claim.
- Default fixture absence remains visible and non-blocking, while `--required-release` converts every missing or failed acceptance condition into a nonzero sanitized failure.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Real Pi executables were not supplied in the execution environment. The planned default path emitted the sanitized `real-pi-fixtures-unavailable` SKIP record; the deterministic self-test proved the required-release non-skip and all acceptance controls. A release invocation must still supply the two real executables.

## TDD Gate Compliance

- The Phase 26 RED learning and registration contracts were established before this GREEN plan and the learning contract was observed failing before Task 1 implementation.
- Task 3's deterministic self-test exercises success plus missing input, version mismatch, profile mismatch, cancellation, shutdown, orphan, and evidence-sanitization failures. This plan is `type: execute`, so the plan-level RED/GREEN commit gate does not apply.

## Known Stubs

None. The no-fixture SKIP mode is intentional release-runner behavior, not an implementation placeholder.

## User Setup Required

None for routine development. Release verification must provide executable Pi 0.84.1 and current-version fixtures through the documented command flags or equivalent environment variables.

## Next Phase Readiness

- Phase 26 learning, root dispatch, and public checks are green.
- Final release readiness can invoke `scripts/verify-pi-mcp-bridge.mjs --required-release` with real minimum/current Pi fixtures; required-release mode cannot skip.

## Verification

- `bash scripts/test-learning-docs.sh` - PASS
- `bash scripts/verify-docs-parity.sh` - PASS
- `node scripts/run-repository-tests.mjs --verify-phase26-registration=routine` - PASS, exact five contracts once
- `node scripts/verify-pi-mcp-bridge.mjs --self-test` - PASS
- `node scripts/verify-pi-mcp-bridge.mjs` - PASS with planned sanitized SKIP in the fixture-free environment
- `npm test` - PASS
- `npm run check:public` - PASS

## Self-Check: PASSED

- All nine implementation files and this summary exist in the feature worktree.
- Task commits `95aac3f`, `0faa3ba`, and `3e988bc` are present in repository history.
- The final implementation diff passes whitespace and privacy-reference checks.

---
*Phase: 26-guided-setup-and-harness-onboarding*
*Completed: 2026-08-12*
