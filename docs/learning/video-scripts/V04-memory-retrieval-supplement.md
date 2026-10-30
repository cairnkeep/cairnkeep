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
including serialized CallToolResult text/structured content, not transport
envelopes. Follow one actual navigation with an exact read. Show a
legacy null/untracked reference, then a source change invalidating an entity;
do not demonstrate production conversion or claim facts were verified by reading.

Compare the independently enumerated Markdown arm and actual cold/warm costs.
Do not claim caching is faster: every map still revalidates current visibility
and revisions. No model/provider or automatic `AGENTS.md` injection occurs.
Explain private cache sensitivity and separate HTTP consent. This is a recording
brief, not a claim that a new segment has been recorded or published.

## Unreleased explicit-feedback recording brief

Use a disposable tracked project and the existing harness MCP connection. Call
`memory_context_search` with an opaque task digest; zoom into current provenance
and the session-bound receipt. Explicitly record `useful`, then repeat it to show
idempotency. A conflicting outcome, another session/project and source ABA must
refuse. Inspect `memory-context feedback export --scope project` and verify no
query, key, source value or receipt is copied into the feedback records. Show
exact-ID forget plan/apply and separate HTTP consent/profile restrictions.

Collection changes no ranking and self-reported feedback is not truth, human
review or anti-Sybil evidence. No production conversion, activation, fabricated
model-quality gain or new recording/publication is implied by this brief.
In the source-only coherence test, pause at the synthetic reranker barrier and
change tags/type without changing text. Show omission with `truncated: true`,
then a fresh correctly filtered search; never attach current provenance to old
typed fields. Keep the isolated legacy observer and its locking limits explicit.

For an optional source-only ranking segment, run the real feedback policy/MCP
tests and `run-memory-continuity-study.mjs --all --check --summary`. Pause on the
no-held-out-improvement decision: unchanged first-hit/recall, stale count and
negatives, with added provenance bytes and local latency. Show the opt-in kill
switch, three-task minimum and bounded one-slot swap using only synthetic data.
Explain that fabricated task IDs remain possible and recommend collection-only.
Do not present independent feature controls as a combined agent-quality gain.

## Joint continuity recording brief (unreleased source-only)

Use the [combined workflow guide](../../memory-continuity-workflow.md), a patched
runtime and this exact source checkout. This is an updated brief, not a claim
that another segment has been recorded or published. Type these real commands
at readable speed, pausing after each result:

```sh
npm run build:server
node mcp-memory-server/scripts/smoke-memory-context-integration.mjs
node mcp-memory-server/scripts/smoke-memory-integrated-study.mjs
node mcp-memory-server/scripts/run-memory-continuity-study.mjs --features freshness,links,maps,feedback --check --summary
```

Zoom into the actual seven-call sequence, then pause on `map_truncated` and
`related_seed`: the alias is explicit caller input, not an invented complete map.
Show all three exact linked values versus the original one-record search, then
the independent Markdown result. Keep additional curation, calls and bytes on
screen; the 48 plan/apply calls are the whole adversarial replay, not a minimum
onboarding requirement. Compare native MCP with the in-process control without
claiming a storage-speed advantage.

Pause on the old route's warning: the stale value remains, and no tool chooses
truth. Show the ordinary-query no-gain result, leave ranking off, and explain why
explicit feedback is neither factual verification nor permission. Show metadata
and ABA refusals, different-client receipt rejection, then the same-secret
managed restore control with retained historical votes and zero eligibility.
Explain the separate HTTP consent and trusted-bearer-domain limitation.

Use short terminal zooms and result comparisons, with silence after a refusal
and before the next command. Never substitute a production store, display real
credentials or imply new native-harness/human-pilot qualification. Close by
distinguishing this technical recording brief from an actually produced video.
