---
phase: 26-guided-setup-and-harness-onboarding
verified: 2026-08-12T13:05:25Z
status: gaps_found
score: 9/10 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "SETUP-02: missing or empty interactive targets recommend Git initialization while existing non-Git trees are never initialized silently"
    status: partial
    reason: "Explicit Git authorization and failure containment work, but the interactive controller asks for Git mode before target classification and presents no missing/empty-target recommendation. Public operating guidance claims that recommendation exists."
    artifacts:
      - path: "scripts/setup.mjs"
        issue: "promptSetupChoices asks a generic Git-mode question at line 74; classifySetupTarget does not run until line 164, so target state cannot influence the prompt."
      - path: "scripts/test-setup-preflight.mjs"
        issue: "Tests pure non-TTY choices and classification separately, but never exercise the interactive prompt/recommendation path."
      - path: "docs/operating.md"
        issue: "Line 78 states that a missing or empty interactive target recommends initialization, which the live prompt does not do."
    missing:
      - "Classify the selected target before asking for Git mode, then visibly recommend init only for missing/empty interactive targets."
      - "Keep existing non-Git targets explicit with no silent initialization."
      - "Add a behavioral interactive test that asserts recommendation, confirmation, refusal/no-write, and existing-tree wording."
---

# Phase 26: Guided Setup & Harness Onboarding Verification Report

**Phase Goal:** A first-time user can set up a missing, empty, non-Git, or existing project through an explicit harness-aware workflow that produces no ambiguous partial state, while existing scripted `cairn bootstrap` callers remain compatible.

**Verified:** 2026-08-12T13:05:25Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Verdict

Phase 26 is substantively implemented and its local, packaged, native-Windows, runtime-matrix, and Pi evidence is unusually strong. However, the goal contract is not fully achieved: the locked interactive Git-policy behavior in SETUP-02/D-04 is absent from the live controller. This is observable in code, contradicted by public documentation, and not covered by the tests that currently pass.

The failure is narrow but must-have: interactive onboarding is part of the phase goal. Status is therefore `gaps_found`, not `passed`.

## Goal Achievement

### Roadmap Success Criteria

| # | Roadmap criterion | Status | Evidence |
|---|---|---|---|
| 1 | Setup classifies target/Git before writes, offers interactive choices, and has deterministic automation flags | VERIFIED | `scripts/setup-core.mjs:161-310`, `scripts/setup.mjs:153-187`; focused preflight and output contracts pass. |
| 2 | Git mutation is explicit; missing-Git/untracked failures are distinct and non-partial | VERIFIED | `scripts/setup.mjs:147-186`, `scripts/setup-core.mjs:239-280`; focused preflight and compatibility contracts pass. |
| 3 | Only selected harness assets reconcile into versioned state; reruns preserve user data and report zero changes | VERIFIED | `scripts/setup-core.mjs:288-309`, `scripts/setup-reconcile.mjs:271-330`; reconcile and compatibility contracts pass. |
| 4 | Maintained Pi extension exposes only the effective catalog, preserves authority metadata, and closes its child | VERIFIED | `mcp-memory-server/src/pi-mcp-bridge.ts:109-239`, `pi/extensions/cairnkeep-memory.ts:15-60`; bridge smoke and accepted real-Pi evidence pass. |
| 5 | Platform/package/overlay/completion/uninstall/docs/learning contracts pass without hidden agent behavior | VERIFIED | Local focused checks pass; GitHub CI run 31597475813 reports all 11 jobs successful at `143a5c1`; only the acceptance summary changed afterward. |

### Requirement Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | SETUP-01 — guided and deterministic setup classifies target/Git before project writes | VERIFIED | Public dispatch at `scripts/cairn-cli.mjs:99-102` and `scripts/windows-platform.mjs:699-712`; parse/preflight/plan/mutation order at `scripts/setup.mjs:153-187`; focused tests pass. |
| 2 | SETUP-02 — Git initialization is explicit, failure classes are non-partial, and missing/empty interactive targets recommend initialization | **FAILED — BLOCKER** | Explicit authorization and failure handling exist, but `scripts/setup.mjs:69-82` asks generic Git mode before `classifySetupTarget()` at line 164. No recommendation is possible; `docs/operating.md:78-79` overclaims it. |
| 3 | SETUP-03 — selected harnesses only, versioned state, compatible bootstrap | VERIFIED | Selected launcher construction at `scripts/setup-core.mjs:294-308`; state v1 at `scripts/setup-reconcile.mjs:316-324`; compatibility test passes. |
| 4 | SETUP-04 — ownership-safe reconciliation, stable unchanged reruns, no implicit global reinstall, exact counts | VERIFIED | Desired/current/prior digest decisions at `scripts/setup-reconcile.mjs:289-330`; setup only reports machine sync at `scripts/setup.mjs:102-118`; reconcile/output tests pass. |
| 5 | SETUP-05 — result and doctor name modes, launch, verification, limitations, and recovery | VERIFIED | Result model/rendering at `scripts/setup.mjs:93-135`; diagnosis at `scripts/setup.mjs:251-293`; output and doctor tests pass. |
| 6 | SETUP-06 — POSIX/native Windows, Bash 3.2, Node 22/24/26, package, completion, uninstall, and smoke coverage | VERIFIED | Shared Windows dispatch and completion are wired; CI run 31597475813 has successful native Windows 22/24/26, memory-server 22/24/26, macOS Bash 3.2, repository, boot, container, and portability jobs. |
| 7 | PI-MCP-01 — local stdio child, dynamic discovery/calls, cancellation and shutdown | VERIFIED | Dynamic paginated discovery/call/close at `pi-mcp-bridge.ts:139-239`; bridge smoke and accepted required-release evidence cover call/cancel/shutdown/no-orphan. |
| 8 | PI-MCP-02 — effective gate/profile intersection and exact trusted Phase 21 metadata | VERIFIED | Bridge consumes only `tools/list` results and retains tool/annotations/output schema/content/details at `pi-mcp-bridge.ts:139-157, 211-230`; profile and metadata oracle passes. |
| 9 | PI-MCP-03 — explicit cross-platform Pi lifecycle and real stdio round trip without agent behavior | VERIFIED | Explicit sync/doctor/uninstall wiring, tools-only Pi registration, lifecycle test pass, and accepted non-SKIP real-Pi evidence for two distinct installations. |
| 10 | OVERLAY-01 — stable provider-neutral data-only policy seam while core owns generic behavior | VERIFIED | Strict parser at `scripts/setup-core.mjs:49-150`; policy schema and public docs exist; overlay and privacy contracts pass. |

**Score:** 9/10 requirement truths verified (0 present-but-behavior-unverified)

## Required Artifacts

| Artifact | L1/L2 | Wiring / data flow | Status |
|---|---|---|---|
| `scripts/setup-core.mjs` | 310 lines; substantive parse, policy, target, Git, choices, and plan exports | Imported by `scripts/setup.mjs`; produces frozen plan consumed by reconciler | VERIFIED |
| `scripts/setup-reconcile.mjs` | 331 lines; substantive containment, digest, atomic write, and state logic | Imported by controller; writes selected assets then `.ai/cairnkeep.json` | VERIFIED |
| `scripts/setup.mjs` | 294 lines; substantive controller, output, and doctor model | Called by POSIX and Windows CLI routes | PARTIAL — interactive recommendation gap |
| `schemas/cairnkeep-setup.schema.json` | Strict v1 state schema exists | Packaged, documented, and contract-tested | VERIFIED |
| `schemas/cairnkeep-setup-policy.schema.json` | Strict v1 policy schema exists | Packaged, documented, and checked against runtime behavior | VERIFIED |
| `mcp-memory-server/src/pi-mcp-bridge.ts` | 240 lines; substantive SDK supervision and adaptation | Built to `dist`, dynamically imported by Pi extension | VERIFIED |
| `pi/extensions/cairnkeep-memory.ts` | 61 lines; substantive tools-only lifecycle binding | Explicitly installed/checked by POSIX and Windows Pi sync | VERIFIED |
| `scripts/phase26-test-manifest.mjs` | Exact five-entry routine manifest | Imported and executed by repository runner | VERIFIED |
| `scripts/verify-pi-mcp-bridge.mjs` | 588 lines; substantive self-test and required-release acceptance runner | Used by release evidence; self-test passes locally | VERIFIED |
| Public docs and Ready L23 | Operating, compatibility, Windows, privacy, overlay, uninstall, learning, and changelog surfaces exist | Docs/learning/package tests pass | PARTIAL — operating docs overclaim the missing interactive recommendation |

## Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `scripts/cairn-cli.mjs` | `scripts/setup.mjs` | Dynamic `runSetup` import | WIRED | POSIX path at lines 99-102. |
| `scripts/windows-platform.mjs` | `scripts/setup.mjs` | Same controller plus Windows-only asset augmentation | WIRED | Lines 699-712; no second policy implementation. |
| `scripts/setup.mjs` | `scripts/setup-core.mjs` | Parse → policy → prompt → preflight → choices → plan | WIRED | Lines 153-172; ordering exposes the recommendation gap. |
| `scripts/setup.mjs` | `scripts/setup-reconcile.mjs` | Confirmed plan passed after prompt/confirmation | WIRED | Lines 174-187. |
| `scripts/setup-reconcile.mjs` | `.ai/cairnkeep.json` | Strict relative state written last and atomically | WIRED | Lines 285-324. |
| Pi extension | compiled bridge | Installed package root dynamic import | WIRED | `pi/extensions/cairnkeep-memory.ts:5-22`. |
| Pi bridge | `cairn memory-server` | Fixed argv, `shell:false` SDK transport, `MCP_HTTP_PORT` removed | WIRED | `pi-mcp-bridge.ts:63-68, 109-121`. |
| Server `tools/list` | Pi registrations/calls | Paginated dynamic catalog and per-tool closures | WIRED | `pi-mcp-bridge.ts:139-157`; extension lines 24-37. |
| Pi sync/doctor/uninstall | memory extension | Explicit package-owned lifecycle | WIRED | `sync-pi-assets.sh`, `doctor.sh`, and `uninstall.sh`; lifecycle tests pass. |
| Repository/server runners | Phase 26 contracts | Shared five-entry manifest and named bridge smoke | WIRED | Registration proof passes; server `test:smoke` includes `check:pi-mcp-bridge`. |

## Data-Flow Trace

| Artifact | Data | Source | Consumer | Status |
|---|---|---|---|---|
| Setup controller | target/Git/harness/memory/confirmation | argv/policy/TTY | frozen plan → reconciler → result | FLOWING, except target state does not flow back into the interactive Git prompt |
| Setup state | selected assets, modes, digests, versions | reconciliation decisions | doctor and allow-listed uninstall | FLOWING |
| Pi bridge | effective tool records and call results | live local MCP `tools/list` / `tools/call` | Pi tool definitions and trusted result details | FLOWING |
| Test manifest | exact routine contract paths | `phase26-test-manifest.mjs` | shared repository dispatcher | FLOWING |

## Decision Coverage

| Decisions | Status | Evidence |
|---|---|---|
| D-01–D-03 | VERIFIED | Public setup plus compatible bootstrap; deterministic flags; read-only preflight before managed writes. |
| D-04 | **FAILED** | Explicit `--git init` works and existing trees are not silently initialized, but missing/empty interactive targets receive no tailored recommendation. |
| D-05–D-10 | VERIFIED | Distinct errors/no-write tests, Git-less limitations, multi-harness state, selected reconciliation, and explicit machine sync. |
| D-11–D-15 | VERIFIED | Cairnkeep-owned SDK bridge, dynamic effective catalog, exact trusted details, bounded lifecycle, tools only. |
| D-16–D-19 | VERIFIED | Shared Node path, provider-neutral policy, RED-before-GREEN history/contracts/docs, provisional unreleased v2.11 sequencing, and successful external platform matrix. |

## High-Threat Disposition

| Threat | Status | Independent evidence |
|---|---|---|
| T-26-01 target traversal/link/device | MITIGATED | Ancestor/destination `lstat` and containment checks; setup preflight/reconcile tests pass; native Windows CI passed. |
| T-26-02 shell/PATH or executable policy injection | MITIGATED | Fixed argv and `shell:false`; strict no-follow enum-only policy; preflight/overlay tests pass. |
| T-26-03 user-owned overwrite/delete | MITIGATED | Three-way digests and backup-first allow-listed uninstall; reconcile/uninstall/lifecycle tests pass. |
| T-26-04 secret/private-state disclosure | MITIGATED | Strict relative state allowlist/private mode, sanitized evidence, public-reference scan, package test. |
| T-26-05 partial state/interrupted replace | MITIGATED | Full validation before target creation, same-directory atomic replace, state last, interruption/idempotence tests. |
| T-26-06 inherited HTTP transport | MITIGATED | Child environment removes `MCP_HTTP_PORT`; hostile-environment bridge test passes. |
| T-26-07 stderr/request stalls | MITIGATED | Bounded stderr/result sizes and finite startup/call timeouts; delay/crash tests pass. |
| T-26-08 collision/catalog authority | MITIGATED | Dynamic catalog only, duplicate/collision rejection, direct catalog oracle. |
| T-26-09 cancellation/shutdown race | MITIGATED | Per-call abort, idempotent close, child-exit state transition, cancellation/no-orphan tests and real-Pi evidence. |
| T-26-10 annotation/profile loss | MITIGATED | Exact direct-vs-bridge profile/schema/annotation comparisons; no native-propagation claim. |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Preflight/choice/no-write | `node scripts/test-setup-preflight.mjs` | PASS | PASS |
| Ownership/idempotence/atomic state | `node scripts/test-setup-reconcile.mjs` | PASS | PASS |
| Legacy bootstrap compatibility | `node scripts/test-setup-compatibility.mjs` | PASS | PASS |
| Setup human/JSON/limited output | `bash scripts/test-setup-output.sh` | PASS | PASS |
| Overlay policy and precedence | `bash scripts/test-setup-overlay.sh` | PASS | PASS |
| Complete/limited/incomplete/Pi doctor | `bash scripts/test-doctor.sh` | PASS | PASS |
| Backup-first uninstall/revert | `bash scripts/test-uninstall.sh` | PASS | PASS |
| Pi machine lifecycle | `node scripts/test-pi-lifecycle.mjs` | PASS | PASS |
| Pi catalog/call/cancel/crash/shutdown | `node mcp-memory-server/scripts/smoke-pi-mcp-bridge.mjs` | PASS | PASS |
| Exact routine registration | `node scripts/run-repository-tests.mjs --verify-phase26-registration=routine` | PASS, five exact contracts once | PASS |
| Real-Pi runner controls | `node scripts/verify-pi-mcp-bridge.mjs --self-test` | PASS, including skip/input/version/profile/cancel/shutdown/orphan controls | PASS |

## External Acceptance Evidence

- `gh run view 31597475813 --repo cairnkeep/cairnkeep --json ...` independently returned `status: completed`, `conclusion: success`, head `143a5c1bf3bc142ed42c207c1b263fe064c8bf48`, and 11 successful jobs. These include native Windows on Node 22/24/26, memory server on Node 22/24/26, macOS fresh install/Bash 3.2, repository, server boot, container, and shell portability. From that tested head to current `HEAD`, only `26-10-SUMMARY.md` changed.
- Per the verification scope, the sanitized objective evidence in `26-10-SUMMARY.md` is accepted for the non-skipping real-Pi required-release run, official Node 24/26 containers, and isolated empty non-Git replay. The reported Pi matrix covers separate 0.84.1 fixture installations, full/read-only/custom catalogs, schemas, trusted metadata/details, harmless call, cancellation, awaited shutdown, and no orphan.

## Probe Execution

No `probe-*.sh` path is declared by the phase. The phase declares focused behavioral contracts and an acceptance runner instead; those were executed as listed above.

## Requirements Coverage

| Requirement | Source plans | Status | Evidence |
|---|---|---|---|
| SETUP-01 | 01, 04, 06, 10 | SATISFIED | Public controller/preflight and passing focused tests. |
| SETUP-02 | 01, 04, 06, 10 | **BLOCKED** | Interactive missing/empty recommendation absent. |
| SETUP-03 | 01, 04, 06, 10 | SATISFIED | Selected state/scaffold and bootstrap compatibility. |
| SETUP-04 | 01, 04, 10 | SATISFIED | Three-way ownership and exact rerun counts. |
| SETUP-05 | 02, 03, 06, 07, 08, 09, 10 | SATISFIED | Output, doctor, recovery, lifecycle, docs, learning. |
| SETUP-06 | 02, 03, 06, 07, 08, 09, 10 | SATISFIED | Package/platform/runtime/CI evidence. |
| PI-MCP-01 | 01, 05, 09, 10 | SATISFIED | Dynamic supervised stdio bridge and real acceptance. |
| PI-MCP-02 | 01, 05, 08, 09, 10 | SATISFIED | Effective profiles and exact trusted metadata. |
| PI-MCP-03 | 03, 07, 08, 09, 10 | SATISFIED | Explicit lifecycle and accepted real round trip. |
| OVERLAY-01 | 02, 04, 06, 08, 10 | SATISFIED | Strict data-only seam and public-core ownership. |

No Phase 26 requirement is orphaned from plan frontmatter.

## Anti-Patterns and Disconfirmation Pass

| File | Line | Finding | Severity | Impact |
|---|---:|---|---|---|
| `scripts/setup.mjs` | 74 / 164 | Git prompt precedes target classification; no target-aware recommendation | BLOCKER | D-04 and the recommendation clause of SETUP-02 are not implemented. |
| `docs/operating.md` | 78 | Documentation claims missing/empty interactive targets recommend init | WARNING (same root cause) | Public guidance overstates live behavior. |
| `scripts/test-setup-preflight.mjs` | 92-192 | Passing test separately covers non-TTY choices and pure classification, not their interactive integration | WARNING (same root cause) | A passing contract is misleading for the failed clause. |

No unreferenced `TBD`, `FIXME`, or `XXX` marker was found in phase-modified files. Empty/null matches were fixture accumulators, optional state, or deliberate cancellation returns rather than product stubs.

The required disconfirmation pass found: one partially met requirement (SETUP-02), one passing test that does not test the claimed interactive behavior (`test-setup-preflight.mjs`), and one uncovered error/UX path (interactive recommendation/refusal wording by target class). No additional independent blocker was found.

## Human Verification Required

None. Native/runtime/real-Pi/replay evidence was explicitly accepted as objective evidence for this verification, and every behavior-dependent runtime invariant has either a passing focused behavioral contract or accepted external acceptance evidence.

## Gaps Summary

One blocking gap remains. Move target classification ahead of the interactive Git question (or otherwise feed classified target state into the prompt), visibly recommend `init` for missing/empty targets while keeping existing non-Git trees explicitly neutral, and add a behavioral interactive test. Update or retain the operating statement only after that test passes.

No later milestone phase exists to which this must-have can be deferred.

---

_Verified: 2026-08-12T13:05:25Z_
_Verifier: goal-backward code and behavior audit_
