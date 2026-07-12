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

## Milestone: v1.2 — Context Exploration (token-miser + FastContext)

**Shipped:** 2026-07-06
**Phases:** 4 (6-9) | **Plans:** 8 | **Sessions:** ~2 (2026-07-04 → 2026-07-06)

### What Was Built
- FastContext reliability probe (`scripts/verify-fastcontext-reliability.sh`) — bash+curl+jq, offline `--self-test`, `--props-only`/`--full`; live operator run returned GO (15/15 turns real `tool_calls`, zero narration) against the deployed q8_0 GGUF + `llama-server --jinja`
- `context_explore` MCP tool in `cairn-memory` — a thin subprocess delegate to `token_miser explore` (existing `runCommand` pattern), fail-closed on every precondition/execution error, dual compact `path:line-range` citations + lossless structured `Evidence` output, env-only provider-neutral config
- Paired `/context-explore` commands (Claude Code + OpenCode) + `scripts/sync-opencode-explore-assets.sh` install/drift script + `docs/operating.md` parity
- A/B token-savings harness (`scripts/verify-token-savings-ab.sh`) — offline `--self-test` Nyquist backstop + operator-gated live `--full`; measured ~99.9% byte-savings on verified tight-query pinpoints (D-03 PASS)

### What Worked
- The reliability spike as a standalone hard gate (Phase 6) *before* any wiring directly applied the v1.1 OCP-04 lesson — tool-call reliability was proven live before a line of tool code depended on it
- Delegating to token-miser's Rust binary instead of reimplementing FastContext's loop/sandbox/serving kept cairnkeep thin and provider-neutral — no endpoint/model/API-key/host committed anywhere (grep-verified for CTX-03)
- The A/B harness reported cairnkeep's *own* measured number and disclosed the broad-query model-unreliability transparently (09-AB.md) rather than cherry-picking the flattering headline

### What Was Inefficient
- The v1.1 small-model tool-call variance resurfaced: broad/loosely-worded queries wandered or hallucinated citations (D-01), so the headline had to be scoped to the verified tight-query slice
- The `Evidence` JSON schema wasn't fully pinned by research — required reading token-miser's `src/explore/mod.rs` directly during Phase 7 planning before writing the parser
- Endpoint-down-but-configured yields exit 0 + empty `Evidence`, indistinguishable from a genuine empty result — accepted as a residual CTX-02 gap, mitigated only by surfacing turns/tool_calls in the empty-citation text

### Patterns Established
- Spike-then-build: probe a local model's tool-calling reliability against the *actually-deployed* quant + server flags in a standalone gated phase before wiring anything on top
- Delegate to a sibling binary via the existing `runCommand` subprocess pattern rather than re-deriving its agentic loop in TypeScript
- For a value-prop claim, report the project's own measured number and disclose the unreliable slice rather than hiding it behind the verified one

### Key Lessons
1. A standalone reliability-spike phase is cheap insurance against the expensive narration-failure class — make it a hard gate, not an assumption (CTX-06 is the deliberate reprise of OCP-04's lesson).
2. Delegation over reimplementation keeps a provider-neutral core neutral: hold no endpoint/model/key, let the sibling own its serving config.
3. When a small local model is only reliable on tight queries, scope the headline number to the verified slice and disclose the rest — an honest bounded number beats an unbounded claim.

### Cost Observations
- Model mix: predominantly opus (single-developer, verification-heavy)
- Sessions: ~2; local inference (FastContext q8_0 GGUF via `llama-server --jinja`) under test as the exploration backend
- Notable: implementation was thin (subprocess delegation); the effort concentrated in offline-first harnesses + operator-gated live verification — same shape as v1.1

---

## Milestone: v1.3 — Routing Seam & Context Maturation

**Shipped:** 2026-07-08
**Phases:** 4 (10-13) | **Plans:** 12 | **Sessions:** ~3 (2026-07-06 → 2026-07-08)

### What Was Built
- `route_check` MCP tool — a thin fetch-based delegate probing token-miser's `GET /health`, fail-closed at both the precondition and execution tiers, D-10-pinned to exactly one request/one env key; real-binary proof via `scripts/verify-routing-seam.sh` and the seam contract frozen in `docs/operating.md`
- token-miser published PUBLIC at github.com/cairnkeep/token-miser (Apache-2.0, single clean-history commit) plus two fail-loud hygiene gates: `verify-no-private-references.sh` (tree + denylist + commit-log) and `verify-docs-parity.sh` (one-directional code→docs drift)
- `context_explore` maturation — content-sensitive result cache (query + HEAD + dirty-state), memory/wiki citation cross-referencing with byte-identical zero-hit output, double-opt-in fail-open `UserPromptSubmit` auto-invoke hook, all through one shared `runContextExplore()` (MCP tool + `explore` CLI)
- Headless OpenCode harness hardening — NDJSON `tool_use` event assertions (canary-linked) replacing substring greps, serve/`--attach` transport, infra-only retry, preflight tool-call probe, `--repeat N` soak; live 5/5 consecutive round-trips closed the v1.1 OCP-06 gap

### What Worked
- Verify-by-execution at every layer: offline MCP round-trip guards for each new tool, composed proof scripts per phase (`verify-routing-seam.sh`, `verify-explore-maturation.sh`), and live UAT closing the human-check items — the milestone audit passed with zero gaps on the first run
- The fetch-not-subprocess call for `route_check` was decided from token-miser's actual surface (proxy-only HTTP, no CLI subcommand) rather than pattern-copying the `context_explore` delegate — right seam, one env key, frozen by guard assertions
- Clean-slate single-commit publish for token-miser removed the entire private-history risk class in one move; the guard verified the tree before push
- Phase 13 directly cashed in the v1.1 OCP-04 root-cause: narrated pseudo-tool-calls now hard-FAIL (never retry), and only infra failures retry — the live soak then passed 5/5 with zero retries

### What Was Inefficient
- REQUIREMENTS.md checkboxes drifted twice (SC-01/02/03 and CTX-08 left Pending after their phases closed) and had to be caught by verifiers — the ledger flip isn't part of the plan-close motion yet
- Pre-existing AI-authorship trailers in history surfaced twice (Phase 11 guard, Phase 12 deferred item) and needed operator history-rewrites mid-milestone — hygiene debt from before the gates existed
- The `--repeat` soak's real-`~/.claude` tamper guard false-positives when driven from inside a live Claude Code session (transcript writes trip the mtime fingerprint) — cosmetic, but it cost a diagnosis round
- 12-VALIDATION.md was left as an unfilled template; the phase's actual proof lived in the PLAN verify blocks and the composed script — the artifact added nothing

### Patterns Established
- Pin a seam with guard assertions (exactly N requests, exactly these env keys), not just docs — refactors can't silently drift a contract a test physically checks
- Publish a private-origin sibling as a single scrubbed commit, gated by the same guard the consuming repo runs as its milestone gate
- Double-opt-in + fail-open + timeout for any hook that auto-runs on user prompts; silence is the default
- Assert protocol-level events (NDJSON `tool_use` with canary linkage), never model narration, when verifying agent behavior; classify retries by failure type (infra vs behavioral)

### Key Lessons
1. Freeze contracts in executable form: the D-10 pinning assertions are the reason the seam can be trusted by an overlay that never reads the source.
2. Requirements-ledger updates must ride the same commit as the work that satisfies them — trailing bookkeeping is the milestone audit's most common false alarm.
3. Retry logic must be scoped to the failure class it absorbs: retrying behavioral failures (narration) would have masked the exact regression the harness exists to catch.
4. Run history-hygiene gates from milestone one — retrofitting them surfaces old violations at the least convenient time.

### Cost Observations
- Model mix: predominantly opus orchestration with sonnet subagents (verification-heavy)
- Sessions: ~3; live verification against local qwen3.5-27b (llama.cpp) for the OpenCode soak, real token_miser binary for the routing proof
- Notable: 12,440 insertions in 3 days with a first-run clean milestone audit — the composed per-phase proof scripts made closeout nearly free

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~2 | 3 | Retroactive audit-against-code closeout for a pre-plan-tracking codebase |
| v1.1 | ~2 | 2 | Scratch-isolated live-parity harness; first override closeout (gap gated on external model reliability) |
| v1.2 | ~2 | 4 | Spike-as-hard-gate before wiring; verify-by-execution with the project's own measured number (bounded to the verified slice, unreliable slice disclosed) |
| v1.3 | ~3 | 4 | Executable seam contracts (guard-pinned); first fully verified closeout (audit passed, zero gaps, human checks closed in UAT) |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 5 smoke checks | build clean, flows verified | provider-neutral core (no vendor deps) |
| v1.1 | live-parity harness (5 stages + negative controls) | 4/6 reqs proven live, 2/6 proven-achievable | native OpenCode plugins (no new runtime deps) |
| v1.2 | 2 offline self-test harnesses + live A/B | 7/7 reqs complete; CTX-07 live-measured (~99.9% tight-query byte-savings) | subprocess delegation to token-miser (no new runtime deps) |
| v1.3 | 3 offline smoke guards + 3 composed proof scripts + live 5/5 soak | 9/9 reqs complete; verified closeout | fetch-based delegate + bash gates (no new runtime deps) |

### Top Lessons (Verified Across Milestones)

1. Verification by execution beats a paper trail — run the build + smoke suite.
2. Fail closed on any opt-in network surface.
3. Trust only structural, server-side evidence when verifying against a variable-reliability local model — not grep matches on model free-text.
4. Probe a local model's tool-calling reliability against the actually-deployed quant + server flags in a standalone gated phase before building wiring on it (OCP-04 → CTX-06).
5. Pin seam contracts with executable guard assertions (exact request count, exact env-key set) so drift is a test failure, not a docs archaeology exercise (v1.3 D-10).
