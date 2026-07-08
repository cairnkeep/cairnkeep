---
phase: 13-headless-harness-hardening
plan: 02
subsystem: testing
tags: [bash, node, opencode, harness, soak, reliability]

# Dependency graph
requires:
  - phase: 13-headless-harness-hardening (plan 01)
    provides: "scripts/lib/assert-tool-event.mjs, assert_tool_event() wrapper, LAST_ROUNDTRIP_RETRIES, hardened run_stage_remember_recall (serve/--attach transport)"
provides:
  - "preflight_tool_call_probe() -- mechanical gate that fails fast on missing CAIRN_LLM_* config or a non-tool-call-reliable model, before any soak setup is burned"
  - "--repeat N soak mode -- N independent cold reproductions of the hardened remember->recall round-trip, per-iteration PASS/FAIL + retry-count table, aggregate N/N verdict"
affects: [13-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Preflight-before-soak gate (Phase 6 precedent): a cheap single-iteration probe run once, before N expensive iterations, so a bad model/config fails in seconds not minutes"
    - "Per-iteration CLEANED_UP=0 + cleanup() reset to force a fresh scratch teardown/re-arm cycle inside a loop, reusing the single EXIT-trap cleanup() function rather than a second teardown implementation"

key-files:
  created: []
  modified:
    - scripts/verify-opencode-live-parity.sh

key-decisions:
  - "preflight_tool_call_probe drives one /remember-style turn against the real cairn-memory MCP tool (not a generic built-in tool) via the same scratch bring-up + serve/--attach transport the soak itself uses, per 13-RESEARCH.md Open Question 2's recommendation -- the marginal setup cost is small and it directly proves the property the soak depends on"
  - "The env-var presence check (CAIRN_LLM_API_KEY/API_URL/EXTRACTION_MODEL) runs before ANY opencode invocation in the probe, since an empty provider config hangs opencode indefinitely rather than failing fast (Pitfall 2) and opencode's own bundled default model could otherwise produce a false PASS (Pitfall 3)"
  - "--repeat's aggregate FAIL path uses return 1 (not exit 1), mirroring the existing --full case's convention, since main is the script's last statement and both are equivalent for the final exit code; argument validation and preflight-abort use exit 2 / exit 1 respectively, per the plan's explicit wording"

patterns-established:
  - "Soak loop iterates its own capture_real_config_fingerprint/setup_scratch/seed_canary/install_assets/write_scratch_config/positive_load_check/start_capture_server/stop_capture_server cycle per iteration, then explicitly resets CLEANED_UP=0 and calls cleanup() to force scratch teardown before the next iteration -- no state bleed (D-03)"

requirements-completed: [OCP-07]

coverage:
  - id: D1
    description: "preflight_tool_call_probe fails fast (no opencode call) when CAIRN_LLM_API_KEY/API_URL/EXTRACTION_MODEL is not fully set, and otherwise drives one real cairn-memory tool call asserted via assert_tool_event, printing a trait-named FAIL message on narration failure"
    requirement: "OCP-07"
    verification:
      - kind: other
        ref: "bash -n scripts/verify-opencode-live-parity.sh (syntax) + grep 'preflight_tool_call_probe' + grep 'not tool-call-reliable (no-thinking required)' -- both pass"
        status: pass
    human_judgment: false
  - id: D2
    description: "--repeat N soak mode: gated by the preflight probe, loops N independent cold reproductions of run_stage_remember_recall, per-iteration PASS/FAIL+retries row, aggregate N/N verdict, non-zero exit unless all N pass, non-numeric/zero N rejected with exit 2"
    requirement: "OCP-07"
    verification:
      - kind: integration
        ref: "env -u CAIRN_LLM_API_KEY -u CAIRN_LLM_API_URL -u CAIRN_LLM_EXTRACTION_MODEL timeout 30 scripts/verify-opencode-live-parity.sh --repeat 1 -- exits 1 in 0.005s (bounded fail-fast, no hang); scripts/verify-opencode-live-parity.sh --repeat 0/abc/-3 all exit 2 with usage message; scripts/verify-opencode-live-parity.sh --help greps --repeat"
        status: pass
    human_judgment: true
    rationale: "The live 5/5 soak against a real tool-call-reliable local model (the actual reliability claim, D-01) can only be proven in an environment with CAIRN_LLM_* configured -- not runnable in this sandbox. This plan's own testing confirms the gate logic (fail-fast, argument validation, dispatch wiring); the operator must run scripts/verify-opencode-live-parity.sh --repeat 5 live and record the 5/5 result as the phase gate (13-RESEARCH.md Validation Architecture, Phase Gate row)."

duration: 12min
completed: 2026-07-08
status: complete
---

# Phase 13 Plan 02: Preflight Probe + `--repeat N` Soak Mode Summary

**`preflight_tool_call_probe()` gates a new `--repeat N` soak mode in `scripts/verify-opencode-live-parity.sh` that runs N independent cold reproductions of the hardened remember→recall round-trip, printing a per-iteration PASS/FAIL+retry table and an aggregate N/N verdict.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-08T16:26:00+02:00
- **Completed:** 2026-07-08T16:31:12+02:00
- **Tasks:** 2 completed
- **Files modified:** 1

## Accomplishments
- `preflight_tool_call_probe()` fails fast (no opencode call spent) if `CAIRN_LLM_API_KEY`/`CAIRN_LLM_API_URL`/`CAIRN_LLM_EXTRACTION_MODEL` is not fully set (Pitfall 2 guard, also the Pitfall 3 guard against a false PASS on opencode's own bundled default model), otherwise drives one real `cairn-memory` write-style tool call through the proven scratch/serve/`--attach` bring-up and asserts a genuine tool_use event via `assert_tool_event` (Plan 01), printing a trait-named FAIL message (`not tool-call-reliable (no-thinking required)`) on narration failure.
- `--repeat N` (default 5) soaks `run_stage_remember_recall` N times, each iteration a fully independent cold reproduction (its own `capture_real_config_fingerprint`/`setup_scratch`/`seed_canary`/`install_assets`/`write_scratch_config`/`positive_load_check`/`start_capture_server`/`stop_capture_server` + a `CLEANED_UP=0`+`cleanup()` reset for teardown) — the D-01 5/5 bar, D-03 no-state-bleed.
- Per-iteration evidence row `[repeat:$i/$N] PASS|FAIL (retries=$LAST_ROUNDTRIP_RETRIES)` plus aggregate `[repeat] $passes/$N PASSED` and a final `OK`/`FAIL` verdict line; non-zero exit unless all N pass.
- `usage()` extended with a `--repeat N` synopsis line and paragraph, positioned as the explicit slow reliability mode distinct from `--stage wakeup` and `--full`.

## Task Commits

Each task was committed atomically:

1. **Task 1: preflight_tool_call_probe with env fail-fast and trait message** - `8e46a95` (feat)
2. **Task 2: --repeat N soak mode with per-iteration scratch, evidence table, aggregate verdict, usage text** - `ae77e46` (feat)

**Plan metadata:** committed as part of this SUMMARY (worktree mode — orchestrator merges).

## Files Created/Modified
- `scripts/verify-opencode-live-parity.sh` - Added `preflight_tool_call_probe()` and the `--repeat` dispatch case in `main()`, plus `usage()` text for `--repeat N`.

## Decisions Made
- Probe exercises the real `cairn-memory` MCP tool (matches what the soak itself will do) rather than a generic built-in tool, per 13-RESEARCH.md Open Question 2's recommendation.
- Kept the probe's own teardown (`stop_capture_server` + `CLEANED_UP=0`/`cleanup()`) self-contained rather than relying solely on the process-exit trap, so the probe's scratch dirs don't linger until the `--repeat` loop's own first iteration or final script exit.
- Used `return 1` for the aggregate FAIL path (mirroring the existing `--full` case's convention) but `exit 2`/`exit 1` for argument-validation and preflight-abort respectively, matching the plan's explicit wording for those two paths.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' acceptance criteria were verified directly:
- `bash -n scripts/verify-opencode-live-parity.sh` exits 0.
- `preflight_tool_call_probe` defined; env check precedes any opencode call (source review + live test below).
- FAIL message contains exact substring `not tool-call-reliable (no-thinking required)`.
- Probe reuses `start_capture_server` (`--hostname 127.0.0.1` unchanged, only one `opencode serve` invocation in the whole file) and `assert_tool_event` — no new bind flags.
- `scripts/verify-opencode-live-parity.sh --help` names `--repeat`.
- `env -u CAIRN_LLM_API_KEY -u CAIRN_LLM_API_URL -u CAIRN_LLM_EXTRACTION_MODEL timeout 30 scripts/verify-opencode-live-parity.sh --repeat 1` returned exit 1 in 0.005s (bounded, no hang, no 124 timeout kill).
- `--repeat 0`, `--repeat abc`, `--repeat -3` all exit 2 with the usage message.
- Each iteration's row includes `retries=$LAST_ROUNDTRIP_RETRIES`; aggregate prints `N/N`.

## Issues Encountered
- The Edit tool again refused to apply patches to this pre-existing tracked file (same environment quirk documented in 13-01-SUMMARY.md's Issues Encountered). Worked around identically: `python3` exact-match string replacement for both structural edits (the `preflight_tool_call_probe` function insertion, the `usage()` heredoc extension, and the `--repeat` dispatch case), each verified against the plan's specified behavior before committing.

## User Setup Required

None - no external service configuration required. Live execution of the `--repeat 5` soak still requires an operator-configured `CAIRN_LLM_*` tool-call-reliable local model (per D-05/D-07, unchanged precondition from Plan 01) — this plan's own sandbox has no live model configured, matching 13-RESEARCH.md's documented environment gap. The env-unset fail-fast path (preflight probe) was proven live in this sandbox; the actual 5/5 pass count (D-01) is the operator's phase-gate action, to be recorded in the phase UAT/VERIFICATION doc.

## Next Phase Readiness
- `preflight_tool_call_probe()` and `--repeat N` are ready for Plan 03 (or the phase's closeout) to reference when updating MILESTONES.md/REQUIREMENTS.md traceability (D-04, Success Criterion #3) and `docs/operating.md` (D-07 trait-based precondition).
- The live `--repeat 5` soak (5/5, D-01) is the phase gate — not runnable in this sandbox, requires an operator environment with `CAIRN_LLM_*` configured against a no-thinking, tool-call-reliable local model.
- No blockers for Plan 03.

---
*Phase: 13-headless-harness-hardening*
*Completed: 2026-07-08*
