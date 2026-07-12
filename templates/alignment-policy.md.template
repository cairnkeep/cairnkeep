# Alignment Collaboration Policy

This repository uses the alignment-governance workflow to keep code, repo docs, `AGENTS.md`, and durable memory consistent.

## Branch Rules

- Default branch: `REPLACE_WITH_DEFAULT_BRANCH`
- Do not push feature work directly to `REPLACE_WITH_DEFAULT_BRANCH`.
- Use a feature branch, run `/gsd-align-audit` when the branch changes code, docs, `AGENTS.md`, or durable behavior, and keep branch-local findings under `.planning/alignment/BRANCH-NOTES/` until the work is accepted.

## Gap Lifecycle

- Open or refresh gaps with `/gsd-align-audit`.
- Turn an accepted gap into a remediation plan with `/gsd-align-plan <gap-id>`.
- If multiple people propose different fixes for the same gap, keep one canonical gap ID and record alternative proposals through `proposal_type`, `supersedes`, and `superseded_by` instead of opening unrelated duplicates.
- Close accepted gaps only from the default branch with `/gsd-align-promote`.

## Review Expectations

- Blocker and high-severity gaps should not merge without at least one human review.
- Treat the repo-local gap ledger as the shared state for ownership, severity, and promotion status.
- If a gap is already claimed by another branch or person, coordinate before taking it over.

## Promotion Rules

- Durable project memory only receives accepted branch-safe conclusions.
- Refresh the project-doc AnythingLLM workspace after merge when docs or `AGENTS.md` changed in a way retrieval should reflect.
- Keep durable memory entries concise and factual.