# L10 - Faster context exploration

**Status:** Brief
**Track:** Operator
**Planned time:** 30 minutes

## Outcome

Use optional token-miser/FastContext exploration with compact citations and
understand caching, routing, and fallback behavior.

## Planned lesson

- `context_explore` as a thin delegate rather than a second memory store.
- Repository root, query, citations, and cache keys.
- Cross-referencing citations with memory and the wiki.
- Optional pre-task invocation and its privacy implication.
- `route_check` health versus model-selection policy.
- Failure behavior when the optional subprocess is absent.

## Hands-on lab

Explore a synthetic repository, verify every returned path and line range,
repeat the query to observe caching, modify the repository, and confirm cache
invalidation. Disable the binary and verify standalone Cairnkeep remains usable.

## Acceptance criteria

- Every reported citation resolves to current repository content.
- Dirty-state or HEAD changes prevent stale cache reuse.
- The learner distinguishes exploration output from durable memory.
- An unavailable explorer fails locally without breaking memory operations.

## Planned video

Compare a broad manual search with one cited exploration result. Target 10
minutes and keep routing as a separate optional chapter.

## Source material

- [Operating guide](../../operating.md#exploration-cache-context_explore-on-by-default)
- [token-miser](https://github.com/cairnkeep/token-miser)
