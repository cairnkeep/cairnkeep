---
phase: 08-operating-layer-wiring
plan: 02
subsystem: infra
tags: [bash, opencode, sync-script, docs]

# Dependency graph
requires:
  - phase: 08-operating-layer-wiring (Plan 01)
    provides: opencode/command/context-explore.md (the source asset this script manages)
provides:
  - scripts/sync-opencode-explore-assets.sh — dedicated install/drift script for the OpenCode /context-explore command
  - docs/operating.md install + verify parity for the new script
affects: [09-live-verification-ab-token-savings]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One sync-opencode-*-assets.sh script per OpenCode feature (sixth instance: memory, wiki, security, graphify, plugin, now explore)"

key-files:
  created: [scripts/sync-opencode-explore-assets.sh]
  modified: [docs/operating.md]

key-decisions:
  - "D-04 fulfilled as documentation parity, not a new CI job — no sibling sync-opencode-*-assets.sh has real CI wiring (confirmed via grep on .github/workflows/); inventing CI for this one script would silently add unmatched scope"
  - "--apply column alignment: used a single space before --apply so the automated grep -q 'sync-opencode-explore-assets.sh --apply' acceptance check matches exactly (double-space column alignment for the 31-char filename would have broken the literal substring match)"

patterns-established:
  - "New single-asset OpenCode sync scripts should copy sync-opencode-graphify-assets.sh (single-asset sibling) as the leaner template, not the LEGACY_ASSETS-bearing wiki script, since this repo now has two clean single-asset examples"

requirements-completed: [CTX-05]

coverage:
  - id: D1
    description: "scripts/sync-opencode-explore-assets.sh installs/drift-checks the /context-explore command asset, round-tripping clean (--apply then --check both exit 0, in sync)"
    requirement: "CTX-05"
    verification:
      - kind: unit
        ref: "bash -n scripts/sync-opencode-explore-assets.sh && round-trip --apply/--check against temp live root (plan Task 1 automated verify)"
        status: pass
    human_judgment: false
  - id: D2
    description: "docs/operating.md documents the new script for both install (--apply) and drift-check (--check), framed as manual sanity check with no false CI claim"
    requirement: "CTX-05"
    verification:
      - kind: unit
        ref: "grep -c/-q assertions on docs/operating.md (plan Task 2 automated verify)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-05
status: complete
---

# Phase 08 Plan 02: OpenCode /context-explore Install Script + Docs Parity Summary

**New `sync-opencode-explore-assets.sh` install/drift script for the OpenCode `/context-explore` command, mirroring the five existing `sync-opencode-*-assets.sh` siblings, plus `docs/operating.md` install+verify parity.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-05T17:49:00Z (approx, per STATE.md session start)
- **Completed:** 2026-07-05T18:02:06Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 edited)

## Accomplishments
- Created `scripts/sync-opencode-explore-assets.sh`, a structural narrowing of `sync-opencode-wiki-assets.sh` down to a single managed asset (`command/context-explore.md`), with no `LEGACY_ASSETS` dead code
- Verified the script round-trips clean: `--apply --live-root $tmp` then `--check --live-root $tmp` both exit 0 and report in-sync
- Verified no private references (endpoint/model/host/IP/vendor) leak into the script
- Documented the script in `docs/operating.md`: an `--apply` line in the OpenCode setup order (sixth sibling), and a `--check` sanity bullet in the verification section — explicitly not claiming any CI job runs it, since none of the five existing siblings has one

## Task Commits

Each task was committed atomically:

1. **Task 1: Create scripts/sync-opencode-explore-assets.sh** - `84495ca` (feat)
2. **Task 2: Add docs/operating.md parity for the new sync script** - `1ed92fd` (docs)

**Plan metadata:** (this commit, pending)

## Files Created/Modified
- `scripts/sync-opencode-explore-assets.sh` - New dedicated install/drift script for the OpenCode `/context-explore` command; `ASSETS = ["command/context-explore.md"]`; `--check`/`--apply`/`--live-root`/`-h` flags identical to sibling scripts
- `docs/operating.md` - Added the new script to the OpenCode setup order (`--apply`) and the verifying-the-install section (`--check`)

## Decisions Made
- D-04 (CI wiring for `--check`) fulfilled as documentation parity, matching the de-facto pattern of all five existing sibling scripts (none has real CI automation; confirmed via `grep -rn "sync-opencode\|sync-claude" .github/workflows/` returning no matches). Inventing a first-of-its-kind CI job here was explicitly out of scope per the plan's stated reasoning.
- Used a single space (not double-space column alignment) before `--apply` on the new script's docs line, so the plan's exact automated `grep -q 'sync-opencode-explore-assets.sh --apply'` acceptance check matches literally. The plan's "align with sibling column style" guidance and the plan's own literal grep check were in tension for a 31-character filename (odd length vs. the 28/30/32-char siblings); the automated verification command was treated as authoritative since it defines "done."

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Edit/Write tools failed with "File has not been read yet" despite fresh Read calls**
- **Found during:** Task 2 (docs/operating.md edit)
- **Issue:** Both the `Edit` and `Write` tools repeatedly refused to modify `docs/operating.md`, reporting the file had not been read, immediately after fresh `Read` calls (tried with absolute path, relative path, full-file read, and partial-range read — all failed identically). This blocked the required documentation edit.
- **Fix:** Used `Bash` with a Python script (`python3 -c`) to perform the same two surgical string replacements the plan specified (verified each `old` string had exactly one match before replacing, via `assert content.count(old) == 1`), then verified the diff was minimal and exactly as intended via `git diff`.
- **Files modified:** docs/operating.md
- **Verification:** `git diff docs/operating.md` showed only the two intended insertions; the plan's exact automated verify command (`grep -c`/`grep -q` checks) passed.
- **Committed in:** 1ed92fd (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — tool-environment workaround, no scope change)
**Impact on plan:** No impact on the delivered content; the Bash/Python fallback produced an identical diff to what Edit would have made. Purely a tooling workaround, not a plan deviation in substance.

## Issues Encountered
- The plan's suggested "column-aligned" spacing before `--apply` (matching sibling scripts' visual alignment) would have broken the plan's own literal `grep -q` acceptance check for a 31-character filename. Resolved by using single-space, prioritizing the automated verification gate over visual alignment (see Decisions Made).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- CTX-05 install path is complete: `/context-explore` now has full install/drift-check parity with every other OpenCode feature.
- Phase 9 (Live Verification + A/B Token-Savings) can proceed; no blockers from this plan.

---
*Phase: 08-operating-layer-wiring*
*Completed: 2026-07-05*
