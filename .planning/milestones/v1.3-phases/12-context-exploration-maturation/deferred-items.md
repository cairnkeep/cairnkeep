# Phase 12 — Deferred Items (out of scope for Plan 03)

## verify-no-private-references.sh fails on pre-existing commit history (not from Plan 03)

**Found during:** Plan 03, Task 3 verification (`bash scripts/verify-no-private-references.sh`).

**Issue:** Stage 3 (commit-message AI-authorship scan) fails on two commits
that predate this plan's worktree base (`29b85c1f...`):

```
80f363d1178d692334a0f30a8787088e76f06740 chore(12-01): sync package-lock license field with package.json
9836b1c... docs(12-02): complete cross-reference enrichment plan
```

Both carry the assistant's default AI co-authorship git trailer (exact string
omitted here so the tracked-tree scan stays clean), which violates
`DEC-no-ai-authorship [LOCKED]` (PROJECT.md).

**Scope:** Confirmed via `git merge-base --is-ancestor` that the offending
commit is an ancestor of this plan's branch base — it was created in an
earlier wave (Plan 01/02) before Plan 03 started, not by this plan's own
commits. Verified none of Plan 03's own commits (`3e47c8b`, `7999469`,
`60f8861`) contain any AI-authorship trailer.

**Action:** Not fixed here — rewriting an already-merged ancestor commit's
message is a destructive git-history operation outside a single plan's file
scope and outside the destructive-git-operations this executor is permitted
to perform. Left for the user/orchestrator to decide (e.g. `git commit
--amend`/interactive rebase on the affected commits before this milestone's
history is considered final, or an explicit override-closeout note).

**Verification of scope:** `git log 29b85c1..HEAD --format='%B' | grep -i
"co-authored\|claude fable\|anthropic\|generated with"` returns nothing —
Plan 03 introduces zero new violations.

**RESOLVED (orchestrator, phase close-out):** The two offending unpushed
commit messages were rewritten in place via `git filter-branch --msg-filter`
over the unpushed range (`origin/main..HEAD`, all local-only commits) to strip
the trailer lines, and the literal trailer quotes in this file and the Plan 03
SUMMARY were reworded so the tracked-tree scan passes.
`verify-no-private-references.sh` is green as of this commit.
