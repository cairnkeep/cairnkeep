---
phase: 10
slug: routing-seam
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-06
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `10-RESEARCH.md` §Validation Architecture (HIGH confidence, grounded in direct source read + live binary execution).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None — hand-rolled assert-style smoke scripts (`check(name, cond)` helper), consistent with every `check:*-guard` script in this repo (`mcp-memory-server/scripts/smoke-explore-guard.mjs`) |
| **Config file** | none — Wave 0 adds scripts |
| **Quick run command** | `npm run check:route-guard` (new script, added in Wave 0) |
| **Full suite command** | `npm run test:smoke` (already runs `build` + all `check:*-guard` scripts; wire the new one into this chain) |
| **Estimated runtime** | ~30 seconds (tsc build + smoke chain) |

---

## Sampling Rate

- **After every task commit:** Run `npm run check:route-guard`
- **After every plan wave:** Run `npm run test:smoke`
- **Before `/gsd-verify-work`:** Full suite green AND `scripts/verify-routing-seam.sh` run at least once (D-06 real proof invocation)
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

> Task IDs are filled once PLAN.md exists. Requirement-level map (from RESEARCH.md) below; wire each to its task during execution.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | RT-01 (register + fail-closed tiers) | — | throws on unset/malformed `CAIRN_ROUTE_ENDPOINT`; `{ok:false}` on unreachable/non-2xx/malformed-JSON; `{ok:true}` on real 200 | smoke (MCP round-trip) | `node mcp-memory-server/scripts/smoke-route-guard.mjs` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | RT-01 (D-10 freeze) | — | exact fetch path (`GET {endpoint}/health`) + exact env-key set (`CAIRN_ROUTE_ENDPOINT`) cannot silently drift | smoke (pinning assertions, same file) | `node mcp-memory-server/scripts/smoke-route-guard.mjs` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | RT-01 (D-06 real proof) | — | a genuine (non-mocked) `token_miser` binary answers `/health` | integration (operator/CI-gated; skip-with-message if binary absent) | `scripts/verify-routing-seam.sh` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | RT-02 (seam contract doc) | — | `docs/operating.md` documents `CAIRN_ROUTE_ENDPOINT` + contract, sufficient without reading source | manual (UAT) + optional `grep -q CAIRN_ROUTE_ENDPOINT docs/operating.md` | grep backstop only | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `mcp-memory-server/scripts/smoke-route-guard.mjs` — RT-01 registration + all four fail-closed outcomes + D-10 pinning assertions
- [ ] `mcp-memory-server/package.json` — add `check:route-guard` script, wire into `test:smoke`
- [ ] `scripts/verify-routing-seam.sh` — real proof invocation (D-06), operator/CI-gated on the `token_miser` binary being present
- [ ] `docs/operating.md` — `CAIRN_ROUTE_ENDPOINT` env row + seam-contract subsection (RT-02)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Seam-contract doc is sufficient for an external overlay to drive routing without reading core source | RT-02 | Doc completeness/accuracy is a review judgement, not a runnable assertion | Read `docs/operating.md` seam-contract section cold; confirm `CAIRN_ROUTE_ENDPOINT`, the tool's call shape, and fail-closed behavior are all specified. Optional `grep` presence backstop only. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
