---
phase: 6
slug: fastcontext-reliability-spike
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-04
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> This phase is a **spike/verification**: the committed probe script *is* the test.
> Validation = offline structural checks (script runs, records evidence, computes a verdict)
> plus the operator-gated live probe. No unit-test framework is installed.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | bash + `curl` + `jq` — the committed probe script is the test harness (mirrors `scripts/verify-opencode-live-parity.sh`) |
| **Config file** | none — endpoint via env var (`FASTCONTEXT_PROBE_URL`), loopback default; real endpoint from gitignored `.ai/.env` |
| **Quick run command** | `{probe script} --self-test` (offline: arg-parse, jq assertions, verdict logic on fixture responses — no live model) |
| **Full suite command** | `{probe script}` (live: requires operator-supplied FastContext `llama-server --jinja` endpoint) |
| **Estimated runtime** | offline self-test ~seconds; live probe ~minutes (≥15 turns) |

---

## Sampling Rate

- **After every task commit:** Run the offline self-test (`--self-test`) — must exit 0 without a live endpoint.
- **After every plan wave:** Re-run the offline self-test; shellcheck the script if available.
- **Before sign-off:** Operator runs the live probe once against the deployed endpoint and the recorded evidence + verdict are committed.
- **Max feedback latency:** offline self-test < 30 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 6-01-01 | 01 | 1 | CTX-06 | T-6-01 / — | No private host/IP committed; endpoint env-only | offline | `{probe} --self-test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · Planner replaces this scaffold row with the real per-task map.*

---

## Wave 0 Requirements

- [ ] Probe script skeleton with an offline `--self-test` path that exercises jq assertions + verdict logic against fixture (canned) `/props` and `/v1/chat/completions` responses — so the record-and-check + go/no-go logic is validated with **no live model dependency**.

*The live probe itself is operator-gated (D-07) and cannot run in CI; its self-test path is the automated backstop.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live tool-call reliability (≥15 turns all `finish_reason=tool_calls`) + `/props` recording | CTX-06 | Requires the operator's deployed FastContext GGUF + `llama-server --jinja` endpoint (no committed host/IP, DEC-no-private-references); the empirical reliability outcome is the very thing the spike exists to measure | Operator sets `FASTCONTEXT_PROBE_URL`, runs the probe live, commits the recorded evidence log + go/no-go verdict artifact |

---

## Validation Sign-Off

- [ ] Probe script has an offline `--self-test` path with automated jq/verdict assertions
- [ ] Sampling continuity: no 3 consecutive tasks without automated (offline) verify
- [ ] Wave 0 covers the offline self-test fixture
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s (offline)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
