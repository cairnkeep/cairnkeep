---
phase: 26-guided-setup-and-harness-onboarding
plan: "08"
subsystem: documentation
tags: [setup, pi, overlay, windows, privacy, release]
requires:
  - phase: 26-guided-setup-and-harness-onboarding
    provides: guided setup, Pi bridge, lifecycle, and package contracts from Plans 01-07
provides:
  - operator guidance for guided and deterministic setup
  - explicit Pi sync, bridge, doctor, and uninstall contract
  - provider-neutral overlay policy documentation
  - provisional unreleased v2.11 sequencing notes
affects: [operators, overlays, package consumers, release-readiness]
tech-stack:
  added: []
  patterns: [explicit-machine-sync, backup-first-recovery, data-only-policy]
key-files:
  created:
    - .planning/phases/26-guided-setup-and-harness-onboarding/26-08-SUMMARY.md
  modified:
    - docs/operating.md
    - docs/harness-compatibility.md
    - docs/native-windows.md
    - docs/privacy-and-data-flow.md
    - docs/building-an-overlay.md
    - README.md
    - CHANGELOG.md
key-decisions:
  - "Document setup as the recommended entry point while preserving bootstrap as the deterministic compatibility primitive."
  - "Keep Pi machine sync explicit and describe annotations only in trusted bridge details because Pi has no native annotations field."
  - "Record v2.11 as provisional and unreleased until pending v2.10 sequencing and the full release matrix complete."
patterns-established:
  - "Project setup reports machine operations but never applies them automatically."
  - "Overlay policy remains strict, data-only, provider-neutral, and lower precedence than explicit CLI choices."
requirements-completed: [SETUP-05, SETUP-06, PI-MCP-02, PI-MCP-03, OVERLAY-01]
coverage:
  - requirement: SETUP-05
    deliverable: Guided setup operator and recovery documentation
    tests:
      - scripts/verify-docs-parity.sh
      - scripts/test-uninstall.sh
    verification:
      - command: bash scripts/verify-docs-parity.sh
        status: pass
      - command: bash scripts/test-uninstall.sh
        status: pass
    human_judgment: false
  - requirement: SETUP-06
    deliverable: Deterministic setup and machine-sync authority documentation
    tests:
      - scripts/test-setup-overlay.sh
      - scripts/test-package-install.sh
    verification:
      - command: bash scripts/test-setup-overlay.sh
        status: pass
      - command: bash scripts/test-package-install.sh
        status: pass
    human_judgment: false
  - requirement: PI-MCP-02
    deliverable: Pi runtime compatibility and metadata preservation documentation
    tests:
      - scripts/verify-docs-parity.sh
    verification:
      - command: bash scripts/verify-docs-parity.sh
        status: pass
    human_judgment: false
  - requirement: PI-MCP-03
    deliverable: Pi lifecycle, privacy, and recovery documentation
    tests:
      - scripts/test-uninstall.sh
      - scripts/verify-no-private-references.sh
    verification:
      - command: bash scripts/test-uninstall.sh
        status: pass
      - command: bash scripts/verify-no-private-references.sh
        status: pass
    human_judgment: false
  - requirement: OVERLAY-01
    deliverable: Strict provider-neutral setup policy seam documentation
    tests:
      - scripts/test-setup-overlay.sh
    verification:
      - command: bash scripts/test-setup-overlay.sh
        status: pass
    human_judgment: false
duration: 13min
completed: 2026-08-12
status: complete
---

# Phase 26 Plan 08: Setup and Pi Operator Documentation Summary

**Guided setup, deterministic automation, explicit Pi lifecycle ownership, privacy boundaries, overlay policy, and provisional release sequencing are now documented across every public operator surface.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-08-12T11:06:43Z
- **Completed:** 2026-08-12T11:19:22Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Documented interactive and deterministic setup choices, limited non-Git mode, selected-asset reconciliation, private state, structured output, doctor, launch, and recovery behavior.
- Defined explicit Pi apply/check/doctor/uninstall ownership, dynamic tool discovery, bounded child lifecycle, exact response preservation, trusted annotation details, and the lack of a native Pi annotations slot.
- Added native Windows parity and privacy boundaries for setup state, child environment, bounded stderr, synthetic replay evidence, and local-only stdio operation.
- Published the strict provider-neutral overlay-policy schema, precedence, constraints, file-safety limits, and explicit machine-sync responsibility.
- Updated public onboarding and marked v2.11.0 provisional and unreleased after pending v2.10.0 sequencing without claiming a tag, publication, or release.

## Task Commits

Each task was committed atomically:

1. **Task 1: Document setup, Pi integration, platforms, privacy, and overlays** - `1bc7c6a` (docs)
2. **Task 2: Add public setup, recovery, and provisional release guidance** - `7c3a608` (docs)
3. **Release-boundary fix: Keep current v2.11 work distinct from shipped features** - `5eacb90` (fix)

## Files Created/Modified

- `docs/operating.md` - Guided/deterministic setup, output, recovery, and complete Pi bridge lifecycle.
- `docs/harness-compatibility.md` - Pi support boundary, annotation handling, provisional minimum, and release matrix.
- `docs/native-windows.md` - Equivalent Windows setup, sync, ACL, diagnosis, and verification path.
- `docs/privacy-and-data-flow.md` - Setup state and local child-process/replay privacy boundaries.
- `docs/building-an-overlay.md` - Data-only setup policy schema, precedence, constraints, and overlay ownership.
- `README.md` - Concise public setup, Pi, doctor, and backup-first uninstall entry points.
- `CHANGELOG.md` - Explicitly provisional and unreleased v2.11 changes after pending v2.10 sequencing.
- `.planning/phases/26-guided-setup-and-harness-onboarding/26-08-SUMMARY.md` - Execution record and verified coverage.

## Decisions Made

- Recommended `cairn setup` for new onboarding while retaining `cairn bootstrap` and `--untracked` for compatible automation.
- Described setup as project-only reconciliation: machine sync remains explicit, visible, and independently checkable.
- Preserved MCP annotations in trusted Pi result details without claiming native model-facing propagation.
- Kept the release note provisional until both sequencing and cross-platform runtime evidence are complete.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Kept provisional v2.11 work out of the shipped feature claim**

- **Found during:** Final release-claim review
- **Issue:** Adding `setup` and the Pi memory extension to the README's existing “Shipped” sentence contradicted the plan's explicit unreleased boundary.
- **Fix:** Separated current provisional v2.11 functionality from shipped features and added an unreleased notice to the setup section.
- **Files modified:** `README.md`
- **Commit:** `5eacb90`

**Total deviations:** 1 auto-fixed bug.

## Known Stubs

None. The documentation points only to implemented setup, policy, Pi lifecycle, diagnosis, and uninstall surfaces.

## Verification

- `bash scripts/test-package-install.sh` - PASS
- `bash scripts/test-setup-overlay.sh` - PASS
- `bash scripts/test-uninstall.sh` - PASS
- `bash scripts/verify-docs-parity.sh` - PASS
- `bash scripts/verify-no-private-references.sh` - PASS
- The later learning curriculum contract was intentionally not invoked, as required by this plan.

## Threat Review

- Setup state documentation preserves the no-secrets, no-endpoints, no-absolute-path boundary and private POSIX/Windows permissions.
- Pi documentation preserves local stdio, bounded stderr/results/timeouts, explicit sync, and no prompt/skill/loop/remote behavior.
- Overlay policy remains data-only and provider-neutral; uninstall remains backup-first and user-preserving.
- No new runtime trust boundary was introduced by these documentation-only changes.

## Self-Check: PASSED

- All seven modified documentation files and this summary exist.
- Task commits `1bc7c6a`, `7c3a608`, and `5eacb90` exist in the feature worktree history.
- Package, overlay, uninstall, documentation parity, and public-reference verification all pass.

---
*Phase: 26-guided-setup-and-harness-onboarding*
*Completed: 2026-08-12*
