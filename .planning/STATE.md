---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: OpenCode parity
current_phase: 05
current_phase_name: live-opencode-parity-verification
status: verifying
stopped_at: Completed 05-03-PLAN.md (via D-01 fallback); phase 05 ready for verification
last_updated: "2026-07-03T23:11:21.074Z"
last_activity: 2026-07-03
last_activity_desc: Phase 05 execution started
progress:
  total_phases: 2
  completed_phases: 2
  total_plans: 9
  completed_plans: 9
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-03)

**Core value:** Drop-in parity — a fresh `cairn bootstrap` plus the carved commands, agents, and hooks reproduce the originating private workflow end-to-end, verified against the `cairn-memory` MCP server.
**Current focus:** Phase 05 — live-opencode-parity-verification

## Current Position

Phase: 05 (live-opencode-parity-verification) — EXECUTING
Plan: 3 of 3
Status: Phase complete — ready for verification
Last activity: 2026-07-03 — Phase 05 execution started

### Owed to Phase 5 (carried from Phase 4)

- ⚠️ **OCP-01/02/03/04 live round-trip** — Phase 4 shipped these as implementation + install wiring only; the live proof (capture stages real candidates, recall-on-edit throws context, `remember` persists via live MCP, `recall` retrieves) is Phase 5's OCP-06 scope. Tracked in `04-UAT.md` test 2.

### v1.1 roadmap (2026-07-03)

Two phases, continuing the sequential numbering from v1.0 (ended at Phase 3):

- **Phase 4 — OpenCode parity operating layer** (OCP-01, OCP-02, OCP-03, OCP-04, OCP-05): port the memory-capture (SessionEnd) and memory-recall (pre-edit) lifecycle plus the `remember`/`recall` commands to OpenCode's plugin model, and make `memory-wakeup` self-sufficient of Claude-rendered assets. Installs via the `sync-opencode-*-assets.sh` scripts.
- **Phase 5 — Live OpenCode parity verification** (OCP-06): prove the full wakeup → recall → capture lifecycle and the commands round-trip against the registered `cairn-memory` MCP in a live OpenCode session — the same verify-by-execution bar v1.0 used for the Claude path.

### Phase 3 results (2026-07-03)

- **Operating guide** — `docs/operating.md` written: full setup order (build + register `cairn-memory` MCP → install operating layer → configure `.ai/.env` → launch), a workflow reference for every command/hook, and the config table. Satisfies Phase 3 criterion 1.
- **Fresh-bootstrap parity** — verified. `cairn bootstrap` writes `.ai/` + `.planning/`; the operating layer is reproduced by `sync-claude-assets.sh --apply` (confirmed into a scratch `--live-root`: 10 commands, 7 agents, 3 hooks registered on the right events, idempotent re-check clean). The gap was purely that this install step was undocumented — now fixed in README + the bootstrap next-steps output. Satisfies criterion 2.
- **Hygiene** — Apache-2.0 LICENSE present, CI (`ci.yml`) builds + tests the memory server on push/PR, no tracked secrets or `.env`, no attribution noise. Satisfies criterion 4.
- **Baseline tag (criterion 3)** — DONE. Annotated tag `v1.0.0` at HEAD; all security follow-ups closed before sign-off.

Known OpenCode-side gap (documented, not fixed at v1.0 — now the v1.1 milestone target): the OpenCode memory lifecycle (capture/recall) and self-sufficient wakeup are the parity work carried into v1.1. Claude Code is the complete, verified path.

### Phase 2 verification results (2026-07-03)

All flows exercised end-to-end against the registered `cairn-memory` MCP and now pass:

- **Memory MCP round-trip** — write/read/list/search/delete confirmed. Fixed: `memory_read` published an empty tool schema (ZodEffects `.refine()` wrapper); moved the exactly-one-of check into the handler.
- **Provider neutrality** — removed a hardcoded vendor embedding-model default; the model name is now required for semantic search, else substring fallback.
- **remember / recall** — AgentFS + file-memory write and cross-layer read confirmed.
- **memory-sync / memory-review** — routed the PR-state read through the provider operation map (was a hardcoded GitHub path); fixed the memory-review MCP tool allowlist; both default cleanly when the provider is unset/`none`.
- **Memory hooks (wakeup / capture / recall)** — capture → staging → wakeup surfacing → memory-review accept-gate round-trip confirmed. Fixed a shell test-guard bug in `memory-recall.sh`; re-synced live hooks via `sync-claude-assets.sh`.
- **wiki-ingest / wiki-query / wiki-lint** — seeded the wiki from `docs/git-providers.md`, wrote back a cited query answer, and ran a clean lint pass (0 findings).
- **security-audit** — full selector → investigator → validator chain produced accepted finding **SEC-0001** (memory scope path traversal). Fixed with a kebab-case scope allowlist + base-dir containment; regression-tested by `smoke-scope-guard.mjs`.
- **repo-review** — reviewed the session's own diff; caught a Medium in the SEC-0001 fix (an ineffective `resolve===join` containment guard). Hardened it with `relative()`-based containment.

All follow-ups since resolved on 2026-07-03: HTTP-transport hardening for the opt-in `MCP_HTTP_PORT` mode (auth, CORS, DNS-rebinding) — SEC-0001 fully closed; and the `scope:"all"` write/read asymmetry (REVIEW.md finding 3) — `"all"` now rejected on write/list/delete/supersede/history paths. No open review or security items.

## Performance Metrics

**Velocity:**

- Total plans completed: 6 (Phase 1 delivered before plan tracking)
- Average duration: -
- Total execution time: -

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Configurable git-provider abstraction | pre-tracking | - | - |
| 04 | 6 | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 04 P01 | 25 | 2 tasks | 1 files |
| Phase 04 P02 | 3min | 3 tasks | 3 files |
| Phase 04 P03 | 5min | 1 tasks | 1 files |
| Phase 04 P04 | 15min | 2 tasks | 1 files |
| Phase 04 P05 | 20min | 1 tasks | 1 files |
| Phase 04 P06 | 45min | 2 tasks | 2 files |
| Phase 05 P01 | 55min | 2 tasks | 1 files |
| Phase 05 P02 | 79min | 3 tasks | 2 files |
| Phase 05 P03 | 95min | 3 tasks tasks | 3 files files |

## Accumulated Context

### Decisions

Locked hard rules live in the PROJECT.md decisions block: DEC-no-private-references, DEC-no-ai-authorship, DEC-commit-scanning.
Recent decisions affecting current work:

- Phase 1: Git host resolved via one provider config key + per-provider operation→tool map; collaboration commands never assume a specific host
- v1.1: OpenCode parity for capture/recall is implemented as OpenCode plugin lifecycle handlers (not Claude shell hooks); `memory-wakeup` must be self-sufficient of Claude-rendered assets (per the PROJECT.md v1.1 decision).
- [Phase 04]: OCP-05 injection channel = system.transform (empirically confirmed against installed OpenCode CLI v1.17.11; instruction-file fallback not needed)
- [Phase 04]: OpenCode remember/recall commands port: AgentFS-only per D-06 (Claude file-memory layer dropped), verbatim layer-agnostic semantics per D-07
- [Phase 04]: OCP-05 wakeup resolves project root via PluginInput.directory (not process.cwd()) to avoid a cwd/repo-root mismatch
- [Phase 04]: OpenCode memory-capture uses client.session.get() to filter subagent subsessions via parentID, since session.idle's event payload only carries sessionID
- [Phase 04]: memory-capture dedupe Set is marked before the extract call, capping each top-level session at exactly one extraction attempt regardless of outcome (fail-open, no retry loop)
- [Phase 04]: OCP-02 dedupe key is sessionID:filePath (not filePath alone) so recall re-arms per distinct session, matching memory-wakeup.ts's per-session semantics
- [Phase 04]: OCP-02 recall plugin's catch block re-throws only its own intentional surface-context Error (prefix-matched), swallowing all other errors to stay fail-open (D-03)
- [Phase 04-06]: OCP-05 hard bar proven by execution — OpenCode wakeup surfaces AgentFS memory with no reachable ~/.claude (Run A/B canary confirmed); removed memory-wakeup's per-session dedupe Set since experimental.chat.system.transform fires more than once per session (title-gen call shares sessionID with the real turn) and output.system is a fresh array per call
- [Phase 05-01]: session.idle does not double-fire and never fires before real messages exist (confirmed live, v1.17.11); memory-capture.ts dedupe needs no fix
- [Phase 05-01]: opencode run --format json carries the session ID as the top-level field sessionID on every streamed event
- [Phase 05-01]: installed OpenCode CLI has no --auto flag; harness uses --dangerously-skip-permissions instead
- [Phase 05-02]: memory-capture.ts stdin-writer crash fixed (D-03/OCP-06 defect clause); opencode-run process-exit race worked around via opencode serve + --attach at the harness level (no plugin change)
- [Phase 05-02]: Discovered live-model reliability gap: /recall does not drive a real memory_search/_read tool call with the configured local model in headless opencode run (write-oriented calls remained reliable); carried forward to 05-03's interactive-session fallback per D-01
- [Phase 05-03] OCP-04 recall read-back is an open, root-caused model-reliability limitation: qwen3.6-27b-coder is a thinking model whose reasoning leaks as narrated pseudo-tool-calls; not a defect in recall.md/remember.md/cairn-memory/harness
- [Phase 05-03] Interactive TUI session (D-01) resolved via harness-only fallback clause (headless operator, no TTY); recorded as explicit fallback-gap in 05-UAT.md Test 5
- [Phase 05-03] docs/operating.md corrected: OpenCode memory-wakeup plugin is self-sufficient of Claude assets (Phase-4 D-04); stale precondition removed

### Pending Todos

- Plan Phase 5 (Live OpenCode parity verification, OCP-06) via `/gsd-plan-phase 5`.

### Done since (2026-07-03)

- SEC-0001 HTTP-transport hardening: fail-closed bearer-token auth, per-origin CORS, Host-header/DNS-rebinding validation; regression-tested by `smoke-http-guard.mjs`. SEC-0001 remediation is now fully closed.
- Added `sync-opencode-memory-assets.sh` so OpenCode's memory/review commands install like the other asset families (guide caveat removed).
- Fixed the `scope:"all"` write/read asymmetry (REVIEW.md finding 3): `resolveScopePath` rejects `"all"` on the write/list/delete/supersede/history paths (it is a read-only fan-out scope); regression-tested in `smoke-scope-guard.mjs`.

### Blockers/Concerns

Phase 4 (OCP-01, OCP-02, OCP-03, OCP-04, OCP-05) complete; ready to plan Phase 5 (OCP-06).

- 05-02/05-03 live stages require operator to configure a reachable local OpenAI-compatible endpoint plus CAIRN_LLM_API_KEY/CAIRN_LLM_API_URL/CAIRN_LLM_EXTRACTION_MODEL (e.g. via .ai/.env) before executing
- 05-02: local model endpoint (127.0.0.1:8001) went down mid-session and did not recover; recall stage + full negative-control sweep need re-verification once the endpoint is confirmed reachable again

## Deferred Items

Items acknowledged and carried forward:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Milestone | Enterprise overlay (private-only, never in this repo) | Planned | 2026-07-03 |
| Milestone | token-miser integration (optional companion) | Planned | 2026-07-03 |

## Session Continuity

Last session: 2026-07-03T23:11:21.068Z
Stopped at: Completed 05-03-PLAN.md (via D-01 fallback); phase 05 ready for verification
Resume file: None

## Operator Next Steps

- Plan Phase 5 (Live OpenCode parity verification, OCP-06) with /gsd-plan-phase 5
