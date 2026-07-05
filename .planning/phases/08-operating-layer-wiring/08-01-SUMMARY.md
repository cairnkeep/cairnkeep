---
phase: 08-operating-layer-wiring
plan: 01
subsystem: operating-layer
tags: [claude-code, opencode, mcp, slash-command, context-explore]

# Dependency graph
requires:
  - phase: 07-context-explore-mcp-tool
    provides: the registered `context_explore` MCP tool (query/repo_root/timeout_seconds inputSchema, citations-only text output)
provides:
  - "claude/commands/context-explore.md — Claude Code /context-explore slash command"
  - "opencode/command/context-explore.md — OpenCode /context-explore slash command"
affects: [08-02-opencode-install, phase-9-live-verification]

# Tech tracking
tech-stack:
  added: []
  patterns: [direct-inline-mcp-call-command (mirrors recall.md, not the wiki-query agent-dispatch pattern)]

key-files:
  created:
    - claude/commands/context-explore.md
    - opencode/command/context-explore.md
  modified: []

key-decisions:
  - "Followed D-01: direct inline tool call, no paired sub-agent/workflow file."
  - "Followed D-02: allowed-tools/tools grants exclude Read/Grep/Glob so citations cannot be auto-expanded by the command itself."
  - "Followed D-03: repo_root always resolved via git rev-parse --show-toplevel (+ optional path-arg override) and passed explicitly, never left to cwd or CAIRN_EXPLORE_REPO_ROOT."

patterns-established:
  - "Harness-specific tool-naming: Claude uses comma-list `allowed-tools: Bash, mcp__cairn-memory__<tool>`; OpenCode uses YAML `tools:` map with `<server>_<tool>: true` (single underscore, no mcp__ prefix)."

requirements-completed: [CTX-04, CTX-05]

coverage:
  - id: D1
    description: "Claude Code /context-explore command invokes context_explore directly and relays citations, granting only Bash + the MCP tool"
    requirement: "CTX-04"
    verification:
      - kind: other
        ref: "grep-based structural check: allowed-tools line, repo-root block, repo_root token, DEC-no-private-references negative scan — all pass"
        status: pass
    human_judgment: false
  - id: D2
    description: "OpenCode /context-explore command mirrors the Claude command body, self-contained (no agent/workflow file), tools: map grants only bash + cairn-memory_context_explore"
    requirement: "CTX-05"
    verification:
      - kind: other
        ref: "grep-based structural check: tools: map entries (exactly 2), repo-root block, repo_root token, body-diff match against Claude sibling, DEC-no-private-references negative scan — all pass"
        status: pass
    human_judgment: false
  - id: D3
    description: "Live end-to-end invocation against a running FastContext endpoint (real citations from a real query)"
    verification: []
    human_judgment: true
    rationale: "Deferred by plan design to Phase 9 (CTX-07), consistent with how Phases 5-7 deferred live-model-dependent checks. This plan only builds and structurally verifies the command files."

# Metrics
duration: 8min
completed: 2026-07-05
status: complete
---

# Phase 8 Plan 01: Operating-Layer Commands Summary

**Paired `/context-explore` slash commands for Claude Code and OpenCode that call the Phase 7 `context_explore` MCP tool directly and relay its compact citations, with no auto-read of cited ranges.**

## Performance

- **Duration:** 8 min
- **Completed:** 2026-07-05
- **Tasks:** 2
- **Files modified:** 2 (both new)

## Accomplishments
- Created `claude/commands/context-explore.md`: `allowed-tools: Bash, mcp__cairn-memory__context_explore` only, resolves `repo_root` via `git rev-parse --show-toplevel` (+ optional path override), relays `context_explore`'s citation text verbatim with a one-line error pass-through on failure.
- Created `opencode/command/context-explore.md`: self-contained sibling (no agent/workflow file) with the OpenCode `tools:` map form (`bash: true`, `cairn-memory_context_explore: true`), identical body to the Claude command.
- Both files pass the `DEC-no-private-references` negative grep scan (no endpoint/model/host/IP/vendor default).

## Task Commits

Each task was committed atomically:

1. **Task 1: Create the Claude Code /context-explore command (CTX-04)** - `52bfaf8` (feat)
2. **Task 2: Create the OpenCode /context-explore command (CTX-05, command half)** - `c25e4de` (feat)

**Plan metadata:** committed separately by the orchestrator's post-merge state-update step (worktree mode — this executor does not touch STATE.md/ROADMAP.md).

## Files Created/Modified
- `claude/commands/context-explore.md` - Claude Code direct-call slash command invoking `context_explore`
- `opencode/command/context-explore.md` - OpenCode direct-call slash command invoking `context_explore`, self-contained

## Decisions Made
None — plan executed exactly as written, structure and frontmatter shape both taken verbatim from the `recall.md` analog per 08-PATTERNS.md.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required. (`CAIRN_EXPLORE_BINARY` / endpoint config is owned by Phase 7/token-miser, not this plan.)

## Next Phase Readiness
- CTX-04 (Claude command) and the command half of CTX-05 are complete and structurally verified.
- Plan 02 still needs to install the OpenCode command via a new `sync-opencode-explore-assets.sh` script (the OpenCode command file exists but is not yet wired into the install pipeline).
- Live end-to-end invocation against a running FastContext endpoint remains Phase 9's CTX-07 gate — not attempted here by design.

---
*Phase: 08-operating-layer-wiring*
*Completed: 2026-07-05*

## Self-Check: PASSED

- FOUND: claude/commands/context-explore.md
- FOUND: opencode/command/context-explore.md
- FOUND commit: 52bfaf8
- FOUND commit: c25e4de
- FOUND commit: 66fc56d
