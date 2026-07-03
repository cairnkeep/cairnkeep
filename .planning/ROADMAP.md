# Roadmap: Cairnkeep

## Milestones

- ✅ **v1.0 OSS core → parity** — Phases 1-3 (shipped 2026-07-03) — see [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)
- 🚧 **v1.1 OpenCode parity** — Phases 4-5 (in progress)
- 📋 **Enterprise overlay (private)** — planned; wraps the core with organization-specific launchers and config; lives only on the private remote, never in this repo
- 📋 **token-miser integration** — planned; the routing + context-explore sibling, brought in as an optional companion

## Phases

<details>
<summary>✅ v1.0 OSS core → parity (Phases 1-3) — SHIPPED 2026-07-03</summary>

- [x] Phase 1: Configurable git-provider abstraction — completed (pre-plan-tracking)
- [x] Phase 2: Operating-layer verification — completed 2026-07-03
- [x] Phase 3: Docs + parity sign-off — completed 2026-07-03

Full detail archived in [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md). Baseline tag: `v1.0.0`.

</details>

### 🚧 v1.1 OpenCode parity (In Progress)

**Milestone Goal:** Bring the OpenCode operating layer to full drop-in parity with the verified Claude Code path — the same memory-capture and memory-recall lifecycle, the same `remember`/`recall` commands, and a self-sufficient session-start wakeup that stands on its own without Claude assets installed — proven end-to-end by a live OpenCode run.

- [ ] **Phase 4: OpenCode parity operating layer** - Port the memory lifecycle (capture, recall, wakeup) and the `remember`/`recall` commands to OpenCode's plugin model, self-sufficient of Claude assets (all 6 plans executed; awaiting human verification — see 04-UAT.md)
- [ ] **Phase 5: Live OpenCode parity verification** - Prove the full lifecycle plus commands round-trip end-to-end against the registered `cairn-memory` MCP in a live OpenCode session

## Phase Details

### Phase 4: OpenCode parity operating layer

**Goal**: OpenCode gains the same memory lifecycle and memory commands as the verified Claude path — implemented against OpenCode's plugin model (lifecycle handlers, not Claude's shell hooks) and installed via the `sync-opencode-*-assets.sh` scripts — standing on its own with no Claude assets present.
**Depends on**: Phase 3 (the v1.0 Claude baseline is the parity reference)
**Requirements**: OCP-01, OCP-02, OCP-03, OCP-04, OCP-05
**Success Criteria** (what must be TRUE):

  1. Ending an OpenCode session extracts memory candidates into the shared staging area — the same staging the Claude `memory-capture` SessionEnd hook writes to (OCP-01)
  2. Editing or writing a file in OpenCode injects that file's specific memory into context before the edit proceeds, matching the Claude `memory-recall` pre-edit behavior (OCP-02)
  3. Starting an OpenCode session surfaces session-start context — AgentFS memory plus the wiki index plus any open HARD contradictions — with no Claude-rendered assets present on disk (OCP-05)
  4. Running `remember` in OpenCode persists a durable finding across the memory layers (OCP-03)
  5. Running `recall` in OpenCode retrieves known info across the memory layers (OCP-04)

**Plans**: 6/6 plans complete
**Wave 1**

- [x] 04-01-PLAN.md — Wave 1 — spike: injection-mechanism spike + channel decision (OCP-05 de-risk)
- [x] 04-02-PLAN.md — remember + recall commands, wired into sync-opencode-memory-assets.sh (OCP-03, OCP-04)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04-03-PLAN.md — rewrite memory-wakeup.ts native, self-sufficient of Claude assets (OCP-05)
- [x] 04-04-PLAN.md — memory-capture.ts: session-end extract → staging (OCP-01)
- [x] 04-05-PLAN.md — memory-recall.ts: pre-edit file-specific injection (OCP-02)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 04-06-PLAN.md — sync-opencode-plugin-assets.sh INFRA_ROOT rendering + OCP-05 acceptance gate

### Phase 5: Live OpenCode parity verification

**Goal**: The full OpenCode memory lifecycle and commands are proven to round-trip end-to-end in a live OpenCode session against the registered `cairn-memory` MCP — confirming drop-in parity with the Claude path by execution, the same bar v1.0 used.
**Depends on**: Phase 4
**Requirements**: OCP-06
**Success Criteria** (what must be TRUE):

  1. In a live OpenCode session, the wakeup → recall → capture lifecycle runs against the registered `cairn-memory` MCP and each stage produces its expected effect (OCP-06)
  2. `remember` followed by `recall` round-trips a finding within the live session — written on one turn, read back across layers on a later turn (OCP-06)
  3. A fresh install of only the OpenCode assets (no Claude assets on disk) reproduces the full working workflow — drop-in parity confirmed (OCP-06)
  4. The parity run is captured as execution evidence, matching how v1.0 verified the Claude path by execution (OCP-06)

**Plans**: TBD

## Progress

| Phase | Milestone | Status | Completed |
|-------|-----------|--------|-----------|
| 1. Configurable git-provider abstraction | v1.0 | Complete | pre-tracking |
| 2. Operating-layer verification | v1.0 | Complete | 2026-07-03 |
| 3. Docs + parity sign-off | v1.0 | Complete | 2026-07-03 |
| 4. OpenCode parity operating layer | v1.1 | Verifying | - |
| 5. Live OpenCode parity verification | v1.1 | Not started | - |
