---
status: testing
phase: 04-opencode-parity-operating-layer
source: [04-VERIFICATION.md]
started: 2026-07-03T13:39:12Z
updated: 2026-07-03T13:39:12Z
---

## Current Test

number: 1
name: Re-confirm the two auto-confirmed blocking human-verify checkpoints (04-01 CHOSEN-CHANNEL, 04-06 OCP-05 acceptance)
expected: |
  Operator reviews 04-SPIKE-INJECTION.md's `CHOSEN-CHANNEL: system.transform` decision and
  04-06-SUMMARY.md's OCP-05 acceptance evidence (canary fact OCP-05-CANARY-QUOKKA-9182 surfaced
  in two isolated scratch-HOME runs, Run B natural-framing ruling out prompt leakage) and
  confirms both stand — or re-runs the live acceptance test personally.
awaiting: user response

## Tests

### 1. Re-confirm the two auto-confirmed blocking human-verify checkpoints
expected: Operator reviews `04-SPIKE-INJECTION.md`'s `CHOSEN-CHANNEL: system.transform` decision and `04-06-SUMMARY.md`'s OCP-05 acceptance evidence (canary `OCP-05-CANARY-QUOKKA-9182` surfaced in two isolated scratch-`HOME` runs; Run B used natural framing, ruling out prompt leakage) and confirms both stand, or re-runs the live acceptance test personally.
why_human: Both were explicit blocking checkpoints (`gate="blocking"`) requiring operator sign-off on a live, model-in-the-loop observation. The recorded evidence is concrete and specific, but the sign-off itself was an orchestrator timeout auto-confirmation (operator away), not genuine human judgment — both SUMMARYs self-flag it as re-visitable.
result: [pending]

### 2. Live round-trip of OCP-01/02/03/04 (Phase 5 scope)
expected: Each command/plugin performs its documented effect against a live, registered `cairn-memory` MCP in a real OpenCode session — OCP-01 capture stages a real session's candidates; OCP-02 recall throws real context on a live matched edit; OCP-03 `remember` persists a fact via a live MCP call; OCP-04 `recall` retrieves it back.
why_human: Deliberately scoped to Phase 5 (OCP-06) per this phase's own plans (04-02, 04-04, 04-05 SUMMARYs all defer live round-trip verification to Phase 5). Phase 4's success criteria treat OCP-01/02/03/04 as satisfied by correct implementation + wiring; OCP-05 is the one hard bar requiring in-phase live execution proof (already met). Mark as deferred-to-Phase-5 unless you want to exercise it now.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
