# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — OSS core → parity

**Shipped:** 2026-07-03
**Phases:** 3 | **Plans:** 0 (pre-plan-tracking) | **Sessions:** ~2 (2026-07-02 → 2026-07-03)

### What Was Built
- Provider-neutral core — one `CAIRN_GIT_PROVIDER` key + per-provider operation→tool map; no hardcoded git hosts
- `cairn-memory` MCP server — 10 tools on stdio plus opt-in token-gated HTTP transport
- Verified operating layer — memory round-trip, wiki (ingest/query/lint), security-audit, repo-review, and memory hooks (wakeup/capture/review) across Claude Code
- `docs/operating.md` operating guide + fresh-bootstrap parity, baseline tag `v1.0.0`, Apache-2.0 + CI hygiene

### What Worked
- Direct code + live-smoke verification stood in cleanly for missing SUMMARY/VERIFICATION artifacts — stronger evidence than a paper trail for a pre-tracking codebase
- Security findings were caught and closed in-loop: security-audit surfaced SEC-0001, repo-review then caught a weak fix (`resolve===join`) and it was hardened with `relative()`
- Each fix landed with a regression smoke test (`smoke-scope-guard`, `smoke-http-guard`), so the suite grew with the surface area

### What Was Inefficient
- The project predates GSD plan-tracking, so phase/plan/task counts were unavailable and the milestone-complete CLI mis-read unchecked ROADMAP boxes as "unstarted" — required `--force` and manual reconciliation of stale checkboxes
- OpenCode operating-layer parity trailed Claude Code (wakeup install ordering, later a dedicated sync script) — a second harness surfaced ordering assumptions late

### Patterns Established
- ZodEffects `.refine()` must not be used as an MCP tool `inputSchema` — it publishes an empty schema; validate exactly-one-of inside the handler
- Path containment uses `relative()`, never `resolve(base,x)===join(base,x)` (misses `../` traversal); read-only fan-out scopes like `"all"` are rejected on write paths
- Opt-in network transports fail closed by default (bearer auth + per-origin CORS + Host validation)

### Key Lessons
1. For codebases that predate plan-tracking, retroactive audit-against-code + live smoke is the right closeout evidence — don't fabricate SUMMARY artifacts to satisfy the tooling.
2. Chaining security-audit → repo-review on the same diff catches weak first-pass fixes; treat the verifier's own output as reviewable.
3. A second harness (OpenCode) is where single-harness install-ordering assumptions leak — document the complete path explicitly.

### Cost Observations
- Model mix: predominantly opus (single-developer, verification-heavy session)
- Sessions: ~2
- Notable: verification-by-execution kept rework low; most churn was security follow-ups, all closed before close

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~2 | 3 | Retroactive audit-against-code closeout for a pre-plan-tracking codebase |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 5 smoke checks | build clean, flows verified | provider-neutral core (no vendor deps) |

### Top Lessons (Verified Across Milestones)

1. Verification by execution beats a paper trail — run the build + smoke suite.
2. Fail closed on any opt-in network surface.
