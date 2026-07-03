---
phase: 04-opencode-parity-operating-layer
plan: 02
subsystem: operating-layer
tags: [opencode, memory, agentfs, cairn-memory-mcp, command-layer]

# Dependency graph
requires:
  - phase: 04 (plan 01)
    provides: "CHOSEN-CHANNEL: system.transform confirmed viable for OCP-05 wakeup injection"
provides:
  - "opencode/command/remember.md - OpenCode-native durable-fact write command (OCP-03)"
  - "opencode/command/recall.md - OpenCode-native cross-layer read command (OCP-04)"
  - "scripts/sync-opencode-memory-assets.sh extended to install both new commands"
affects: [04-opencode-parity-operating-layer (remaining plans), 05-live-opencode-parity-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "OpenCode command frontmatter tools: boolean map (not Claude allowed-tools: list)"
    - "MCP tool reference by OpenCode surface name: cairn-memory_<tool> (single underscore)"

key-files:
  created:
    - opencode/command/remember.md
    - opencode/command/recall.md
  modified:
    - scripts/sync-opencode-memory-assets.sh

key-decisions:
  - "Per D-06, remember.md drops the Claude-only file-memory layer entirely; AgentFS project scope is the sole durable structured write target for OpenCode"
  - "Per D-07, all layer-agnostic semantics ported verbatim: empty-argument guard, dedupe-before-write, absolute-date conversion, no em/double-hyphen dashes, doc-layer flag-don't-run"
  - "Per D-12, no new sync script; both commands added to the existing sync-opencode-memory-assets.sh ASSETS array"

patterns-established:
  - "OpenCode command port pattern: Claude allowed-tools: list -> OpenCode tools: map; mcp__server__tool -> server_tool"

requirements-completed: [OCP-03, OCP-04]

coverage:
  - id: D1
    description: "opencode/command/remember.md persists a durable finding to AgentFS project scope, dedupes via memory_search, flags (never auto-runs) wiki/AnythingLLM doc layers"
    requirement: "OCP-03"
    verification:
      - kind: other
        ref: "grep -c '^tools:' opencode/command/remember.md == 1 && grep -q cairn-memory_memory_write && !grep -q '^allowed-tools:'"
        status: pass
    human_judgment: true
    rationale: "Static frontmatter/content checks pass, but the command's actual runtime behavior (memory_write round-trip against a live OpenCode session) is unverified until Phase 5 (OCP-06) live verification."
  - id: D2
    description: "opencode/command/recall.md reads AgentFS project scope, then wiki index, then optional AnythingLLM in the documented order, matching Claude recall.md semantics"
    requirement: "OCP-04"
    verification:
      - kind: other
        ref: "grep -c '^tools:' opencode/command/recall.md == 1 && grep -q cairn-memory_memory_search && grep -q domain_knowledge_query && !grep -q '^allowed-tools:'"
        status: pass
    human_judgment: true
    rationale: "Static frontmatter/content checks pass, but the command's actual runtime behavior in a live OpenCode session is unverified until Phase 5 (OCP-06)."
  - id: D3
    description: "scripts/sync-opencode-memory-assets.sh installs both new commands idempotently, no new sync script introduced"
    requirement: "OCP-03"
    verification:
      - kind: integration
        ref: "bash scripts/sync-opencode-memory-assets.sh --apply --live-root <scratch> && --check (both pass); second --apply reports 0 updated / 7 already matched"
        status: pass
    human_judgment: false

# Metrics
duration: 3min
completed: 2026-07-03
status: complete
---

# Phase 4 Plan 2: OpenCode remember/recall commands Summary

**Ported the Claude `remember`/`recall` command semantics to OpenCode-native command markdown (tools: map frontmatter, cairn-memory_* MCP tool names), dropping the Claude-only file-memory layer per D-06 and wiring both into the existing memory-asset sync script.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-07-03T12:44:21Z
- **Completed:** 2026-07-03T12:44:36Z
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `opencode/command/remember.md` — OpenCode write-half command: empty-argument guard, dedupe via `cairn-memory_memory_search`, write/supersede via `cairn-memory_memory_write`/`cairn-memory_memory_supersede` (AgentFS project scope only, no Claude file-memory step), flag-don't-run for wiki/AnythingLLM.
- `opencode/command/recall.md` — OpenCode read-half command: AgentFS (`cairn-memory_memory_search`, retry scope `all`) -> `.planning/wiki/index.md` -> optional `cairn-memory_domain_knowledge_query`, with the same disagreement/staleness reporting rule as Claude's recall.md.
- `scripts/sync-opencode-memory-assets.sh` extended (`ASSETS` array) so both commands install via the existing idempotent `--check`/`--apply` mechanism, no new sync script.

## Task Commits

Each task was committed atomically:

1. **Task 1: Author opencode/command/remember.md (OCP-03)** - `22d674d` (feat)
2. **Task 2: Author opencode/command/recall.md (OCP-04)** - `facf42e` (feat)
3. **Task 3: Wire remember.md and recall.md into sync-opencode-memory-assets.sh** - `f630143` (feat)

**Plan metadata:** (this commit, follows)

## Files Created/Modified
- `opencode/command/remember.md` - OpenCode-native durable-fact write command (AgentFS-only, per D-06)
- `opencode/command/recall.md` - OpenCode-native cross-layer read command
- `scripts/sync-opencode-memory-assets.sh` - `ASSETS` array extended with `command/remember.md` and `command/recall.md`

## Decisions Made
None beyond the plan's locked decisions (D-06, D-07, D-12) — executed exactly as specified. Both commands use the `tools:` boolean-map frontmatter house style from `opencode/command/memory-sync.md`, and MCP tools are referenced by their OpenCode surface name (`cairn-memory_memory_write`, `cairn-memory_memory_search`, `cairn-memory_memory_supersede`, `cairn-memory_domain_knowledge_query`) rather than Claude's `mcp__server__tool` form.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both commands are static-verified (frontmatter shape, MCP tool naming, sync-script installability) but not yet exercised in a live OpenCode session — that live round-trip (write a fact via `/remember`, retrieve it via `/recall`) is explicitly Phase 5's OCP-06 scope, not this plan's.
- Remaining Phase 4 plans (OCP-01 capture, OCP-02 recall injection, OCP-05 wakeup rewrite) are unblocked by this plan; no shared file conflicts.

---
*Phase: 04-opencode-parity-operating-layer*
*Completed: 2026-07-03*

## Self-Check: PASSED

All created files found on disk; all three task commit hashes (22d674d, facf42e, f630143) found in git log.
