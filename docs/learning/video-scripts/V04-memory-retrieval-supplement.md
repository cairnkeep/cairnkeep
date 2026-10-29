# V04 supplement — Finding the current fact without flooding context

Technical recording brief; no video is claimed as recorded. Use the source
checkout containing hybrid memory search and only invented fixture content.

## Real terminal demonstration

Type at readable human speed, leaving pauses after each command:

```sh
npm --prefix mcp-memory-server run build
npm --prefix mcp-memory-server run check:memory-retrieval
npm --prefix mcp-memory-server run study:memory-retrieval
```

Zoom into the real MCP test's new-process handoff, superseded-history exclusion,
wrong-identifier refusal and provider-failure result. Demonstrate an MCP call
with `strategy: "hybrid"` and `explain: true`; show matched terms and source
locators, then show an unrelated query returning zero results. Explain that
agents still verify maintained sources and do not automatically correct memory.

## Evidence and pacing

Show the frozen 1,000-distractor table: 3/9 first hits for substring, 8/9 for
BM25 and hybrid. Pause on the difference in irrelevant bytes and negative hits.
Then highlight that Markdown with the same admission policy also achieves 8/9
and zero negative hits. State that storage format did not cause the gain.

Finish with the semantic-only paraphrase that lexical modes miss. Explain that
provider-specific thresholds need their own evidence, that a ranking score is
not confidence, and that the attempted live study failed with HTTP 502. Do not
invent a successful live result or claim general task-quality improvements.
Use short terminal zooms and side-by-side result comparisons instead of static
slides; keep credentials and real memory off screen.

## Optional reranker segment (2.24.0 or newer source checkout)

Record real `check:memory-reranker` output, pausing on the no-network default,
scope/history canaries and provider-failure fallback. With explicit synthetic
provider configuration, run `run-memory-reranker-study.mjs --live --summary`.
Do not show credentials or endpoint addresses. Compare the two arms using the
same embeddings: the first frozen run improved first hits from 6/16 to 15/16,
but `current-not-history` regressed. Zoom into that failure rather than hiding
it. Explain that the earlier HTTP-502 study is separate and remains a failed
run. Demonstrate the doctor's synthetic request, then disable reranking and
show unchanged memory text and provenance. This is a recording brief, not a
claim that this segment has been filmed or published.

## Source-only compact-map segment (unreleased)

Use only the disposable synthetic fixture. Type and pause on:

```sh
node mcp-memory-server/scripts/smoke-memory-map.mjs
node mcp-memory-server/scripts/smoke-memory-map-mcp.mjs
node mcp-memory-server/scripts/run-memory-continuity-study.mjs --features freshness,links,maps --check --summary
```

Zoom into `partitions`, prefix/entity navigation, a freshness warning, an
ambiguity label and `truncated`. Explain the 4 KiB default/8 KiB hard UTF-8 budget
including MCP framing. Follow one actual navigation with an exact read. Show a
legacy null/untracked reference, then a source change invalidating an entity;
do not demonstrate production conversion or claim facts were verified by reading.

Compare the independently enumerated Markdown arm and actual cold/warm costs.
Do not claim caching is faster: every map still revalidates current visibility
and revisions. No model/provider or automatic `AGENTS.md` injection occurs.
Explain private cache sensitivity and separate HTTP consent. This is a recording
brief, not a claim that a new segment has been recorded or published.
