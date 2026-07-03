---
phase: 05
slug: live-opencode-parity-verification
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-03
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> This is a live-execution verification phase — "tests" are scripted `opencode run` harness stages plus one interactive session, not a unit-test framework. Source: `05-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bash harness script extending the Phase-4 OCP-05 acceptance pattern (no unit-test framework — live execution) |
| **Config file** | none — the harness writes a scratch `opencode.json` per run (MCP `cairn-memory` registration + provider/model + permissive `permission` block) |
| **Quick run command** | Single wakeup FOUND/NOT-FOUND probe stage — fastest signal that MCP registration + scratch-`HOME` isolation are sound |
| **Full suite command** | Full harness: all five stages (wakeup, recall-on-edit, capture, remember, recall) + negative controls, then one interactive session |
| **Estimated runtime** | live-model dependent (~minutes; local qwen endpoint on loopback per D-04) |

---

## Sampling Rate

- **After every task commit:** wakeup FOUND/NOT-FOUND probe (confirms registration + isolation didn't regress)
- **After every plan wave:** full scripted harness (five stages + negative controls)
- **Before `/gsd-verify-work`:** full scripted harness green **and** the one interactive session complete
- **Max feedback latency:** one probe stage (single `opencode run` invocation)

---

## Per-Stage Verification Map

Task IDs are assigned by the planner; this maps OCP-06's stages to their live check. Each row is a `must_have` truth for goal-backward verification.

| Stage | Requirement | Expected Behavior | Test Type | Automated Check | File Exists |
|-------|-------------|-------------------|-----------|-----------------|-------------|
| wakeup | OCP-06 | seeded canary surfaces at session-start, no reachable `~/.claude` | live/scripted | `opencode run` FOUND/NOT-FOUND probe | ❌ W0 |
| recall-on-edit | OCP-06 | stem-matching file edit throws injected context w/ seeded fact; non-matching file does not | live/scripted | `opencode run` + inspect `--format json` `tool.execute` event | ❌ W0 |
| capture | OCP-06 | session-end stages a candidates JSON containing the canary | live/scripted (gated on `session.idle` probe) | `opencode run` + grep `.planning/memory-staging/*.json` | ❌ W0 |
| remember→recall | OCP-06 | `/remember` writes via a live MCP call; `/recall` retrieves it (same/continued session) | live/scripted | two `opencode run --format json --session` calls | ❌ W0 |
| negative controls | OCP-06 | every stage above returns NOT-FOUND/no-effect on an unseeded scratch project | live/scripted | same commands, unseeded scratch project | ❌ W0 |
| interactive session | OCP-06 | full workflow works in one genuine live TUI session (D-01 literal bar) | manual/live | operator drives `opencode` TUI in scratch project | ❌ W0 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Diagnostic probe: does `session.idle` double-fire on the title-gen sub-call (as `system.transform` did in Phase 4)? — gates the capture stage design (`05-RESEARCH.md` Pitfall 1 / Open Q1)
- [ ] One-line inspection: exact session-ID field name in `opencode run --format json` output (Open Q2)
- [ ] Scratch `opencode.json` writer (MCP `cairn-memory` registration + provider/model + permission block) — new setup step, no verbatim precedent
- [ ] Negative-control scaffolding for all five stages (Phase 4 built it only for wakeup)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| One genuine interactive OpenCode session (D-01 literal "live session" bar) | OCP-06 | TUI session state can't be driven headlessly; multi-turn `--session`/`--continue` have open reliability bugs (#11680, #3434) | Operator drives `opencode` TUI in the scratch project (`HOME=$SCRATCH_HOME`): wakeup → edit a stem-matching file → `/remember` → `/recall`, in one continuous conversation. Fallback to harness-only allowed per D-01 if impractical — record the gap in `05-UAT.md`, do not silently drop. |

---

## Validation Sign-Off

- [ ] Every stage has a scripted `opencode run` check or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without an automated check
- [ ] Wave 0 settles the `session.idle` probe + session-ID field inspection **before** the capture / remember→recall stages are trusted
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` set once the planner's task map is reconciled against this strategy

**Approval:** pending
