---
phase: 26-guided-setup-and-harness-onboarding
plan: "06"
subsystem: cli
tags: [setup, reconciliation, windows, completions, doctor]

requires:
  - phase: 26-02
    provides: Setup output, completion, platform, and package contracts
  - phase: 26-03
    provides: Setup doctor lifecycle contract
  - phase: 26-04
    provides: Strict setup planning, policy validation, and ownership-safe reconciliation
provides:
  - Public guided and deterministic cairn setup controller with exact usage and operational exits
  - Shared POSIX and Windows dispatch with selected native launch assets
  - Bash, zsh, fish, and PowerShell setup completion parity
  - Read-only complete, Git-less, and incomplete setup-state diagnosis
affects: [26-07-pi-lifecycle, 26-08-documentation, 26-09-learning, release-readiness]

tech-stack:
  added: []
  patterns: [single Node setup policy path, confirmation-before-mutation, digest-backed doctor diagnosis]

key-files:
  created: [scripts/setup.mjs]
  modified: [scripts/cairn-cli.mjs, scripts/windows-platform.mjs, scripts/completion.sh, scripts/doctor.sh]

key-decisions:
  - "Keep project setup and machine synchronization separate: setup reports an exact sync command but never invokes it."
  - "Use the same setup module on POSIX and Windows, augmenting only the selected native launcher assets in the Windows dispatcher."
  - "Diagnose only setup-owned project assets here; the explicit Pi machine-extension status remains owned by Plan 26-07."

patterns-established:
  - "Setup orchestration: parse and preflight before plan construction, then mutate only after explicit confirmation."
  - "Operator output: one bounded result object drives JSON and human rendering, including deterministic counts and recovery."

requirements-completed: [SETUP-01, SETUP-02, SETUP-03, SETUP-05, SETUP-06, OVERLAY-01]

coverage:
  - id: D1
    description: Public setup supports explicit non-TTY replay, TTY prompting, exact usage exits, and confirmation-before-write behavior.
    requirement: SETUP-01
    verification:
      - kind: integration
        ref: scripts/test-setup-output.sh
        status: pass
      - kind: integration
        ref: scripts/test-setup-preflight.mjs
        status: pass
    human_judgment: false
  - id: D2
    description: POSIX and Windows use one setup policy flow with equivalent selected assets and output state.
    requirement: SETUP-02
    verification:
      - kind: integration
        ref: scripts/test-windows-native.mjs
        status: pass
      - kind: integration
        ref: scripts/test-package-install.sh
        status: pass
    human_judgment: false
  - id: D3
    description: All supported shell completions expose the same setup command, flags, and values.
    requirement: SETUP-05
    verification:
      - kind: integration
        ref: scripts/test-completion.sh
        status: pass
    human_judgment: false
  - id: D4
    description: Doctor distinguishes complete, intentional Git-less, and malformed or drifted setup-owned project state without repair.
    requirement: SETUP-06
    verification:
      - kind: integration
        ref: scripts/test-doctor.sh plus direct complete/limited/incomplete branch probe
        status: pass
    human_judgment: false
  - id: D5
    description: Legacy bootstrap bytes and output remain compatible while setup uses ownership-safe reconciliation.
    requirement: OVERLAY-01
    verification:
      - kind: integration
        ref: scripts/test-setup-compatibility.mjs and scripts/test-setup-reconcile.mjs
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-08-12
status: complete
---

# Phase 26 Plan 06: Public Guided Setup Summary

**A single cross-platform setup controller now confirms deterministic project plans, reconciles only selected assets, reports explicit recovery and machine-sync guidance, and exposes bounded setup health diagnostics.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-08-12T10:28:45Z
- **Completed:** 2026-08-12T10:42:26Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- Added `cairn setup` with TTY prompting, deterministic non-TTY flags and policy defaults, exact status-2 usage failures, distinct operational errors, confirmation-before-write ordering, and shared JSON/human results.
- Routed Windows through the same controller, reconciled only selected native launchers, and added identical setup choices to Bash, zsh, fish, and PowerShell completions.
- Added read-only setup-state diagnosis that verifies private state shape, required ownership records, file digests and modes, and produces bounded complete, Git-less, or incomplete recovery output.

## Task Commits

Each task was committed atomically:

1. **Task 1: Orchestrate guided and deterministic setup through the public CLI** - `8212e96` (feat)
2. **Task 2: Add Windows-equivalent dispatch and all shell completions** - `0a294b1` (feat)
3. **Task 3: Diagnose complete, limited, and incomplete setup states** - `876b982` (feat)

The RED contracts for these TDD-marked tasks were committed in Plans 26-01 through 26-03; this plan contains their GREEN production commits.

## Files Created/Modified

- `scripts/setup.mjs` - Shared setup orchestration, result rendering, deterministic recovery, and setup-state diagnosis.
- `scripts/cairn-cli.mjs` - Public setup help and POSIX Node dispatch.
- `scripts/windows-platform.mjs` - Shared setup route, selected Windows launch assets, and PowerShell completion.
- `scripts/completion.sh` - Bash, zsh, and fish setup command/flag/value completion.
- `scripts/doctor.sh` - Bounded complete, Git-less, and incomplete project setup diagnosis.

## Decisions Made

- Setup never invokes machine sync; it returns the exact explicit command so user authority remains intact.
- Windows reuses the common setup controller and only supplies native launch assets, preventing a second policy implementation.
- Plan 26-06 diagnoses setup-owned project assets only. Plan 26-07 remains responsible for explicit Pi machine-extension sync, status, and uninstall lifecycle.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The combined doctor contract intentionally keeps its Pi lifecycle section gated until Plan 26-07 adds explicit machine-extension sync/status. The Plan 26-06 complete, Git-less, and malformed-state branches were also exercised directly and passed without enabling that future lifecycle owner early.

## User Setup Required

None - no external service configuration required.

## Verification

- `node scripts/test-setup-preflight.mjs` - PASS
- `node scripts/test-setup-compatibility.mjs` - PASS
- `node scripts/test-setup-reconcile.mjs` - PASS
- `bash scripts/test-setup-output.sh` - PASS
- `bash scripts/test-completion.sh` - PASS
- `node scripts/test-windows-native.mjs` - PASS
- `bash scripts/test-doctor.sh` - PASS; later Pi lifecycle block intentionally gated to Plan 26-07
- Direct complete, Git-less, and malformed setup-state doctor probe - PASS
- `bash scripts/test-package-install.sh` - PASS
- `bash scripts/verify-no-private-references.sh` - PASS

## Next Phase Readiness

- Public setup, platform dispatch, completions, and project-state diagnosis are ready for Plan 26-07's explicit Pi machine lifecycle and backup-first uninstall integration.
- No implementation blocker remains for the next plan.

## Self-Check: PASSED

- All five task-owned production files and this summary exist.
- Task commits `8212e96`, `0a294b1`, and `876b982` are present in repository history.
- Plan-wide setup, compatibility, reconciliation, output, completion, simulated Windows, doctor, package-install, and public-reference checks passed.

---
*Phase: 26-guided-setup-and-harness-onboarding*
*Completed: 2026-08-12*
