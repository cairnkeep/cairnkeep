# Phase 6: FastContext Reliability Spike - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-04
**Phase:** 6-FastContext Reliability Spike
**Areas discussed:** Probe harness form, Probe surface, Go/no-go threshold, Deployment prerequisite

> **Interaction note:** The four gray areas were presented via AskUserQuestion but the user
> was away (60s timeout, no response). Per workflow guidance, decisions were resolved to
> Claude's grounded defaults from the loaded research (`.planning/research/*`) and the OCP-04
> tool-call-reliability history in project memory. All are flagged editable before planning.

---

## Probe harness form

| Option | Description | Selected |
|--------|-------------|----------|
| Committed re-runnable script | bash+curl mirroring `verify-opencode-live-parity.sh` | ✓ |
| One-off documented investigation | Ad-hoc, evidence only in phase artifact | |

**User's choice:** (default) Committed re-runnable script.
**Notes:** Phase 6 gates Phases 7-9 and the pinned quant/build/template changes over time — a
re-runnable, env-driven, loopback-only probe re-establishes the verdict cheaply on each change.

---

## Probe surface

| Option | Description | Selected |
|--------|-------------|----------|
| Raw llama-server endpoint only | `/v1/chat/completions` with FastContext tool schemas | ✓ (verdict basis) |
| Also `token_miser explore` end-to-end | Corroborate the real integration path | ✓ (optional, non-verdict) |

**User's choice:** (default) Raw endpoint is the verdict basis; `token_miser explore` is
optional corroboration only.
**Notes:** Anchoring the verdict to the raw endpoint isolates the variable under test
(model + template + `--jinja` + quant) from token-miser's Rust execution loop.

---

## Go/no-go threshold

| Option | Description | Selected |
|--------|-------------|----------|
| Strict: 100% tool_calls + `/props` native template | Every turn across ≥5 prompts × ≥3 turns; any narration = no-go | ✓ |
| Tolerance-based | Allow some narration turns below a threshold | |

**User's choice:** (default) Strict two-gate bar.
**Notes:** OCP-04 memory shows a tool-reliable model hit 100% `finish_reason=tool_calls` at
curl level; for a 4B quant, anything less at the raw endpoint is a red flag worth blocking on.

---

## Deployment prerequisite

| Option | Description | Selected |
|--------|-------------|----------|
| Operator-provided runtime prerequisite | Server stood up outside phase deliverable; combo pinned + recorded | ✓ |
| Phase-deliverable deployment code | Build/commit the serving setup | |

**User's choice:** (default) Operator-provided prerequisite; phase MUST pin/record the exact
combo probed; an un-standable server is a documented no-go blocker.
**Notes:** Per project memory the mitkox FastContext GGUF is not currently deployed (infra
runs qwen-coder + inactive qwen3.5-27b), so "bring the server up" is likely the spike's first
real step.

## Claude's Discretion

- Exact probe prompt wording, script filename, and evidence-log format (planner/executor).
- Whether the verdict lives in `06-SPIKE.md` / `06-FINDINGS.md` / standard UAT+SUMMARY docs.
- Recommendation (non-binding): use cairnkeep's own repo as the probe corpus.

## Deferred Ideas

None — discussion stayed within phase scope. Adjacent work already scheduled: Phase 7
(`context_explore` tool + config), Phase 8 (operating-layer commands), Phase 9 (token-savings
A/B), TMISER-R1 (token-miser HTTP routing proxy, future milestone).
