---
phase: 26-guided-setup-and-harness-onboarding
plan: "10"
subsystem: release-readiness
tags: [acceptance-matrix, setup, pi, mcp, portability, privacy]

requires:
  - phase: 26-guided-setup-and-harness-onboarding
    provides: completed setup, compatibility, Pi bridge, packaging, overlays, public documentation, and learning contracts from Plans 26-01 through 26-09
provides:
  - Sanitized complete release-readiness evidence for the Phase 26 implementation
  - Native Windows, Node 22/24/26, Bash 3.2, real Pi, and isolated work-laptop replay approval
affects: [release-readiness, native-windows, runtime-matrix, real-pi-validation]

tech-stack:
  added: []
  patterns: [sanitized acceptance matrix, non-skipping release gate, separate fixture roles, explicit equal-version evidence]

key-files:
  created:
    - .planning/phases/26-guided-setup-and-harness-onboarding/26-10-SUMMARY.md
  modified: []

key-decisions:
  - "Treat the real-Pi default SKIP as fixture availability evidence only, never as conformance evidence."
  - "Accept exact annotation preservation only in trusted bridge metadata/details; make no native Pi annotation propagation claim."
  - "Require separate minimum/current Pi installations and explicit current version while allowing their version strings to be equal when registry minimum and current coincide."

patterns-established:
  - "Acceptance evidence records exact commands, runtime versions, and statuses without copying paths, identities, environment values, or raw private-host output."

requirements-completed: [SETUP-01, SETUP-02, SETUP-03, SETUP-04, SETUP-05, SETUP-06, PI-MCP-01, PI-MCP-02, PI-MCP-03, OVERLAY-01]

coverage:
  - id: D1
    description: "All locally available Phase 26 repository, package, lifecycle, privacy, setup, and Pi simulation gates pass."
    verification:
      - kind: integration
        ref: "npm test"
        status: pass
      - kind: integration
        ref: "npm --prefix mcp-memory-server test"
        status: pass
      - kind: integration
        ref: "npm run check:public"
        status: pass
    human_judgment: false
  - id: D2
    description: "The final native Windows, Node 22/24/26, Bash 3.2, real Pi minimum/current, and sanitized work-laptop replay matrix is approved."
    verification:
      - kind: manual_procedural
        ref: "release-readiness matrix approval after PR #43 CI run 31597475813, official runtime containers, real-Pi required-release runner, and sanitized work-laptop replay"
        status: pass
    human_judgment: true
    rationale: "Native and real-host evidence required explicit human approval after the automated gates passed."

duration: 1h 12m
completed: 2026-08-12
status: complete
---

# Phase 26 Plan 10: Acceptance Matrix Summary

**Complete release-readiness proof across local suites, official Node containers, native Windows CI, real Pi fixtures, Bash 3.2, and an isolated work-laptop replay without tagging or releasing**

## Performance

- **Duration:** 1h 12m
- **Started:** 2026-08-12T11:44:40Z
- **Completed:** 2026-08-12T12:56:38Z
- **Tasks:** 2
- **Files modified:** 1
- **Release/tag/publish operations:** none

## Accomplishments

- Passed every local repository, server, package, completion, uninstall, setup, privacy, lifecycle, and Pi simulation gate.
- Passed Node 22/24/26, native Windows x64, Bash 3.2/macOS, real Pi, container, portability, and server-boot release cells.
- Proved failure containment and idempotent recovery on an isolated empty non-Git target with spaces and Unicode.
- Closed T-26-01 through T-26-10 with sanitized evidence and no private-host disclosure.

## Local Automated Evidence

| Gate | Exact command | Status | Sanitized evidence |
|---|---|---:|---|
| Routine registration | `node scripts/run-repository-tests.mjs --verify-phase26-registration=routine` | PASS | Shared dispatcher scheduled the exact five required contracts once. |
| Root suite | `npm test` | PASS | Repository shell, simulated Windows, setup, Pi lifecycle, and bridge contracts completed. |
| Server build | `npm --prefix mcp-memory-server run build` | PASS | TypeScript build completed. |
| Server suite | `npm --prefix mcp-memory-server test` | PASS | Full smoke suite completed and explicitly invoked `check:pi-mcp-bridge`. |
| Public gate | `npm run check:public` | PASS | Privacy scan, docs parity, runtime audit, server build, and nested root suite completed. |
| Packed install | `bash scripts/test-package-install.sh` | PASS | Packed CLI and memory server installed and exercised. |
| Completion | `bash scripts/test-completion.sh` | PASS | Shell completion contract completed. |
| Uninstall | `bash scripts/test-uninstall.sh` | PASS | Ownership, preservation, backup, purge, and revert contract completed. |
| Setup preflight | `node scripts/test-setup-preflight.mjs` | PASS | Target, Git, syntax, choices, and no-write failures completed. |
| Setup reconcile | `node scripts/test-setup-reconcile.mjs` | PASS | Ownership, idempotence, containment, privacy, and atomic state completed. |
| Setup compatibility | `node scripts/test-setup-compatibility.mjs` | PASS | Legacy POSIX/Windows fixture compatibility completed. |
| Setup output | `bash scripts/test-setup-output.sh` | PASS | Structured and human-readable setup output completed. |
| Doctor | `bash scripts/test-doctor.sh` | PASS | Complete, limited, incomplete, Pi drift, and recovery states completed. |
| Overlay | `bash scripts/test-setup-overlay.sh` | PASS | Strict overlay schema, precedence, privacy, and package contract completed. |
| Pi bridge smoke | `node mcp-memory-server/scripts/smoke-pi-mcp-bridge.mjs` | PASS | Dynamic catalogs, trusted result handling, cancellation, crash, and lifecycle completed. |
| Pi lifecycle | `node scripts/test-pi-lifecycle.mjs` | PASS | Sync, drift, backup, revert, preservation, and teardown completed. |
| Privacy scan | `bash scripts/verify-no-private-references.sh` | PASS | No disallowed private references found. |
| Documentation parity | `bash scripts/verify-docs-parity.sh` | PASS | Public documentation and shipped behavior remain aligned. |
| Bash 3.2 harness | `scripts/smoke-bash32.sh` | PASS | Podman ran the declared Bash 3.2 image; all five sync scripts and doctor help passed. |

## Official Node Container Matrix

Both disposable Linux containers checked out commit `143a5c1bf3bc142ed42c207c1b263fe064c8bf48` with full history and ran:

```text
npm ci --include=dev --global=false --dry-run=false
npm --prefix mcp-memory-server ci --include=dev --global=false --dry-run=false
npm --prefix mcp-memory-server run build
npm --prefix mcp-memory-server test
npm test
npm run check:public
```

| Official image | Runtime | Image digest | Result |
|---|---|---|---:|
| `node:24-bookworm` | Node.js v24.19.0, npm 11.17.0 | `sha256:f6d02cf1353049cf3658e6ce9ec03c6877a6479495f122062d195e2279d01055` | PASS |
| `node:26-bookworm` | Node.js v26.7.0, npm 11.19.0 | `sha256:1624087a97c41a6c1e737be8a801f6c37c97bb36551472132d76b120f3791093` | PASS |

For each image, root dependency installation, server dependency installation, server build, server tests, root tests, and the public gate all passed.

## Real Pi Required-Release Evidence

After commits `0bd19ec`, `8b85e94`, and `143a5c1`, the non-skipping command `node scripts/verify-pi-mcp-bridge.mjs --required-release --json` passed against two isolated official `@earendil-works/pi-coding-agent` installations:

| Evidence | Minimum fixture | Current fixture |
|---|---:|---:|
| Exact version | 0.84.1 | 0.84.1 |
| Separate executable/installation | true | true |
| Full profile tools | 14 | 14 |
| Read-only profile tools | 8 | 8 |
| Custom profile tools | 2 | 2 |
| Catalog and schemas equivalent | true | true |
| Trusted metadata/details equivalent | true | true |
| Harmless call completed | true | true |
| Per-call cancellation completed | true | true |
| Awaited shutdown completed | true | true |
| No orphan child remained | true | true |

The sanitized result recorded `versions_equal: true`. Minimum and current are fixture roles backed by distinct executable paths and installations; equality is valid while registry minimum and current are both 0.84.1. When current advances, the runner still requires its exact explicitly supplied version.

The D-12 contract is exact preservation of discovered annotations in trusted bridge metadata and call details. This evidence makes no native Pi annotation propagation claim.

## Sanitized Work-Laptop Replay

The packed feature tarball passed an isolated Linux replay against an empty non-Git target containing spaces and Unicode:

- Incomplete non-interactive setup exited `2` and created none of `.git`, `.ai`, `.planning`, or `.agentfs`.
- After explicit Git initialization, setup with Pi and local memory succeeded.
- Managed state and the Pi launcher were present; Claude, OpenCode, Kimi, and Qwen launchers were absent as selected.
- An identical rerun reported `created: 0`, `updated: 0`, `unchanged: 16`, and `skipped: 0`.
- The disposable fixture and packed package were removed after verification.

Only classifications and counts are recorded; no managed path, host identity, environment value, or private content is included.

## Native and CI Matrix

[PR #43 CI run 31597475813](https://github.com/cairnkeep/cairnkeep/actions/runs/31597475813) passed all 11 jobs at head `143a5c1`:

| Job group | Result | Evidence |
|---|---:|---|
| Native Windows x64, Node 22 | PASS | Contracts and packed global-install workflow under spaces/Unicode, PowerShell completion, setup/ACL/Pi teardown/uninstall. |
| Native Windows x64, Node 24 | PASS | Same complete native contract and packed-install workflow. |
| Native Windows x64, Node 26 | PASS | Same complete native contract and packed-install workflow. |
| Repository | PASS | Root repository suite. |
| Memory server, Node 22 | PASS | Server build and tests. |
| Memory server, Node 24 | PASS | Server build and tests. |
| Memory server, Node 26 | PASS | Server build and tests. |
| Fresh install, macOS | PASS | Real Bash 3.2 packed fresh-install workflow. |
| Server boot | PASS | Built server booted successfully. |
| Container | PASS | Container contract completed. |
| Shell portability | PASS | Portable-shell contract completed. |

## Final Release-Readiness Matrix

| Cell | Status | Sanitized evidence |
|---|---:|---|
| Node.js 22 | PASS | Local v22.23.1 plus repository/server/native Windows CI. |
| Node.js 24 | PASS | Official Linux container plus server/native Windows CI. |
| Node.js 26 | PASS | Official Linux container plus server/native Windows CI. |
| Bash 3.2 | PASS | Declared local container harness and macOS fresh-install CI. |
| Native Windows x64 | PASS | Node 22/24/26 native jobs under spaces/Unicode. |
| Real Pi minimum | PASS | Separate official 0.84.1 installation completed the full matrix. |
| Real Pi current | PASS | Separate official 0.84.1 installation completed the full matrix with explicit equality. |
| Required-release Pi result | PASS | Non-SKIP full/read-only/custom catalog, schema, trusted-details, call, cancellation, shutdown, and orphan checks. |
| Empty non-Git work-laptop replay | PASS | Failure containment, explicit initialization, selected harness state, idempotent rerun, and cleanup verified. |

## Threat Disposition

- T-26-01 through T-26-05 are closed by native Windows path, ACL, setup recovery, package, lifecycle, and uninstall evidence.
- T-26-06 through T-26-10 are closed by the non-skipping real-Pi catalog, transport, cancellation, shutdown, orphan, collision, profile, and trusted-details evidence.
- T-26-04 is additionally closed by public privacy checks and the sanitized work-laptop record.
- No high-severity Phase 26 risk remains unresolved.

## Task Commits

1. **Task 1: Run and record all locally available gates** - `3ddf284` (docs)
2. **Task 2 runner correction: permit equal minimum/current versions with separate installations** - `0bd19ec` (fix)
3. **Task 2 documentation correction: clarify minimum/current fixture roles** - `8b85e94` (docs)
4. **Task 2 runner correction: exercise real Pi tool definitions** - `143a5c1` (fix)
5. **Task 2: Approve and record the complete release-readiness matrix** - final summary commit reported by the executor

## Files Created/Modified

- `.planning/phases/26-guided-setup-and-harness-onboarding/26-10-SUMMARY.md` - Sanitized local, runtime, native, real-Pi, replay, CI, and threat-closure evidence.

## Decisions Made

- Kept minimum/current as separate installation roles while truthfully permitting equal versions when the official registry minimum and current coincide.
- Preserved discovered annotations only in trusted bridge metadata/details because Pi exposes no supported native annotation field.
- Treated all matrix work as release-readiness verification only; no tag, publication, or release was performed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Allowed equal minimum/current Pi versions with separate installations**
- **Found during:** Task 2 required-release execution
- **Issue:** The official registry minimum and current were both 0.84.1, while the runner incorrectly required distinct version strings.
- **Fix:** Required distinct executable paths/installations, retained exact explicit current-version verification, and emitted sanitized equality evidence.
- **Files modified:** `scripts/verify-pi-mcp-bridge.mjs`, public documentation, and acceptance planning contracts.
- **Verification:** Runner self-tests, default/missing-fixture behavior, privacy/docs checks, and the real required-release matrix passed.
- **Committed in:** `0bd19ec`, `8b85e94`

**2. [Rule 1 - Bug] Exercised captured real Pi tool definitions**
- **Found during:** Task 2 required-release execution
- **Issue:** Pi 0.84.1 `getAllTools()` returned metadata-only catalog entries, so the observer could not invoke registered tool implementations.
- **Fix:** Captured the definitions passed to the real extension API's `registerTool()` and used them for calls while retaining catalog observation through Pi.
- **Files modified:** `scripts/verify-pi-mcp-bridge.mjs`
- **Verification:** Regression self-test and the exact real required-release gate passed for both isolated official installations.
- **Committed in:** `143a5c1`

---

**Total deviations:** 2 auto-fixed (1 blocking issue, 1 runner bug)
**Impact on plan:** Both fixes were necessary for truthful execution against the official current Pi release; production bridge behavior and release scope were unchanged.

## Issues Encountered

- Early local aggregate output exceeded the tool-output ceiling; bounded per-gate reruns produced the authoritative local results.
- Disposable Node containers initially lacked valid linked-worktree history; full-history disposable clones resolved this evidence-environment issue without changing source.

## User Setup Required

None - release-readiness verification requires no persistent user configuration.

## Next Phase Readiness

- Phase 26 release-readiness evidence is complete and approved.
- No tag, package publication, or release was performed by this plan.

## Self-Check: PASSED

- The summary exists and records both completed tasks.
- Task and deviation commits exist in repository history.
- Every matrix cell records sanitized PASS evidence.
- D-12 is bounded to trusted metadata/details and makes no native annotation propagation claim.
- No private host path, identity, environment value, executable path, or raw private-host output is present.
- Orchestrator-owned planning-state files were preserved and excluded from this plan's commits.

---
*Phase: 26-guided-setup-and-harness-onboarding*
*Completed: 2026-08-12*
