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
- Optional hybrid lexical/identifier admission, explicit aliases, match reasons
  and valid empty results; similarity scores are not factual confidence.
- Curated Markdown as a credible baseline; indexing policy and storage format
  are separate decisions.
- Superseding a fact without losing history.
- Session-end candidate extraction and `/memory-review` as the acceptance gate.
- Typed node metadata, tags, and hard filters as an independent opt-in.
- Why hindsight notes and logical note address spaces are not reviewed memory.
- Deleting synthetic course memory safely.

## Hands-on lab

Store three synthetic facts in different categories, retrieve them by an
imprecise query, supersede one, inspect its history, and reject one staged
candidate.

From a source checkout, run:

```sh
npm --prefix mcp-memory-server run study:memory-retrieval
```

Compare the 0/100/1,000-distractor results and explain
why Markdown with the same admission policy matches Cairnkeep. Inspect the
semantic-only case that lexical modes miss; do not describe the synthetic
report as general accuracy. Repeat retrieval after superseding a synthetic
fact and starting a fresh client, verifying the new value and explicit history.

## Acceptance criteria

- The learner can justify the scope and category for each fact.
- Search finds a fact without requiring its exact key.
- A nearby but incorrect identifier and an unrelated query return no hybrid
  match; aliases never widen scope or grant authority.
- Superseding preserves the prior value in history.
- No extracted candidate becomes durable without an explicit review action.
- Enabling typed nodes changes discovery structure, not the authority of a fact.

## Optional reranker extension

From the feature checkout, run `npm --prefix mcp-memory-server run check:memory-reranker`
without a provider. Then, only with explicit synthetic-data/provider consent,
compare the frozen live study in the retrieval guide. Explain both the 6/16
to 15/16 first-result improvement and the single regression; this is not a
general accuracy or agent-productivity claim. Show that reranking is off by
default, has a separate credential, preserves admission and exact-key priority,
and falls back without mutating stored facts. A failed provider must make
`cairn doctor` fail even though search still works. Read-only is not a promise
of zero network traffic: configured search advertises open-world behavior.

## Source material

- [Operating guide](../../operating.md#the-workflow)
- [Memory retrieval and the Markdown baseline](../../memory-retrieval.md)
- [Recording supplement](../video-scripts/V04-memory-retrieval-supplement.md)
- [Storage and deployment](../../storage.md)
- [L14 - Typed memory and controlled import](L14-typed-memory.md)
