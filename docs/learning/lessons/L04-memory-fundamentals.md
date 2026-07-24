# L04 - Memory fundamentals

**Status:** Brief
**Track:** Practitioner
**Planned time:** 35 minutes

## Outcome

Choose an appropriate scope and key, search by meaning, inspect history, and
review extracted candidates before they become durable memory.

## Planned lesson

- Identity, project, and global scopes.
- Key families: `decisions/`, `pitfalls/`, `patterns/`, `bugs/`,
  `constraints/`, and `conventions/`.
- Exact read versus semantic search and substring fallback.
- Superseding a fact without losing history.
- Session-end candidate extraction and `/memory-review` as the acceptance gate.
- Deleting synthetic course memory safely.

## Hands-on lab

Store three synthetic facts in different categories, retrieve them by an
imprecise query, supersede one, inspect its history, and reject one staged
candidate.

## Acceptance criteria

- The learner can justify the scope and category for each fact.
- Search finds a fact without requiring its exact key.
- Superseding preserves the prior value in history.
- No extracted candidate becomes durable without an explicit review action.

## Planned video

Open with two contradictory memories, demonstrate search and superseding, then
finish with the review queue. Target 12-15 minutes. Write the complete script in
Wave 2 after the lab fixture is executable.

## Source material

- [Operating guide](../../operating.md#the-workflow)
- [Storage and deployment](../../storage.md)
