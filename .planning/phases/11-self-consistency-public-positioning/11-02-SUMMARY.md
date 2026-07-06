---
phase: 11-self-consistency-public-positioning
plan: 02
subsystem: infra
tags: [github, publish, licensing, cross-repo, gh-cli]
requires:
  - phase: 11-self-consistency-public-positioning (plan 01)
    provides: scripts/verify-no-private-references.sh (the scrub/denylist guard)
provides:
  - "github.com/cairnkeep/token-miser — public repo, single clean commit, Apache-2.0"
  - "Trimmed, scrubbed, provider-neutral token-miser publish tree"
affects: [11-03 (docs linking the public sibling repo)]

tech-stack:
  added: []
  patterns:
    - "Cross-repo clean-slate publish: git init fresh history, never filter-repo/BFG rewrite of private history (D-01)"
    - "Scrub gate with operator-supplied denylist run before any irreversible push"

key-files:
  created:
    - "~/PARA/Projects/token-miser/LICENSE (Apache-2.0, verbatim copy, copyright line updated)"
    - "~/PARA/Projects/token-miser/config.enterprise.example.toml (neutral rename of the employer-named example config)"
  modified:
    - "~/PARA/Projects/token-miser/config.enterprise.example.toml (Qwen 3.6 family model defaults, operator-requested checkpoint fix)"

key-decisions:
  - "Neutral-renamed the employer-named example config to config.enterprise.example.toml (provider-neutral, matches existing config.hybrid.toml/config.local.toml naming style)"
  - "Operator-requested fix at the pre-push checkpoint: tier1 default model changed to qwen-3.6-4b (small), tier3 default changed to qwen-3.6-235b (flagship) — all three tiers now come from the Qwen 3.6 family; tier2 (qwen-3.6-27b), the embedding model, and the private_cluster intent_classifier were already correct or out of scope and left untouched"
  - "Amended the single publish commit rather than adding a second commit, to preserve the single-clean-commit invariant (D-01) through the checkpoint fix"

requirements-completed: [SC-01]

coverage:
  - id: D1
    description: "token-miser publish tree scrubbed, licensed, re-init'd to single-commit history, and gated zero-hit before push"
    requirement: SC-01
    verification:
      - kind: other
        ref: "CAIRN_GUARD_DENYLIST=<denylist> bash scripts/verify-no-private-references.sh (from token-miser dir) — exit 0"
        status: pass
      - kind: other
        ref: "cargo build (in token-miser dir) — Finished dev profile"
        status: pass
    human_judgment: false
  - id: D2
    description: "github.com/cairnkeep/token-miser created public and verified PUBLIC after operator-approved checkpoint"
    requirement: SC-01
    verification:
      - kind: other
        ref: "gh repo view cairnkeep/token-miser --json visibility -> {\"visibility\":\"PUBLIC\"}"
        status: pass
    human_judgment: false

duration: ~15min (continuation session; original Task 1 scrub/re-init ran in a prior session)
completed: 2026-07-06
status: complete
---

# Phase 11 Plan 02: Publish token-miser Public Summary

**github.com/cairnkeep/token-miser is live and PUBLIC — a scrubbed, Apache-2.0, single-clean-commit tree that passed the no-private-references guard and `cargo build` before push, with the checkpoint's requested Qwen-3.6-family config fix folded into that same commit.**

## Performance

- **Started:** prior session (Task 1) + this continuation session ~2026-07-06T21:48Z
- **Completed:** 2026-07-06T21:50:06Z
- **Tasks:** 3/3 complete (Task 1 scrub/re-init, Task 2 human-verify checkpoint, Task 3 publish)
- **Files modified:** 2 in the token-miser cross-repo tree (LICENSE added, config.enterprise.example.toml renamed + edited); 0 cairnkeep tracked files (this plan is cross-repo only, per its own frontmatter)

## Accomplishments

- Trimmed ~/PARA/Projects/token-miser to the D-04 publish set (src/, Cargo.toml, Cargo.lock, scrubbed docs, example configs) — dropped .ai/, .planning/, bench/, CLAUDE.md, AGENTS.md, .gitlab-ci.yml, .github/, target/
- Added an Apache-2.0 LICENSE (verbatim copy of cairnkeep's LICENSE, copyright line updated)
- Neutral-renamed the <employer>-named example config to `config.enterprise.example.toml` and scrubbed <employer>/vendor/internal-host literals from all kept docs and configs
- Re-init'd token-miser to a single clean commit (`git init`; no filter-repo/BFG rewrite of the private history — the private stondo/token-miser repo remains an untouched, unmodified archive)
- Ran the guard with the operator's denylist set: zero hits (`[guard] OK: no private/vendor/AI-authorship references found in tracked tree or commit-message history`)
- `cargo build` succeeded standalone in the trimmed tree
- Human-verify checkpoint: operator reviewed the tracked set and approved the push, conditional on one fix (see Deviations)
- Applied the operator's fix and amended the single commit (history stayed at exactly 1 commit)
- Re-verified the triad post-fix: 1 commit, guard zero-hit, `cargo build` success
- Published: `gh repo create cairnkeep/token-miser --public --source=. --push` (repo did not previously exist — confirmed via `gh repo view` returning "not found" first, per the Pitfall-3 check)
- Verified PUBLIC: `gh repo view cairnkeep/token-miser --json visibility` -> `{"visibility":"PUBLIC"}`
- Verified the pushed remote history is a single commit (`git rev-list --count origin/master` -> 1)

## Task Commits

This plan operates entirely on the cross-repo working tree `~/PARA/Projects/token-miser` (zero cairnkeep tracked files touched, per plan frontmatter). Cross-repo commit hashes:

1. **Task 1: Scrub, trim, re-init, and gate the publish tree** - `0812aa8` "chore: initial public release" (token-miser repo, pre-checkpoint)
2. **Checkpoint fix (operator-requested, folded into the same commit via amend)** - `68f3737` "chore: initial public release" (token-miser repo — amended, history stays at exactly 1 commit)
3. **Task 3: Publish** - pushed `68f3737` to `github.com/cairnkeep/token-miser` as the sole commit on `master`

**Plan metadata (this file, cairnkeep repo):** committed immediately after this SUMMARY is written.

## Files Created/Modified

- `~/PARA/Projects/token-miser/LICENSE` - Apache-2.0, verbatim copy of cairnkeep's LICENSE with updated copyright line
- `~/PARA/Projects/token-miser/config.enterprise.example.toml` - neutral rename of the <employer>-named example config; all three provider tiers now default to Qwen 3.6 family models (small/mid/flagship sizing)

No cairnkeep tracked files were modified by Tasks 1-3 (cross-repo plan, per frontmatter). This SUMMARY.md is the only cairnkeep-repo artifact from this plan.

## Decisions Made

- Neutral rename target: `config.enterprise.example.toml`, matching the existing `config.hybrid.toml`/`config.local.toml` naming convention already in the tree
- Checkpoint fix scope: only the tier1 and tier3 model-mapping defaults were <employer>/off-family and needed changing (to `qwen-3.6-4b` and `qwen-3.6-235b` respectively); tier2's default was already `qwen-3.6-27b`, the semantic-router embedding model (`qwen3-embedding-8b`) is a different lineage by design and was left alone, and the `private_cluster.models.intent_classifier` was already Qwen family — none of those needed touching
- Applied the fix via commit amend (not a second commit) to preserve the single-clean-commit invariant required by D-01 and the plan's acceptance criteria

## Deviations from Plan

### Auto-fixed Issues

**1. [Checkpoint-directed, not an auto-fix rule — operator-approved conditional] Qwen 3.6 family model defaults**
- **Found during:** Task 2 (human-verify checkpoint) — operator approved the push conditional on this change
- **Issue:** `config.enterprise.example.toml` had `tier1_free` defaulting to a non-Qwen small model and `tier3_complex` defaulting to a non-Qwen flagship model, while `tier2_standard` was already Qwen 3.6
- **Fix:** Changed `tier1_free.model_mapping.default` to `qwen-3.6-4b` (small) and `tier3_complex.model_mapping.default` to `qwen-3.6-235b` (flagship); left `tier2_standard` (`qwen-3.6-27b`), the embedding model, the `reserved` placeholders, and `private_cluster.models.intent_classifier` untouched
- **Files modified:** `~/PARA/Projects/token-miser/config.enterprise.example.toml`
- **Verification:** Guard re-run (denylist set) exit 0; `cargo build` succeeded; `git rev-list --count HEAD` still 1 after the amend
- **Committed in:** `68f3737` (amended into the single publish commit, token-miser repo)

---

**Total deviations:** 1 (operator-directed checkpoint fix, not an autonomous deviation-rule fix)
**Impact on plan:** No scope creep — the fix was explicitly requested by the operator as a condition of checkpoint approval and is confined to the one config file this plan already owns.

## Issues Encountered

None beyond the expected checkpoint round-trip. `gh repo view cairnkeep/token-miser` correctly reported "not found" before creation (Pitfall 3 handled as documented — no accidental recreate-over-existing attempted).

## User Setup Required

None - no external service configuration required beyond the `gh` auth already verified in Task 1/RESEARCH (stondo, cairnkeep-org member).

## Next Phase Readiness

- `github.com/cairnkeep/token-miser` exists, is PUBLIC, single-commit, Apache-2.0 licensed — Plan 03's docs can now link a real, live public sibling repo without the claim being aspirational.
- No blockers for Plan 03.

---
*Phase: 11-self-consistency-public-positioning*
*Completed: 2026-07-06*
