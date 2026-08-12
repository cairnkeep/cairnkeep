---
phase: 26-guided-setup-and-harness-onboarding
plan: "03"
subsystem: testing
tags: [doctor, uninstall, pi, lifecycle, learning, red-contracts]
requires:
  - phase: 26-01
    provides: Exact five-entry Phase 26 manifest and RED-only dispatch proof
provides:
  - Setup-state and Pi drift doctor RED contracts
  - Backup-first Pi memory-extension uninstall RED contract
  - Cross-platform Pi sync/status/recovery lifecycle RED contract
  - Ready L23 lesson and required track-routing RED contract
affects: [26-06, 26-07, 26-08, 26-09]
tech-stack:
  added: []
  patterns: [baseline-before-gate, explicit exit-86 RED mode, complete-surface auto-activation]
key-files:
  created:
    - scripts/test-pi-lifecycle.mjs
  modified:
    - scripts/test-uninstall.sh
    - scripts/test-doctor.sh
    - scripts/test-learning-docs.sh
key-decisions:
  - Project setup must prove selected Pi launchers without auto-syncing machine assets.
  - Pi removal backs up even operator-modified owned extensions while preserving neighboring files, memory, and context packs.
  - Native Pi and Windows evidence remains a release-readiness gate and is not inferred from fixtures or simulation.
metrics:
  duration: 6m
  completed: 2026-08-12
status: complete
---

# Phase 26 Plan 03: Doctor, Uninstall, Pi Lifecycle, and Learning RED Contracts Summary

Executable RED coverage now fixes the setup/Pi lifecycle boundary from selected project launchers through explicit machine sync, drift diagnosis, backup-first removal, recovery, and Ready L23 curriculum routing.

## Performance

- **Duration:** 6 minutes
- **Started:** 2026-08-12T09:59:15Z
- **Completed:** 2026-08-12T10:05:20Z
- **Tasks:** 1
- **Files changed:** 4

## Accomplishments

- Extended doctor coverage for complete, intentionally Git-less limited, incomplete, and missing selected Pi extension states with bounded actionable recovery.
- Extended uninstall coverage for exact backup/manifest/revert of an operator-modified owned Pi memory extension while neighboring extensions, durable memory, and context packs remain unchanged.
- Added a POSIX/Windows-neutral Node lifecycle fixture covering selected/deselected launchers, the no-auto-sync boundary, explicit sync/check, missing-extension drift, and reversible uninstall.
- Required a Ready L23 guided-setup lesson with both Quickstart and Operator routes, deterministic replay, local stdio, limited mode, recovery, uninstall, privacy, cancellation, and version metadata.
- Revalidated that the shared Phase 26 manifest contains exactly five RED-only Node contracts and routine dispatch schedules none.

## Task Commits

1. **Task 1: Define RED doctor, uninstall, Pi lifecycle, learning, and runner contracts** - `f7028e7`

## Files Created/Modified

- `scripts/test-uninstall.sh` - Pi memory-extension ownership, backup, manifest, preservation, and exact revert contract.
- `scripts/test-doctor.sh` - Complete/limited/incomplete setup and Pi drift recovery contract.
- `scripts/test-learning-docs.sh` - Ready L23 contents, version metadata, and Quickstart/Operator reachability contract.
- `scripts/test-pi-lifecycle.mjs` - Cross-platform selected-launcher, explicit sync, status, drift, uninstall, and preservation lifecycle contract.

## Decisions Made

- Kept the three automatically discovered shell tests baseline-green before their independent Phase 26 gates.
- Required complete owned production surfaces before normal Phase 26 assertions activate, avoiding failures from partially landed parallel GREEN work.
- Kept the Node Pi lifecycle contract direct-RED until Plan 26-09 changes the manifest state after every owner and learning route is complete.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None. The explicit RED gates are intentional executable contracts and automatically yield to normal assertions when their complete production owners exist.

## Verification

- `bash scripts/test-uninstall.sh && bash scripts/test-doctor.sh && bash scripts/test-learning-docs.sh` - PASS after all established baseline assertions.
- Explicit uninstall/doctor/learning RED invocation plus direct Pi lifecycle contract - PASS with exit statuses `86,86,86,86`.
- `node scripts/run-repository-tests.mjs --verify-phase26-registration=red` - PASS; exact five-entry manifest remains RED-only and routine scheduling remains empty.
- `bash scripts/verify-no-private-references.sh` - PASS.
- Shell syntax, Node syntax, and Git whitespace checks - PASS.

## Self-Check: PASSED

- All four task-owned test files exist.
- Task commit `f7028e7` exists in repository history.
- No tracked file deletions occurred.
- Orchestrator-owned `.planning/PROJECT.md`, `.planning/ROADMAP.md`, and `.planning/STATE.md` were not staged or modified by this plan executor.

---
*Phase: 26-guided-setup-and-harness-onboarding*
*Completed: 2026-08-12*
