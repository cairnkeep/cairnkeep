---
phase: 26-guided-setup-and-harness-onboarding
plan: "04"
subsystem: setup-engine
tags: [setup, policy, git, reconciliation, atomic-write, security]
requires:
  - phase: 26-01
    provides: Setup preflight, compatibility, and reconciliation RED contracts
  - phase: 26-02
    provides: Strict overlay policy RED contract
provides:
  - Pure cross-platform setup argument, policy, target, Git, and plan model
  - Ownership-aware desired/current/prior reconciliation
  - Strict private project setup-state persistence
  - Versioned setup policy and state schemas
affects: [26-06, 26-07, 26-08, 26-09]
tech-stack:
  added: []
  patterns: [read-only preflight, structured usage errors, data-only policy, three-way digest ownership, state-last atomic replacement]
key-files:
  created:
    - scripts/setup-core.mjs
    - scripts/setup-reconcile.mjs
    - schemas/cairnkeep-setup.schema.json
    - schemas/cairnkeep-setup-policy.schema.json
  modified:
    - scripts/test-setup-overlay.sh
key-decisions:
  - Setup policy is limited to schema_version, defaults, and constraints with strict enum-only nested fields.
  - User-diverged and previously unowned existing assets are skipped; only absent, identical, or digest-proven prior-owned assets are reconciled.
  - Setup state contains only relative managed paths, digests, modes, template identities, enums, and public package version.
metrics:
  duration: 9m
  completed: 2026-08-12
status: complete
---

# Phase 26 Plan 04: Transactional Setup Planner and Reconciler Summary

Guided setup now has a deterministic read-only planning boundary and an ownership-safe atomic reconciler that preserves user bytes, selected-harness scope, private relative-only state, and legacy bootstrap identity.

## Performance

- **Duration:** 9 minutes
- **Started:** 2026-08-12T10:18:43Z
- **Completed:** 2026-08-12T10:27:13Z
- **Tasks:** 2
- **Files changed:** 5

## Accomplishments

- Implemented complete setup flag parsing with exact status-2 usage errors, non-TTY completeness, fixed-argv Git probes, missing/empty/non-empty classification, and distinct operational error classes.
- Added strict no-follow policy reads with size, type, executable-mode, schema, unknown-field, provider-neutral data, precedence, and constraint validation.
- Built frozen mutation plans whose selected launcher and shared scaffold bytes/modes match the existing bootstrap oracle exactly.
- Implemented desired/current/prior digest reconciliation with exact counts, stable identical mtimes, user-divergence preservation, and no inspection of unselected harness assets.
- Added strict setup-state validation and state-last same-directory atomic replacement with private POSIX modes or Windows ACLs, retrying Windows replacement without destination unlink.
- Proved invalid plans create no missing target and symlinked target ancestors are rejected before managed writes.

## Task Commits

1. **Task 1: Implement strict choices, policy, and read-only preflight** - `66a7b15`
2. **Task 2: Implement three-way reconciliation and private versioned state** - `d7f2731`
3. **Windows atomic creation retry fix** - `1bb947d`

## Files Created/Modified

- `scripts/setup-core.mjs` - Argument parsing, strict policy loading, target/Git preflight, choice resolution, and frozen asset planning.
- `schemas/cairnkeep-setup-policy.schema.json` - Provider-neutral versioned defaults/constraints policy contract.
- `scripts/setup-reconcile.mjs` - Containment validation, three-way ownership decisions, atomic asset writes, and private state-last persistence.
- `schemas/cairnkeep-setup.schema.json` - Strict relative-only project setup-state contract.
- `scripts/test-setup-overlay.sh` - Correct executable-mode fixture setup for the existing security assertion.

## Decisions Made

- Explicit CLI choices override policy defaults; interactive answers fill only remaining choices; the final effective choices must satisfy all policy constraints.
- Git work-tree status comes from fixed `git rev-parse` argv and never from `.git` path presence.
- Missing targets remain absent until every plan field and asset record is validated; target creation is the first possible mutation.
- Atomic replacement follows the platform-security safe pattern and never unlinks an existing destination as a retry strategy.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Made the executable-policy fixture exercise file mode correctly**
- **Found during:** Task 1 overlay GREEN verification
- **Issue:** The fixture rewrote an existing file with a creation-only mode option, leaving it non-executable and making the expected rejection unreachable.
- **Fix:** Applied executable mode explicitly before asserting policy rejection.
- **Files modified:** `scripts/test-setup-overlay.sh`
- **Commit:** `66a7b15`

**2. [Rule 2 - Missing Critical Functionality] Delayed target creation until complete plan validation**
- **Found during:** Task 2 threat-model audit
- **Issue:** An initial reconciler draft created a missing target before validating every asset record.
- **Fix:** Validate target ancestors and all plan/asset data first, then create the directory chain as the first mutation; added an executable no-create security probe.
- **Files modified:** `scripts/setup-reconcile.mjs`
- **Commit:** `d7f2731`

**3. [Rule 1 - Bug] Retried Windows atomic creation without unlink fallback**
- **Found during:** Post-Task 2 platform parity review
- **Issue:** Replacement retried transient Windows failures, but first-time atomic rename did not.
- **Fix:** Added bounded retry for new destinations while retaining destination-safe replacement semantics.
- **Files modified:** `scripts/setup-reconcile.mjs`
- **Commit:** `1bb947d`

## Known Stubs

None.

## Verification

- `node scripts/test-setup-preflight.mjs` - PASS.
- `bash scripts/test-setup-overlay.sh` - PASS.
- `node scripts/test-setup-reconcile.mjs` - PASS.
- `node scripts/test-setup-compatibility.mjs` - PASS with exact legacy POSIX/Windows asset identity and stable rerun mtimes.
- Invalid-plan no-create and symlinked-target containment probe - PASS.
- Both JSON schemas parse successfully.
- `bash scripts/verify-no-private-references.sh` - PASS.
- Node syntax and Git whitespace checks - PASS.

## Self-Check: PASSED

- All four production/schema artifacts and the corrected overlay test exist.
- Commits `66a7b15`, `d7f2731`, and `1bb947d` exist in repository history.
- No tracked file deletions occurred.
- Orchestrator-owned `.planning/PROJECT.md`, `.planning/ROADMAP.md`, and `.planning/STATE.md` were not staged or modified by this plan executor.

---
*Phase: 26-guided-setup-and-harness-onboarding*
*Completed: 2026-08-12*
