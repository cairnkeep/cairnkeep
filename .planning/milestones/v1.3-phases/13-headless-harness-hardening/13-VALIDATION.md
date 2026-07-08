---
phase: 13
slug: headless-harness-hardening
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-08
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

The harness IS the test — there is no unit-test framework. The one genuinely
unit-testable unit (the NDJSON tool-event matcher) gets an offline fixture
test (`scripts/test-remember-recall-assertions.sh`), created in Wave 1. The
live 5/5 soak requires an operator-provided tool-call-reliable model
(CAIRN_LLM_*) that is NOT available in CI/sandbox — it is the phase gate run
at `/gsd-verify-work`, not an executor-runnable command.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bash integration harness (`scripts/verify-opencode-live-parity.sh`) + one offline Node fixture test |
| **Config file** | none — env-var driven (`CAIRN_LLM_*`) |
| **Quick run command** | `bash scripts/test-remember-recall-assertions.sh` (offline, no model) |
| **Full suite command** | `scripts/verify-opencode-live-parity.sh --repeat 5` (live, requires real model) + `scripts/verify-opencode-live-parity.sh --full` once (D-12) |
| **Estimated runtime** | fixture test ~1s; `--repeat 5` multi-minute (Pitfall 5) |

---

## Sampling Rate

- **After every task commit:** `bash -n scripts/verify-opencode-live-parity.sh` + `bash scripts/test-remember-recall-assertions.sh`
- **After every plan wave:** the plan's `<automated>` verify block (offline structural + parser checks)
- **Before `/gsd-verify-work`:** `scripts/verify-opencode-live-parity.sh --repeat 5` green (5/5, D-01) + `--full` once (D-12), recorded in the phase UAT/VERIFICATION doc (D-04)
- **Max feedback latency:** offline checks < 5s; live soak is an explicit slow gate, not per-commit

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | OCP-07 | T-13-01 | Malformed NDJSON line skipped, never crashes parser | unit (offline) | `bash scripts/test-remember-recall-assertions.sh` | ❌ W1 creates | ⬜ pending |
| 13-01-02 | 01 | 1 | OCP-07 | T-13-02 / T-13-03 | serve stays 127.0.0.1; no CAIRN_LLM_API_KEY value logged | integration (structural offline) | `bash -n … && bash scripts/test-remember-recall-assertions.sh && grep assert-tool-event.mjs/--attach/LAST_ROUNDTRIP_RETRIES` | ❌ W1 creates | ⬜ pending |
| 13-02-01 | 02 | 2 | OCP-07 | T-13-05 | Env-var gate blocks false PASS on bundled default model | integration (structural offline) | `bash -n … && grep preflight_tool_call_probe / trait message` | ❌ W2 creates | ⬜ pending |
| 13-02-02 | 02 | 2 | OCP-07 | T-13-02 / T-13-03 | Missing CAIRN_LLM_* fails fast without hang; no secret in table | integration (offline fail-fast) | `--help \| grep --repeat` + `env -u CAIRN_LLM_* timeout 30 … --repeat 1` returns non-zero | ❌ W2 creates | ⬜ pending |
| 13-03-01 | 03 | 3 | OCP-07 | T-13-04 | No private/vendor reference in docs | doc gate | `scripts/verify-docs-parity.sh && scripts/verify-no-private-references.sh && grep tool-call-reliable/qwen3.5-27b/--repeat` | ✅ (gates exist) | ⬜ pending |
| 13-03-02 | 03 | 3 | OCP-07 | T-13-04 / T-13-03 | Gap record cites public model, no secret transcribed | doc gate | `grep OCP-07 Complete row + [x] + MILESTONES` + `scripts/verify-no-private-references.sh` | ✅ (gates exist) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/lib/assert-tool-event.mjs` — NDJSON tool-event matcher (created Wave 1, Task 13-01-01)
- [ ] `scripts/test-remember-recall-assertions.sh` — offline fixture test for the matcher (created Wave 1, Task 13-01-01)

*No separate framework install: node v20.19.2 is already present; the harness is the test infrastructure.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 5/5 consecutive live round-trips | OCP-07 SC#1 | Requires an operator-provided no-thinking tool-call-reliable local model (CAIRN_LLM_*), unavailable in sandbox/CI | Operator runs `scripts/verify-opencode-live-parity.sh --repeat 5`; expects `[repeat] OK: 5/5`; paste the per-run + aggregate table into the Phase 13 UAT/VERIFICATION doc |
| Retry absorbs infra flakiness without masking failures | OCP-07 SC#2 | Same live-model dependency; observed via the evidence table's retry column | Inspect the `retries=` column in the `--repeat 5` output; a PASS with retries>0 shows absorbed flakiness, a FAIL is honest |
| Gap recorded resolved | OCP-07 SC#3 | Doc review, not executed | Confirm MILESTONES.md + REQUIREMENTS.md updated (Task 13-03-02) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (assert-tool-event.mjs + fixture test, Wave 1)
- [x] No watch-mode flags
- [x] Feedback latency < 5s (offline checks)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-08
