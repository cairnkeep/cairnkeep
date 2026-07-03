# Phase 5: Live OpenCode parity verification - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-03
**Phase:** 5-Live OpenCode parity verification
**Areas discussed:** Verification execution model, Test environment / install surface, Model + data, Evidence artifact

> Note: gray areas were presented via AskUserQuestion but the user was away
> (re-asked once, then a 60s timeout). Selections below were made on best judgment
> per Phase-4 precedent + the ponytail minimal-diff principle. All revisable via
> `/gsd-discuss-phase 5`.

---

## Verification execution model

| Option | Description | Selected |
|--------|-------------|----------|
| Automated harness | Extend Phase-4 OCP-05 scratch-HOME script to all stages; deterministic, repeatable, no human-in-loop | |
| Interactive OpenCode UAT | Operator drives a real OpenCode session by hand; highest fidelity, manual, non-repeatable | |
| Hybrid | Harness backbone for deterministic proof + one genuine interactive session confirm | ✓ |

**User's choice:** Hybrid (auto-selected)
**Notes:** Roadmap says "in a live OpenCode session" explicitly, so a pure harness would not honor the wording; the harness gives repeatable evidence and the interactive confirm satisfies the literal live-session bar. Falls back to harness-only with an explicit recorded gap if the interactive session is impractical at execution time.

---

## Test environment / install surface

| Option | Description | Selected |
|--------|-------------|----------|
| Scratch-isolated env | Fresh scratch HOME + OPENCODE_CONFIG_DIR, no reachable ~/.claude; proves fresh-install/no-Claude bar | ✓ |
| Real operator config | Register + install in real ~/.config/opencode; authentic but mutates real setup, doesn't prove no-Claude bar | |
| Both | Scratch for criterion 3 + real for criteria 1/2 | |

**User's choice:** Scratch-isolated (auto-selected), with `cairn-memory` registered *inside* the scratch OPENCODE_CONFIG_DIR
**Notes:** Lazy consolidation — registering the MCP inside the scratch config lets ONE environment satisfy both criterion 3 (fresh install, no Claude assets) and criteria 1/2 (round-trip against a genuinely registered MCP), without mutating the operator's real config. cairn-memory is currently NOT registered in the live ~/.config/opencode, so registration + install is part of setup — done in scratch.

---

## Model + data for the round-trip

| Option | Description | Selected |
|--------|-------------|----------|
| Local model + canary | Local qwen for extract/recall; fresh canary + negative control in a scratch AgentFS project | ✓ |
| Configured model + real AgentFS | Operator's configured model against repo real .agentfs; authentic but non-deterministic, pollutes real memory | |
| You decide at runtime | Pick per reachable endpoint; default to canary+scratch | |

**User's choice:** Local model + canary (auto-selected), with runtime endpoint fallback blended in
**Notes:** Provable and controlled; negative control proves a surfaced canary came from injected memory. Avoids writing test facts into the repo's real .agentfs. Endpoint fallback allowed (Phase 4 fell back debian-4080 → local-ai) with the used endpoint recorded.

---

## Evidence artifact

| Option | Description | Selected |
|--------|-------------|----------|
| Phase-5 UAT.md | Standard GSD UAT with per-stage expected/result/evidence; closes owed 04-UAT test-2 items | ✓ |
| Dedicated evidence log | Standalone PARITY-EVIDENCE.md with raw transcripts | |
| You decide | Follow GSD pattern + inline raw evidence | |

**User's choice:** Phase-5 UAT.md with raw evidence inline (auto-selected, blended with "you decide")
**Notes:** 05-UAT.md closes the four owed OCP-01/02/03/04 round-trip items directly, plus the integrated lifecycle and remember→recall round-trips; raw canary IDs / command outputs / model responses / negative-control result embedded inline so the record stands alone. Standard 05-VERIFICATION.md still produced by the verify workflow.

---

## Claude's Discretion

- Harness script structure/naming, canary token strings, the stem/file used to trigger the OCP-02 recall match, per-stage assertion wording, interactive-session script — left to planner/executor, constrained by Phase-4 harness patterns.

## Deferred Ideas

None — discussion stayed within phase scope.
