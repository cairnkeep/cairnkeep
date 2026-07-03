---
phase: 04-opencode-parity-operating-layer
plan: 03
subsystem: infra
tags: [opencode, plugin, memory-wakeup, agentfs, cairn-memory]

# Dependency graph
requires:
  - phase: 04-opencode-parity-operating-layer (plan 01, spike)
    provides: "CHOSEN-CHANNEL: system.transform decision (04-SPIKE-INJECTION.md) and client.session.messages() shape"
provides:
  - "opencode/plugins/memory-wakeup.ts natively surfaces AgentFS memory, wiki index, open HARD contradictions, and staged-candidates count with no ~/.claude shell-out"
affects: ["04-06 (install wiring / INFRA_ROOT rendering)", "05 (live OpenCode parity verification)"]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Native TS reimplementation of a Claude shell hook, calling the shared cairn-memory server subcommand directly instead of shelling out to a rendered Claude asset"]

key-files:
  created: []
  modified: ["opencode/plugins/memory-wakeup.ts"]

key-decisions:
  - "Resolved the plugin's project root via PluginInput.directory (not process.cwd()), matching D-05's guidance to avoid a cwd/root mismatch"
  - "SERVER_ENTRY keeps the literal @@INFRA_ROOT@@ token unrendered — rendering is Plan 04-06's job in the sync script, mirroring the Claude hook's sed substitution"

patterns-established:
  - "Fail-open native plugin body wrapped in try/catch; guard on .agentfs/project.db or .planning/wiki/index.md before doing any work"

requirements-completed: [OCP-05]

coverage:
  - id: D1
    description: "memory-wakeup.ts reimplemented natively: resolves the server via @@INFRA_ROOT@@, assembles AgentFS memory / wiki index / open HARD contradictions / staged-candidates count, keeps once-per-session dedupe and fail-open try/catch, no ~/.claude shell-out"
    requirement: "OCP-05"
    verification:
      - kind: other
        ref: "grep checks (@@INFRA_ROOT@@, mcp-memory-server/dist/index.js, surfaced, catch, no homedir) — all passed"
        status: pass
      - kind: other
        ref: "cd mcp-memory-server && npm run check:extract"
        status: pass
      - kind: other
        ref: "cd mcp-memory-server && npm run typecheck"
        status: pass
    human_judgment: true
    rationale: "The hard acceptance bar (delete ~/.claude, live OpenCode session still surfaces memory via experimental.chat.system.transform) is a live-session check deferred to Plan 04-06 per the plan's own <done> criterion; this plan's automated checks only prove the source-level contract, not runtime delivery to the model."

# Metrics
duration: 5min
completed: 2026-07-03
status: complete
---

# Phase 4 Plan 03: Native OpenCode memory-wakeup Summary

**Rewrote `opencode/plugins/memory-wakeup.ts` to surface AgentFS memory, the wiki index, open HARD contradictions, and staged-candidates count natively, removing the last `~/.claude` shell-out from the OpenCode wakeup path.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-03T12:48:44Z
- **Completed:** 2026-07-03T12:53:54Z
- **Tasks:** 1 completed
- **Files modified:** 1

## Accomplishments
- `memory-wakeup.ts` no longer imports `node:os` or shells out to `bash ~/.claude/hooks/memory-wakeup.sh`; it calls `node @@INFRA_ROOT@@/mcp-memory-server/dist/index.js wakeup` directly via the plugin's `$` shell handle.
- All four session-start sections are assembled natively in TypeScript: `## Project memory (AgentFS)`, `## Wiki index`, `## Open HARD contradictions — resolve before dependent work` (parsed from the `wiki:contradictions:open:start`/`end` region, filtered to `severity: hard` lines), and `## Staged memory candidates (N session(s)) — UNREVIEWED`.
- The guard (`.agentfs/project.db` OR `.planning/wiki/index.md` must exist) now resolves against `PluginInput.directory` instead of `process.cwd()`, avoiding a cwd/project-root mismatch.
- Once-per-session `surfaced` Set dedupe and the `experimental.chat.system.transform` injection channel (the CHOSEN-CHANNEL confirmed by the 04-01 spike) are both preserved unchanged.
- The whole hook body remains wrapped in `try/catch` — fail-open per D-03.

## Task Commits

Each task was committed atomically:

1. **Task 1: Reimplement memory-wakeup.ts natively (D-04)** - `4aff55f` (feat)

**Plan metadata:** commit created below (docs: complete plan)

## Files Created/Modified
- `opencode/plugins/memory-wakeup.ts` - Rewritten to call the shared `cairn-memory` server directly, assemble all four wakeup sections in native TS, and resolve the project root via `PluginInput.directory`; no more Claude-asset dependency.

## Decisions Made
- Used `PluginInput.directory` (the field OpenCode's `@opencode-ai/plugin` type passes into the plugin factory) as the repo-root reference for the guard-file checks, rather than `process.cwd()`, per D-05's caution about cwd/root divergence.
- Left `SERVER_ENTRY` as the literal, unrendered `@@INFRA_ROOT@@/mcp-memory-server/dist/index.js` token — Plan 04-06 owns adding the `sed`-style rendering step to `sync-opencode-plugin-assets.sh` (mirroring `sync-claude-assets.sh`'s existing substitution), so this plan does not touch the sync script.
- For the AgentFS and wiki sections, the section header is always emitted when the guard file exists (matching `memory-wakeup.sh`'s unconditional `echo` behavior), with the body appended only if non-empty — preserves parity with the Claude reference while avoiding a header with literally nothing under it when content is empty.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`memory-wakeup.ts` is fully self-sufficient of Claude assets at the source level (verified: no `homedir` import, no shell-out to `~/.claude`, `@@INFRA_ROOT@@` token present, `mcp-memory-server` contract untouched — `npm run check:extract` and `npm run typecheck` both pass).

Remaining before OCP-05 is fully closed: Plan 04-06 must (a) add the `@@INFRA_ROOT@@` rendering step to `scripts/sync-opencode-plugin-assets.sh`, and (b) run the live "delete `~/.claude`, start an OpenCode session, confirm wakeup still surfaces" acceptance test — this plan only proves the reimplementation is correct at the source/contract level, not that it round-trips live against a real OpenCode session (that live proof is explicitly deferred to 04-06 / Phase 5's OCP-06 per the plan's own `<verification>` section).

No blockers for Wave 2/3 plans in this phase.

## Self-Check: PASSED

- FOUND: opencode/plugins/memory-wakeup.ts
- FOUND: 4aff55f

---
*Phase: 04-opencode-parity-operating-layer*
*Completed: 2026-07-03*
