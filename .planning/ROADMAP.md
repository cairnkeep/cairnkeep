# Roadmap: Cairnkeep

## Milestones

- ✅ **v1.0 OSS core → parity** — Phases 1-3 (shipped 2026-07-03) — see [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 OpenCode parity** — Phases 4-5 (shipped 2026-07-04) — see [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Context Exploration (token-miser + FastContext)** — Phases 6-9 (shipped 2026-07-06) — see [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)
- 🚧 **v1.3 Routing Seam & Context Maturation** — Phases 10-13 (in progress)
- 📋 **Enterprise overlay (private)** — planned; wraps the core with organization-specific launchers and config; lives only on the private remote, never in this repo
- 📋 **token-miser routing-proxy surface, full hosting (TMISER-R1 remainder)** — planned; v1.3's RT-01 delivers only the thin wire to token-miser's routing/tiering surface — hosting the proxy itself, or any endpoint/model/tier config, stays out of the core per the LOCKED thin-delegate boundary and is carried by a future private-track milestone

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

<details>
<summary>✅ v1.2 Context Exploration (Phases 6-9) — SHIPPED 2026-07-06</summary>

- [x] Phase 6: FastContext Reliability Spike (2/2 plans) — completed 2026-07-04 (live 15/15 `tool_calls`, GO — CTX-06)
- [x] Phase 7: context_explore MCP Tool (2/2 plans) — completed 2026-07-04 (CTX-01/02/03)
- [x] Phase 8: Operating-Layer Wiring (2/2 plans) — completed 2026-07-05 (CTX-04/05)
- [x] Phase 9: Live Verification + A/B Token-Savings (2/2 plans) — completed 2026-07-06 (CTX-07 — ~99.9% byte-savings tight-query anchor, D-03 PASS)

Full detail archived in [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md). Baseline tag: `v1.2`.

</details>

### 🚧 v1.3 Routing Seam & Context Maturation (In Progress)

**Milestone Goal:** Wire cairnkeep to token-miser's routing/tiering surface as a thin, self-consistent public delegate, mature `context_explore` (memory-aware, auto-invoked, cached), and make the OpenCode remember→recall round-trip reliably reproducible headless — without breaching the thin-delegate or no-private-references boundaries.

- [x] **Phase 10: Routing Seam** - Thin, documented delegate to token-miser's routing/tiering surface; no proxy, endpoint, or model config in the core (completed 2026-07-06)
- [x] **Phase 11: Self-Consistency & Public Positioning** - token-miser positioned as a public sibling, docs matched to shipped code, no-private-references guard re-run as a milestone gate (completed 2026-07-06)
- [x] **Phase 12: Context Exploration Maturation** - `context_explore` becomes memory-aware, auto-invoked pre-task, and cache-backed (completed 2026-07-07)
- [x] **Phase 13: Headless Harness Hardening** - The OpenCode `/remember`→`/recall` round-trip reproduces reliably headless, closing the v1.1 OCP-06 gap (completed 2026-07-08)

## Phase Details

### Phase 10: Routing Seam

**Goal**: cairnkeep drives token-miser's routing/tiering surface through a thin, documented delegate — mirroring the `context_explore` subprocess-delegate boundary — with the seam frozen so a future overlay can drive routing unchanged.
**Depends on**: Nothing new (builds on the v1.2 `context_explore` subprocess-delegate pattern, Phase 7)
**Requirements**: RT-01, RT-02
**Success Criteria** (what must be TRUE):

  1. cairnkeep invokes token-miser's routing/tiering surface through one thin delegate call; a grep across `src/` confirms no proxy server, endpoint list, model list, or tier config is hosted in the core.
  2. The routing invocation's call shape and its provider-neutral config keys (env-var driven, no committed defaults) are written up in the operating docs as a stable seam contract.
  3. The seam-contract doc alone is sufficient for an external/private overlay to drive routing without reading cairnkeep's core source.

**Plans**: 2/2 plans complete

- [x] 10-01-PLAN.md — route_check fetch-based delegate + smoke-route-guard + test:smoke wiring (RT-01)
- [x] 10-02-PLAN.md — verify-routing-seam.sh real-binary proof (D-06) + docs/operating.md seam contract (RT-02)

### Phase 11: Self-Consistency & Public Positioning

**Goal**: The docs present token-miser as a public cairnkeep-org sibling, describe the routing surface consistently with the shipped Phase 10 code, and the no-private-references guard passes as an explicit milestone gate.
**Depends on**: Phase 10 (docs describe the routing wire that exists; the guard re-run covers the new surface)
**Requirements**: SC-01, SC-02, SC-03
**Success Criteria** (what must be TRUE):

  1. The docs name, link, and describe token-miser as a public cairnkeep-org sibling project — no framing implies it's a private/vendor dependency.
  2. The operating docs' description of the routing surface and the token-miser relationship matches the Phase 10 shipped code with no drift between prose and behavior.
  3. A full-repo no-private-references scan (code, comments, docs) returns zero hits, run and recorded as an explicit milestone gate.

**Plans**: 4/4 plans complete
**Wave 1**

- [x] 11-01-PLAN.md — no-private-references guard + docs-parity gate scripts (SC-02/SC-03)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 11-02-PLAN.md — clean-slate publish token-miser as a public cairnkeep-org sibling (SC-01)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 11-03-PLAN.md — cairnkeep docs sweep + public-sibling positioning (SC-01/SC-02)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 11-04-PLAN.md — run + record the no-private-references milestone gate (SC-03)

### Phase 12: Context Exploration Maturation

**Goal**: `context_explore` becomes memory-aware, auto-invoked at task start, and cache-backed — without a manual command each time or re-paying token-miser's cost on repeat queries.
**Depends on**: Nothing new (independent of the routing work; builds on the v1.2 `context_explore` tool, Phase 7)
**Requirements**: CTX-08, CTX-09, CTX-10
**Success Criteria** (what must be TRUE):

  1. `context_explore`'s output flags which cited ranges have related hits in `memory_search` and/or the wiki, surfacing the cross-reference alongside the citation.
  2. A pre-task hook auto-invokes `context_explore` for a task's query with no manual `/context-explore` call required.
  3. An identical query against an unchanged repo (same HEAD + dirty-state) returns a cached result instead of re-invoking token-miser; changing the repo invalidates the cache and triggers a fresh call.

**Plans**: 3/3 plans complete

**Wave 1**

- [x] 12-01-PLAN.md — CTX-10: result cache (query + HEAD + dirty-state) + shared `runContextExplore` extraction + `explore` CLI subcommand

**Wave 2** *(depends on 12-01)*

- [x] 12-02-PLAN.md — CTX-08: citation cross-referencing against memory + wiki (cwd-threaded, fail-open, byte-identical zero-hit)

**Wave 3** *(depends on 12-02)*

- [x] 12-03-PLAN.md — CTX-09: UserPromptSubmit auto-invoke hook + composed verify-explore-maturation.sh + docs (env keys, OpenCode parity gap)

### Phase 13: Headless Harness Hardening

**Goal**: The OpenCode `/remember`→`/recall` round-trip reproduces reliably in the scripted headless harness, closing the v1.1 OCP-06 override gap.
**Depends on**: Nothing new (independent; hardens the existing v1.1 harness, Phase 5)
**Requirements**: OCP-07
**Success Criteria** (what must be TRUE):

  1. The scripted headless harness (serve/`--attach` + retry) completes the `/remember`→`/recall` round-trip successfully across repeated runs, not a single lucky pass.
  2. The harness's retry logic absorbs the previously-identified opencode run-completion flakiness without manual operator intervention.
  3. The v1.1 OCP-06 known gap (reliable headless reproduction) is recorded as resolved in MILESTONES.md and REQUIREMENTS.md traceability.

**Plans**: 3/3 plans complete

**Wave 1**

- [x] 13-01-PLAN.md — NDJSON tool-event matcher + run_stage_remember_recall converted to serve/`--attach`, genuine tool-event assertions, infra-only retry (OCP-07; D-08/09/11/13)

**Wave 2** *(depends on 13-01)*

- [x] 13-02-PLAN.md — preflight tool-call probe + `--repeat N` soak (fresh scratch per iteration, evidence table, 5/5 verdict) (OCP-07; D-01/02/03/04/06/12)

**Wave 3** *(depends on 13-02)*

- [x] 13-03-PLAN.md — docs/operating.md trait-based model precondition + MILESTONES.md/REQUIREMENTS.md OCP-06 gap-resolution record (OCP-07; D-04/05/07)

## Progress

| Phase | Milestone | Status | Completed |
|-------|-----------|--------|-----------|
| 1. Configurable git-provider abstraction | v1.0 | Complete | pre-tracking |
| 2. Operating-layer verification | v1.0 | Complete | 2026-07-03 |
| 3. Docs + parity sign-off | v1.0 | Complete | 2026-07-03 |
| 4. OpenCode parity operating layer | v1.1 | Complete | 2026-07-03 |
| 5. Live OpenCode parity verification | v1.1 | Complete (override) | 2026-07-04 |
| 6. FastContext Reliability Spike | v1.2 | Complete | 2026-07-04 |
| 7. context_explore MCP Tool | v1.2 | Complete | 2026-07-04 |
| 8. Operating-Layer Wiring | v1.2 | Complete | 2026-07-05 |
| 9. Live Verification + A/B Token-Savings | v1.2 | Complete | 2026-07-06 |
| 10. Routing Seam | 2/2 | Complete    | 2026-07-06 |
| 11. Self-Consistency & Public Positioning | 4/4 | Complete    | 2026-07-06 |
| 12. Context Exploration Maturation | 3/3 | Complete    | 2026-07-07 |
| 13. Headless Harness Hardening | 3/3 | Complete    | 2026-07-08 |
