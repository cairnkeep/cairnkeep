---
phase: 08-operating-layer-wiring
verified: 2026-07-05T20:30:00Z
status: passed
score: 5/6 must-haves verified
behavior_unverified: 1
overrides_applied: 0
deferred:

  - truth: "User can run a Claude Code command that invokes context_explore and observes real citations surfaced live in the response"
    addressed_in: "Phase 9"
    evidence: "Phase 9 Success Criterion 3: 'At least one operating-layer /context-explore command (Claude Code and/or OpenCode) is run live end-to-end against a real bootstrapped project — the same verify-by-execution bar proven against the registered cairn-memory MCP in prior milestones.'"
behavior_unverified_items:

  - truth: "The Claude/OpenCode /context-explore command actually invokes context_explore live and surfaces real citations in the response (roadmap SC1)."
    test: "Run /context-explore \"<query>\" from a live Claude Code or OpenCode session against a bootstrapped project with CAIRN_EXPLORE_BINARY configured, and observe the response."
    expected: "The command output shows path:line-range citations (or the documented zero-citation note) sourced from a real token_miser explore invocation, not a stub."
    why_human: "Requires a live MCP client session and a configured token-miser binary/FastContext endpoint — cannot be exercised by static grep/file inspection. Explicitly deferred to Phase 9 (CTX-07) by plan design, consistent with how Phases 5-7 deferred live-model-dependent checks."
human_verification:

  - test: "Run /context-explore \"<query>\" from a live Claude Code or OpenCode session against a bootstrapped project with CAIRN_EXPLORE_BINARY configured, and observe the response."
    expected: "The command output shows path:line-range citations (or the documented zero-citation note) sourced from a real token_miser explore invocation, not a stub."
    why_human: "Requires a live MCP client session and a configured token-miser binary/FastContext endpoint — cannot be exercised by static grep/file inspection. Explicitly deferred to Phase 9 (CTX-07) by plan design."
---

# Phase 8: Operating-Layer Wiring Verification Report

**Phase Goal:** Users can invoke context exploration on demand from both the Claude Code and OpenCode operating layers, mirroring the existing command/agent pairing pattern.
**Verified:** 2026-07-05T20:30:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A Claude Code command exists that structurally invokes `context_explore` and is wired to relay citations | ✓ VERIFIED | `claude/commands/context-explore.md` exists; `allowed-tools: Bash, mcp__cairn-memory__context_explore` (exact match, no Read/Grep/Glob); body resolves `repo_root` via `git rev-parse --show-toplevel` + optional path override and instructs passing it explicitly on the tool call; step 2 instructs relaying `content[0].text` verbatim with a one-line error pass-through (using `structuredContent.error` on execution failures, the thrown message on precondition failures — both match the real tool's actual failure shapes in `mcp-memory-server/src/index.ts:1001-1080`). |
| 2 | User can run a Claude Code command that invokes `context_explore` and observes citations surfaced live in the response (roadmap SC1, runtime half) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Command is present and structurally wired to the correct, already-registered tool (verified inputSchema match: `query`, `repo_root`, `timeout_seconds`). No live MCP session was exercised — the plan explicitly defers this to Phase 9 (CTX-07), and Phase 9's SC3 explicitly covers running a `/context-explore` command live end-to-end. See Deferred Items. |
| 3 | An OpenCode command exists that invokes the same `context_explore` tool, self-contained (no agent/workflow file) | ✓ VERIFIED | `opencode/command/context-explore.md` exists; `tools:` map has exactly `bash: true` and `cairn-memory_context_explore: true` (2 total `: true` grants, no read/grep/glob); body is byte-identical in structure/content to the Claude command (same repo-root resolution, same tool call, same report step). No separate agent/workflow file was created. |
| 4 | The OpenCode command installs via a dedicated `sync-opencode-*-assets.sh` script mirroring the existing pattern (parity with Claude) | ✓ VERIFIED | `scripts/sync-opencode-explore-assets.sh` exists, executable, `bash -n` clean. `ASSETS=("command/context-explore.md")` only. Functional round-trip confirmed live: `--apply --live-root $tmp` installs the file and reports "Applied 1 explore asset(s)"; subsequent `--check --live-root $tmp` reports "in sync" and exits 0. No `LEGACY_ASSETS`/`report_legacy_live_assets` dead code (grep count 0). Structure mirrors sibling `sync-opencode-*-assets.sh` scripts (`--check`/`--apply`/`--live-root`/`-h` flags, same dispatch shape). Claude side needs no new script: `scripts/sync-claude-assets.sh` auto-discovers all `claude/**/*.md` via its `find . -type f -name '*.md'` scan — confirmed live by running `--apply` into a temp root and finding `commands/context-explore.md` installed and logged as `installed: commands/context-explore.md`. |
| 5 | `docs/operating.md` documents the new script for install and drift-check, parity with `sync-claude-assets.sh --check` | ✓ VERIFIED | Setup-order block contains `scripts/sync-opencode-explore-assets.sh --apply   # context-explore command` alongside the five siblings; verifying-the-install section contains a `sync-opencode-explore-assets.sh --check` bullet directly after the `sync-claude-assets.sh --check` bullet, framed as a manual sanity check (no false CI claim, consistent with the fact that no sibling script has real CI wiring — confirmed no `sync-` references in `.github/workflows/`). |
| 6 | Both commands are on-demand, agent-invoked entry points, not automatic hooks (roadmap SC3 / fresh-task-only invariant) | ✓ VERIFIED | `claude/hooks/*.sh` still contains exactly 3 scripts (`memory-capture.sh`, `memory-recall.sh`, `memory-wakeup.sh`) — no new hook added. No references to `context-explore`/`context_explore` in `claude/hooks/`. The only discoverable invocation surfaces are the two new slash-command files. |

**Score:** 5/6 truths verified (1 present + wired, behavior-unverified — live invocation deferred to Phase 9 per plan design)

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Live end-to-end invocation of `/context-explore` surfacing real citations (roadmap SC1's runtime half) | Phase 9 | Phase 9 Success Criterion 3: "At least one operating-layer `/context-explore` command (Claude Code and/or OpenCode) is run live end-to-end against a real bootstrapped project — the same verify-by-execution bar proven against the registered `cairn-memory` MCP in prior milestones." Both 08-01-PLAN.md and 08-02-PLAN.md explicitly state this deferral by design, consistent with how Phases 5-7 deferred live-model-dependent checks. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `claude/commands/context-explore.md` | Claude slash command, direct MCP call, citations-only | ✓ VERIFIED | Exists, substantive (42 lines, full objective/context/process body), wired (tool name matches the real registered `context_explore` tool's schema exactly) |
| `opencode/command/context-explore.md` | OpenCode slash command, direct MCP call, self-contained | ✓ VERIFIED | Exists, substantive, wired (`cairn-memory_context_explore` matches the OpenCode server-prefix convention used by the sibling `recall.md`) |
| `scripts/sync-opencode-explore-assets.sh` | Dedicated install/drift script | ✓ VERIFIED | Exists, executable, substantive (188 lines), wired (round-trips clean against a live temp root) |
| `docs/operating.md` | Install + verify documentation parity | ✓ VERIFIED | Two surgical insertions present at the correct sections, no unrelated changes found in diff history |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `claude/commands/context-explore.md` | `mcp__cairn-memory__context_explore` tool | `allowed-tools:` frontmatter grant | WIRED | Exact grant line matches the plan spec; matches the real tool name registered in `mcp-memory-server/src/index.ts:1001` |
| `opencode/command/context-explore.md` | `context_explore` tool | `tools:` map `cairn-memory_context_explore: true` | WIRED | Matches OpenCode's single-underscore server-prefix convention, mirrors `recall.md`'s established pattern for other tools |
| `scripts/sync-opencode-explore-assets.sh` | `opencode/command/context-explore.md` | `ASSETS` array + `ensure_source_assets_exist` | WIRED | Confirmed live: script finds the source file, copies it, and detects it as in-sync afterward |
| `scripts/sync-claude-assets.sh` | `claude/commands/context-explore.md` | generic `find . -type f -name '*.md'` scan | WIRED | Confirmed live: `--apply` into a temp root installed and logged `commands/context-explore.md` with no code change needed |
| `docs/operating.md` | `scripts/sync-opencode-explore-assets.sh` | prose references | WIRED | 2 references found (`--apply` in setup order, `--check` in verification section) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Claude command frontmatter matches plan's exact required grant | `grep -q '^allowed-tools: Bash, mcp__cairn-memory__context_explore$'` | matched | ✓ PASS |
| OpenCode command frontmatter has exactly 2 tool grants | `grep -c ': true' opencode/command/context-explore.md` | 2 | ✓ PASS |
| DEC-no-private-references negative scan (all 3 files) | `grep -niE 'http://\|https://\|127\.0\.0\.1\|localhost\|enterprise\|:8080\|:11434\|gguf\|llama-server'` | no matches (exit 1) on all 3 | ✓ PASS |
| Sync script round-trip (`--apply` then `--check`) | `bash scripts/sync-opencode-explore-assets.sh --apply/--check --live-root $tmp` | both exit 0, reports in-sync | ✓ PASS |
| No `LEGACY_ASSETS` dead code carried over from the wiki template | `grep -c "LEGACY_ASSETS\|report_legacy_live_assets"` | 0 | ✓ PASS |
| `claude/commands/*.md` auto-install picks up the new file with no script change | `bash scripts/sync-claude-assets.sh --apply --live-root $tmp` | logged `installed: commands/context-explore.md` | ✓ PASS |
| Live invocation of either command against a real MCP session | n/a — no running MCP client available in this environment | not run | ? SKIP (routed to human verification / Phase 9) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| CTX-04 | 08-01 | User can invoke context exploration on demand from a Claude Code command | ✓ SATISFIED (codebase) / ⚠️ STALE (tracker) | `claude/commands/context-explore.md` exists and is structurally correct. **However, `.planning/REQUIREMENTS.md` still lists CTX-04 as `[ ]` unchecked and "Pending"** (line 18, line 62) — never updated across either 08-01 or 08-02's commits, even though 08-01-SUMMARY.md's `requirements-completed:` frontmatter claims `[CTX-04, CTX-05]`. This is a documentation-tracking gap, not a functional gap: the artifact is real and correct, but the requirements traceability doc was not updated to match. |
| CTX-05 | 08-02 | User can invoke context exploration on demand from an OpenCode command, installed via `sync-opencode-*-assets.sh` | ✓ SATISFIED | Both command file and install script exist and are verified; REQUIREMENTS.md correctly marks this `[x]` Complete. |

### Anti-Patterns Found

None. No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers, no stub returns, no hardcoded-empty stubs found in any of the 4 phase files.

### Human Verification Required

### 1. Live end-to-end `/context-explore` invocation

**Test:** From a live Claude Code or OpenCode session with `CAIRN_EXPLORE_BINARY` configured, run `/context-explore "<some real repo-exploration query>"` against a bootstrapped project.
**Expected:** The response surfaces real `path:line-range` citations (or the documented zero-citation note `(no citations found; turns=N, tool_calls=N)`), not a stub or error, and the command does not itself read/summarize the cited files.
**Why human:** This requires a live MCP client session and a configured `token-miser` binary — outside the reach of static file inspection. This is explicitly and deliberately deferred to Phase 9 (CTX-07 / roadmap SC3), which owns the live-invocation gate for this milestone, consistent with the same deferral pattern used in Phases 5-7.

## Gaps Summary

No blocking gaps. All four required artifacts exist, are substantive, and are correctly wired to the already-registered Phase 7 `context_explore` tool. The install-path parity for OpenCode (`sync-opencode-explore-assets.sh`) is functionally verified via a live round-trip, and Claude's zero-script auto-install path was independently confirmed to actually pick up the new file. The on-demand/no-hook constraint (SC3) holds — hook count unchanged, no automatic invocation path exists.

One structural finding, not a functional blocker: `.planning/REQUIREMENTS.md` was not updated to mark CTX-04 complete (it still reads `[ ]` / "Pending") despite the Claude command being fully delivered in Plan 01 and the plan's own SUMMARY claiming `requirements-completed: [CTX-04, CTX-05]`. Recommend a one-line fix to REQUIREMENTS.md alongside the next commit in this phase's line; not blocking phase closure since the underlying artifact is real and verified, but flagged so the tracker doesn't silently drift from the codebase.

The one item genuinely left open is runtime/live proof that invoking either command actually surfaces real citations from a live token-miser/FastContext round-trip — this is by design deferred to Phase 9, which has an explicit, matching success criterion (SC3) for exactly this check. It is not treated as a gap of this phase, but it does route this verification to `human_needed` per the decision tree since a present-but-behavior-unverified item exists.

---

_Verified: 2026-07-05T20:30:00Z_
_Verifier: Claude (gsd-verifier)_
