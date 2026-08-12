---
phase: 26-guided-setup-and-harness-onboarding
plan: "07"
subsystem: lifecycle
tags: [pi, sync, doctor, uninstall, backup, windows]

requires:
  - phase: 26-03
    provides: Pi lifecycle, doctor, and uninstall RED contracts
  - phase: 26-05
    provides: Supervised Pi MCP bridge and package-owned memory extension
  - phase: 26-06
    provides: Selected-harness setup state and explicit machine-sync guidance
provides:
  - Explicit POSIX and Windows sync/check ownership for the Pi memory extension
  - Selected-project Pi bridge diagnosis with missing and drift recovery
  - Backup-first Pi extension removal and allow-listed guided-setup cleanup
  - Compatibility-preserving legacy Pi sync count output
affects: [26-08-documentation, 26-09-learning, uninstall, release-readiness]

tech-stack:
  added: []
  patterns: [explicit machine sync, bounded read-only diagnosis, recorded ownership intersected with package allowlist]

key-files:
  created: []
  modified: [scripts/sync-pi-assets.sh, scripts/windows-platform.mjs, scripts/doctor.sh, scripts/uninstall.sh]

key-decisions:
  - "Keep Pi machine installation explicit: project setup reports sync guidance but never invokes apply."
  - "Treat guided-setup state as candidate ownership only and intersect every recorded path with a fixed package allowlist before removal."
  - "Preserve the legacy two-asset Pi reconciliation count and report the new memory-extension result on a separate line."

patterns-established:
  - "Machine lifecycle: apply/check a fixed owned list while leaving neighboring harness configuration untouched."
  - "Safe uninstall: back up every managed candidate before removal and retain user data unless an explicit purge flag is present."

requirements-completed: [SETUP-05, SETUP-06, PI-MCP-03]

coverage:
  - id: D1
    description: POSIX and Windows explicitly install and check the Pi memory extension beside the existing trajectory and graph assets.
    requirement: PI-MCP-03
    verification:
      - kind: integration
        ref: scripts/test-pi-lifecycle.mjs
        status: pass
      - kind: integration
        ref: scripts/test-windows-native.mjs
        status: pass
    human_judgment: false
  - id: D2
    description: Doctor reports synchronized, missing, drifted, and incomplete selected-project Pi states without starting or repairing the bridge.
    requirement: SETUP-06
    verification:
      - kind: integration
        ref: scripts/test-doctor.sh
        status: pass
    human_judgment: false
  - id: D3
    description: Pi and guided-setup assets are removed backup-first while neighboring files, memory, and context packs remain preserved by default.
    requirement: SETUP-05
    verification:
      - kind: integration
        ref: scripts/test-uninstall.sh and guided ownership safety probe
        status: pass
      - kind: integration
        ref: scripts/test-pi-lifecycle.mjs
        status: pass
    human_judgment: false
  - id: D4
    description: Legacy bootstrap, graph adapter, package, doctor, uninstall, and platform contracts remain green.
    verification:
      - kind: integration
        ref: npm test
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-08-12
status: complete
---

# Phase 26 Plan 07: Pi Lifecycle and Safe Uninstall Summary

**Explicit Pi memory-extension synchronization, bounded bridge health diagnosis, and backup-first allow-listed uninstall now complete the cross-platform harness lifecycle without hidden setup side effects.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-08-12T10:55:06Z
- **Completed:** 2026-08-12T11:05:10Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added the Pi memory extension to POSIX and Windows apply/check ownership, including exact missing/drift recovery while preserving neighboring harness files.
- Added read-only doctor checks for selected-project bridge build and machine-extension status without starting the child process or installing assets.
- Made POSIX and Windows uninstall back up the Pi memory extension, and made guided-project cleanup accept only recorded paths that also appear in a fixed package-owned allowlist.
- Preserved memory, context packs, modified managed bytes, neighboring project files, and the established Pi sync output contract.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add explicit Pi memory-extension sync and cross-platform status** - `6fab6ac` (feat)
2. **Task 2: Integrate bridge doctor and backup-first uninstall** - `d27b264` (feat)
3. **Compatibility fix: Preserve established Pi sync count output** - `8cf4f3a` (fix)

The lifecycle RED contracts were committed in Plan 26-03; this plan contains their GREEN production commits.

## Files Created/Modified

- `scripts/sync-pi-assets.sh` - Three-asset Pi apply/check ownership, bounded recovery, and compatible reconciliation reporting.
- `scripts/windows-platform.mjs` - Equivalent Windows memory-extension sync and uninstall targets.
- `scripts/doctor.sh` - Selected-project Pi build, installation, and drift diagnosis.
- `scripts/uninstall.sh` - Backup-first Pi removal and allow-listed guided-setup ownership cleanup with a legacy bootstrap compatibility path.

## Decisions Made

- Machine Pi assets remain an explicit sync lifecycle separate from project setup.
- A setup state record identifies removal candidates but cannot authorize arbitrary paths; uninstall requires both a valid record and membership in a package-known allowlist.
- Legacy bootstrap projects without setup state retain their established cleanup path, while guided projects remove individual recorded assets and preserve neighboring user files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved the established two-asset Pi sync count output**
- **Found during:** Plan-wide `npm test`
- **Issue:** Counting the new memory extension in the legacy summary line broke the existing graph-adapter idempotence contract.
- **Fix:** Kept the historical trajectory/prompt count line byte-compatible and added a separate memory-extension reconciliation line.
- **Files modified:** `scripts/sync-pi-assets.sh`
- **Verification:** `bash scripts/test-graph-harness-adapters.sh`, focused Pi lifecycle tests, and exact `npm test` pass.
- **Committed in:** `8cf4f3a`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fix preserves a public compatibility contract while keeping the new lifecycle result explicit; no scope expansion.

## Issues Encountered

- Task 1's end-to-end Pi lifecycle oracle intentionally remained RED until Task 2 named the uninstall owner. The uninstall change was implemented before the Task 1 verification run but staged only in Task 2's atomic commit.

## User Setup Required

None - synchronization remains an explicit operator command and no external service is required.

## Verification

- `node scripts/test-pi-lifecycle.mjs` - PASS
- `node scripts/test-windows-native.mjs` - PASS
- `bash scripts/test-doctor.sh` - PASS
- `bash scripts/test-uninstall.sh` - PASS
- `bash scripts/test-graph-harness-adapters.sh` - PASS
- Guided setup ownership, modified-file backup, and neighboring-file preservation probe - PASS
- `bash scripts/verify-no-private-references.sh` - PASS
- `npm test` - PASS

## Next Phase Readiness

- Explicit Pi install, status, recovery, and uninstall semantics are ready for Plan 26-08 operating and privacy documentation.
- The intentionally RED L23 learning contract remains deferred to Plan 26-09.

## Self-Check: PASSED

- All four task-owned production files and this summary exist.
- Task commits `6fab6ac`, `d27b264`, and `8cf4f3a` are present in repository history.
- Focused lifecycle/security tests and the exact root suite passed.

---
*Phase: 26-guided-setup-and-harness-onboarding*
*Completed: 2026-08-12*
