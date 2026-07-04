---
phase: 06-fastcontext-reliability-spike
plan: 02
subsystem: infra
tags: [fastcontext, reliability, verdict, spike, go-no-go, live-probe, operator-gated]

# Dependency graph
requires:
  - phase: 06-fastcontext-reliability-spike
    plan: 01
    provides: "scripts/verify-fastcontext-reliability.sh — the committed bash+curl+jq probe run live in this plan"
provides:
  - ".planning/phases/06-fastcontext-reliability-spike/06-SPIKE.md — the committed GO verdict (ROADMAP SC#3) gating Phases 7-9"
  - "Empirically-grounded GO: FastContext q8_0 + llama-server --jinja emits real tool_calls 15/15 turns (de-risks the OCP-04 failure class)"
affects: [07-context-explore-tool, 08-operating-layer-wiring, 09-live-verification-ab]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Operator-gated live probe: checkpoint:human-verify hands the live run to the operator (private infra, no committed host/IP), executor writes the verdict from returned evidence"
    - "Verdict scored on JSON structure (gate #2 finish_reason==tool_calls) never narrated content; gate #1 field-presence recorded as evidence only"

key-files:
  created:
    - .planning/phases/06-fastcontext-reliability-spike/06-SPIKE.md
  modified: []

key-decisions:
  - "VERDICT = GO. Gate #2 matrix passed 15/15 turns (every turn finish_reason==tool_calls, well-formed non-empty tool_calls array), --full exit code 0, zero narration turns — the clean opposite of the OCP-04 failure class."
  - "Refined D-05 applied as written: verdict anchored to gate #2; chat_template_tool_use ABSENT recorded as an architectural caveat (single-unified-template Qwen3-family GGUF, 06-RESEARCH.md finding #1), never an auto-NO-GO. Operator confirmed the rubric at the checkpoint."
  - "D-08 combination pinned in 06-SPIKE.md: fastcontext-1.0-4b-rl q8_0, llama.cpp build_info b8856-9da7b42f4, --jinja on, unified Qwen3 <tools> XML template, n_ctx 24576. GPU noted as NOT the variable under test."
  - "D-04 token_miser corroboration skipped — binary absent from PATH; verdict anchored to the raw endpoint per D-03, unaffected by the skip."

requirements-completed: [CTX-06]

coverage:
  - id: D5
    description: "Live tool-call matrix and go/no-go verdict against the actually-deployed FastContext endpoint (the human_judgment item owed from Plan 06-01's coverage D4)"
    requirement: "CTX-06"
    verification:
      - kind: other
        ref: "Operator ran scripts/verify-fastcontext-reliability.sh --props-only then --full against the deployed endpoint; --full exit 0, 15/15 turns finish_reason=tool_calls"
        status: pass
    human_judgment: true
    rationale: "The live run requires the operator's own deployed llama-server + FastContext GGUF (D-07, private infra); evidence reported at the checkpoint:human-verify and transcribed into 06-SPIKE.md."

duration: 3min
completed: 2026-07-04
status: complete
---

# Phase 6 Plan 02: FastContext Live Probe + Go/No-Go Verdict Summary

**The operator ran the committed probe live against the actually-deployed FastContext q8_0 GGUF + `llama-server --jinja` endpoint; the go/no-go verdict is GO — every turn of the ≥15-turn matrix emitted a real `tool_calls` array (15/15, exit 0, zero narration), de-risking the OCP-04 failure class and opening Phases 7-9.**

## Performance

- **Duration:** ~3 min (verdict authored + committed after the operator returned live evidence)
- **Completed:** 2026-07-04
- **Tasks:** 2/2 (Task 1 = operator checkpoint:human-verify; Task 2 = write + commit the verdict)
- **Files modified:** 1 (new — 06-SPIKE.md)

## Accomplishments

- **Task 1 (checkpoint:human-verify — operator live run):** The operator stood up the FastContext `llama-server --jinja` endpoint with the 06-RESEARCH.md finding #4 recipe (`--alias fastcontext-1.0-4b -ngl 99 -c 24576 --jinja --flash-attn on --cache-type-k q4_0 --cache-type-v q4_0`, bound loopback, on an RTX-class GPU), exported `FASTCONTEXT_PROBE_URL` (never committed), and ran `scripts/verify-fastcontext-reliability.sh --props-only` then `--full`. Reported: `/props` build_info `b8856-9da7b42f4`, alias `fastcontext-1.0-4b`, quant `q8_0`, `n_ctx 24576`; `chat_template_tool_use` ABSENT (expected); gate #2 matrix 15/15 PASS; `--full` exit 0; zero narration turns. Raw evidence stayed in the gitignored `06-EVIDENCE.log` (scrub-check confirmed no URL/API key written).
- **Task 2 (write the verdict):** Authored `.planning/phases/06-fastcontext-reliability-spike/06-SPIKE.md` — the committed **GO** verdict. Records the refined-D-05 rubric verbatim (gate #2 anchor; gate #1 absence not a blocker; operator-confirmed at the checkpoint), the D-08 pinned combination, the gate #1 `/props` evidence, the gate #2 15/15 per-turn tally + exit 0, a Phase 7 forward note (Docker-mount-path quirk deferred to Phase 7; D-04 corroboration skipped-absent), and a re-runnability note.

## Task Commits

1. **Task 1: Operator live probe (checkpoint:human-verify)** — no code commit; evidence returned at the checkpoint and transcribed into the verdict. Raw run recorded in the gitignored `06-EVIDENCE.log`.
2. **Task 2: Write the go/no-go verdict artifact 06-SPIKE.md** — `a81f2e7` (docs)

## Files Created/Modified

- `.planning/phases/06-fastcontext-reliability-spike/06-SPIKE.md` — the committed GO verdict with the D-08 pinned combination, refined-D-05 rubric, gate #1 + gate #2 evidence, and Phase 7 forward note. Scrubbed of any private endpoint/secret.

## Decisions Made

- **GO verdict** anchored to gate #2 (15/15 turns `finish_reason=tool_calls`, `--full` exit 0). This is the empirical, JSON-structure-based signal D-06 requires at the raw endpoint for a 4B quant — not a narrated-content inference.
- **chat_template_tool_use ABSENT is a recorded caveat, not a blocker** — applied the refined D-05 exactly as the operator confirmed at the checkpoint; absence is architectural for this single-unified-template Qwen3-family GGUF (06-RESEARCH.md finding #1), predicted source-verified before the run.
- **D-04 token_miser corroboration skipped** (binary absent from PATH) — recorded, not treated as a blocker; verdict is anchored to the raw endpoint (D-03).
- **GPU is not the variable under test** — noted explicitly in 06-SPIKE.md; the spike isolates model weights + chat-template + `--jinja` + quant, all identical to the deployment target.

## Deviations from Plan

None — plan executed exactly as written. Task 1 correctly stopped at the `checkpoint:human-verify` (human-verify is not auto-approved), and Task 2's `<action>`, `<verify>`, and `<acceptance_criteria>` were all satisfied. No Rule 1-4 deviations were needed.

## Authentication Gates

None. The operator-gated live run is the checkpoint's normal flow (D-07 private infra), not an auth gate.

## Issues Encountered

None.

## Known Stubs

None. The probe's static stubbed `role:"tool"` reply loop (Pattern 1, D-03) is the documented, intended design of a reliability-only spike (the probe never executes real filesystem access on the model's behalf) — not an unintentional stub. The Docker-mount-path hallucination quirk is explicitly deferred to Phase 7 in the verdict's forward note.

## Threat Flags

None. Both threats in this plan's `<threat_model>` were mitigated as specified: T-06-05 (Information Disclosure) — 06-SPIKE.md embeds only scrubbed excerpts, the automated grep for a non-loopback IPv4 finds none, and a secret/host scan is clean; raw evidence stays in the gitignored `06-EVIDENCE.log`. T-06-06 (false GO/false NO-GO) — the verdict is anchored to gate #2 JSON-structure evidence (15/15), never narrated content, and the refined-D-05 rubric prevented both a false GO on narration and a false NO-GO on gate-1 field absence.

## Next Phase Readiness

- **GO opens Phases 7-9.** The FastContext tool-calling loop is proven reliable (15/15 at the raw endpoint) against the deployed q8_0 quant + `--jinja` combo. Phase 7 (`context_explore` MCP tool) can build on FastContext without re-discovering a tool-calling gap in wired code.
- **Phase 7 carry-over:** wire a `resolve_path()`-style normalization shim when adding real tool execution (the RL checkpoint's Docker-mount-path `/repo-name/...` quirk, deferred here per D-03); read `~/PARA/Projects/token-miser/src/explore/mod.rs` directly during Phase 7 planning before writing the Evidence-JSON parser (carried STATE.md concern).
- **Re-runnability:** re-run `scripts/verify-fastcontext-reliability.sh --full` to re-establish the verdict whenever the deployed quant/build/template changes (D-01); the probe records `build_info` + raw `/props` every run so drift from the D-08 pinned combination is traceable.

---
*Phase: 06-fastcontext-reliability-spike*
*Completed: 2026-07-04*

## Self-Check: PASSED

- FOUND: .planning/phases/06-fastcontext-reliability-spike/06-SPIKE.md
- FOUND: .planning/phases/06-fastcontext-reliability-spike/06-02-SUMMARY.md
- FOUND commit: a81f2e7 (Task 2 — 06-SPIKE.md GO verdict)
