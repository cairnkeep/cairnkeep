---
phase: 10-routing-seam
plan: 02
subsystem: infra
tags: [bash, shell-scripting, docs, mcp, token-miser, health-check]

requires:
  - phase: 10-routing-seam
    provides: "route_check MCP tool (Plan 01) — the frozen contract this doc/script prove and document"
provides:
  - "scripts/verify-routing-seam.sh — real (non-mocked) token_miser binary /health proof, operator-gated, health-only default + optional --full stretch"
  - "docs/operating.md CAIRN_ROUTE_ENDPOINT config row + Routing seam contract subsection"
affects: [routing-seam, future-overlay-integration]

tech-stack:
  added: []
  patterns:
    - "Verify-by-execution against a real background-started binary with EXIT trap teardown + bounded curl poll loop (never fixed-sleep), mirroring verify-fastcontext-reliability.sh / verify-token-savings-ab.sh"

key-files:
  created:
    - scripts/verify-routing-seam.sh
  modified:
    - docs/operating.md

key-decisions:
  - "Health-only mode is the default and the only required proof (D-06); --full's /v1/chat/completions round-trip is an explicitly optional, skippable-with-message stretch (D-06/D-07 defer live routing)"
  - "Used a script-global ROUTE_PID (not a function-local var) so the EXIT trap can read it after run_health_proof() returns — a function-local pid was unbound under set -u when the trap fired, caught and fixed during execution (Rule 1)"

patterns-established:
  - "Background-start + trap kill + bounded curl -sf poll loop (never sleep-and-hope) for proving a real binary's HTTP liveness in a verify script"

requirements-completed: [RT-01, RT-02]

coverage:
  - id: D1
    description: "scripts/verify-routing-seam.sh proves the real token_miser binary answers GET /health with status:ok, fails loud when the binary is absent, and cleans up the process on exit"
    requirement: "RT-01"
    verification:
      - kind: other
        ref: "bash -n scripts/verify-routing-seam.sh && bash scripts/verify-routing-seam.sh --help"
        status: pass
      - kind: manual_procedural
        ref: "timeout 30 bash scripts/verify-routing-seam.sh (real token_miser binary present on this machine) — observed [health] OK line, exit 0, no lingering process"
        status: pass
      - kind: manual_procedural
        ref: "CAIRN_ROUTE_BINARY=/nonexistent bash scripts/verify-routing-seam.sh — observed FATAL message, exit 1"
        status: pass
    human_judgment: true
    rationale: "Plan's own <verify><human-check> requires an operator with the real binary to confirm a live 200 /health; I ran this live proof myself during execution (binary happened to be present on this machine) and it passed, but the plan designates this as a human sign-off step so it stays flagged for confirmation rather than silently auto-passing."
  - id: D2
    description: "docs/operating.md documents CAIRN_ROUTE_ENDPOINT and the route_check seam contract (tool name, env key, /health path, precondition/execution/success shapes, and an explicit does-NOT clause) sufficient for an overlay to drive routing without reading src/"
    requirement: "RT-02"
    verification:
      - kind: other
        ref: "grep -q CAIRN_ROUTE_ENDPOINT docs/operating.md && grep -q route_check docs/operating.md"
        status: pass
      - kind: other
        ref: "grep -qi 'does not' within the Routing seam subsection (covers both /v1/chat/completions and tier-reporting clauses)"
        status: pass
    human_judgment: true
    rationale: "Plan's <verify><human-check> asks for a cold-read review confirming the subsection alone is sufficient to drive routing without opening mcp-memory-server/src/index.ts (SC #3) — a judgment call reserved for human sign-off per the plan."

duration: 15min
completed: 2026-07-06
status: complete
---

# Phase 10 Plan 02: Routing Seam Real-Proof Script + Doc Contract Summary

**Real (non-mocked) token_miser `/health` proof script plus the `CAIRN_ROUTE_ENDPOINT`/`route_check` seam contract documented in `docs/operating.md`**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-06T16:47:00Z
- **Completed:** 2026-07-06T16:50:43Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `scripts/verify-routing-seam.sh`: background-starts the real `token_miser` binary, polls `GET /health` with a bounded `curl -sf -m 2` retry loop (never a fixed sleep), asserts `"status":"ok"`, and guarantees teardown via an `EXIT` trap. Fails loud (nonzero, explicit stderr message) when the binary is absent — never a silent pass. `--full` is an optional, skippable-with-message stretch for a real `/v1/chat/completions` round-trip.
- `docs/operating.md`: added the `CAIRN_ROUTE_ENDPOINT` config row and a new "Routing seam (`route_check`, opt-in)" subsection documenting the tool name, its single env key, the exact `GET {endpoint}/health` call, the precondition/execution/success return shapes, and an explicit does-NOT clause (no `/v1/chat/completions`/`/v1/messages` driving, no tier reporting) — matching the frozen contract table at the top of `10-01-PLAN.md` verbatim (tool name `route_check`, env key `CAIRN_ROUTE_ENDPOINT`, path `/health`).
- Ran the script live against the real `token_miser` binary present on this machine: confirmed a genuine 200 `/health` with `status:ok`, clean process teardown, and a loud failure path with the binary absent.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create scripts/verify-routing-seam.sh** - `829b8a7` (feat)
2. **Task 2: Document CAIRN_ROUTE_ENDPOINT + Routing seam contract** - `69395e8` (docs)

**Plan metadata:** _(recorded in the final commit for this plan)_

## Files Created/Modified
- `scripts/verify-routing-seam.sh` - real-binary `/health` proof, operator-gated, health-only default + `--full` stretch
- `docs/operating.md` - `CAIRN_ROUTE_ENDPOINT` config row + Routing seam contract subsection

## Decisions Made
- Health-only is the default and only required mode; `--full`'s chat round-trip is explicitly optional and skips with a message rather than failing when no tier backend is reachable (matches D-06/D-07 — live routing is deferred).
- Fixed an `unbound variable` bug found during live testing: the `EXIT` trap referenced a `local` `pid` from inside `run_health_proof()`, which was out of scope by the time the trap fired under `set -u`. Promoted it to a script-global `ROUTE_PID` so cleanup works reliably (Rule 1 auto-fix, verified by a clean live run with no lingering process afterward).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed EXIT trap referencing an out-of-scope local variable**
- **Found during:** Task 1 (live test run of the script against the real token_miser binary)
- **Issue:** `local pid=$!` inside `run_health_proof()` went out of scope once the function returned; the `trap 'kill "$pid" ...' EXIT` then failed with `pid: unbound variable` under `set -euo pipefail`, causing the script to exit 1 even after a successful health proof and leaving the started process to be reaped inconsistently.
- **Fix:** Replaced the function-local `pid` with a script-global `ROUTE_PID`, set inside the function, referenced by the trap and the failure-message string.
- **Files modified:** `scripts/verify-routing-seam.sh`
- **Verification:** Re-ran `timeout 30 bash scripts/verify-routing-seam.sh` twice against the real binary — both times exited 0 with the `[health] OK` line, and `pgrep -f token_miser` showed no lingering process afterward (confirmed the one earlier stray process was a leftover from the pre-fix run, not the fixed script).
- **Committed in:** `829b8a7` (part of Task 1 commit — fix applied before commit, not a separate commit)

**2. [Tooling] Edit tool transient failure on docs/operating.md — worked around via scripted string-replace**
- **Found during:** Task 2 (documenting the seam contract)
- **Issue:** The `Edit` tool returned "File has not been read yet" on `docs/operating.md` despite a successful prior `Read`, and repeated on retry — matching the known transient issue noted in the sequential-execution instructions for this plan.
- **Fix:** Applied the identical diff via a scripted Python exact-string-replace (single `str.replace` call, asserted exactly one match) instead of the `Edit` tool.
- **Files modified:** `docs/operating.md`
- **Verification:** `grep -n 'CAIRN_ROUTE_ENDPOINT\|route_check' docs/operating.md` and a full re-read of the new section confirmed the diff applied correctly and matches the plan's required structure.
- **Committed in:** `69395e8` (part of Task 2 commit)

---

**Total deviations:** 2 (1 auto-fixed bug, 1 tooling workaround)
**Impact on plan:** Both necessary for correctness of the deliverable; no scope creep. The trap bug would have caused every real run to report a false failure exit code despite a successful health proof.

## Issues Encountered
None beyond the two items documented above under Deviations.

## Pending Human-Checks

The plan's two `<human-check>` verify items are explicitly deferred to a human operator per the execution instructions (this plan is autonomous, no interactive checkpoints):

1. **Task 1 human-check:** "Operator with the token_miser binary present runs `bash scripts/verify-routing-seam.sh` once and confirms a real 200 /health (D-06). On a machine without the binary, confirm it fails loud, not silent." — I ran this live myself during execution (the real binary happens to exist on this machine) and observed a passing health proof plus a loud failure with the binary absent; still flagged for operator confirmation per plan design.
2. **Task 2 human-check:** "Read the routing seam subsection cold and confirm it is sufficient to drive routing without reading core source, and that the does-NOT clause is present and accurate (SC #3, Pitfall 3)." — Automated greps confirm presence of the required strings; the cold-read sufficiency judgment itself is reserved for a human reviewer.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The routing seam is now both proven-real (script) and externally documented (doc contract) — RT-01 and RT-02 are both satisfied at the automated-verification level.
- No blockers. The two pending human-checks above are informational sign-offs, not gating items, per this plan's autonomous execution mode.

---
*Phase: 10-routing-seam*
*Completed: 2026-07-06*

## Self-Check: PASSED

- FOUND: scripts/verify-routing-seam.sh (executable)
- FOUND: docs/operating.md
- FOUND: .planning/phases/10-routing-seam/10-02-SUMMARY.md
- FOUND: commit 829b8a7 (Task 1)
- FOUND: commit 69395e8 (Task 2)
