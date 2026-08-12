---
phase: 26-guided-setup-and-harness-onboarding
plan: "05"
subsystem: mcp-pi-bridge
tags: [pi, mcp, stdio, lifecycle, cancellation, trust]
requires:
  - phase: 26-01
    provides: Dynamic Pi bridge RED smoke and exact Pi 0.84.1 fixture
provides:
  - Supervised local stdio MCP client adapter for Pi
  - Dynamic server-authorized Pi tool registration
  - Bounded Pi call, cancellation, crash, and shutdown lifecycle
  - Routine Pi bridge smoke composition in the server suite
affects: [26-06, 26-07, 26-08, 26-09]
tech-stack:
  added: []
  patterns: [dynamic MCP discovery, bounded stdio supervision, package-root extension import, tools-only Pi binding]
key-files:
  created:
    - mcp-memory-server/src/pi-mcp-bridge.ts
    - pi/extensions/cairnkeep-memory.ts
  modified:
    - mcp-memory-server/package.json
key-decisions:
  - The MCP server remains the sole catalog/profile authority; the bridge stores only the dynamically returned session catalog.
  - Exact annotations and output schemas remain in trusted call details because Pi 0.84.1 has no native annotations slot.
  - The copied Pi extension imports the compiled adapter from the rendered Cairnkeep package root and installs no Pi-local dependencies.
metrics:
  duration: 8m
  completed: 2026-08-12
status: complete
---

# Phase 26 Plan 05: First-Party Pi MCP Bridge Summary

Pi now discovers and calls the exact server-authorized local stdio catalog through a bounded package-owned bridge, with exact trusted metadata, per-call cancellation, collision refusal, and orphan-free lifecycle shutdown.

## Performance

- **Duration:** 8 minutes
- **Started:** 2026-08-12T10:06:54Z
- **Completed:** 2026-08-12T10:14:46Z
- **Tasks:** 2
- **Files changed:** 3

## Accomplishments

- Implemented paginated dynamic MCP discovery for full, read-only, and custom effective server profiles without a second tool allowlist.
- Added finite startup/call limits, bounded stderr and result handling, per-call cancellation, conservative text/image conversion, crash fan-out, shared idempotent close, and child-exit state transitions.
- Preserved complete returned tool records, exact annotations/output schemas, original MCP content, structured content, result metadata, and error state in trusted Pi details.
- Added a thin Pi extension that resolves the compiled package adapter, refuses existing-name collisions before registration, forwards Pi abort signals, and registers no prompts, commands, loops, skills, or remote access.
- Added `check:pi-mcp-bridge` beside the MCP trust gate and composed it into the routine server smoke suite with no dependency or lockfile changes.

## Task Commits

1. **Task 1: Implement supervised dynamic MCP discovery and calls** - `b8a73f7`
2. **Task 2: Bind the adapter to Pi session lifecycle without Pi-local dependencies** - `a26fa75`
3. **Lifecycle correctness fix** - `7a5894a`

## Files Created/Modified

- `mcp-memory-server/src/pi-mcp-bridge.ts` - Supervised MCP client, dynamic catalog, bounded result adapter, and lifecycle state machine.
- `pi/extensions/cairnkeep-memory.ts` - Thin package-root Pi session binding and dynamic tool registration.
- `mcp-memory-server/package.json` - Named bridge smoke command and routine suite composition.

## Decisions Made

- Default production transport is the fixed local `cairn memory-server` command; test-only injected command/argv uses the same `shell: false` SDK transport.
- The bridge copies defined environment variables but always removes `MCP_HTTP_PORT`, preventing parent configuration from switching the child away from stdio.
- Unsupported MCP content types fail closed instead of being silently dropped or rewritten.
- Native Pi annotations are not claimed or fabricated; exact server annotations stay in trusted tool/call details.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved explicit oversized-result classification**
- **Found during:** Task 1 bridge smoke
- **Issue:** The SDK read buffer closed the transport before the bridge could report its configured result limit.
- **Fix:** Kept a finite transport cap above the semantic result limit and retained transport errors for larger hard-cap failures.
- **Files modified:** `mcp-memory-server/src/pi-mcp-bridge.ts`
- **Commit:** `b8a73f7`

**2. [Rule 1 - Bug] Closed lifecycle state after unexpected child exit**
- **Found during:** Post-Task 2 lifecycle review
- **Issue:** Pending calls rejected after a child crash, but the public bridge state could remain `ready`.
- **Fix:** Wrapped the SDK close callback to transition to `closed` and clear the session catalog on unexpected transport termination.
- **Files modified:** `mcp-memory-server/src/pi-mcp-bridge.ts`
- **Commit:** `7a5894a`

## Known Stubs

None.

## Verification

- `(cd mcp-memory-server && npm ci && npm run build && npm test)` - PASS with the Pi bridge composed into routine smoke.
- `node mcp-memory-server/scripts/smoke-pi-mcp-bridge.mjs` - PASS for profiles, pagination, exact metadata/results, unsupported/oversized results, cancellation, crash, collision, shutdown, and orphan checks.
- `(cd mcp-memory-server && npm run check:mcp-trust)` - PASS.
- `bash scripts/verify-no-private-references.sh` - PASS.
- Package dependency and both lockfile comparisons - unchanged.
- TypeScript build and Git whitespace checks - PASS.

## Self-Check: PASSED

- Both new production files and the modified server manifest exist.
- Commits `b8a73f7`, `a26fa75`, and `7a5894a` exist in repository history.
- Compiled `mcp-memory-server/dist/pi-mcp-bridge.js` is produced by the existing build.
- No tracked file deletions occurred.
- Orchestrator-owned `.planning/PROJECT.md`, `.planning/ROADMAP.md`, and `.planning/STATE.md` were not staged or modified by this plan executor.

---
*Phase: 26-guided-setup-and-harness-onboarding*
*Completed: 2026-08-12*
