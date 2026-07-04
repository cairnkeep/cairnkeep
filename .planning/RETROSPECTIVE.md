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

## Milestone: v1.1 — OpenCode parity

**Shipped:** 2026-07-04 (override closeout)
**Phases:** 2 (4-5) | **Plans:** 9 | **Sessions:** ~2 (2026-07-03 → 2026-07-04)

### What Was Built
- OpenCode memory lifecycle on native plugins — `memory-capture.ts` (`session.idle` → staging, byte-compatible with the Claude contract), `memory-recall.ts` (pre-edit throw-to-surface injection), `memory-wakeup.ts` (native, self-sufficient of `~/.claude`)
- `remember`/`recall` commands for OpenCode, wired into `sync-opencode-memory-assets.sh`
- `verify-opencode-live-parity.sh` — a scratch-isolated live-parity harness (fingerprint-guarded HOME, negative controls, real registered `cairn-memory` MCP)
- 05-UAT.md execution evidence discharging the OCP-01/02/03/04 live round-trip owed from 04-UAT

### What Worked
- The scratch-HOME fingerprint guard (snapshot real `~/.config/opencode` + `~/.claude` before/after, fail loud on drift) let live verification run without risking the operator's real config
- Capture was the most reliable stage (4/4) because its evidence is server-side (a staged JSON file), not model-narrated — structural evidence beats grepping model text
- Diagnosing OCP-04 by triangulating raw curl + a proxy + direct model-config injection isolated the blocker to the model's tool-calling, not the code

### What Was Inefficient
- Grep-based tool-call assertions produced a false-positive class: narrated-but-unexecuted tool syntax matched as if it were a real `"type":"tool"` event — trust was misplaced until caught
- Chased thinking-config and a thinking-strip proxy as OCP-04 fixes before proving they were dead ends; the real fix was swapping to a tool-call-reliable model
- Headless operator (no TTY) meant the literal interactive-session bar couldn't be met — recorded as a fallback-gap rather than closed

### Patterns Established
- Verify a live MCP tool call by a genuine `"type":"tool"` event in the `--format json` stream, never a substring grep of free-text (thinking models narrate tool syntax they don't execute)
- Local thinking-model tool-calling is a reliability variable, not a determinism guarantee — document per-stage evidence + variance rather than asserting per-invocation success
- Toggling `enable_thinking` can move *which* tool call fails rather than fixing it; the durable fix is a genuinely no-thinking, tool-call-reliable model verified with the actual client (opencode), not just curl

### Key Lessons
1. Structural, server-side evidence (a staged file, a plugin-injected exception) is the only trustworthy signal when the client is a variable-reliability local model.
2. When a live assertion is grep-based, distrust it unless the matched text is structurally server-side or a real tool event.
3. An override closeout is the honest call when the mechanism is proven but reliable reproduction is gated on an external dependency (model/runtime) — document the gap and the follow-up, don't claim a green pass.

### Cost Observations
- Model mix: predominantly opus (single-developer, verification-heavy)
- Sessions: ~2; local inference (qwen coder / qwen3.5-27b) under test as the OpenCode-side model
- Notable: most of the effort was live-verification diagnosis, not implementation — the plugins landed quickly; proving them live against a flaky local model was the long pole

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~2 | 3 | Retroactive audit-against-code closeout for a pre-plan-tracking codebase |
| v1.1 | ~2 | 2 | Scratch-isolated live-parity harness; first override closeout (gap gated on external model reliability) |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 5 smoke checks | build clean, flows verified | provider-neutral core (no vendor deps) |
| v1.1 | live-parity harness (5 stages + negative controls) | 4/6 reqs proven live, 2/6 proven-achievable | native OpenCode plugins (no new runtime deps) |

### Top Lessons (Verified Across Milestones)

1. Verification by execution beats a paper trail — run the build + smoke suite.
2. Fail closed on any opt-in network surface.
3. Trust only structural, server-side evidence when verifying against a variable-reliability local model — not grep matches on model free-text.
