# L05 - The daily workflow

**Status:** Brief
**Track:** Practitioner
**Planned time:** 40 minutes

## Outcome

Use memory, the cited wiki, alignment artifacts, and automatic hooks without
confusing derived knowledge with canonical project sources.

## Planned lesson

- SessionStart recall, pre-edit recall, and SessionEnd candidate staging.
- Optional structured capture, hindsight distillation, and compaction continuity
  as separate post-session paths that do not bypass memory review.
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
- Captured evidence and notes are never described as canonical project state.
- The learner can describe what to do at session start, before editing, and at
  session end.

## Source material

Optional unreleased source-checkout exercise: after a synthetic cross-harness
handoff, request `memory_map`, inspect `truncated`, and follow navigation with an
exact read. Do not inject a global map at every startup or replace maintained
sources with a prefix count. Maps are deterministic and provider-free; the
[separate map guide](../../memory-maps.md) explains scope and cache boundaries.

For a complete optional source-only exercise, follow the
[joint continuity workflow](../../memory-continuity-workflow.md). Start with
ordinary task-derived recall, confirm the project scope, orient with a bounded
map, follow a caller-known explicit alias and read exact sources. Inspect an
overdue assertion instead of silently choosing truth. Repeat from another MCP
client/generic folder using shared identity, while keeping project selection
explicit. At the end, review durable changes separately from optional usefulness
feedback; feedback neither approves a write nor changes ranking by collection.
The lab is synthetic and unreleased, not a rehearsed new video or an agent task
quality result. The existing daily workflow remains usable without these tools.

- [Operating guide](../../operating.md#the-workflow)
- [Git provider configuration](../../git-providers.md)
- [L13 - Session evidence and hindsight](L13-session-evidence.md)
