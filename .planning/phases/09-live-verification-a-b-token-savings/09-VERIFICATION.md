---
phase: 09-live-verification-a-b-token-savings
verified: 2026-07-06T00:00:00Z
status: passed
score: 10/10 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "CTX-07 is accounted for (checked off, status flipped to Complete) in .planning/REQUIREMENTS.md"
    status: resolved
    resolution: "Fixed inline during phase close-out: REQUIREMENTS.md line 24 flipped `- [ ]` → `- [x]` and the Traceability table row `| CTX-07 | Phase 9 |` flipped `Pending` → `Complete`. Non-functional doc-sync only; all technical must-haves were already verified."
    reason: "REQUIREMENTS.md still shows CTX-07 as an unchecked `- [ ]` item (line 24) and 'Pending' in the Traceability table (line 65), even though Phase 9 (which closes CTX-07) is marked complete in ROADMAP.md and both 09-01-SUMMARY.md and 09-02-SUMMARY.md declare `requirements-completed: [CTX-07]`. Every other v1.2 requirement (CTX-01..CTX-06) was flipped to `[x]` / 'Complete' when its owning phase finished; CTX-07 is the one outlier left stale."
    artifacts:
      - path: ".planning/REQUIREMENTS.md"
        issue: "Line 24 checkbox unchecked; line 65 Traceability table status cell reads 'Pending' instead of 'Complete'."
    missing:
      - "Flip `- [ ] **CTX-07**` to `- [x] **CTX-07**` on line 24."
      - "Update the Traceability table row `| CTX-07 | Phase 9 | Pending |` to `| CTX-07 | Phase 9 | Complete |` on line 65."
---

# Phase 9: Live Verification + A/B Token-Savings Verification Report

**Phase Goal:** Milestone close-out gate — measured (not cited) before/after token count on cairnkeep's own harness against a real bootstrapped project (CTX-07).
**Verified:** 2026-07-06
**Status:** passed (sole documentation-sync gap — CTX-07 traceability — resolved inline during close-out; all technical/functional must-haves verified)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Committed A/B harness computes native-vs-`context_explore` byte/char delta deterministically for both sides, on cairnkeep's own repo (ROADMAP SC-1) | ✓ VERIFIED | `scripts/verify-token-savings-ab.sh --native --repo .` re-run live during this verification: exits 0, offline, prints deterministic per-query `bytes=`/`chars=` lines for all 5 queries with no backend. `run_explore()` shells the real `token_miser explore` binary and counts only the citation text. D-02 (09-CONTEXT.md) explicitly resolves the "real bootstrapped project" SC wording: headline = cairnkeep's own repo, `--repo` override exists for a fresh-bootstrap run. |
| 2 | `--self-test` passes offline as the Nyquist backstop (byte-delta arithmetic, `chars/4` estimate, D-03 gate both directions, renderCitations-shape reproduction) — no backend required | ✓ VERIFIED | Re-ran `scripts/verify-token-savings-ab.sh --self-test` live: exit 0, prints `[self-test:delta] OK`, `[self-test:gate] OK`, `[self-test:render] OK`, `[self-test] PASSED`. `self_test_render()` feeds the same `render_citation_text()` jq expression `run_explore()` calls, against a canned Evidence JSON fixture, and asserts the exact `path:start-end` shape — confirmed byte-for-byte against the real `renderCitations()` in `mcp-memory-server/src/index.ts:604-615`. |
| 3 | `--explore` fails loud (non-zero, documented-gap message), never a silent skip, when no exploration binary is available (D-04) | ✓ VERIFIED | Re-ran `CAIRN_EXPLORE_BINARY='' PATH=/usr/bin:/bin scripts/verify-token-savings-ab.sh --explore --repo .`: exit 1, stderr prints `FATAL: no exploration binary found ... documented gap, not a silent skip (D-04)`. |
| 4 | Byte/char delta is the reported anchor; the token number is a provider-neutral `chars/4` estimate, never a vendor tokenizer (D-01a) | ✓ VERIFIED | `est_tokens()` in the script is literally `chars / 4`, documented inline as the provider-neutral heuristic; no tokenizer file/dependency added. `09-AB.md` Section 2 states this explicitly ("D-01a note: the byte delta is the anchor... never a vendor tokenizer"). |
| 5 | Running the harness `--full` against the real backend yielded a measured per-query + median before/after byte delta plus a `chars/4` token estimate (SC-2) | ✓ VERIFIED | `09-AB.md` §2 records two tight, manually-verified queries: renderCitations 52620→38 bytes (99.93% savings, ~13155→~10 est. tokens) and runCommand 42154→38 bytes (99.91%, ~10538→~10 est. tokens). §3 records the harness's default broad query set's native side reproducing the offline deterministic numbers exactly (total 195,299 native bytes across 5 queries). |
| 6 | The measured number and the D-03 verdict are recorded in the committed `09-AB.md` and referenced from the phase SUMMARY (SC-2 literal satisfaction) | ✓ VERIFIED | `09-AB.md` committed at `4420366`. `09-02-SUMMARY.md` line 68 states: "09-AB.md reference: see [09-AB.md](./09-AB.md) ... this satisfies SC-2's requirement." |
| 7 | D-03 net-savings gate is honored: PASS recorded only on the verified queries; the unreliable/hallucinated broad-set figure is a documented finding, never a silent pass | ✓ VERIFIED | `09-AB.md` §4: "**PASS** — on the verified tight queries... Cairnkeep's ~99.9% pinpoint-query magnitude need not match FastContext's own paper figure." §3 explicitly disqualifies the naive ~99.8% broad-set number: "This number is explicitly NOT the CTX-07 headline... built entirely on empty or hallucinated citations." This is the correct D-03/D-01 behavior per the task's own framing, not a defect. |
| 8 | At least one live `/context-explore`-equivalent run happened end-to-end against the real backend, with a verified citation captured (SC-3) | ✓ VERIFIED (with a noted literal-wording nuance) | `09-AB.md` §5 records two live runs corroborating the explore side (`renderCitations` → `mcp-memory-server/src/index.ts:604-615`, `runCommand` → `mcp-memory-server/src/index.ts:406-450`), both manually verified correct against the live tree. **Nuance:** §5's own text states the run went "via the same MCP `context_explore` tool that the `/context-explore` command wraps" rather than literally typing `/context-explore <query>` in a Claude Code session (the literal instruction in 09-02-PLAN.md's `<how-to-verify>`). `claude/commands/context-explore.md` is a 3-step, no-branching wrapper (resolve repo root via `git rev-parse` → call `context_explore` with explicit `repo_root` → relay `content[0].text` verbatim) — the recorded run passed the same explicit `repo_root` (cairnkeep's own repo) a `git rev-parse` resolution would have produced, so the tool-call surface actually exercised is identical. This is disclosed transparently in the doc, not hidden, and the task instructions for this verification pass itself frame the bar as "`/context-explore`-equivalent," so this is treated as satisfying intent rather than a gap. |
| 9 | No non-loopback endpoint host/IP, model alias, or vendor tokenizer is committed in the harness or `09-AB.md` (DEC-no-private-references); no source changes to `context_explore` or the `/context-explore` commands | ✓ VERIFIED | `grep -niE 'https?://'` and model-alias greps against `09-AB.md` and the script: zero matches. `git show --stat` on all 4 phase-9 commits (`25fc384`, `c3848a1`, `ac10b0a`, `4420366`) touches only `scripts/verify-token-savings-ab.sh` and `09-AB.md` — `mcp-memory-server/src/index.ts`, `claude/commands/context-explore.md`, `opencode/command/context-explore.md` show zero diff across the phase's commit range. |
| 10 | CTX-07 is accounted for (checked off, flipped to Complete) in `.planning/REQUIREMENTS.md` | ✗ FAILED | `.planning/REQUIREMENTS.md` line 24 still reads `- [ ] **CTX-07**` and line 65's Traceability table still reads `| CTX-07 | Phase 9 | Pending |`, despite Phase 9 being marked complete in `ROADMAP.md` and both plan SUMMARYs declaring `requirements-completed: [CTX-07]`. Every sibling requirement (CTX-01..CTX-06) was flipped when its phase closed; this one was missed. |

**Score:** 9/10 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/verify-token-savings-ab.sh` | Committed, executable, staged A/B harness (`--self-test`/`--native`/`--explore`/`--full`/`-h`) | ✓ VERIFIED | 557 lines, `-rwxrwxr-x`, `bash -n` clean. All 4 stages re-run live during this verification (see truths 1-3 above); `main()` dispatches to each stage function. |
| `.planning/phases/09-live-verification-a-b-token-savings/09-AB.md` | Verdict doc: recipe table, measured A/B, `chars/4` estimate, D-03 verdict, SC-3 transcript | ✓ VERIFIED | All 5 required sections present (recipe table, tight-query A/B, broad-set D-01 finding, D-03 verdict, SC-3 transcript); no debt markers, no leaked endpoint/model values. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `scripts/verify-token-savings-ab.sh` (`render_citation_text`) | `mcp-memory-server/src/index.ts:604-615` (`renderCitations`) | jq expression reproduces the exact `path:start-end` newline-joined shape / empty-citations note | ✓ WIRED | Read both; the jq expression's two branches (empty-citations note string, `path:start-end` join) match `renderCitations()` field names and string format verbatim. `self_test_render()` proves this offline against canned fixtures matching both branches. |
| Harness env vars | `CAIRN_EXPLORE_BINARY` / `CAIRN_EXPLORE_REPO_ROOT` | `resolve_explore_binary()` reads `CAIRN_EXPLORE_BINARY` (same var name `context_explore`'s MCP registration reads); repo root defaults to `CAIRN_EXPLORE_REPO_ROOT` or `--repo` override | ✓ WIRED | Confirmed both env vars read in script; `resolve_explore_binary()` falls back to `token_miser` on PATH. |
| `09-AB.md` measured number | Harness `--full` evidence-log output shape | Per-query `[delta]` lines + `[median]` + `[verdict]` lines match the recorded table/verdict shape in `09-AB.md` | ✓ WIRED | `run_full()`'s per-query/median/verdict line formats structurally match `09-AB.md`'s §2/§3/§4 tables (the raw evidence log itself is gitignored/ephemeral and not expected to be committed — confirmed `*.log` in `.gitignore`). |
| SC-3 transcript | Live `/context-explore` run (`claude/commands/context-explore.md`) | Recorded citation output in `09-AB.md` §5 | ✓ WIRED (nuance noted in Truth #8) | Command file unchanged (confirmed via git diff across phase commits); recorded run used the same underlying tool call with the same explicit `repo_root` the command would resolve to. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CTX-07 | 09-01-PLAN.md, 09-02-PLAN.md | Measured before/after A/B on cairnkeep's own harness, cairnkeep's own number | ✓ SATISFIED (functionally) / ✗ BLOCKED (traceability doc) | Technical substance fully evidenced (harness + `09-AB.md`), but `.planning/REQUIREMENTS.md` line 24/65 was never flipped from `[ ]`/"Pending" to `[x]`/"Complete" — see gap above. |

No orphaned requirements found — CTX-07 is the only requirement ID declared across both plans' `requirements:` frontmatter, and it is the only one mapped to Phase 9 in REQUIREMENTS.md's Traceability table.

### Anti-Patterns Found

None blocking. No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK` markers in `scripts/verify-token-savings-ab.sh` or `09-AB.md`. All "placeholder" string matches are legitimate prose (documenting the loopback-default convention and one query's literal subject matter — "infra-root placeholder value" — not a stub marker).

**ℹ️ Info (non-blocking, worth noting for future runs):** the harness's default broad-query-set `git grep` recipe is not perfectly stable across time once `09-AB.md`/the harness's own header comment (both tracked files containing the literal grep patterns as prose, e.g. "git-provider") are committed to the repo — a later `--native` run can pick up the doc's own text as an additional grep hit, shifting the top-12-hit window slightly (observed: query 3 "git-provider" measured 23,067 bytes when re-run live during this verification vs. 23,034 bytes recorded in `09-AB.md` §3, a 33-byte drift, with no source-file changes in between). This does not affect the CTX-07 headline (Section 2's tight queries, which use different patterns not present in the recipe table's own prose) and does not change the PASS verdict; it is a minor self-referential-contamination risk for the harness's broad query set on future re-runs, not a correctness bug in the delta/gate logic itself.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `--self-test` offline Nyquist backstop passes | `scripts/verify-token-savings-ab.sh --self-test` | exit 0, `[self-test] PASSED` | ✓ PASS |
| `--native` computes deterministic offline byte/char counts | `scripts/verify-token-savings-ab.sh --native --repo .` | exit 0, 5 `[native] query=N ... bytes=... chars=...` lines | ✓ PASS |
| `--explore` fails loud with no binary (D-04) | `CAIRN_EXPLORE_BINARY='' PATH=/usr/bin:/bin scripts/verify-token-savings-ab.sh --explore --repo .` | exit 1, `FATAL: no exploration binary found ... documented gap` | ✓ PASS |
| `--help` documents all stages | `scripts/verify-token-savings-ab.sh --help` | exit 0, lists `--self-test`/`--native`/`--explore`/`--full`/`-h` + env vars | ✓ PASS |
| No non-loopback endpoint/model committed | `grep -niE 'https?://\|sonnet\|opus\|gpt\|gemini\|llama' 09-AB.md` | zero matches | ✓ PASS |
| No source drift into `context_explore`/commands | `git show --stat` on all 4 phase-9 commits | only `scripts/verify-token-savings-ab.sh` and `09-AB.md` touched | ✓ PASS |

This phase produces no server/service that needs to be started; all checks above are direct, non-mutating command runs against the committed script and doc.

### Probe Execution

No `scripts/*/tests/probe-*.sh` convention or explicit probe declarations found in this phase's PLAN/SUMMARY docs — this phase's own verification instrument (`scripts/verify-token-savings-ab.sh --self-test`) fills that role and is covered under Behavioral Spot-Checks above.

### Human Verification Required

None. The one live-run nuance (Truth #8 — direct MCP tool call vs. literal `/context-explore` slash-command invocation) is resolved by this verification's own instructions, which explicitly frame the bar as "`/context-explore`-equivalent," and by the trivial-wrapper equivalence argument documented above — no further human judgment call is needed on that point.

### Gaps Summary

One gap, purely a documentation-traceability miss, not a functional/code gap: `.planning/REQUIREMENTS.md` was never updated to reflect CTX-07's closure. Line 24's checkbox is still unchecked and the Traceability table (line 65) still reads "Pending," while every sibling v1.2 requirement (CTX-01 through CTX-06) was flipped to `[x]`/"Complete" when its owning phase finished. This is a one-line-times-two fix (flip the checkbox, flip the table cell) and does not indicate any missing engineering work — the harness, the live measured number, the D-03 verdict, and the SC-3 corroborating run are all present, substantive, wired, and independently re-run-verified as part of this report. Recommend fixing REQUIREMENTS.md before/at milestone close-out (`/gsd-complete-milestone` or a direct edit), then this phase is clean.

---

_Verified: 2026-07-06_
_Verifier: Claude (gsd-verifier)_
