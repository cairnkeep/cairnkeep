---
phase: 06-fastcontext-reliability-spike
plan: 01
subsystem: infra
tags: [fastcontext, llama-server, tool-calls, bash, probe, spike]

# Dependency graph
requires:
  - phase: 05-opencode-parity
    provides: verify-opencode-live-parity.sh pattern (staged/env-driven/loopback-safe harness shape)
provides:
  - "scripts/verify-fastcontext-reliability.sh — committed bash+curl+jq probe with --self-test, --props-only, --full, -h/--help"
  - "Offline --self-test backstop covering /props recording, per-turn tool-call assertion, and refined-D-05 verdict scoring"
affects: [06-02 (live probe + verdict), 07-context-explore-tool, 08-operating-layer-wiring, 09-live-verification-ab]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Env-driven, loopback-only probe config (FASTCONTEXT_PROBE_URL) mirroring the CAIRN_LLM_* precedent"
    - "Offline self-test backstop for a live-only probe: canned fixture JSON exercises the record-and-check + verdict logic with zero network access"
    - "Stubbed tool-result loop (Pattern 1): reliability probing without executing real filesystem access"

key-files:
  created:
    - scripts/verify-fastcontext-reliability.sh
  modified: []

key-decisions:
  - "Refined D-05 implemented as written in the plan's <d05_refinement>: verdict is anchored to gate #2 (every turn in the >=15-turn matrix must pass); gate #1 (chat_template_tool_use) is recorded as evidence only and never auto-forces a NO-GO on its own."
  - "System prompt and read/glob/grep tool schemas copied verbatim from 06-RESEARCH.md finding #2/#3's curl example (the only literal text available from the token-miser client.rs source, which lives in a sibling project not read directly by this plan)."
  - "assert_tool_call_turn() gates strictly on jq JSON structure (finish_reason == \"tool_calls\" AND non-empty tool_calls) and explicitly never accepts the stale-doc singular \"tool\" value."

patterns-established:
  - "Pattern: offline --self-test as the Nyquist backstop for a probe whose real signal requires an operator-gated live endpoint."

requirements-completed: [CTX-06]

coverage:
  - id: D1
    description: "Offline --self-test exits 0 with no live endpoint reachable, validating arg-parse, jq assertions, and the go/no-go verdict logic against canned fixture JSON"
    requirement: "CTX-06"
    verification:
      - kind: other
        ref: "bash scripts/verify-fastcontext-reliability.sh --self-test"
        status: pass
    human_judgment: false
  - id: D2
    description: "Self-test discriminates a PASS fixture (finish_reason==tool_calls, non-empty tool_calls) from a narration-FAIL fixture (finish_reason==stop, content-only)"
    requirement: "CTX-06"
    verification:
      - kind: other
        ref: "bash scripts/verify-fastcontext-reliability.sh --self-test (self-test:matrix assertion)"
        status: pass
    human_judgment: false
  - id: D3
    description: "/props recording treats an absent chat_template_tool_use as evidence, never as an error or auto-no-go"
    requirement: "CTX-06"
    verification:
      - kind: other
        ref: "bash scripts/verify-fastcontext-reliability.sh --self-test (self-test:props + self-test:verdict absent-field+all-PASS->GO case)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Live tool-call matrix and go/no-go verdict against the actually-deployed FastContext endpoint"
    verification: []
    human_judgment: true
    rationale: "Requires the operator's own deployed llama-server + FastContext GGUF endpoint (D-07); this is the scope of the follow-on Plan 06-02, not this plan."

duration: 2min
completed: 2026-07-04
status: complete
---

# Phase 6 Plan 01: FastContext Reliability Probe Instrument Summary

**Committed bash+curl+jq probe (`scripts/verify-fastcontext-reliability.sh`) with an offline `--self-test` that proves the /props recording, the strict per-turn tool-call gate, and the refined-D-05 verdict logic — all before any live endpoint is touched.**

## Performance

- **Duration:** 2 min (task commits span 23:04:38–23:06:28)
- **Started:** 2026-07-04T23:04:00+02:00 (approx.)
- **Completed:** 2026-07-04T23:06:28+02:00
- **Tasks:** 3/3
- **Files modified:** 1 (new)

## Accomplishments
- `scripts/verify-fastcontext-reliability.sh` created: `--self-test` (offline), `--props-only` (live gate #1), `--full` (live gate #1 + gate #2 + verdict), `-h`/`--help`.
- `inspect_props()`/`record_props_evidence()` record `/props`'s `chat_template_tool_use`, `chat_template_caps`, `build_info`, and the raw `chat_template` verbatim; an absent `chat_template_tool_use` is recorded as expected evidence for this Qwen3-family GGUF, never as an error.
- `run_turn_matrix()` drives a genuine multi-turn loop (>=5 prompts x >=3 turns, >=15 turns total) over an accumulating `messages` array — assistant tool-call turn, stubbed `role:"tool"` reply, next turn — using the verbatim read/glob/grep tool schemas and system prompt from 06-RESEARCH.md finding #2/#3.
- `assert_tool_call_turn()` gates strictly on `finish_reason == "tool_calls"` AND a non-empty `tool_calls` array via `jq`; never a `content` substring match, never the stale-doc `"tool"` value.
- `compute_verdict()` implements the refined D-05 scoring: GO only when every matrix turn passes (gate #2, D-06 hard blocker); gate #1 (`chat_template_tool_use`) is recorded as evidence and never auto-forces a NO-GO by itself.
- `finalize_evidence_log()` writes a per-turn results table and the D-08 pinned-combination block (build_info, chat_template excerpt, gate-1 status); `run_token_miser_corroboration()` runs the optional D-04 stage when `token_miser` is on PATH and logs a skip-with-reason otherwise.
- `--self-test` covers all five required fixture cases offline, with zero network access: PASS fixture accepted; narration-FAIL fixture rejected; all-PASS matrix -> GO; one-narration-turn matrix -> NO-GO; `chat_template_tool_use` ABSENT + all-PASS matrix -> still GO (the refined-D-05 guard).

## Task Commits

Each task was committed atomically:

1. **Task 1: Script skeleton — usage/help, env config, /props stage, offline self-test scaffold** - `6e3254e` (feat)
2. **Task 2: Multi-turn tool-call matrix — verbatim schemas, per-turn assertion, stubbed tool-result loop** - `0505fcf` (feat)
3. **Task 3: Verdict scoring (refined D-05), evidence-log finalize, optional token_miser corroboration** - `9e0d5ca` (feat)

## Files Created/Modified
- `scripts/verify-fastcontext-reliability.sh` - The committed, re-runnable FastContext reliability probe (bash + curl + jq); `--self-test`/`--props-only`/`--full`/`-h` modes.

## Decisions Made
- Implemented the refined D-05 scoring exactly as specified in this plan's `<d05_refinement>` block: the verdict is anchored to gate #2 (the empirical per-turn matrix), and gate #1's field-presence is evidence only.
- Used the verbatim system prompt and tool schemas quoted in 06-RESEARCH.md's finding #2 curl example (the only literal text available to copy from — the underlying token-miser `client.rs` source lives in a sibling project this plan does not read directly).
- Model alias, evidence log path, and probe URL are all env-overridable with loopback/repo-relative defaults; no host/IP/vendor literal is committed (`grep` for non-loopback IPv4 finds none).

## Deviations from Plan

None - plan executed exactly as written. All three tasks' `<action>`, `<verify>`, and `<acceptance_criteria>` items were implemented as specified; no Rule 1-4 deviations were needed.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. The live probe against a real FastContext endpoint is the operator-gated scope of Plan 06-02, not this plan.

## Known Stubs

None. This plan's own deliverable is intentionally a "stubbed tool-result loop" probe (Pattern 1 from 06-RESEARCH.md) — the probe never executes real filesystem access on the model's behalf by design (D-03), which is the documented, intended behavior for this reliability-only spike, not an unintentional stub.

## Threat Flags

None. All threats in this plan's `<threat_model>` (T-06-01 through T-06-04, T-06-SC) were mitigated as specified: env-only config with a loopback-only default (no non-loopback IPv4 found via grep), no URL/secret ever echoed (only a SET/UNSET-style presence indicator), all curl arguments quoted with no `eval`, and `assert_tool_call_turn()` gates strictly on JSON structure with the narration fixture proven rejected by `--self-test`.

## Next Phase Readiness
- The probe instrument is complete and self-verifying offline; Plan 06-02 can run `--props-only` then `--full` directly against the operator's deployed FastContext endpoint (FASTCONTEXT_PROBE_URL) without re-deriving any of this instrument.
- No blockers. The live probe itself remains gated on the operator standing up the `llama-server` endpoint (D-07) — not yet available on this machine as of this plan's execution.

---
*Phase: 06-fastcontext-reliability-spike*
*Completed: 2026-07-04*

## Self-Check: PASSED

- FOUND: scripts/verify-fastcontext-reliability.sh
- FOUND: .planning/phases/06-fastcontext-reliability-spike/06-01-SUMMARY.md
- FOUND commit: 6e3254e (Task 1)
- FOUND commit: 0505fcf (Task 2)
- FOUND commit: 9e0d5ca (Task 3)
