# Phase 13: Headless Harness Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-08
**Phase:** 13-headless-harness-hardening
**Areas discussed:** Reliability bar, Model policy, Assertion trust, Hardening scope

---

## Reliability bar

### Q1: Numeric bar for "reliably reproduces across repeated runs"

| Option | Description | Selected |
|--------|-------------|----------|
| 5/5 consecutive | Five consecutive full round-trip passes, zero manual intervention; a failure resets the count | ✓ |
| ≥9/10 runs | Tolerates one flaky run in ten — weaker "mostly reproducible" claim | |
| 3/3 consecutive | Minimal repeated-run proof; thin margin over "proven once" | |

**User's choice:** 5/5 consecutive (Recommended)

### Q2: How the repeated runs are driven

| Option | Description | Selected |
|--------|-------------|----------|
| --repeat N flag | Soak mode in verify-opencode-live-parity.sh; per-run + aggregate PASS/FAIL in one command | ✓ |
| Wrapper soak script | Separate script shelling out to the harness N times | |
| Manual re-runs, recorded | Operator runs --full five times, pastes outputs | |

**User's choice:** --repeat N flag (Recommended)

### Q3: Per-iteration isolation

| Option | Description | Selected |
|--------|-------------|----------|
| Fresh per iteration | Full scratch-HOME setup, fresh canary, fresh serve, teardown each run — independent cold reproductions | ✓ |
| One scratch env, 5 round-trips | Setup once, five round-trips with distinct canaries inside it | |
| Hybrid: fresh serve, shared scratch | Scratch built once; serve + canary fresh per iteration | |

**User's choice:** Fresh per iteration (Recommended)

### Q4: Evidence recorded to close the gap

| Option | Description | Selected |
|--------|-------------|----------|
| Aggregate + per-run log | Per-iteration PASS/FAIL table + aggregate verdict recorded in UAT/VERIFICATION; MILESTONES.md + REQUIREMENTS.md point at it | ✓ |
| Aggregate verdict only | Just the final 5/5 PASS line | |
| You decide | Claude picks the evidence format | |

**User's choice:** Aggregate + per-run log (Recommended)

---

## Model policy

### Q1: Reliability conditioned on a tool-call-reliable model?

| Option | Description | Selected |
|--------|-------------|----------|
| Reliable-model precondition | OCP-07 scoped to "reliable given a no-thinking, tool-call-reliable model"; retry absorbs run-completion flakiness only | ✓ |
| Absorb any model via retries | Must pass 5/5 even with the thinking model — risks unclosable phase for external reasons | |
| Two-tier claim | Precondition + best-effort non-gating thinking-model run | |

**User's choice:** Reliable-model precondition (Recommended)

### Q2: Mechanical preflight vs docs-only

| Option | Description | Selected |
|--------|-------------|----------|
| Preflight probe | Cheap gate before the soak asserting the configured model emits a genuine tool call; fails fast | ✓ |
| Docs-only precondition | State the requirement in help text + docs; no probe | |
| You decide | Claude picks at planning time | |

**User's choice:** Preflight probe (Recommended)

### Q3: Naming the proven model in docs

| Option | Description | Selected |
|--------|-------------|----------|
| Trait-based + example | "No-thinking, tool-call-reliable local model" + qwen3.5-27b cited as the proven public example | ✓ |
| Traits only, no model name | Maximally neutral, loses the known-working datapoint | |
| Pin the model in the harness | Known-good allowlist — violates no-committed-defaults idiom | |

**User's choice:** Trait-based + example (Recommended)

---

## Assertion trust

### Q1: Tool-event assertion upgrade in scope?

| Option | Description | Selected |
|--------|-------------|----------|
| In scope, round-trip stages | Upgrade remember→recall (+ negative control) to parse genuine tool-execution events from the NDJSON stream | ✓ |
| In scope, all stages | Also convert wakeup/recall-on-edit/capture | |
| Defer entirely | Keep greps; follow-up remains open | |

**User's choice:** In scope, round-trip stages (Recommended)

### Q2: Assertion strictness

| Option | Description | Selected |
|--------|-------------|----------|
| Tool event + canary linkage | memory_write event on /remember AND memory_search/_read event on /recall whose result payload contains the canary | ✓ |
| Tool event presence only | Right events fired; canary still checked by grep | |
| You decide | Claude picks assertion depth at planning | |

**User's choice:** Tool event + canary linkage (Recommended)

### Q3: De-risking the unconfirmed NDJSON schema

| Option | Description | Selected |
|--------|-------------|----------|
| Researcher confirms live first | Capture a real --format json stream from the installed opencode and pin the event shape before planning locks the parser | ✓ |
| Plan defensively without confirming | Tolerant parser on guessed field names | |
| You decide | Claude picks the de-risking approach | |

**User's choice:** Researcher confirms live first (Recommended)

---

## Hardening scope

### Q1: Which stages get serve/--attach + retry

| Option | Description | Selected |
|--------|-------------|----------|
| Round-trip stage only | Convert run_stage_remember_recall to the proven serve/--attach pattern; wakeup/recall-on-edit unchanged | ✓ |
| All plain-run stages | Also convert wakeup and recall-on-edit | |
| You decide | Claude picks conversion scope | |

**User's choice:** Round-trip stage only (Recommended)

### Q2: What must pass 5/5

| Option | Description | Selected |
|--------|-------------|----------|
| Round-trip 5/5, --full once | Soak loops the hardened round-trip stage; full suite runs once as regression | ✓ |
| Whole --full suite 5/5 | Every stage five consecutive times — ~5x runtime for stages outside the gap | |
| You decide | Claude picks soak scope | |

**User's choice:** Round-trip 5/5, --full once (Recommended)

### Q3: What retry may absorb

| Option | Description | Selected |
|--------|-------------|----------|
| Infra failures only | Bounded retry for run-completion/transport flakiness only; a clean run failing its assertion FAILS the iteration; retry counts logged | ✓ |
| Retry any failure, bounded | Any failed attempt retried up to N times | |
| You decide | Claude picks retry policy | |

**User's choice:** Infra failures only (Recommended)

---

## Claude's Discretion

- Preflight probe placement/mechanism, exact retry bound and infra-failure
  classification, NDJSON parser implementation, `--repeat` ergonomics,
  evidence-table format — invariants preserved: 5/5 bar, fresh scratch per
  iteration, infra-only retry, event+canary assertions.

## Deferred Ideas

- Interactive TUI confirm (carried v1.1 gap, out of scope per REQUIREMENTS.md)
- Tool-event assertion upgrade for the non-round-trip stages
- serve/--attach conversion for wakeup/recall-on-edit
- Soaking the whole --full suite N×
