# Phase 9: Live Verification + A/B Token-Savings - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove the v1.2 value proposition — token-efficient exploration — with cairnkeep's
**own measured** before/after token number against a real repo, and run at least
one `/context-explore` command live end-to-end against the real backend. This is
the **milestone close-out gate** for v1.2.

This phase is **measurement + verification, not a build**. It produces a committed
A/B harness, a recorded measured number in the phase's UAT/SUMMARY docs, and one
live operating-layer run. It does **NOT** build any new exploration capability,
change the `context_explore` tool (Phase 7), change either `/context-explore`
command (Phase 8), add caching/annotation/UI (deferred CTX-F1..F3), or swap the
exploration backend.

Requirements: **CTX-07** (measured, not-cited-from-paper before/after A/B on
cairnkeep's own harness against a real bootstrapped project).

</domain>

<decisions>
## Implementation Decisions

> The user delegated all four gray areas to Claude ("you decide"). The decisions
> below are grounded in prior-phase precedent (Phase 6 harness discipline, Phase 8
> D-02 delta lock, the project's verify-by-execution + fail-loud culture) and are
> safe to edit before planning.

### A/B baseline — how the "before" number is produced
- **D-01:** **Deterministic committed harness + live SC-3 run.** A live-agent-on-
  both-sides measurement would drift every run — a poor basis for a milestone-
  closing *headline* number. Instead, a committed, re-runnable
  `scripts/verify-*.sh` computes the native-vs-explore token delta
  deterministically: the **native ("before") side** runs a fixed native-
  exploration recipe (glob → grep → read the file ranges a native answer pulls
  into context) and counts those; the **explore ("after") side** counts the
  compact `path:line-range` citation text that `context_explore` actually returns
  to the main agent (the lean surface locked by Phase 8 D-02). The required SC-3
  live `/context-explore` run corroborates the explore side against the real
  backend. Rationale: this is exactly what "cairnkeep's own verification harness"
  + "measured, not cited" + Phase-6-D-01 re-runnability point to, and the headline
  does not depend on a flaky live model.

- **D-01a:** **Byte delta is the tokenizer-free ground truth; token count is a
  reported estimate.** The harness always reports the raw **byte/char delta**
  (fully portable, no tokenizer dependency) as the anchor, and additionally a
  token estimate. The tokenizer choice must be **provider-neutral** — a neutral
  public tokenizer or a documented `chars/N` heuristic, **never the deployed
  vendor model's tokenizer committed into the repo** (DEC-no-private-references).
  Exact tokenizer/heuristic is Claude's discretion at plan time, but the byte
  anchor is mandatory so the number is defensible even if the estimate is
  approximate.

### Corpus & query set
- **D-02:** **cairnkeep's own repo, a small representative query set (3–5),
  reported per-query + median.** A real repo (Phase 6's recommended probe corpus),
  and a small set defends against single-query cherry-picking. Resolves the mild
  SC-wording tension ("real bootstrapped project" vs Phase 6's "cairnkeep's own
  repo"): the A/B **headline uses cairnkeep's repo**, and the harness accepts a
  `--repo` override so the operator can additionally point it at a fresh
  `cairn bootstrap` scratch project for strict-wording coverage without changing
  the default.

### Pass bar / milestone gate
- **D-03:** **Record + net-savings sanity gate.** SC-2's literal bar is only
  "recorded and reported," but a silent regression must not slip through. Pass =
  the harness runs and produces an honest number **and** it shows net savings > 0.
  A savings ≤ 0 result is a **loud, documented finding / known-gap** requiring a
  look — never a silent pass (mirrors Phase 6 D-08's fail-loud discipline). **No
  paper-figure gate**: cairnkeep's number is not required to match FastContext's
  ~60% claim — a legitimately different number for this repo + this quant is a
  valid measured truth, not a failure.

### Live run scope (SC-3) & backend prerequisite
- **D-04:** **One live `/context-explore` run on Claude Code, operator-gated.**
  Claude Code is the primary verified harness across v1.0/v1.1; SC-3 accepts
  "Claude Code and/or OpenCode," so one layer suffices, and OpenCode parity was
  already proven in v1.1. The FastContext server + `token_miser explore` binary
  are **operator-provided runtime prerequisites** (Phase 6 D-07), not phase-
  deliverable code; the harness is committed + re-runnable and the live run is
  **operator-gated** (mirroring the Phase 6 operator-gated live probe), never
  blocking milestone close-out on server bring-up. If the backend cannot be stood
  up, that is a documented gap, not a silent skip.

### Claude's Discretion
- Exact tokenizer / `chars/N` heuristic for the token estimate (byte anchor is
  mandatory; estimate must be provider-neutral) — pick at plan time.
- The precise 3–5 representative exploration queries and the fixed native-
  exploration recipe (which globs/greps/reads model "what a native agent would
  pull in") — planner/researcher's call; document the recipe so the baseline is
  reproducible and auditable.
- Harness filename and whether the verdict lives in `09-UAT.md`, `09-SUMMARY.md`,
  or a dedicated `09-AB.md` — planner's call; the roadmap only requires the
  measured number appear in the phase's UAT/SUMMARY docs.
- Whether the SC-3 live run and the A/B harness share one script or are two —
  implementation detail.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` — **CTX-07** (measured before/after A/B, native
  Read/Glob/Grep vs `context_explore`, cairnkeep's own harness, real bootstrapped
  project, cairnkeep's own number not the paper figure).
- `.planning/ROADMAP.md` §"Phase 9: Live Verification + A/B Token-Savings" — goal +
  the 3 success criteria (A/B harness both paths; measured number recorded in
  UAT/SUMMARY; ≥1 operating-layer command run live end-to-end).

### The delta being measured (LOCKED upstream)
- `.planning/phases/08-operating-layer-wiring/08-CONTEXT.md` §D-02 — the command
  surfaces **citations only** and deliberately does NOT read/summarize the cited
  ranges: "this is precisely what Phase 9 / CTX-07 A/B measures." The "after"
  token count is this lean citation text, nothing more.
- `.planning/phases/07-context-explore-mcp-tool/07-CONTEXT.md` §D-02 — dual output:
  compact `path:line-range` text (the agent-facing surface Phase 9 counts) +
  structured `Evidence` passthrough.

### Harness pattern & backend-prerequisite precedent (mirror these)
- `.planning/phases/06-fastcontext-reliability-spike/06-CONTEXT.md` §D-01/D-02
  (committed, env-driven, loopback-only, re-runnable probe), §D-07 (server is an
  operator-provided runtime prerequisite), §D-08 (fail loud, never a silent skip).
- `.planning/phases/06-fastcontext-reliability-spike/06-SPIKE.md` — the **GO**
  verdict (live 15/15 `tool_calls`): the backend is already proven tool-reliable,
  so the SC-3 live run can rely on it and does not re-probe reliability.
- `scripts/verify-fastcontext-reliability.sh` and
  `scripts/verify-opencode-live-parity.sh` — the committed, staged, env-driven,
  loopback-only harness template Phase 9's A/B script should follow.

### The tool + commands exercised (unchanged this phase)
- `mcp-memory-server/src/index.ts` — `context_explore` registration (~line 1001);
  `renderCompactCitations` (~lines 599–612) producing the compact text; `Evidence`
  shape = `citations[] { path, start_line, end_line }`, `expanded_snippets[]`,
  `stats { turns, tool_calls }`. **Note: the tool reports NO token usage** — Phase 9
  measures *main-agent* tokens (native file content vs citation text), not the
  tool's internal usage.
- `claude/commands/context-explore.md` — the Claude Code command the SC-3 live run
  invokes (citations-only, explicit `repo_root`).
- `opencode/command/context-explore.md` — the OpenCode parity command (not run live
  this phase per D-04, but the parity target).

### Constraint
- `.planning/PROJECT.md` §Constraints — **DEC-no-private-references [LOCKED]**: the
  A/B harness is loopback-only; no endpoint host/IP, model name, or vendor
  tokenizer committed. Operator supplies the real backend from the ambient shell /
  gitignored `.ai/.env` (Phase 6 D-02 precedent).

### External runtime prerequisite (referenced, never vendored)
- `~/PARA/Projects/token-miser` — the `token_miser explore` binary that produces
  the `Evidence` citations. Referenced by path/env only; not vendored; its
  FastContext endpoint/model config stays in token-miser's own TOML.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/verify-fastcontext-reliability.sh` / `scripts/verify-opencode-live-parity.sh`
  — copy the committed, env-driven, loopback-only, staged-with-generous-timeouts
  harness structure for the A/B script (offline-safe stages + operator-gated live
  stage).
- `renderCompactCitations` in `mcp-memory-server/src/index.ts` — defines the exact
  "after" surface (compact citation text) whose tokens the A/B counts.

### Established Patterns
- Committed harness + operator-supplied endpoint via `.ai/.env`; no host/IP/model
  committed (Phase 1–6 discipline).
- Verify-by-execution: the SC-3 live run is a real end-to-end invocation against the
  real backend, same bar v1.0/v1.1 held.
- Fail-loud on missing prerequisite: an un-standable backend or a savings-regression
  is documented, never silently skipped/passed.

### Integration Points
- **No source changes.** New committed A/B harness under `scripts/`; measured number
  recorded in `.planning/phases/09-.../09-UAT.md` (and/or `09-SUMMARY.md`). The A/B
  compares: native side = bytes/tokens of file content a fixed native-exploration
  recipe pulls into context, vs explore side = bytes/tokens of the citation text
  `context_explore` returns.

</code_context>

<specifics>
## Specific Ideas

- **Byte delta is the anchor, token count is the estimate** — the headline claim
  survives even if the tokenizer estimate is approximate, and stays provider-neutral.
- **The "after" number is deliberately tiny** — Phase 8 D-02 made the command
  surface citations only; the whole point is the main agent never pays to read the
  file contents natively. Phase 9 quantifies exactly that avoided cost.
- **The backend is already proven** (06-SPIKE.md GO) — Phase 9 does not re-verify
  tool-call reliability; it measures savings and runs one live command.

</specifics>

<deferred>
## Deferred Ideas

- **NVIDIA-NeMo/Switchyard as a routing-proxy backend** — an LLM routing/protocol-
  translation proxy (OpenAI↔Anthropic, multi-backend routing). It is **not** a
  substitute for FastContext (repo exploration) or for `token_miser explore`
  (subprocess-delegated exploration, "never a routing target"), so it changes
  nothing in Phase 9. It **is** a plausible substitute/alternative for the
  **deferred token-miser routing/tiering surface (TMISER-R1)**. Evaluate if/when
  TMISER-R1 is scoped in a future milestone — out of scope for v1.2.
  (Apache-2.0; https://github.com/NVIDIA-NeMo/Switchyard)
- **Token-savings UI / annotation / caching (CTX-F1..F3)** — future differentiators,
  deferred until the base capability's savings are proven (this phase proves them).
- **Live OpenCode `/context-explore` run** — not run live this phase (D-04 runs
  Claude Code only); OpenCode parity already proven in v1.1. A future full-parity
  live pass could add it.

</deferred>

---

*Phase: 9-live-verification-a-b-token-savings*
*Context gathered: 2026-07-06*
