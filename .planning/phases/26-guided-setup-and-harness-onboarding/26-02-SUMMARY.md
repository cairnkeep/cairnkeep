---
phase: 26-guided-setup-and-harness-onboarding
plan: "02"
subsystem: testing
tags: [setup, overlay-policy, package, completion, windows, red-contracts]
requires:
  - phase: 26-01
    provides: Phase 26 RED-mode convention and manifest registration proof
provides:
  - Human and structured guided-setup output RED contracts
  - Strict provider-neutral setup-policy and precedence RED contracts
  - Installed-package, shell-completion, and simulated-Windows RED contracts
affects: [26-04, 26-05, 26-06, 26-08, 26-09]
tech-stack:
  added: []
  patterns: [default-green automatic discovery, explicit exit-86 RED mode, production-surface auto-activation]
key-files:
  created:
    - scripts/test-setup-output.sh
    - scripts/test-setup-overlay.sh
  modified:
    - scripts/test-completion.sh
    - scripts/test-package-install.sh
    - scripts/test-windows-native.mjs
key-decisions:
  - Output assertions activate only after the complete controller/core/reconciler/schema surface exists; overlay assertions activate independently when the core policy seam exists.
  - Existing completion, package-install, and Windows lifecycle assertions always run before Phase 26 skip or RED gates.
  - Simulated Windows checks establish semantic parity but do not claim native Windows release evidence.
metrics:
  duration: 8m
  completed: 2026-08-12
status: complete
---

# Phase 26 Plan 02: Setup Output, Overlay, Package, and Platform RED Contracts Summary

Default-green repository tests with explicit exit-86 contracts now define guided setup output, strict overlay policy, installed-package integrity, four-shell completion parity, and simulated-Windows behavior before their GREEN owners land.

## Performance

- **Duration:** 8 minutes
- **Started:** 2026-08-12T09:49:17Z
- **Completed:** 2026-08-12T09:57:09Z
- **Tasks:** 2
- **Files changed:** 5

## Accomplishments

- Added setup output contracts for complete and Git-less limited results, human and JSON rendering, exact usage status, actionable recovery, and no-write failures.
- Added strict data-only policy coverage for schema shape, CLI precedence, constraints, unknown fields, oversized input, links, executable files, URLs, and credential-shaped data.
- Extended all shell completion, packed global install, and simulated-Windows tests without weakening their existing baseline assertions.
- Proved every new contract remains green during automatic discovery and returns attributable exit 86 only when `CAIRN_PHASE26_RED=1` requests the missing feature surface.

## Task Commits

1. **Task 1: Define RED output and overlay policy contracts** - `ee3a6cc`
2. **Task 2: Extend RED completion, package, simulated-Windows contracts** - `d50537b`

## Files Created/Modified

- `scripts/test-setup-output.sh` - Public CLI human/JSON, limited, usage, operational, and no-write setup contract.
- `scripts/test-setup-overlay.sh` - Strict policy schema, validation, precedence, constraint, and package-baseline contract.
- `scripts/test-completion.sh` - Bash, zsh, fish, and PowerShell setup command/flag/value parity gate.
- `scripts/test-package-install.sh` - Installed setup modules, schemas, compiled Pi bridge, extension, docs, execution, and package-hygiene gate.
- `scripts/test-windows-native.mjs` - Spaces/Unicode, shared setup choices/results, private state, recovery, and PowerShell completion simulation.

## Decisions Made

- Split policy-core and user-facing output activation so Plan 26-04 can satisfy the overlay contract without waiting for the Plan 26-06 controller.
- Required the complete owned production surface before automatic package/platform assertions activate, preventing partial parallel implementations from racing one another.
- Kept Node 22/24/26 and native Windows as later release-readiness evidence; this plan records no native-platform claim.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected completion detector shell quoting**
- **Found during:** Task 2 focused verification
- **Issue:** The initial quoted regular expression was not valid Bash syntax.
- **Fix:** Replaced it with a word-bounded setup lookup that works across generated completion formats.
- **Files modified:** `scripts/test-completion.sh`
- **Commit:** `d50537b`

## Known Stubs

None. The explicit RED gates are intentional executable contracts and automatically yield to normal assertions when their complete production surfaces exist.

## Verification

- `bash scripts/test-setup-output.sh && bash scripts/test-setup-overlay.sh` - PASS with explicit pre-production skips after baseline/self-validation.
- Explicit output/overlay RED invocation - PASS with exit statuses `86,86`.
- `bash scripts/test-completion.sh && bash scripts/test-package-install.sh && node scripts/test-windows-native.mjs` - PASS after all legacy baseline assertions.
- Explicit completion/package/Windows RED invocation - PASS with exit statuses `86,86,86`.
- `node scripts/run-repository-tests.mjs --verify-phase26-registration=red` - PASS; exact five-entry manifest remains RED-only and routine scheduling remains empty.
- `bash scripts/verify-no-private-references.sh` - PASS.
- Shell syntax, Node syntax, and Git whitespace checks - PASS.

## Self-Check: PASSED

- All five task-owned test files exist.
- Task commits `ee3a6cc` and `d50537b` exist in repository history.
- No tracked file deletions occurred.
- Orchestrator-owned `.planning/PROJECT.md`, `.planning/ROADMAP.md`, and `.planning/STATE.md` were not staged or modified by this plan executor.

---
*Phase: 26-guided-setup-and-harness-onboarding*
*Completed: 2026-08-12*
