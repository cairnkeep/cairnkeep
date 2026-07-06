# Phase 9: Live Verification + A/B Token-Savings - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-06
**Phase:** 9-live-verification-a-b-token-savings
**Areas discussed:** A/B baseline fairness, Target repo & prompt, Pass bar / milestone gate, Live run scope (SC-3)

---

## A/B baseline fairness — how the "before" number is produced

| Option | Description | Selected |
|--------|-------------|----------|
| Deterministic harness + live SC-3 run | Committed re-runnable harness computes native-vs-explore delta deterministically (fixed native recipe: glob→grep→read vs compact citation tokens); SC-3 live run corroborates the explore side. Reproducible, cheap, model-independent headline. | ✓ (Claude) |
| Live agent both sides | Measure actual API token usage of a real agent doing native Read/Glob/Grep vs one context_explore call. Most faithful, but non-deterministic and needs the model up on both sides. | |
| Byte/char proxy, no tokenizer | Report raw bytes/chars pulled into context both ways as the savings proxy. Zero tokenizer dependency, but a proxy for tokens. | |

**User's choice:** Delegated to Claude ("you decide what is best among the 3").
**Notes:** Chose the deterministic harness (D-01) because a live-both-sides number drifts every run — a poor basis for a milestone-closing headline. Byte delta adopted as the tokenizer-free ground truth anchor (D-01a), with a provider-neutral token estimate layered on; this borrows the best of the byte-proxy option without discarding a token figure.

---

## Target repo & prompt

| Option | Description | Selected |
|--------|-------------|----------|
| Cairnkeep repo, small query set (3–5) | Real repo (Phase-6 corpus), per-query + median to resist cherry-picking. | ✓ (Claude) |
| Cairnkeep repo, one query | Single representative query; simplest, but one data point. | |
| Fresh cairn bootstrap project | Matches SC-1's "real bootstrapped project" wording most literally, but a small/fresh tree may under-represent savings. | |

**User's choice:** Delegated to Claude ("you decide what is best among the 3").
**Notes:** D-02 uses cairnkeep's repo + 3–5 queries as the headline, and resolves the SC-wording tension by adding a `--repo` override so the operator can also point the harness at a fresh `cairn bootstrap` project for strict-wording coverage.

---

## Pass bar / milestone gate

| Option | Description | Selected |
|--------|-------------|----------|
| Record + net-savings sanity gate | Honest number closes v1.2 AND must show net savings > 0; a regression is a loud documented finding, never a silent pass. No paper-figure gate. | ✓ (Claude) |
| Record only, no threshold | Whatever the number is closes v1.2; strict SC-2 reading, but a regression wouldn't block. | |
| Benchmark vs ~60% paper claim | Pass only within a band of FastContext's ~60% figure; strongest claim, but risks blocking on a legitimately different number. | |

**User's choice:** Delegated to Claude ("you decide what is best among the 3").
**Notes:** D-03 — matches the project's fail-loud culture (Phase 6 D-08) without over-promising a paper-matching figure.

---

## Live run scope (SC-3)

| Option | Description | Selected |
|--------|-------------|----------|
| Claude Code, operator-gated | One live /context-explore run on the primary verified harness; backend an operator runtime prerequisite (Phase 6 D-07); live run operator-gated, not blocking on server bring-up. | ✓ (Claude) |
| Both Claude + OpenCode | Full parity evidence, but doubles operator burden; both depend on the same backend. | |
| OpenCode only | Parity-focused, but less aligned with the primary-verified-harness precedent. | |

**User's choice:** Delegated to Claude ("you decide").
**Notes:** D-04 — SC-3 accepts one layer; OpenCode parity already proven in v1.1.

---

## Claude's Discretion

All four gray areas were explicitly delegated to Claude. Decisions (D-01..D-04) are
grounded in prior-phase precedent and recorded in 09-CONTEXT.md. Additional
plan-time discretion: exact tokenizer/`chars/N` heuristic (byte anchor mandatory),
the specific 3–5 queries and the fixed native-exploration recipe, harness filename,
and the UAT/SUMMARY/AB doc layout.

## Deferred Ideas

- **NVIDIA-NeMo/Switchyard** — user surfaced it mid-discussion and asked whether it
  complements or substitutes token-miser / FastContext. Verdict: it is an LLM
  *routing proxy* (protocol translation + multi-backend routing), the same category
  as the deferred **TMISER-R1** routing surface — **not** a substitute for
  FastContext or `token_miser explore`. Changes nothing in Phase 9; evaluate as a
  TMISER-R1 alternative in a future milestone. (Apache-2.0.)
- **Token-savings UI / annotation / caching (CTX-F1..F3)** — future differentiators.
- **Live OpenCode /context-explore run** — could be added in a future full-parity pass.
