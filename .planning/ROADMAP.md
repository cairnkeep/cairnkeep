# Roadmap: Cairnkeep

## Milestones

- ✅ **v1.0 OSS core → parity** — Phases 1-3 (shipped 2026-07-03) — see [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 OpenCode parity** — Phases 4-5 (shipped 2026-07-04) — see [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- 🚧 **v1.2 Context Exploration (token-miser + FastContext)** — Phases 6-9 (in progress)
- 📋 **Enterprise overlay (private)** — planned; wraps the core with organization-specific launchers and config; lives only on the private remote, never in this repo
- 📋 **token-miser routing-proxy surface (TMISER-R1)** — planned; the HTTP routing/tiering surface (`/v1/chat/completions` tiering, semantic router) — distinct from v1.2's `context_explore` subprocess delegation, which token-miser's own docs call "never a routing target"

## Phases

<details>
<summary>✅ v1.0 OSS core → parity (Phases 1-3) — SHIPPED 2026-07-03</summary>

- [x] Phase 1: Configurable git-provider abstraction — completed (pre-plan-tracking)
- [x] Phase 2: Operating-layer verification — completed 2026-07-03
- [x] Phase 3: Docs + parity sign-off — completed 2026-07-03

Full detail archived in [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md). Baseline tag: `v1.0.0`.

</details>

<details>
<summary>✅ v1.1 OpenCode parity (Phases 4-5) — SHIPPED 2026-07-04 (override closeout)</summary>

- [x] Phase 4: OpenCode parity operating layer (6/6 plans) — completed 2026-07-03 (verified)
- [x] Phase 5: Live OpenCode parity verification (3/3 plans) — completed 2026-07-04 (override closeout — OCP-06 round-trip proven achievable; reliable headless reproduction + interactive TUI confirm are open gaps)

Full detail archived in [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md). Baseline tag: `v1.1`. Known gaps recorded in [MILESTONES.md](MILESTONES.md).

</details>

### 🚧 v1.2 Context Exploration (token-miser + FastContext) (In Progress)

**Milestone Goal:** Give cairnkeep a token-efficient repo-exploration capability — FastContext as a provider-neutral context-explore backend, routed through token-miser — wired into both the `cairn-memory` MCP and the Claude Code + OpenCode operating layers.

- [x] **Phase 6: FastContext Reliability Spike** - Probe and document `finish_reason=tool_calls` reliability against the deployed GGUF quant + `llama-server --jinja` combo before any wiring is built on it (completed 2026-07-04)
- [x] **Phase 7: context_explore MCP Tool** - Thin subprocess-delegating tool in `cairn-memory`, provider-neutral config, fail-closed on every error path (completed 2026-07-04)
- [x] **Phase 8: Operating-Layer Wiring** - Claude Code + OpenCode commands invoke context exploration on demand (completed 2026-07-05)
- [x] **Phase 9: Live Verification + A/B Token-Savings** - Cairnkeep's own measured before/after token count, milestone close-out gate (completed 2026-07-06)

## Phase Details

### Phase 6: FastContext Reliability Spike

**Goal**: The actually-deployed FastContext GGUF quant + `llama-server --jinja` combination is proven to reliably emit real tool calls (not narration) before any code depends on it — de-risking the exact failure class this project already paid for once (OCP-04).
**Depends on**: Nothing (first phase of v1.2; gates Phases 7-9)
**Requirements**: CTX-06
**Success Criteria** (what must be TRUE):

  1. A repeated-trial probe (multiple prompts, multiple turns) against the actually-deployed FastContext GGUF quant + `llama-server --jinja` endpoint records the observed `finish_reason` on every turn.
  2. The probe checks `GET /props` → `chat_template_tool_use` against the deployed `llama-server` build to confirm a native tool-call template is active rather than a narration-prone generic fallback.
  3. A documented go/no-go verdict exists in the phase artifacts: either "reliably invokes tools" (safe to build Phase 7 on) or "narrates instead of invoking" (a hard blocker requiring remediation before proceeding) — never a silent assumption either way.

**Plans**: 2/2 plans complete
**Wave 1**

- [x] 06-01-PLAN.md — Build the committed FastContext reliability probe (`scripts/verify-fastcontext-reliability.sh`; bash+curl+jq, offline `--self-test`, `--props-only`, `--full`)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 06-02-PLAN.md — Operator-gated live probe run + documented go/no-go verdict (`06-SPIKE.md`, refined-D-05 scoring)

### Phase 7: context_explore MCP Tool

**Goal**: `cairn-memory` exposes a `context_explore` tool that delegates natural-language exploration queries to the external `token_miser explore` binary and returns compact citations, configured entirely provider-neutrally, and failing closed on every error path.
**Depends on**: Phase 6 (reliability spike must clear before this is built)
**Requirements**: CTX-01, CTX-02, CTX-03
**Success Criteria** (what must be TRUE):

  1. User can invoke `context_explore` with a natural-language query against a real repo and receive compact `path:line-range` citations, parsed from `token_miser explore`'s `Evidence` JSON via the existing `runCommand` subprocess pattern.
  2. When the `token-miser` binary is missing, misconfigured, times out, or emits malformed stdout, `context_explore` returns a clear, fail-closed error — never a silent empty-success.
  3. `context_explore`'s only configuration surface is environment variables (binary path + optional repo-root override); a grep across `src/` and docs confirms no FastContext endpoint/model/API-key or private host/IP/vendor default is committed anywhere (honors DEC-no-private-references).
  4. An offline smoke test (no live model dependency) exercises the "not configured" and "binary missing" fail-closed paths and passes in CI.

**Plans**: 2/2 plans complete

**Wave 1**

- [x] 07-01-PLAN.md — Offline fail-closed smoke harness + fake-binary fixtures + `check:explore-guard` wiring (Wave 0 test infra; RED until Wave 2)

**Wave 2** *(blocked on Wave 1)*

- [x] 07-02-PLAN.md — Register the `context_explore` tool: delegate to `token_miser explore`, parse Evidence, fail closed, dual compact/structured output, env-only config

### Phase 8: Operating-Layer Wiring

**Goal**: Users can invoke context exploration on demand from both the Claude Code and OpenCode operating layers, mirroring the existing command/agent pairing pattern.
**Depends on**: Phase 7 (`context_explore` must exist and be correctly configured before it's wired into commands)
**Requirements**: CTX-04, CTX-05
**Success Criteria** (what must be TRUE):

  1. User can run a Claude Code command that invokes the `context_explore` MCP tool and surfaces its citations in the response.
  2. User can run an OpenCode command that invokes the same `context_explore` tool, installed via a new `sync-opencode-*-assets.sh` script mirroring the existing asset-sync pattern (parity with Claude).
  3. Both commands are on-demand, agent-invoked entry points — not automatic hooks — consistent with token-miser's fresh-task-only invariant for exploration.

**Plans**: 2/2 plans complete

**Wave 1**

- [x] 08-01-PLAN.md — Create the paired `/context-explore` command prompt files (Claude Code + OpenCode), direct inline MCP call, citations-only, explicit repo_root (CTX-04 + CTX-05 command half)

**Wave 2** *(blocked on Wave 1)*

- [x] 08-02-PLAN.md — Dedicated `scripts/sync-opencode-explore-assets.sh` install/drift script + `docs/operating.md` parity (CTX-05 install path; D-04 as documentation parity — no CI job, matching all five siblings)

### Phase 9: Live Verification + A/B Token-Savings

**Goal**: The milestone's actual value proposition — token-efficient exploration — is proven with cairnkeep's own measured number against a real bootstrapped project, not a cited paper figure.
**Depends on**: Phase 8 (needs the full pipeline — tool, config, and at least one operating-layer command — working end-to-end to produce a meaningful measurement)
**Requirements**: CTX-07
**Success Criteria** (what must be TRUE):

  1. An A/B harness runs the same representative exploration prompt through both native Read/Glob/Grep and `context_explore` against a real bootstrapped project, on cairnkeep's own verification harness.
  2. A measured (not cited-from-paper) before/after token count is recorded and reported in the phase's UAT/SUMMARY docs.
  3. At least one operating-layer `/context-explore` command (Claude Code and/or OpenCode) is run live end-to-end against a real bootstrapped project — the same verify-by-execution bar proven against the registered `cairn-memory` MCP in prior milestones.

**Plans**: 2/2 plans complete

**Wave 1**

- [x] 09-01-PLAN.md — Build the committed A/B token-savings harness (`scripts/verify-token-savings-ab.sh`; byte anchor + `chars/4` estimate, native grep→window recipe vs renderCitations text, offline `--self-test`/`--native`, D-03 net-savings gate)

**Wave 2** *(blocked on Wave 1)*

- [x] 09-02-PLAN.md — Operator-gated live run (`--full` measured number + one live `/context-explore`) + record the verdict in `09-AB.md` referenced from UAT/SUMMARY (SC-2, SC-3; D-04 fail-loud gap)

## Progress

| Phase | Milestone | Status | Completed |
|-------|-----------|--------|-----------|
| 1. Configurable git-provider abstraction | v1.0 | Complete | pre-tracking |
| 2. Operating-layer verification | v1.0 | Complete | 2026-07-03 |
| 3. Docs + parity sign-off | v1.0 | Complete | 2026-07-03 |
| 4. OpenCode parity operating layer | v1.1 | Complete | 2026-07-03 |
| 5. Live OpenCode parity verification | v1.1 | Complete (override) | 2026-07-04 |
| 6. FastContext Reliability Spike | 2/2 | Complete    | 2026-07-04 |
| 7. context_explore MCP Tool | 2/2 | Complete    | 2026-07-04 |
| 8. Operating-Layer Wiring | 2/2 | Complete    | 2026-07-05 |
| 9. Live Verification + A/B Token-Savings | 2/2 | Complete    | 2026-07-06 |
