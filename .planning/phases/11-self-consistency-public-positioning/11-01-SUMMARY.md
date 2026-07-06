---
phase: 11-self-consistency-public-positioning
plan: 01
subsystem: infra
tags: [bash, git-grep, verify-by-execution, docs-parity, secret-denylist]

requires:
  - phase: 10-routing-seam
    provides: "route_check thin delegate + CAIRN_ROUTE_ENDPOINT/RT env keys the parity checker now cross-references"
provides:
  - "scripts/verify-no-private-references.sh -- three-stage fail-loud guard (generic tree scan, env-gated specific denylist, commit-message log scan)"
  - "scripts/verify-docs-parity.sh -- one-directional code-vs-docs drift checker (env keys + command names)"
affects: [11-02-token-miser-publish, 11-03-docs-sweep, milestone-gate]

tech-stack:
  added: []
  patterns:
    - "verify-*.sh shape: #!/usr/bin/env bash, set -euo pipefail, usage() heredoc, main() flag parsing, fail-loud non-zero exit, never silent pass"
    - "git grep (not grep -r) for tracked-tree-only scans, including .planning/"
    - "comm -23 on two sorted lists for one-directional drift detection (code-only, not symmetric diff)"

key-files:
  created:
    - scripts/verify-no-private-references.sh
    - scripts/verify-docs-parity.sh
  modified: []

key-decisions:
  - "Narrowed the generic AI-authorship pattern to attribution markers (co-authored-by trailers, noreply@anthropic.com, generated-with boilerplate, written-by-ai phrasing) instead of RESEARCH.md's illustrative bare 'claude code'/'anthropic' substring -- the bare form false-positives on this project's own legitimate 'Claude Code' harness-name mentions (42+ hits across README.md, PROJECT.md, MILESTONES.md, docs/operating.md), which would make the guard permanently RED"
  - "Command-parity check requires a backtick-quoted or slash-prefixed reference in docs/operating.md, not a bare substring match -- a bare match let context-explore's incidental appearance inside an unrelated sync-script filename comment (line 82) count as 'documented', producing a false negative"
  - "Ran the guard against the real tracked tree + full commit-message log rather than a synthetic fixture -- surfaced a genuine, pre-existing SC-03 finding (see Known Findings below) that is out of this plan's scope to remediate"

requirements-completed: [SC-02, SC-03]

coverage:
  - id: D1
    description: "verify-no-private-references.sh: three-stage guard (generic tree scan, env-gated fail-closed specific denylist, commit-message scan) is executable, --help works, detects a planted denylist term, and fails closed on an unreadable denylist path"
    requirement: "SC-03"
    verification:
      - kind: manual_procedural
        ref: "bash -n scripts/verify-no-private-references.sh; ./scripts/verify-no-private-references.sh --help; CAIRN_GUARD_DENYLIST=<planted-file> ./scripts/verify-no-private-references.sh (exit 1); CAIRN_GUARD_DENYLIST=<unreadable-path> ./scripts/verify-no-private-references.sh (exit 1, FATAL)"
        status: pass
    human_judgment: false
  - id: D2
    description: "verify-docs-parity.sh: one-directional env-key + command-name drift checker is executable, --help works, and correctly names the three known current drift items (CAIRN_EXPLORE_BINARY, CAIRN_EXPLORE_REPO_ROOT, context-explore) without flagging the doc-only CAIRN_GIT_PROVIDER key"
    requirement: "SC-02"
    verification:
      - kind: manual_procedural
        ref: "bash -n scripts/verify-docs-parity.sh; ./scripts/verify-docs-parity.sh --help; ./scripts/verify-docs-parity.sh (exit 1, names all three known gaps; CAIRN_GIT_PROVIDER absent from output)"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-06
status: complete
---

# Phase 11 Plan 01: Verify-by-Execution Gate Scripts Summary

**Two fail-loud bash gates: a three-stage no-private-references guard (generic authorship scan, env-gated specific denylist, commit-log scan) and a one-directional docs-vs-code parity checker, both matching the repo's `verify-routing-seam.sh` shape.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-06T20:48:00Z (approx)
- **Completed:** 2026-07-06T21:08:43Z
- **Tasks:** 2 completed
- **Files modified:** 2 (both new)

## Accomplishments

- `scripts/verify-no-private-references.sh` — Stage 1 (generic, committed AI-authorship-attribution scan of the tracked tree via `git grep`), Stage 2 (env-gated `CAIRN_GUARD_DENYLIST` specific-term scan, fail-closed on unreadable file per D-06), Stage 3 (`git log --format=%B` commit-message scan, since `git grep` never sees commit bodies, per D-07). Self-excludes the script and the phase-11 detector docs from Stage 1 only.
- `scripts/verify-docs-parity.sh` — one-directional `comm -23` diff of sorted `CAIRN_*`/`MCP_HTTP_*` env keys read in `mcp-memory-server/src/*.ts` against keys named in `docs/operating.md` + `README.md`, plus a command-name check requiring every `claude/commands/*.md` file to have a backtick or slash-prefixed reference in `docs/operating.md`. Doc-only keys (e.g. `CAIRN_GIT_PROVIDER`) are never a failure.
- Both scripts verified live against the real repo: the guard is Stage-1/Stage-2 clean and functionally proven (planted-term detection + fail-closed unreadable-path handling both confirmed); the parity checker correctly names all three known SC-02 gaps (`CAIRN_EXPLORE_BINARY`, `CAIRN_EXPLORE_REPO_ROOT`, `context-explore`) and correctly does not flag `CAIRN_GIT_PROVIDER`.

## Task Commits

1. **Task 1: verify-no-private-references.sh (SC-03 guard)** - `c707487` (feat)
2. **Task 2: verify-docs-parity.sh (SC-02 parity checker)** - `6b68daa` (feat)

## Files Created/Modified

- `scripts/verify-no-private-references.sh` - three-stage fail-loud no-private-references guard, matches `verify-routing-seam.sh` shape (`usage()`, `main()` flag parsing, fail-loud never-silent)
- `scripts/verify-docs-parity.sh` - one-directional docs-vs-code drift checker (env keys + command names)

## Decisions Made

- **Narrowed Stage 1's generic pattern away from RESEARCH.md's illustrative example.** The Code Examples section's literal pattern (`anthropic|claude code|written by (an? )?ai|generated (with|by) claude|co-authored-by: claude`) was a rough illustration, not a drop-in: a bare `claude code` or `anthropic` substring match fires on this project's own legitimate identity — "Claude Code" is named 42+ times across `README.md`, `PROJECT.md`, `MILESTONES.md`, and `docs/operating.md` as one of the two supported harnesses, and "Anthropic" appears once legitimately in `09-CONTEXT.md` describing an OpenAI↔Anthropic translation proxy. Using the naive pattern verbatim would make the guard permanently RED on a clean tree, contradicting the plan's own must-have ("exits 0 on the current cairnkeep tracked tree"). The refined pattern (`co-authored-by:\s*claude`, `noreply@anthropic\.com`, `generated (with|by) claude`, `written by (an?)? ?ai\b`) targets genuine AI-authorship attribution — trailers, the anthropic.com email domain, "generated with/by" boilerplate — and produces zero false positives on the current tracked tree while still catching the real historical violation found in commit history (see Known Findings).
- **Command-parity check tightened to backtick/slash-prefixed references, not bare substring.** A bare `grep -qF "$name"` match would have let `context-explore`'s incidental appearance inside an unrelated sync-script filename comment (`docs/operating.md:82`, `# context-explore command`) count as "documented" — a false negative that would have hidden the exact SC-02 gap this script exists to catch. All 10 currently-documented commands have either a backtick-quoted bare-name form (in the "10 commands" enumeration) or a slash-prefixed form (in the workflow section); requiring either form correctly distinguishes real documentation from an incidental mention.
- **11-PATTERNS.md referenced in the plan's `<read_first>` blocks does not exist in this repo.** Proceeded using `11-RESEARCH.md`'s Architecture Patterns and Code Examples sections alone, which contained sufficient detail (Pattern 1/2, the exact D-06 fail-closed snippet, the D-10 parity-check core) to build both scripts correctly. No action needed on the missing file — it is not one of this plan's deliverables.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Refined the Stage 1/3 generic pattern to avoid false-positiving on the project's own "Claude Code" harness-name mentions**
- **Found during:** Task 1 (verify-no-private-references.sh)
- **Issue:** The plan's `<read_first>` pointed to 11-RESEARCH.md's illustrative generic pattern, which includes bare `claude code` and `anthropic` as match terms. Live-testing this pattern against the real tracked tree produced 40+ false-positive files (every legitimate "Claude Code" harness mention), which would make the guard permanently fail on a clean tree — directly contradicting the plan's own acceptance criterion that the script exits 0 on the current tree.
- **Fix:** Replaced the bare-substring alternatives with attribution-specific patterns (`co-authored-by:\s*claude`, `noreply@anthropic\.com`, `generated (with|by) claude`, `written by (an?)? ?ai\b`) that target actual AI-authorship attribution phrasing rather than harness-name mentions.
- **Files modified:** scripts/verify-no-private-references.sh
- **Verification:** Stage 1 tree scan is clean (0 hits) against the current tracked tree; Stage 3 commit-log scan still correctly detects the real historical `Co-Authored-By: Claude ... <noreply@anthropic.com>` trailers (see Known Findings) — confirming detection is live, not weakened into a no-op.
- **Committed in:** c707487 (Task 1 commit)

**2. [Rule 1 - Bug] Tightened the command-parity check to avoid a false negative on context-explore**
- **Found during:** Task 2 (verify-docs-parity.sh)
- **Issue:** A bare `grep -qF "$name" docs/operating.md` substring check found `context-explore` "documented" because the string appears inside an unrelated sync-script filename comment (`docs/operating.md:82`), even though it is genuinely absent from the "10 commands" enumeration and the workflow section — exactly the SC-02 gap the plan requires this script to detect.
- **Fix:** Changed the check to require a backtick-quoted (`` `name` ``) or slash-prefixed (`/name`) reference, matching how all 10 currently-documented commands are actually referenced.
- **Files modified:** scripts/verify-docs-parity.sh
- **Verification:** Re-ran against the real tree — `context-explore` is now correctly named as missing; all 10 already-documented commands (including `graphify`, which only has the backtick form, no slash form) still pass.
- **Committed in:** 6b68daa (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bug fixes to the plan's illustrative/example logic, both discovered by live-testing against the real repo per the verify-by-execution bar)
**Impact on plan:** Both fixes were necessary for the scripts to behave as the plan's own acceptance criteria specify (guard green on a clean tree; parity checker correctly and only names the real known drift). No scope creep — no other files touched.

## Known Findings (real, pre-existing — not a script defect)

Running `scripts/verify-no-private-references.sh` against the real repo today exits **non-zero**, per the acceptance criteria's own framing ("any non-zero here is a real SC-03 finding to clean, not a script defect"):

- **Stage 1** (tracked tree): clean, 0 hits.
- **Stage 2** (specific denylist): not exercised in the real run (`CAIRN_GUARD_DENYLIST` unset in this environment — optional per this plan's `user_setup` note).
- **Stage 3** (commit-message log): **4 hits**. Four existing commits already on this branch's history carry `Co-Authored-By: Claude ... <noreply@anthropic.com>` trailers (added by prior GSD-tooling commits before this phase's guard existed), which is a genuine violation of the LOCKED `DEC-no-ai-authorship` constraint.

This is a real, pre-existing condition, not something introduced by this plan's changes (Task 1/2 only add two new scripts; no commit messages were altered). Per the Scope Boundary rule, fixing it would require rewriting existing commit messages (`git rebase`/history rewrite) — an operation excluded from this executor's permitted git operations (destructive, requires explicit `-i` flags, and risks disrupting a shared branch history) and squarely out of this plan's two-task scope (build the gate scripts; cleaning history is not a listed task). Flagging for operator decision: whether/how to address these 4 historical commits (e.g., a documented exception, or a deliberate history rewrite) is a Rule 4-class architectural decision, not something this executor should attempt unilaterally.

**Recommendation:** Surface this finding at the Phase 11 milestone-gate recording step (D-08) rather than block Plan 01/02/03 on it — the guard's job (proving the detection mechanism works) is complete and verified; remediating 4 historical commit messages is a separate, explicit decision for the operator.

## Issues Encountered

None beyond the two deviations documented above (both resolved inline before the task's commit).

## User Setup Required

None required to complete this plan. Per the plan's `user_setup` block, `CAIRN_GUARD_DENYLIST` is optional for the cairnkeep tree (already clean of employer/vendor literals) — it becomes mandatory for the token-miser scrub gate in Plan 02, where the operator must supply an uncommitted denylist file before that plan's guard run.

## Next Phase Readiness

- Both gate scripts exist, are executable, and behave exactly as the plan's `<verification>` block specifies: guard is Stage 1/2 green (Stage 3 correctly flags a real pre-existing finding, documented above, not a defect); parity checker is correctly RED, naming the exact known SC-02 drift.
- Plan 02 (token-miser publish) can now run the guard against the trimmed publish tree as its gate, per D-05 sequencing.
- Plan 03 (docs sweep) has a mechanized parity check ready to flip green once the doc fixes land.
- Open item for the operator/milestone-gate step: the 4 historical AI-authorship commit-message trailers found by Stage 3 (see Known Findings) — not blocking this plan, but should be explicitly acknowledged (per D-08's "recorded" milestone-gate framing) before SC-03 is declared fully satisfied at milestone close.

## Self-Check: PASSED

- FOUND: scripts/verify-no-private-references.sh (executable)
- FOUND: scripts/verify-docs-parity.sh (executable)
- FOUND: .planning/phases/11-self-consistency-public-positioning/11-01-SUMMARY.md
- FOUND commit: c707487 (Task 1)
- FOUND commit: 6b68daa (Task 2)
- FOUND commit: a016cdc (SUMMARY)

---
*Phase: 11-self-consistency-public-positioning*
*Completed: 2026-07-06*
