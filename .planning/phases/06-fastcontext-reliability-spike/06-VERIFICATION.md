---
phase: 06-fastcontext-reliability-spike
verified: 2026-07-04T23:45:00Z
status: passed
score: 9/9 must-haves verified
behavior_unverified: 0
overrides_applied: 0
resolution:
  - item: "CR-01 disposition (the sole human_needed item)"
    decision: "Operator chose FIX + live re-run. CR-01 fixed in commit 9df61a7 (reply to every tool_call, id-normalized; new [self-test:parallel] guard), alongside WR-01 and WR-02. The corrected probe was re-run live against the deployed GGUF: 15/15 turns PASS, VERDICT GO, --full exit 0 — verdict unchanged. Artifact is now safe for the re-runnable use D-01 promises."
---

# Phase 6: FastContext Reliability Spike Verification Report

**Phase Goal:** Probe `finish_reason=tool_calls` reliability against the actually-deployed FastContext GGUF quant + `llama-server --jinja` combo BEFORE any wiring is built on it (gates Phases 7-9, ROADMAP SC#1-3). Deliverables: a committed re-runnable probe script AND a recorded go/no-go verdict from a live run.
**Verified:** 2026-07-04
**Status:** passed (CR-01 resolved in `9df61a7`; live re-run reconfirmed GO 15/15)
**Re-verification:** No — initial verification; CR-01 human item discharged by fix + live re-run

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (ROADMAP SC#1) A repeated-trial probe records the observed `finish_reason` on every turn of a multi-prompt, multi-turn matrix against the deployed endpoint | ✓ VERIFIED | `06-EVIDENCE.log` (gitignored, read directly — not just SUMMARY claims) contains 15 `[matrix]` lines, one per turn, each recording `finish_reason=tool_calls` and a `tool_calls` count; per-turn table also appended at finalize |
| 2 | (ROADMAP SC#2) The probe checks `GET /props` → `chat_template_tool_use` against the deployed build | ✓ VERIFIED | `record_props_evidence()` (script lines 195-220) queries and logs `chat_template_tool_use`/`chat_template_caps`/`build_info`/raw `chat_template`; `06-EVIDENCE.log` shows `chat_template_tool_use: ABSENT` recorded with the architectural rationale, never erroring |
| 3 | (ROADMAP SC#3) A documented go/no-go verdict exists in the phase artifacts, never a silent assumption | ✓ VERIFIED | `06-SPIKE.md` states `VERDICT: GO` explicitly with rubric, D-08 pinned combination, and both gates' evidence; committed at `a81f2e7` |
| 4 | Offline `--self-test` exits 0 with NO live endpoint reachable | ✓ VERIFIED | Ran independently (not trusting SUMMARY): `bash scripts/verify-fastcontext-reliability.sh --self-test` → exit 0, output `[self-test] PASSED` |
| 5 | Self-test discriminates a PASS fixture (`finish_reason==tool_calls`, non-empty `tool_calls`) from a narration-FAIL fixture (`finish_reason==stop`, content-only) | ✓ VERIFIED | `self_test_matrix_assertion()` runs both fixtures through `assert_tool_call_turn()`; observed output `[self-test:matrix] OK: PASS fixture accepted, narration-FAIL fixture rejected` |
| 6 | `/props` recording treats an absent `chat_template_tool_use` as evidence, never an error or auto-no-go | ✓ VERIFIED | `self_test_props()` output `OK: absent-field and present-field /props fixtures both recorded without error`; `compute_verdict()` self-test asserts `ABSENT + all-PASS → GO` |
| 7 | The live tool-call matrix accumulates the conversation across turns per prompt (assistant tool_call → stubbed role:tool result → next assistant turn), a genuine multi-turn loop, not 15 independent turn-1 calls | ✓ VERIFIED (see also human-verification item re: CR-01) | `run_turn_matrix()` (lines 278-339) builds one `messages` array per prompt and appends turns in place; independently confirmed by `06-EVIDENCE.log`'s 15 matrix lines spanning 5 prompts × 3 turns each with turn indices 1,2,3 (not all turn=1) |
| 8 | The go/no-go verdict is anchored to gate #2 (every turn tool_calls = go; any narration turn = no-go); gate #1 presence is recorded evidence, never an auto-blocker | ✓ VERIFIED | `compute_verdict()` (lines 348-358) computes `GO` iff `MATRIX_PASS==MATRIX_TOTAL`; self-test proves `ABSENT+all-PASS→GO` and `one-narration→NO-GO`; `06-SPIKE.md` states and applies the same rubric; `06-EVIDENCE.log` shows `gate-1: ABSENT`, `gate-2: 15/15`, `VERDICT: GO` |
| 9 | 06-SPIKE.md pins the exact combination probed (D-08): model/quant, build_info, `--jinja`, chat-template excerpt | ✓ VERIFIED | `06-SPIKE.md` "D-08 pinned combination" table: `fastcontext-1.0-4b-rl-q8_0.gguf`, `build_info b8856-9da7b42f4`, `n_ctx 24576`, `--jinja` ON, chat-template excerpt shown; matches `06-EVIDENCE.log`'s independently-written pinned-combination block verbatim (`build_info: b8856-9da7b42f4`) |

**Score:** 9/9 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/verify-fastcontext-reliability.sh` | Committed bash+curl+jq probe; `--self-test`/`--props-only`/`--full`/`-h` | ✓ VERIFIED (with WARNING) | Exists, executable (`rwxr-xr-x`), `bash -n` parses clean, all four flags present and functional; `--self-test` independently re-run and passes; **but** contains an unresolved CRITICAL defect (CR-01, see below) that risks false NO-GO on a future re-run with parallel tool calls |
| `.planning/phases/06-fastcontext-reliability-spike/06-SPIKE.md` | Committed documented go/no-go verdict (ROADMAP SC#3) with D-08 pinned combination and scrubbed evidence excerpts | ✓ VERIFIED | Exists, committed at `a81f2e7`, states explicit `VERDICT: GO`, no non-loopback IPv4 found by grep, no secret/URL value present |
| `.planning/phases/06-fastcontext-reliability-spike/06-EVIDENCE.log` | Raw live-run evidence, gitignored | ✓ VERIFIED | Exists on disk, confirmed NOT tracked by git (`git ls-files` omits it; `git check-ignore -v` confirms `.gitignore:3:*.log` matches it); content independently corroborates every claim in 06-SPIKE.md and both SUMMARY.md files (15/15 PASS, build_info b8856-9da7b42f4, chat_template_tool_use ABSENT) — this is real evidence of an actual live run, not a fabricated artifact |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `assert_tool_call_turn()` | jq JSON structure | strict `finish_reason=="tool_calls" AND tool_calls length>0` gate | ✓ WIRED | Code (lines 246-257) never substring-matches content; self-test proves narration fixture rejected |
| `FASTCONTEXT_PROBE_URL` env | script config | `validate_probe_url()` + `log_endpoint_presence()` | ✓ WIRED | Loopback default (`http://127.0.0.1:8081/v1`); grep for non-loopback IPv4 in script and in 06-SPIKE.md both found none; URL value never echoed, only presence indicator |
| `run_turn_matrix()` | `compute_verdict()` | shared globals `MATRIX_TOTAL`/`MATRIX_PASS` | ✓ WIRED | `--full` path in `main()` (lines 534-550) calls `inspect_props` → `run_turn_matrix` → `compute_verdict` → `finalize_evidence_log` in sequence; exits 0 only on GO |
| `run_turn_matrix()` assistant tool_calls | stubbed `role:"tool"` reply | `tool_call_id=$(...tool_calls[0].id...)` | ⚠️ PARTIAL (CR-01) | Only replies to the first tool_call of a turn; a turn with 2+ tool_calls, or a missing `.id`, leaves subsequent tool_calls in the assistant message unanswered in the next request. Confirmed present in code at lines 332-336. Did not manifest in the actual recorded run (all 15 turns show `tool_calls=1` in `06-EVIDENCE.log`), so the recorded GO is unaffected, but the link is not fully robust for future re-runs |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|--------------|-------------|-------------|--------|----------|
| CTX-06 | 06-01-PLAN.md, 06-02-PLAN.md | FastContext tool-call reliability probed and documented against the actually-deployed GGUF quant + `llama-server --jinja` combo before any operating-layer wiring is built | ✓ SATISFIED | Script + live run + 06-SPIKE.md GO verdict, all independently verified above; REQUIREMENTS.md traceability table already marks CTX-06 "Complete" for Phase 6, matching this finding |

No orphaned requirements: REQUIREMENTS.md maps only CTX-06 to Phase 6, and both plans declare `requirements: [CTX-06]`.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `scripts/verify-fastcontext-reliability.sh` | 332-336 | CR-01 (06-REVIEW.md CRITICAL, unresolved): stubbed tool-result reply only handles `tool_calls[0]` and silently drops the reply entirely when `.id` is absent | 🛑 Critical (per code review), routed to human-verification rather than auto-blocking this phase's already-recorded goal | Risks false NO-GO on a *future* re-run of `--full` if the model emits parallel tool calls or an id-less tool_call — does not affect the already-recorded 2026-07-04 GO (independently confirmed: every one of the 15 recorded turns shows `tool_calls=1`, i.e., the vulnerable path was never exercised in this run) |
| `scripts/verify-fastcontext-reliability.sh` | 250-251, 310-313, 315, 323 | WR-01 (06-REVIEW.md warning, unresolved): a malformed/non-JSON 2xx response would abort the whole script under `set -euo pipefail` rather than being recorded as a per-turn FAIL | ⚠️ Warning | Did not manifest in the recorded run (all responses parsed cleanly); defeats the "never a silent skip" intent only in the untested malformed-response case |
| `scripts/verify-fastcontext-reliability.sh` | 362-374 | WR-02 (06-REVIEW.md warning, unresolved): `run_token_miser_corroboration()` appends raw, unfiltered subprocess stdout/stderr to the evidence log, which could contain an endpoint/diagnostic string if `token_miser` were present | ℹ️ Info (this run) | Stage 3 was skipped in the actual run (`token_miser` absent from PATH, confirmed in `06-EVIDENCE.log`: `[stage-3] token_miser absent from PATH — optional corroboration skipped`), so no leak occurred this run; latent risk only if `token_miser` becomes available later |

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in the committed script or `06-SPIKE.md`.

### Human Verification Required

### 1. CR-01 disposition decision

**Test:** Review `06-REVIEW.md`'s CR-01 finding against `scripts/verify-fastcontext-reliability.sh:332-336` and decide whether to fix, formally accept as tracked debt, or override before Phase 7 begins depending on this probe's re-runnability.
**Expected:** An explicit recorded decision (fix now / accept-with-follow-up-reference / override) — not a silent pass-through into Phase 7 planning.
**Why human:** The already-recorded GO verdict is empirically sound (the parallel-tool-call code path was never exercised — confirmed independently from the raw evidence log, every turn shows exactly 1 tool call), so this is not a fact that invalidates Phase 6's goal. But it is a judgment call about how much technical debt is acceptable in an artifact the project explicitly wants to be "re-runnable... whenever the pinned quant/build/template changes" (06-01-PLAN.md objective, D-01 rationale). A grep or test cannot decide the acceptable-risk threshold for future re-runs.

### Gaps Summary

No gaps block the phase's stated goal. All 9 merged must-have truths (3 ROADMAP success criteria + 6 plan-level truths) were independently verified against the actual codebase and the raw (gitignored) evidence log — not merely against SUMMARY.md claims. The live run is real: `06-EVIDENCE.log` was read directly and its per-turn results, build_info, and verdict match `06-SPIKE.md` and both SUMMARY.md files exactly, with no non-loopback IP or secret leaked.

The one open item is a code-quality/robustness question, not a goal-achievement failure: `06-REVIEW.md`'s CR-01 (critical) is unresolved in the committed script. It biases toward false NO-GO (not false GO) on future re-runs involving parallel tool calls, and it did not affect the already-recorded GO (the actual run's 15/15 turns each show exactly one tool call, so the vulnerable code path was never hit). Per the escalation-gate pattern this is routed to human verification rather than either silently passed or treated as an automatic blocker on a goal that is otherwise achieved.

---

*Verified: 2026-07-04*
*Verifier: Claude (gsd-verifier)*
