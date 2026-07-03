---
phase: 04-opencode-parity-operating-layer
plan: 04
subsystem: operating-layer
tags: [opencode, plugin, memory-capture, session.idle, bun-shell, mcp-memory-server]

# Dependency graph
requires:
  - phase: 04-opencode-parity-operating-layer (plan 01, spike)
    provides: confirmed client.session.messages() shape ({ data: [{ info, parts }] }, role at info.role, parts pre-joined)
provides:
  - "opencode/plugins/memory-capture.ts — OCP-01 session-end memory-candidate extraction and staging"
affects: [04-05, 04-06, 05-live-opencode-parity-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "session.idle + client.session.get() parentID filter as OpenCode's SessionEnd substitute"
    - "Bun $ shell stdin piping (writer.write/close on shellPromise.stdin) to avoid shell-interpolating untrusted session text"

key-files:
  created: [opencode/plugins/memory-capture.ts]
  modified: []

key-decisions:
  - "Dedupe Set is marked before the extract call (not after success), capping each top-level session at exactly one extraction attempt regardless of outcome — matches Pitfall 3's fail-open/no-retry guidance"
  - "parentID is not present on the session.idle event payload itself; fetched via a client.session.get() call to filter subagent subsessions"
  - "Staged file is written verbatim from the extract subcommand's stdout string (not re-serialized through JSON.parse/stringify) to guarantee byte-identical output to claude/hooks/memory-capture.sh's contract"

patterns-established:
  - "OpenCode session-end capture: session.idle -> session.get (parentID filter) -> session.messages -> extract via stdin -> stage with retention cap"

requirements-completed: [OCP-01]

coverage:
  - id: D1
    description: "opencode/plugins/memory-capture.ts stages one candidates JSON per top-level session end, matching the Claude memory-capture.sh contract, with env guards, subagent/dedupe filtering, and the 5-session retention cap"
    requirement: "OCP-01"
    verification:
      - kind: other
        ref: "grep-based acceptance checks (session.idle, parentID, CAIRN_LLM_API_KEY, CAIRN_LLM_EXTRACTION_MODEL, session.messages present; no direct opencode storage reads) — all pass"
        status: pass
      - kind: other
        ref: "cd mcp-memory-server && npm run check:extract (shared extract CLI contract unchanged)"
        status: pass
    human_judgment: true
    rationale: "Live single-session staging (a real OpenCode session ending and a candidates JSON actually appearing in .planning/memory-staging/) is explicitly scoped to Plan 04-06 / Phase 5 per this plan's own <verification> section — this plan's automated checks confirm the code shape and guards, not a live round trip."

duration: 15min
completed: 2026-07-03
status: complete
---

# Phase 04 Plan 04: OpenCode memory-capture plugin Summary

**`opencode/plugins/memory-capture.ts` extracts memory candidates on OpenCode session-end (`session.idle`, subagent-filtered, deduped) and stages them to `.planning/memory-staging/` byte-compatible with the Claude `memory-capture.sh` contract.**

## Performance

- **Duration:** 15 min
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Built the `session.idle` trigger with subagent (`parentID`) filtering via `client.session.get()` and a per-`sessionID` dedupe `Set`, since the `session.idle` event payload itself carries only `sessionID`
- Reimplemented `transcript-to-text.mjs`'s behavior (skip tool/reasoning/file noise, join user/assistant text in order, cap at the most recent 12000 chars) against OpenCode's `{ info, parts }` message shape from `client.session.messages()`
- Piped the assembled session text into `node <server> extract <model>` via the Bun `$` shell's `stdin` `WritableStream` (never string-interpolated) — the T-04-01 injection mitigation
- Wrote the extract subcommand's output verbatim to `.planning/memory-staging/<UTCstamp>.json` and enforced the 5-newest retention cap after each write

## Task Commits

Each task was committed atomically. Both tasks landed in a single commit because Task 2 built directly on top of the file Task 1 created (same acceptance-criteria surface, no intermediate stable state worth splitting):

1. **Tasks 1+2: session-end trigger, message-to-text conversion, extract+stage with retention cap** - `3c65c21` (feat)

## Files Created/Modified
- `opencode/plugins/memory-capture.ts` - `session.idle` handler: subagent/dedupe filtering, message-to-text conversion, stdin-piped extract call, verbatim staging write with 5-session retention cap

## Decisions Made
- Marked the per-`sessionID` dedupe entry immediately after confirming a top-level session (before running the extract call), so each real working session gets exactly one extraction attempt total — consistent with Pitfall 3's "missing staged file is a tolerated degraded outcome, not a retry loop" guidance, rather than retrying on every subsequent `session.idle` fire within the same session.
- Used `client.session.get({ path: { id } })` to obtain `parentID`, since inspection of the `@opencode-ai/sdk` type definitions confirmed `EventSessionIdle.properties` carries only `sessionID` — the plan's guidance to "filter to top-level sessions... ignore any session that carries a parentID" required an extra lookup call not spelled out in the plan text, since the idle event itself doesn't carry it.
- Wrote the staged file directly from the extract subcommand's raw stdout string (after only a read-only `JSON.parse` count check) rather than re-serializing a parsed object, to guarantee the staged bytes are verbatim-identical to what the server emitted, matching D-08's contract precisely.

## Deviations from Plan

None - plan executed as written. The `client.session.get()` parentID lookup (see Decisions Made) is an implementation detail filling in a gap the plan flagged as "Claude's Discretion" (exact TS structure left to the executor), not a deviation from an explicit instruction.

## Issues Encountered
- Initial draft included a code comment referencing the literal string `~/.local/share/opencode/storage` (the Anti-Pattern path this plugin must avoid reading from); the plan's automated verify command greps for the absence of that exact string anywhere in the file, including comments, so it was reworded to describe the same anti-pattern without the literal substring. Verified via re-running the plan's `<verify>` command until it passed cleanly.

## User Setup Required

None - no external service configuration required. (`CAIRN_LLM_API_KEY` / `CAIRN_LLM_EXTRACTION_MODEL` are the same env vars the Claude path already documents in `docs/operating.md`.)

## Next Phase Readiness
- `opencode/plugins/memory-capture.ts` is ready to be wired into `scripts/sync-opencode-plugin-assets.sh`'s `ASSETS[]` array and have `@@INFRA_ROOT@@` rendering added, per D-12 and Pitfall 5 — both are Plan 04-06 scope, not this plan's.
- Live single-session staging verification (a real OpenCode session ending and a candidates file appearing) is explicitly deferred to Plan 04-06 / Phase 5 (OCP-06), consistent with this plan's `<verification>` section.
- No blockers for Wave 2's remaining plans (04-05 recall, 04-06 install wiring).

---
*Phase: 04-opencode-parity-operating-layer*
*Completed: 2026-07-03*
