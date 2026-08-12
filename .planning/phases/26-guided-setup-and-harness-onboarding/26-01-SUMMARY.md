---
phase: 26-guided-setup-and-harness-onboarding
plan: "01"
subsystem: testing
tags: [setup, git-preflight, reconciliation, mcp, pi, stdio, tdd]

requires: []
provides:
  - "Attributable RED contracts for setup choices, target/Git preflight, and legacy bootstrap compatibility"
  - "Digest-based ownership, containment, privacy, interruption, and idempotence reconciliation contract"
  - "Exact Pi 0.84.1-style fake API and paginated stdio MCP bridge lifecycle contract"
  - "Single five-entry Phase 26 manifest consumed by routine and RED-registration dispatch"
affects: [26-03, 26-04, 26-05, 26-06, guided-setup, pi-mcp]

tech-stack:
  added: []
  patterns:
    - "Self-validating fixtures reach exit 86 only for the exact missing production module"
    - "One manifest owns deferred Node contract registration and routine eligibility"
    - "Direct MCP tools/list output is the bridge catalog oracle"

key-files:
  created:
    - scripts/test-setup-preflight.mjs
    - scripts/test-setup-compatibility.mjs
    - scripts/test-setup-reconcile.mjs
    - scripts/phase26-test-manifest.mjs
    - mcp-memory-server/scripts/smoke-pi-mcp-bridge.mjs
  modified:
    - scripts/run-repository-tests.mjs

key-decisions:
  - "Keep every Phase 26 Node contract RED-only in one manifest until its GREEN owner changes that entry to routine."
  - "Treat direct paginated MCP discovery as the sole Pi catalog oracle and retain annotations in trusted details without claiming a native Pi annotations field."
  - "Preserve the POSIX and native-Windows bootstrap implementations as byte, mode, output, rerun, and untracked compatibility oracles."

patterns-established:
  - "Attributable RED: fixtures validate themselves and existing baselines before classifying only an exact missing production module as exit 86."
  - "Deferred dispatch: the repository runner imports one manifest and filters only entries explicitly marked routine."

requirements-completed: [SETUP-01, SETUP-02, SETUP-03, SETUP-04, PI-MCP-01, PI-MCP-02]

coverage:
  - id: D1
    description: "Setup target, Git, choice, no-write, and legacy bootstrap compatibility RED contracts"
    requirement: SETUP-01
    verification:
      - kind: integration
        ref: "node scripts/test-setup-preflight.mjs and node scripts/test-setup-compatibility.mjs return attributable exit 86"
        status: pass
      - kind: integration
        ref: "bash scripts/test-bootstrap-untracked.sh"
        status: pass
    human_judgment: false
  - id: D2
    description: "Ownership-safe reconciliation RED contract with digest decisions, stable mtimes, containment, privacy, and interruption recovery"
    requirement: SETUP-04
    verification:
      - kind: integration
        ref: "node scripts/test-setup-reconcile.mjs returns attributable exit 86"
        status: pass
    human_judgment: false
  - id: D3
    description: "Dynamic Pi MCP bridge RED contract and exact five-entry deferred runner manifest"
    requirement: PI-MCP-02
    verification:
      - kind: integration
        ref: "node mcp-memory-server/scripts/smoke-pi-mcp-bridge.mjs returns attributable exit 86 after fake-server checks"
        status: pass
      - kind: integration
        ref: "node scripts/run-repository-tests.mjs --verify-phase26-registration=red"
        status: pass
      - kind: integration
        ref: "cd mcp-memory-server && npm ci && npm run build && npm test"
        status: pass
    human_judgment: false

duration: 15 min
completed: 2026-08-12
status: complete
---

# Phase 26 Plan 01: Setup and Pi Bridge RED Contracts Summary

**Deterministic setup preflight, ownership reconciliation, and Pi stdio bridge contracts with attributable RED markers and one deferred five-entry test manifest**

## Performance

- **Duration:** 15 min
- **Started:** 2026-08-12T09:26:31Z
- **Completed:** 2026-08-12T09:41:51Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Pinned malformed and incomplete non-TTY setup choices to exact usage status 2, separated operational target/Git classes, and required zero managed-path writes before the missing setup core may classify RED.
- Defined desired/current/prior-digest reconciliation branches, exact counts, stable mtimes, user-byte preservation, strict relative state, unsafe-path refusal, and interrupted atomic replacement behavior.
- Built a paginated fake stdio MCP server and exact Pi lifecycle fixture covering effective profiles, trusted metadata, result conversion, cancellation, crash, shutdown, collisions, and the absence of prompt/loop/remote surfaces.
- Refactored repository Node-contract dispatch around one exact five-entry manifest whose initially RED-only entries are structurally verified but never scheduled routinely.

## Task Commits

Each task was committed atomically:

1. **Task 1: Define RED target, Git, and bootstrap compatibility contracts** - `2794990` (test)
2. **Task 2: Define RED ownership-safe reconciliation contracts** - `1f506fc` (test)
3. **Task 3: Define RED dynamic Pi bridge contracts and a deferred routine manifest** - `ca3602b` (test)

## Files Created/Modified

- `scripts/test-setup-preflight.mjs` - Pure choice, syntax, target, Git, and no-write RED matrix.
- `scripts/test-setup-compatibility.mjs` - POSIX/Windows bootstrap byte, mode, output, rerun, and untracked compatibility oracle.
- `scripts/test-setup-reconcile.mjs` - Three-way ownership, counts, mtime, containment, privacy, and interruption RED matrix.
- `mcp-memory-server/scripts/smoke-pi-mcp-bridge.mjs` - Fake Pi API plus paginated stdio catalog/call/lifecycle bridge contract.
- `scripts/phase26-test-manifest.mjs` - Exact five-entry RED-only/routine inventory and structural validator.
- `scripts/run-repository-tests.mjs` - Shared manifest-driven dispatch and executable RED-registration proof.

## Decisions Made

- The runner contains no duplicate Phase 26 path list; manifest validation and normal scheduling consume the same entries.
- Pi annotations remain exact trusted bridge details and safety inputs, with an explicit assertion that Pi 0.84.1 registrations have no invented native annotations field.
- Setup compatibility is measured against the unchanged legacy implementations instead of routing bootstrap through future guided setup.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The fresh worktree initially had no `mcp-memory-server/node_modules`; the plan-required `npm ci` restored the existing lockfile dependency set with zero vulnerabilities and no manifest or lockfile changes.

## Known Stubs

None - empty arrays and nullable defaults in the new files are fixture accumulators or optional test parameters, not product/UI placeholders. The intentional RED module boundaries are the deliverable of this plan and are owned by Plans 26-04 and 26-05.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plans 26-03 through 26-06 can consume the exact manifest, setup export contracts, and Pi bridge fixture.
- All four contracts remain intentionally RED-only until their named production owners land; routine root and server suites remain green.

## Self-Check: PASSED

- All five created contract/manifest files and the modified runner exist.
- Task commits `2794990`, `1f506fc`, and `ca3602b` are present in history.
- Coverage metadata validates, all four RED wrappers pass, the manifest proof passes, the legacy bootstrap baseline passes, and the full server suite passes.

---
*Phase: 26-guided-setup-and-harness-onboarding*
*Completed: 2026-08-12*
