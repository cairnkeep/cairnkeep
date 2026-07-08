---
phase: 13-headless-harness-hardening
verified: 2026-07-08T14:43:02Z
status: human_needed
score: 3/5 must-haves verified
behavior_unverified: 2
overrides_applied: 0
human_verification:
  - test: "Run `scripts/verify-opencode-live-parity.sh --repeat 5` in an environment with CAIRN_LLM_API_KEY / CAIRN_LLM_API_URL / CAIRN_LLM_EXTRACTION_MODEL set to a no-thinking, tool-call-reliable local model (e.g. qwen3.5-27b), and confirm the output ends with `[repeat] OK: 5/5 consecutive round-trips`."
    expected: "5 consecutive `[repeat:i/5] PASS (retries=N)` rows followed by `[repeat] 5/5 PASSED` and `[repeat] OK: 5/5 consecutive round-trips`, exit code 0."
    why_human: "Requires an operator-configured, tool-call-reliable local model that is not available in this sandbox. All fixture/offline/fail-fast paths were verified in the sandbox; the live 5/5 reproduction (the actual reliability claim, SC#1) cannot be exercised here — the model's tool-calling behavior is exactly what's under test."
  - test: "Inspect the retries= column across the 5 iterations of a live --repeat 5 run for at least one non-zero value that still resulted in PASS."
    expected: "At least one iteration shows retries>0 with an eventual PASS, demonstrating the retry logic absorbed real opencode run-completion flakiness without an operator intervening — OR all 5 iterations show retries=0, which is also an acceptable (if less demonstrative) passing outcome."
    why_human: "SC#2 asserts the retry absorbs previously-identified flakiness; the retry classification logic (infra-vs-narration split) was verified by code review and the offline fixture test, but exercising real infra flakiness requires the live opencode/model environment."
gaps: []
---

# Phase 13: Headless Harness Hardening Verification Report

**Phase Goal:** The OpenCode `/remember`->`/recall` round-trip reproduces reliably in the scripted headless harness, closing the v1.1 OCP-06 override gap.
**Verified:** 2026-07-08T14:43:02Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The scripted headless harness (serve/`--attach` + retry) completes the `/remember`->`/recall` round-trip successfully across repeated runs, not a single lucky pass (SC#1) | PRESENT_BEHAVIOR_UNVERIFIED | `run_stage_remember_recall()` drives both halves through `opencode serve`/`--attach` (`--attach "$CAPTURE_SERVE_URL"` present on both /remember and /recall calls, lines 616, 644), asserts genuine `tool_use` events via `assert_tool_event()` (canary-linked on recall), and `--repeat N` loops N independent cold reproductions with a fresh scratch environment per iteration (lines 808-853). All offline/structural/fail-fast checks pass live in this sandbox. The actual repeated-run reliability claim (N/N live passes) requires an operator-configured tool-call-reliable model — not available here. Both 13-01-SUMMARY.md and 13-02-SUMMARY.md self-report this exact gap (`human_judgment: true`). |
| 2 | The harness's retry logic absorbs the previously-identified opencode run-completion flakiness without manual operator intervention (SC#2) | PRESENT_BEHAVIOR_UNVERIFIED | Retry classification code (lines 609-669) is correct by inspection: retries fire only on `rc==124` (timeout kill) or empty `extract_session_id` (infra failure), bounded to 3 attempts, incrementing `LAST_ROUNDTRIP_RETRIES`; a cleanly-completed run with no matching `tool_use` event is a hard FAIL with no retry. This logic was never exercised against a real flaky opencode run in this sandbox (no live model configured) — the mechanism is present and wired, its live effectiveness is unproven here. |
| 3 | The v1.1 OCP-06 known gap (reliable headless reproduction) is recorded as resolved in MILESTONES.md and REQUIREMENTS.md traceability (SC#3) | VERIFIED (with caveat) | `.planning/REQUIREMENTS.md` line 30: `[x] **OCP-07**...`; line 62: `| OCP-07 | Phase 13 | Complete |`. `.planning/MILESTONES.md` lines 65-68: OCP-06 reliable-headless-reproduction bullet marked "RESOLVED by OCP-07 / Phase 13", the carried-forward `"type":"tool"` footnote is present, and the separate interactive-TUI bullet is correctly left "Still open" (not claimed resolved). **Caveat:** MILESTONES.md's resolved-bullet text asserts the soak "reproduces the round-trip 5/5 consecutive times" and points at "the Phase 13 UAT/VERIFICATION doc" for the per-run/aggregate evidence — but no such doc existed prior to this verification, and this VERIFICATION.md does not itself contain a live 5/5 transcript (see Truth 1). The doc-update literal ask (flip the checkbox/traceability row, annotate the gap) is satisfied; the underlying reliability claim the doc text asserts is still pending human/operator confirmation. |

**Score:** 3/5 truths verified (1 truth-with-caveat counted VERIFIED; 2 present, behavior-unverified — see Human Verification)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/lib/assert-tool-event.mjs` | Standalone NDJSON tool_use event matcher, env-driven regex/canary | VERIFIED | Exists, 50 lines, reads `TOOL_EVENT_REGEX`/`TOOL_EVENT_CANARY` only from `process.env`; matches `type==="tool_use"` + regex + `status==="completed"` + optional canary substring; try/catch per line skips malformed JSON. |
| `scripts/test-remember-recall-assertions.sh` | Offline fixture test, 5 cases | VERIFIED | Executable (`-rwxrwxr-x`); `bash scripts/test-remember-recall-assertions.sh` exits 0, all 5 fixture cases (genuine-write PASS, canary-search PASS, missing-canary FAIL, narrated-text FAIL, empty FAIL) print PASS. |
| `scripts/verify-opencode-live-parity.sh` | `run_stage_remember_recall` hardened, `preflight_tool_call_probe`, `--repeat N` | VERIFIED | `bash -n` clean; `assert_tool_event` appears 9x (wrapper + 2 call sites in `run_stage_remember_recall` + 1 in `preflight_tool_call_probe` + comments); `LAST_ROUNDTRIP_RETRIES` declared, reset, and incremented; `--attach "$CAPTURE_SERVE_URL"` on both /remember and /recall calls; `--repeat` dispatch case present with arg validation, preflight gate, per-iteration fresh scratch, evidence rows, aggregate verdict. |
| `docs/operating.md` | Model precondition + `--repeat` soak documented | VERIFIED | New subsection "Headless round-trip harness — model precondition" (lines 93-115) contains `tool-call-reliable`, `qwen3.5-27b`, `--repeat`; `scripts/verify-docs-parity.sh` and `scripts/verify-no-private-references.sh` both exit 0. |
| `.planning/MILESTONES.md` | OCP-06 gap recorded resolved | VERIFIED (see Truth 3 caveat) | Bullet updated, footnote present, interactive-TUI bullet correctly untouched. |
| `.planning/REQUIREMENTS.md` | OCP-07 checked, traceability Complete | VERIFIED | Checkbox `[x]`, traceability row `Complete`, Last-updated line refreshed. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `run_stage_remember_recall` | `assert-tool-event.mjs` | `assert_tool_event()` bash wrapper, stdin passthrough | WIRED | Wrapper at line 572-574 invoked at lines 631, 660, 682 with correct regex/canary args. |
| `run_stage_remember_recall` (both halves) | `opencode serve` | `--attach "$CAPTURE_SERVE_URL"` | WIRED | Present on /remember (line 616), /recall seeded (line 644), and unseeded recall (line 673) invocations; function guards on empty `CAPTURE_SERVE_URL` at entry (lines 604-607). |
| `--repeat` loop | `run_stage_remember_recall` + `LAST_ROUNDTRIP_RETRIES` | direct call + var read | WIRED | Line 835 calls the function; line 836/839 reads `$LAST_ROUNDTRIP_RETRIES` for the evidence row. |
| `preflight_tool_call_probe` | `assert_tool_event` | direct call | WIRED | Line 724 asserts a genuine write-style tool_use event before returning OK. |
| `--repeat` dispatch | `preflight_tool_call_probe` | direct call, gates loop entry | WIRED | Line 820: `if ! preflight_tool_call_probe; then ... exit 1` before any loop iteration (D-06 confirmed live: env-unset run aborted in the sandbox without looping). |
| docs/operating.md prose | `CAIRN_LLM_API_KEY`/`API_URL`/`EXTRACTION_MODEL` | named reference, no new key | WIRED | `scripts/verify-docs-parity.sh` confirms no undocumented env key introduced. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Offline fixture matcher distinguishes genuine tool call from narration | `bash scripts/test-remember-recall-assertions.sh` | 5/5 cases PASS, aggregate PASS, exit 0 | PASS |
| Script syntax valid after all edits | `bash -n scripts/verify-opencode-live-parity.sh` | exit 0 | PASS |
| `--repeat` fails fast (no hang) with CAIRN_LLM_* unset | `env -u CAIRN_LLM_API_KEY -u CAIRN_LLM_API_URL -u CAIRN_LLM_EXTRACTION_MODEL timeout 30 scripts/verify-opencode-live-parity.sh --repeat 1` | `[preflight] FAIL: CAIRN_LLM_* not fully set` then `[repeat] ABORT`, exit 1, well under the 30s timeout | PASS |
| `--repeat` argument validation | `scripts/verify-opencode-live-parity.sh --repeat 0` / `--repeat abc` | Both print usage message, exit 2 | PASS |
| `--help` documents `--repeat` | `scripts/verify-opencode-live-parity.sh --help \| grep -A3 -- --repeat` | Synopsis + paragraph present | PASS |
| Live 5/5 round-trip soak (the actual reliability claim) | `scripts/verify-opencode-live-parity.sh --repeat 5` (requires real tool-call-reliable model) | Not run — no CAIRN_LLM_* model configured in this sandbox | SKIP (routed to human verification) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| OCP-07 | 13-01, 13-02, 13-03 | The headless harness reliably reproduces the OpenCode `/remember`->`/recall` round-trip (serve/`--attach` + retry), closing the v1.1 OCP-06 override gap | SATISFIED (docs/traceability) / NEEDS HUMAN (live reliability claim) | `.planning/REQUIREMENTS.md` line 30/62 flip to Complete; underlying mechanism built and offline-verified; live 5/5 reproduction pending operator run (see Truths 1-2). |

No orphaned requirements: OCP-07 is the only requirement ID declared across all three plans and it maps 1:1 to the REQUIREMENTS.md entry.

### Anti-Patterns Found

None. No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers, no empty stub implementations, no hardcoded-empty-data patterns found in `scripts/lib/assert-tool-event.mjs`, `scripts/test-remember-recall-assertions.sh`, `scripts/verify-opencode-live-parity.sh`, or `docs/operating.md`.

### Human Verification Required

### 1. Live 5/5 round-trip soak

**Test:** Run `scripts/verify-opencode-live-parity.sh --repeat 5` in an environment with `CAIRN_LLM_API_KEY`/`CAIRN_LLM_API_URL`/`CAIRN_LLM_EXTRACTION_MODEL` configured against a no-thinking, tool-call-reliable local model (e.g. qwen3.5-27b, per docs/operating.md).
**Expected:** Output ends with `[repeat] OK: 5/5 consecutive round-trips`, exit code 0. Paste the per-iteration + aggregate table into this phase's VERIFICATION/UAT record.
**Why human:** This is the actual SC#1 reliability claim — code review and offline fixtures prove the mechanism is built correctly, but only a live run against a real model proves the round-trip reproduces reliably. No CAIRN_LLM_* model is configured in this sandbox.

### 2. Retry absorption evidence

**Test:** Inspect the `retries=` column across the 5 iterations of the live `--repeat 5` run above.
**Expected:** Either at least one iteration shows `retries>0` with an eventual PASS (demonstrating infra flakiness was absorbed), or all iterations show `retries=0` (also acceptable, if less demonstrative of the retry mechanism specifically).
**Why human:** SC#2 asserts the retry logic absorbs real, previously-identified opencode flakiness. The infra-vs-narration classification logic was code-reviewed and is structurally sound, but exercising genuine flakiness requires the live environment.

### Gaps Summary

No FAILED truths, artifacts, or key links. All code artifacts for the harness hardening (NDJSON matcher, `--attach` transport conversion, infra-only retry classification, preflight probe, `--repeat N` soak mode, documentation, and MILESTONES/REQUIREMENTS traceability updates) exist, are substantive, are wired correctly, and pass every check that is runnable in this sandbox (offline fixtures, syntax, fail-fast paths, argument validation, docs-parity, no-private-references).

The phase's central reliability claim — that the round-trip reproduces 5/5 times live — is architecturally sound and defensibly built, but has not been demonstrated live in any environment yet (no Phase 13 UAT/VERIFICATION doc existed prior to this report, and the CAIRN_LLM_* model precondition cannot be satisfied in this sandbox). MILESTONES.md's "RESOLVED" language for the OCP-06 gap is therefore ahead of the recorded evidence: it correctly describes what the harness now does, but the specific "5/5 consecutive" and "recorded in the Phase 13 UAT/VERIFICATION doc" claims are not yet substantiated anywhere in the repository. This is not a code defect — it is a pending operator action. Recommend: an operator with a qwen3.5-27b-class (or better) tool-call-reliable local model runs `--repeat 5`, and the resulting transcript is appended to this VERIFICATION.md (or a companion UAT doc) before the milestone is considered fully closed out.

---

*Verified: 2026-07-08T14:43:02Z*
*Verifier: Claude (gsd-verifier)*
