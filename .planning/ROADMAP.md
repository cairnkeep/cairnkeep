# Roadmap: Cairnkeep

## Milestones

- ✅ **v1.0 OSS core → parity** — Phases 1-3 (shipped 2026-07-03) — see [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 OpenCode parity** — Phases 4-5 (shipped 2026-07-04) — see [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Context Exploration (token-miser + FastContext)** — Phases 6-9 (shipped 2026-07-06) — see [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)
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

<details>
<summary>✅ v1.2 Context Exploration (Phases 6-9) — SHIPPED 2026-07-06</summary>

- [x] Phase 6: FastContext Reliability Spike (2/2 plans) — completed 2026-07-04 (live 15/15 `tool_calls`, GO — CTX-06)
- [x] Phase 7: context_explore MCP Tool (2/2 plans) — completed 2026-07-04 (CTX-01/02/03)
- [x] Phase 8: Operating-Layer Wiring (2/2 plans) — completed 2026-07-05 (CTX-04/05)
- [x] Phase 9: Live Verification + A/B Token-Savings (2/2 plans) — completed 2026-07-06 (CTX-07 — ~99.9% byte-savings tight-query anchor, D-03 PASS)

Full detail archived in [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md). Baseline tag: `v1.2`.

</details>

## Progress

| Phase | Milestone | Status | Completed |
| ----- | --------- | ------ | --------- |
| 1. Configurable git-provider abstraction | v1.0 | Complete | pre-tracking |
| 2. Operating-layer verification | v1.0 | Complete | 2026-07-03 |
| 3. Docs + parity sign-off | v1.0 | Complete | 2026-07-03 |
| 4. OpenCode parity operating layer | v1.1 | Complete | 2026-07-03 |
| 5. Live OpenCode parity verification | v1.1 | Complete (override) | 2026-07-04 |
| 6. FastContext Reliability Spike | v1.2 | Complete | 2026-07-04 |
| 7. context_explore MCP Tool | v1.2 | Complete | 2026-07-04 |
| 8. Operating-Layer Wiring | v1.2 | Complete | 2026-07-05 |
| 9. Live Verification + A/B Token-Savings | v1.2 | Complete | 2026-07-06 |
