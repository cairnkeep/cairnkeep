---
phase: 26
slug: guided-setup-and-harness-onboarding
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-08-12
---

# Phase 26 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node `assert` smoke scripts plus Bash smoke scripts |
| **Config file** | Root and `mcp-memory-server/package.json`; no central unit-test config |
| **Quick setup run** | `node scripts/test-setup-preflight.mjs && node scripts/test-setup-reconcile.mjs` |
| **Quick Pi run** | `cd mcp-memory-server && npm ci && npm run build && npm test`; run `node scripts/smoke-pi-mcp-bridge.mjs` directly while RED-only |
| **Real Pi acceptance** | `node scripts/verify-pi-mcp-bridge.mjs` may report an explicit sanitized SKIP outside release; `node scripts/verify-pi-mcp-bridge.mjs --required-release --json` must pass separate Pi minimum/current installations and may never skip at release. Both may report 0.84.1 while it remains registry-current; their executable paths must differ. |
| **Full suite command** | `npm test && npm --prefix mcp-memory-server test` |
| **Estimated runtime** | Focused scripts under 60 seconds; full matrix measured during execution |

---

## Sampling Rate

- **After every task commit:** Run the task's focused Node/Bash contract plus `git diff --check`
- **After every setup plan wave before 26-09:** Run only that plan's focused contracts and standalone `scripts/verify-no-private-references.sh`; intentional later RED contracts remain outside the command
- **After every MCP bridge plan wave:** Run `npm ci`, `npm run build`, and the passing full `npm test` inside `mcp-memory-server`; keep the bridge smoke directly runnable but outside `test:smoke` until its Plan 26-05 GREEN composition
- **First complete routine gate:** After every Phase 26 GREEN owner and L23/Quickstart/Operator learning surface lands in Plan 26-09, prove the exact five-entry runner dispatch, then run `npm test` and `npm run check:public`
- **Before `$gsd-verify-work`:** Repeat root/server full suites and `npm run check:public`, then run packed install, completion, and uninstall tests
- **Release gate:** Node 22/24/26, real Bash 3.2, native Windows x64, and non-skipping `node scripts/verify-pi-mcp-bridge.mjs --required-release --json` with separate Pi minimum/current executable fixtures and the exact explicit current version. Equal 0.84.1 version reports are valid while the registry-current release remains 0.84.1; path equality is never valid.
- **Max feedback latency:** 60 seconds for focused automated checks

---

## Per-Requirement Verification Map

| Contract | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|----------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 26-W0-01 | SETUP-01 | T-26-01 | Invalid/incomplete choices fail before writes | unit/integration | `node scripts/test-setup-preflight.mjs` | ❌ W0 | ⬜ pending |
| 26-W0-01 | SETUP-02 | T-26-01, T-26-02 | Missing Git, non-repo, init and untracked states are distinct and argv-safe | unit/integration | `node scripts/test-setup-preflight.mjs` | ❌ W0 | ⬜ pending |
| 26-W0-02 | SETUP-03 | T-26-03 | Selected assets and strict state preserve legacy bootstrap bytes/output | integration | `node scripts/test-setup-compatibility.mjs` | ❌ W0 | ⬜ pending |
| 26-W0-03 | SETUP-04 | T-26-03, T-26-04 | Digest ownership prevents user-file overwrite and unchanged rewrites | unit/integration | `node scripts/test-setup-reconcile.mjs` | ❌ W0 | ⬜ pending |
| 26-W0-04 | SETUP-05 | T-26-05 | Output and doctor distinguish complete, incomplete, and limited setup | integration | `bash scripts/test-setup-output.sh && bash scripts/test-doctor.sh` | ❌ setup output | ⬜ pending |
| 26-W0-05 | SETUP-06 | T-26-01–05 | Equivalent POSIX/Windows lifecycle and installed-package behavior | matrix | `npm test && bash scripts/test-package-install.sh && node scripts/test-windows-native.mjs` | ✅ infrastructure; ❌ setup cases | ⬜ pending |
| 26-W0-06 | PI-MCP-01 | T-26-06–09 | Bounded local stdio start/list/call/cancel/crash/shutdown lifecycle | integration | `node mcp-memory-server/scripts/smoke-pi-mcp-bridge.mjs`; release: `node scripts/verify-pi-mcp-bridge.mjs --required-release --json` | ❌ W0; ❌ Plan 26-09 real-Pi runner | ⬜ pending |
| 26-W0-06 | PI-MCP-02 | T-26-08, T-26-10 | Direct `tools/list` and Pi registration expose the same gated/profiled catalog; exact annotations remain in trusted bridge metadata/details without a native-propagation claim | contract | `npm --prefix mcp-memory-server run check:mcp-trust && node mcp-memory-server/scripts/smoke-pi-mcp-bridge.mjs`; release: `node scripts/verify-pi-mcp-bridge.mjs --required-release --json` | ✅ server oracle; ❌ bridge oracle; ❌ Plan 26-09 real-Pi runner | ⬜ pending |
| 26-W0-07 | PI-MCP-03 | T-26-06–10 | Explicit sync/status/doctor/uninstall, harmless real call, cancellation, shutdown/no orphan, and no automatic execution/network | integration/E2E | `node scripts/test-pi-lifecycle.mjs`; release: `node scripts/verify-pi-mcp-bridge.mjs --required-release --json` | ❌ W0; ❌ Plan 26-09 real-Pi runner | ⬜ pending |
| 26-W0-08 | OVERLAY-01 | T-26-02, T-26-04 | Strict data-only policy, constrained precedence, no private material | contract | `bash scripts/test-setup-overlay.sh && bash scripts/verify-no-private-references.sh` | ❌ setup overlay; ✅ scanner | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/test-setup-preflight.mjs` — SETUP-01/02 target, Git, flags, and no-partial-state matrix
- [ ] `scripts/test-setup-reconcile.mjs` — SETUP-03/04 ownership, digest, count, mtime, symlink, interruption, and idempotence matrix
- [ ] `scripts/test-setup-compatibility.mjs` — legacy bootstrap byte/output oracle and Windows asset parity
- [ ] `scripts/test-setup-output.sh` — SETUP-05 structured/human result and doctor-state contracts
- [ ] `scripts/test-setup-overlay.sh` — OVERLAY-01 strict policy, precedence, privacy, and package contract
- [ ] `mcp-memory-server/scripts/smoke-pi-mcp-bridge.mjs` — PI-MCP-01/02 fake stdio server and exact fake Pi API contracts
- [ ] `scripts/test-pi-lifecycle.mjs` — PI-MCP-03 machine install/status/doctor/uninstall lifecycle

## Pre-Release Acceptance Artifact

- [ ] `scripts/verify-pi-mcp-bridge.mjs` (Plan 26-09) — provider-neutral real-Pi runner outside automatic test discovery and the exact five-entry Node manifest. Default mode may emit only an explicit sanitized SKIP when fixtures are unavailable. `--required-release` must fail rather than skip unless separate minimum/current executable fixtures both pass direct-versus-Pi full/read-only/custom names/order/input-output schemas, exact trusted metadata/details annotations with no native-propagation claim, harmless call, cancellation, shutdown, and orphan detection. The current version remains explicit and exact; it may equal 0.84.1 until the registry advances.

---

## Threat References

| Ref | Threat | Required mitigation |
|-----|--------|---------------------|
| T-26-01 | Target/scope traversal through symlink, junction, or special file | `lstat` managed ancestors, reject links/devices, prove containment before writes |
| T-26-02 | Shell/PATH injection or executable policy data | Fixed executable and argv with `shell: false`; strict data-only policy schema |
| T-26-03 | User-owned asset overwritten or deleted | Three-way desired/current/prior digest ownership and backup-first uninstall |
| T-26-04 | Setup state leaks paths, endpoints, identity, or credentials | Strict allowlist, relative paths, enums/digests only, public-reference scan |
| T-26-05 | Partial state after failed preflight or interrupted replacement | Complete mutation plan before writes and atomic same-directory replacement |
| T-26-06 | Inherited transport selector opens HTTP instead of stdio | Clear `MCP_HTTP_PORT` for the fixed local child and test hostile environment |
| T-26-07 | Child stderr/request stalls Pi | Bounded stderr tail, startup/call timeouts, bounded results, idempotent close |
| T-26-08 | Tool collision or duplicate catalog broadens authority | Reject name collisions; register only dynamically discovered effective tools |
| T-26-09 | Cancellation/shutdown race leaks child or promises | Per-call cancellation, shared shutdown controller, single close promise, orphan test |
| T-26-10 | Annotation/profile semantics lost at Pi boundary | Preserve exact discovered metadata/details and compare against direct catalog oracle; do not claim unsupported native Pi fields |

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Native Windows x64 setup, ACL, completion, process teardown, and uninstall | SETUP-06, PI-MCP-03 | No native Windows runner is available locally | Run the Phase 26 native lifecycle on Node 22/24/26 under paths with spaces/Unicode; require zero orphan child and private setup state |
| Real Pi round trip on declared minimum and current fixtures | PI-MCP-01–03 | Pi is host-provided and not installed locally | Set distinct executable paths in `CAIRN_PI_0841_BIN` and `CAIRN_PI_CURRENT_BIN`, plus exact `CAIRN_PI_CURRENT_VERSION`; run `node scripts/verify-pi-mcp-bridge.mjs --required-release --json`; require a non-SKIP sanitized PASS for direct-versus-Pi full/read-only/custom names/order/input-output schemas, exact annotations in trusted bridge metadata/details with no native-propagation claim, harmless call, cancellation, shutdown, and no orphan child. The version reports may both be 0.84.1 while that is registry-current. |
| Isolated replay of the originally reported empty non-Git project | SETUP-01/02/05 | The authoritative managed-overlay environment is external to the public core | Baseline is recorded in `26-BASELINE-REPRO.md`; after implementation, rerun in a disposable directory and require guided Git/harness choices, actionable output, and no partial state on refusal/failure |
| Locked D-12 annotation conformance | PI-MCP-02 | Real Pi validation confirms the already-fixed bridge boundary | Require exact discovered annotations in trusted bridge metadata/details and reject any native-propagation claim; no alternate outcome or upstream prerequisite is offered |

---

## Validation Sign-Off

- [x] Every requirement has an automated contract or named Wave 0 dependency
- [x] Sampling continuity prevents three consecutive tasks without automated verification
- [x] Wave 0 covers every missing validation reference
- [x] No watch-mode flags
- [x] Focused feedback target is under 60 seconds
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** strategy complete; execution evidence pending
