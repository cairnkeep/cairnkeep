---
status: complete
phase: 04-opencode-parity-operating-layer
source: [04-VERIFICATION.md]
started: 2026-07-03T13:39:12Z
updated: 2026-07-03T16:05:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Re-confirm the two auto-confirmed blocking human-verify checkpoints
expected: Operator reviews `04-SPIKE-INJECTION.md`'s `CHOSEN-CHANNEL: system.transform` decision and `04-06-SUMMARY.md`'s OCP-05 acceptance evidence (canary `OCP-05-CANARY-QUOKKA-9182` surfaced in two isolated scratch-`HOME` runs; Run B used natural framing, ruling out prompt leakage) and confirms both stand, or re-runs the live acceptance test personally.
why_human: Both were explicit blocking checkpoints (`gate="blocking"`) requiring operator sign-off on a live, model-in-the-loop observation. The recorded evidence is concrete and specific, but the sign-off itself was an orchestrator timeout auto-confirmation (operator away), not genuine human judgment — both SUMMARYs self-flag it as re-visitable.
result: pass
verified_by: live re-execution (2026-07-03) — not a re-read of recorded evidence
evidence: |
  Re-ran the OCP-05 acceptance harness end-to-end against a live model with a FRESH canary
  (OCP-05-CANARY-VERIFY-7731, chosen this session — not the recorded QUOKKA-9182), which also
  exercises the CHOSEN-CHANNEL=system.transform decision (the wakeup injects via
  experimental.chat.system.transform, so a surfaced canary re-confirms the channel):
  - Setup: scratch project seeded with a real AgentFS .agentfs/project.db (agentfs-sdk) holding
    the canary; three plugins installed into a scratch OPENCODE_CONFIG_DIR via
    scripts/sync-opencode-plugin-assets.sh --apply (D1: --apply then --check both report in-sync,
    @@INFRA_ROOT@@ rendered to the real repo path); HOME pointed at an empty scratch dir with NO
    reachable ~/.claude (confirmed absent).
  - Model: local-ai/qwen3.6-27b-coder (127.0.0.1:8001, same family as the original spike;
    default debian-4080 endpoint was down, reachable local-ai used instead).
  - Run A (explicit recite): model returned `FOUND: OCP-05-CANARY-VERIFY-7731`.
  - Run B (natural framing, no mention of injection/memory): model returned
    `OCP-05-CANARY-VERIFY-7731` — rules out prompt leakage.
  - Negative control (NEW, beyond the recorded test): identical config but an unseeded project
    (no .agentfs) → model replied `NOT-FOUND`, proving the canary could only have come from the
    injected AgentFS memory, not training/guessing.
  - Cleanup: all scratch dirs removed; real ~/.config/opencode and ~/.claude untouched; no canary
    leaked into the repo (repo .agentfs predates this session and contains no canary).
  Both blocking checkpoints (CHOSEN-CHANNEL=system.transform, OCP-05 hard bar) stand.

### 2. Live round-trip of OCP-01/02/03/04 (Phase 5 scope)
expected: Each command/plugin performs its documented effect against a live, registered `cairn-memory` MCP in a real OpenCode session — OCP-01 capture stages a real session's candidates; OCP-02 recall throws real context on a live matched edit; OCP-03 `remember` persists a fact via a live MCP call; OCP-04 `recall` retrieves it back.
why_human: Deliberately scoped to Phase 5 (OCP-06) per this phase's own plans (04-02, 04-04, 04-05 SUMMARYs all defer live round-trip verification to Phase 5). Phase 4's success criteria treat OCP-01/02/03/04 as satisfied by correct implementation + wiring; OCP-05 is the one hard bar requiring in-phase live execution proof (already met). Mark as deferred-to-Phase-5 unless you want to exercise it now.
result: skipped
reason: Deferred to Phase 5 (OCP-06 live parity verification) by design — 04-02/04-04/04-05 SUMMARYs all scope OCP-01/02/03/04 live round-trip to Phase 5. Phase 4 success criteria are met by correct implementation + install wiring plus the live OCP-05 hard-bar proof (test 1). Not a blocker for Phase 4 completion; will be exercised against a live registered cairn-memory MCP in Phase 5.

## Summary

total: 2
passed: 1
issues: 0
pending: 0
skipped: 1
blocked: 0

## Gaps
