---
phase: 12-context-exploration-maturation
plan: 03
subsystem: operating-layer
tags: [context_explore, hooks, claude-code, docs, verify-by-execution]

requires:
  - phase: 12-context-exploration-maturation (Plan 01)
    provides: runContextExplore() shared handler + explore CLI subcommand + cache
  - phase: 12-context-exploration-maturation (Plan 02)
    provides: crossReferenceCitations() enrichment (memory_refs/wiki_refs)
provides:
  - claude/hooks/context-explore-pretask.sh — UserPromptSubmit auto-invoke hook (double opt-in, high-signal gated, fail-open)
  - scripts/sync-claude-assets.sh HOOK_EVENTS registration + explicit per-hook settings.json timeout support
  - scripts/verify-explore-maturation.sh — composed offline end-to-end proof of CTX-08/09/10
  - docs/operating.md CAIRN_EXPLORE_AUTOINVOKE row + auto-invoke/cross-ref/cache prose + OpenCode parity known gap
affects: []

tech-stack:
  added: []
  patterns:
    - "UserPromptSubmit hook mirrors memory-recall.sh's fail-open template (double opt-in gate, python3 stdin JSON parse, inject-only-on-match, unconditional exit 0)"
    - "HOOK_EVENTS map extended with an optional '@timeout' suffix so a hook's settings.json registration can carry an explicit per-hook kill-budget without a new registration mechanism"
    - "verify-explore-maturation.sh mirrors verify-token-savings-ab.sh's --stage flag dispatch + wrapper/logging-binary technique, reusing Plan 01/02's fixture binaries"

key-files:
  created:
    - claude/hooks/context-explore-pretask.sh
    - scripts/verify-explore-maturation.sh
    - .planning/phases/12-context-exploration-maturation/deferred-items.md
  modified:
    - scripts/sync-claude-assets.sh
    - docs/operating.md

key-decisions:
  - "Per-hook settings.json timeout threaded via an 'event[:matcher]@timeout' HOOK_EVENTS value (parsed by splitting on '@' before the existing ':' matcher split) rather than a new map/field, keeping the registration mechanism unchanged for the three existing hooks"
  - "Low-signal skip heuristic (prompt < 10 chars, starts with '/', or matches a bare ok/yes/no/thanks(.)? acknowledgement) implemented as a first-pass, explicitly ponytail-style guard per 12-RESEARCH.md Open Question 2 -- not a rigorously derived NLP heuristic"
  - "verify-explore-maturation.sh drives the real explore CLI subcommand and the real (sed-rendered) hook script directly, rather than adding a third .mjs smoke test, so the composed proof exercises the actual shipped artifacts end-to-end in one re-runnable bash script"

requirements-completed: [CTX-09]

coverage:
  - id: D1
    description: "context-explore-pretask.sh: double opt-in (CAIRN_EXPLORE_BINARY + CAIRN_EXPLORE_AUTOINVOKE=1), high-signal gating, 20s timeout wrapped explore CLI call, inject additionalContext only on ok:true + non-empty citations, unconditional exit 0"
    requirement: "CTX-09"
    verification:
      - kind: integration
        ref: "scripts/verify-explore-maturation.sh --hook (3 checks)"
        status: pass
      - kind: manual
        ref: "bash -n claude/hooks/context-explore-pretask.sh"
        status: pass
    human_judgment: false
  - id: D2
    description: "scripts/sync-claude-assets.sh registers context-explore-pretask.sh on UserPromptSubmit with an explicit timeout=25 in settings.json; re-run is a no-op"
    requirement: "CTX-09"
    verification:
      - kind: integration
        ref: "sync-claude-assets.sh --apply/--check against a scratch --live-root (verified manually, not committed as a fixture)"
        status: pass
    human_judgment: false
  - id: D3
    description: "scripts/verify-explore-maturation.sh proves all three Phase 12 success criteria offline: cross-ref flag on a seeded match (CTX-08), cache hit with binary-not-invoked + invalidation (CTX-10), hook inject/silence (CTX-09)"
    requirement: "CTX-09"
    verification:
      - kind: integration
        ref: "bash scripts/verify-explore-maturation.sh (19 checks, all pass) and mcp-memory-server npm run test:smoke (full chain green)"
        status: pass
    human_judgment: false
  - id: D4
    description: "docs/operating.md documents CAIRN_EXPLORE_AUTOINVOKE, the auto-invoke hook, citation cross-referencing, and the OpenCode parity known gap; verify-docs-parity.sh stays green"
    requirement: "CTX-09"
    verification:
      - kind: other
        ref: "bash scripts/verify-docs-parity.sh"
        status: pass
    human_judgment: false

duration: ~15min
completed: 2026-07-07
status: complete
---

# Phase 12 Plan 03: Pre-task Auto-Invoke Hook + Composed Verification + Docs Summary

**A double opt-in, high-signal-gated `UserPromptSubmit` hook auto-invokes `context_explore` for a task's prompt with no manual `/context-explore` call, backed by a new offline composed proof script covering all three Phase 12 success criteria and full operating-docs coverage of the new env key and behaviors.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-07T16:33:00Z (approx, following Plan 02's prior commit)
- **Completed:** 2026-07-07T16:44:47Z
- **Tasks:** 3
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments

- `claude/hooks/context-explore-pretask.sh`: mirrors `memory-recall.sh`'s fail-open template. Gate: `exit 0` immediately unless `CAIRN_EXPLORE_BINARY` is set AND `CAIRN_EXPLORE_AUTOINVOKE=1`. Reads the `UserPromptSubmit` stdin JSON's `prompt` field via the same `python3` idiom `memory-recall.sh` uses. Skips low-signal prompts (< 10 chars, slash commands, bare acknowledgements). Invokes `timeout 20 node "$SERVER_ENTRY" explore "$prompt"` (the Plan 01 CLI, shared cache/cross-ref path) with `|| true`; injects `hookSpecificOutput.additionalContext` only on `ok:true` with non-empty citations, rendering compact `path:start-end` lines plus their `memory_refs`/`wiki_refs` markers (never `expanded_snippets`), capped via `head -40`. Unconditional `exit 0`.
- `scripts/sync-claude-assets.sh`: `HOOK_EVENTS` map gains `["context-explore-pretask.sh"]="UserPromptSubmit@25"` — the new `@timeout` suffix syntax is parsed before the existing `:matcher` split and threaded into the settings.json registration entry as an explicit `hookObj.timeout`, so the hook's kill budget is documented rather than assumed (Pitfall 1). Verified idempotent (re-apply logs `ok: UserPromptSubmit hook already registered`) against a scratch `--live-root`, never touching the real `~/.claude`.
- `scripts/verify-explore-maturation.sh`: a new offline, re-runnable proof script (mirrors `verify-token-savings-ab.sh`'s stage-flag dispatch and wrapper/logging-binary technique) with `--crossref`/`--cache`/`--hook` stages (default: run all three). Drives the real `explore` CLI subcommand and the real (sed-rendered) hook script against Plan 01/02's existing fixture binaries (`fake-tokenmiser-logging.sh`, `fake-tokenmiser-crossref.sh`) — no new fixtures needed. 19 checks total, all passing: cross-ref hit/no-hit/fail-open (CTX-08), cache hit/miss/invalidation via tracked-edit and untracked-file (CTX-10), hook inject-on-gated-on and silence-on-gated-off/low-signal (CTX-09).
- `docs/operating.md`: added the `CAIRN_EXPLORE_AUTOINVOKE` Configuration row; new "Citation cross-referencing" and "Pre-task auto-invoke hook" sections describing behavior, fail-open guarantees, and the OpenCode auto-invoke known gap (no plugin event exposes message text pre-LLM-call); the "Context exploration" workflow bullet cross-links all three. `verify-docs-parity.sh` stays green.

## Task Commits

Each task was committed atomically:

1. **Task 1: UserPromptSubmit auto-invoke hook + registration** - `3e47c8b` (feat)
2. **Task 2: verify-explore-maturation.sh composed end-to-end proof** - `7999469` (test)
3. **Task 3: Document env keys, behavior, and OpenCode parity gap** - `60f8861` (docs)

## Files Created/Modified

- `claude/hooks/context-explore-pretask.sh` - new UserPromptSubmit auto-invoke hook
- `scripts/sync-claude-assets.sh` - HOOK_EVENTS entry + `@timeout`-suffix registration support
- `scripts/verify-explore-maturation.sh` - new composed offline end-to-end proof (CTX-08/09/10)
- `docs/operating.md` - `CAIRN_EXPLORE_AUTOINVOKE` row, cross-ref/auto-invoke sections, OpenCode gap note
- `.planning/phases/12-context-exploration-maturation/deferred-items.md` - logs an out-of-scope, pre-existing commit-history finding (see Deviations)

## Decisions Made

- Threaded the per-hook `settings.json` timeout via an `event[:matcher]@timeout` `HOOK_EVENTS` value rather than introducing a parallel map or changing the function signature broadly — the existing three hooks are unaffected since they simply have no `@` suffix.
- Kept the low-signal skip heuristic exactly as scoped in 12-CONTEXT.md/12-RESEARCH.md (< 10 chars, leading `/`, or a bare `ok|yes|no|thanks?` acknowledgement) and flagged it as a first-pass heuristic in the hook's own comments, per the plan's explicit "mark it a ponytail-style comment" instruction.
- `verify-explore-maturation.sh` invokes the shipped CLI/hook artifacts directly instead of adding a third `.mjs` smoke test alongside Plan 01/02's, since the plan calls for one composed script proving all three criteria together, and Node-based fixtures already existed to reuse from bash.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written; no bugs, missing functionality, or blocking issues were found in this plan's own scope during Task 1-3 implementation or verification.

## Issues Encountered

**Pre-existing, out-of-scope: `verify-no-private-references.sh` fails on commit history from an earlier wave.** Running the full phase-gate verification surfaced a Stage 3 (commit-message AI-authorship scan) failure on two commits — `80f363d1...` (`chore(12-01): sync package-lock license field...`) and `9836b1c...` (`docs(12-02): complete cross-reference enrichment plan`) — both carrying a `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer, which violates this repo's `DEC-no-ai-authorship [LOCKED]` rule. Confirmed via `git merge-base --is-ancestor` that both commits are ancestors of this plan's worktree base (`29b85c1f...`), i.e. they were created in an earlier wave before Plan 03 started, not by any of this plan's own commits (`3e47c8b`, `7999469`, `60f8861` — verified clean via `git log 29b85c1..HEAD --format='%B' | grep -i "co-authored\|claude fable\|anthropic\|generated with"`, zero hits). Per the executor's scope-boundary rule (fix only issues directly caused by this task's own changes; rewriting an already-merged ancestor commit's message is a destructive git-history operation outside a single plan's permitted scope), this was **not fixed** here — logged to `.planning/phases/12-context-exploration-maturation/deferred-items.md` for the orchestrator/user to resolve (e.g. via an explicit history rewrite or an override-closeout note) before the milestone's no-private-references gate is considered fully green.

`mcp-memory-server` needed `npm install` (fresh worktree, no `node_modules`) before `npm run build` would find `tsc`; this restored from the existing `package-lock.json` with no drift this session (Plan 01's earlier `license` field fix from `MIT`→`Apache-2.0` was already committed upstream of this plan's base).

## User Setup Required

None — no external service configuration required. `CAIRN_EXPLORE_AUTOINVOKE` is optional (default unset/inert); set it alongside `CAIRN_EXPLORE_BINARY=1` to enable the pre-task auto-invoke hook after running `scripts/sync-claude-assets.sh --apply`.

## Next Phase Readiness

- Phase 12 (CTX-08/09/10) is now fully implemented and composed-verified: cross-referencing (Plan 02), caching (Plan 01), and pre-task auto-invoke (this plan) all share the one `runContextExplore()` path end-to-end.
- `scripts/verify-explore-maturation.sh` is the re-runnable phase-gate proof; re-run it (after `cd mcp-memory-server && npm install && npm run build`) any time this feature area changes.
- **Blocker for milestone closeout (not this plan):** the pre-existing commit-history AI-authorship violation noted above must be resolved (by the user/orchestrator, not a plan-scoped fix) before `scripts/verify-no-private-references.sh` can be recorded as fully green for this milestone.

---
*Phase: 12-context-exploration-maturation*
*Completed: 2026-07-07*

## Self-Check: PENDING
