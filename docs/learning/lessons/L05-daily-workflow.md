# L05 - The daily workflow

**Status:** Brief
**Track:** Practitioner
**Planned time:** 40 minutes

## Outcome

Use memory, the cited wiki, alignment artifacts, and automatic hooks without
confusing derived knowledge with canonical project sources.

## Planned lesson

- SessionStart recall, pre-edit recall, and SessionEnd candidate staging.
- `/wiki-ingest`, `/wiki-query`, and `/wiki-lint`.
- Sparse, citation-heavy wiki pages rather than copied documentation.
- Alignment gaps, contradictions, and project planning artifacts.
- `/memory-sync` for configured git-provider state.
- A start-of-task and end-of-task checklist.

## Hands-on lab

Ingest one synthetic ADR, query it with citations, change the canonical ADR,
observe staleness, refresh the derived page, and review the session candidate
queue before exiting.

## Acceptance criteria

- Every derived claim links to a canonical source.
- A stale or contradictory page is detected rather than silently trusted.
- Automatic hooks are observable and do not bypass human memory review.
- The learner can describe what to do at session start, before editing, and at
  session end.

## Planned video

Follow one small feature from session start to reviewed handoff. Target 15
minutes and split wiki maintenance into a second video if rehearsal runs long.

## Source material

- [Operating guide](../../operating.md#the-workflow)
- [Git provider configuration](../../git-providers.md)
