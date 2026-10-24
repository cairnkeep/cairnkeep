# Memory retrieval and the Markdown baseline

Status: available since Cairnkeep 2.23.0 as an opt-in strategy. Existing search
defaults are unchanged; the developer study commands require a source checkout.

Cairnkeep keeps authoritative memory text readable. Ordinary memory lives in
AgentFS-backed SQLite; derived note address spaces and wiki pages use files.
Optional embeddings are a rebuildable search aid, not fine-tuning, encrypted
storage, or a replacement for the original text. Semantic search computes
missing vectors lazily and caches them outside the authoritative records.
Configured providers receive memory text and queries; an endpoint can run
locally or remotely. See [storage](storage.md).

## Opt-in hybrid search

Existing `memory_search` calls retain legacy behavior and response shapes.
Clients can explicitly select the new strategy through MCP:

```json
{
  "scope": "project",
  "query": "office tunnel access",
  "strategy": "hybrid",
  "top_k": 5,
  "explain": true
}
```

The result has `mode: "hybrid"`, ordinary original-text `results`, and a
`retrieval` diagnostic. Empty results are valid: `empty_reason` distinguishes
an empty scope from `no_relevant_memory`. `embedding_status` distinguishes
unconfigured, available, failed and not-used providers. Ranking scores are
labelled `ranking-not-confidence`; neither a cosine nor a lexical score is a
probability that a statement is true.

The new strategy currently supports the `memory` address space. File-backed
note searches retain their existing exact behavior; requesting hybrid there
fails explicitly. Existing `memory_read` key/query semantics are unchanged.

### Selection and ranking

1. Resolve explicit scopes and apply enabled typed-node hard filters before
   ranking or embedding. Neither aliases nor semantic similarity widens scope.
2. Tokenize Unicode words, ignore a small source-defined set of common
   English/Italian stop words, and rank with BM25 (key terms appear twice).
   Query terms are capped at 64; tokenization is capped at 4,096 terms per field.
3. Admit lexical matches covering at least 60% of significant query terms,
   with at least two matched terms for multi-term queries or one for a single
   term. An exact key is admitted directly. Compound identifiers and numeric
   identifiers must match exactly within at least one explicit query variant.
   Match complete identifiers, not prefixes: `ember-42` does not match
   `ember-42-backup`, and `4.2.1` does not match `4.2.1-rc1`. Sentence-ending
   punctuation is not part of an identifier.
4. With embeddings available, semantic scores contribute to ranking. A match
   based only on semantics additionally requires an **explicit positive**
   `min_score`. Omitted or zero `min_score` never admits semantic-only matches.
   Choose that threshold using examples from the configured model and corpus;
   no universal cosine cutoff is supplied or claimed as calibrated confidence.
5. Put exact keys first, then sort by 80% normalized BM25 contribution plus
   20% nonnegative cosine contribution. Break ties by scope/key deterministically.
   Collapse identical key/value pairs; keep different values separate.

`top_k` is a maximum, not a quota to fill. Provider failure, incomplete vectors,
zero vectors or invalid dimensions fall back to lexical admission. Failure
diagnostics include no provider response bodies. This does not change the
legacy strategy's existing fallback semantics.

With `explain: true`, each result includes `match.reasons`, matched terms,
lexical coverage, the optional semantic score, and source scope/key locators.
Identical records retain all source locators. `possible_conflicts` identifies
admitted records sharing a key but having different live values across scopes.
That is a review aid, not a finding that one value is false or an instruction
to merge them. Explanations exist only in the response; no new recall log is kept.

### Explicit aliases

Aliases can be curated into ordinary memory text, or supplied as bounded query
alternatives:

```json
{
  "scope": "project",
  "query": "home connection",
  "strategy": "hybrid",
  "query_aliases": ["office tunnel access", "relaybox"],
  "explain": true
}
```

At most eight aliases of 256 UTF-8 bytes each are accepted. The original hybrid
query is bounded to 4 KiB. Invalid bounds fail before opening scopes or making
provider requests. Aliases affect lexical selection; the original query is
embedded once. They are caller-supplied hints and may explicitly substitute an
identifier, not automatically inferred identities or additional authority.
`query_aliases` and `explain` require `strategy: "hybrid"`.

## Current values, history and authority

Search reads live records and excludes hidden supersession history. Updating a
fact through the existing supersession workflow makes the new value current
and preserves the displaced value for explicit history inspection. A new MCP
process can retrieve the live value after the previous local process exits.
Simultaneous clients should use one shared server: independent direct local
AgentFS processes can contend for native database locks.

Current means current in the store, not independently verified or still true
in the real world. No automatic expiry, contradiction resolution, history
deletion, knowledge promotion or durable memory mutation is introduced. Verify
maintained sources and supersede stale facts only through an authorized workflow.
Personal scopes in a trusted deployment are not a multi-user ACL mechanism.
The separate team preview is unchanged.

## A fair Markdown comparison

A curated Markdown folder provides readable durable knowledge, human editing,
navigation and Git history. Adding the same retrieval policy can reproduce the
same retrieval results. Cairnkeep provides a maintained shared MCP interface,
scope routing, lifecycle operations and harness integrations; SQLite itself is
not evidence of better recall.

The reproducible study builds real temporary Markdown files and equivalent
memory candidates with identical keys, values, scopes and explicit aliases.
It compares a searchable-folder BM25 baseline, the legacy substring policy,
the new admission policy and the same new policy applied to Markdown. Both
folder variants receive the same tokenizer/BM25 implementation; the baseline
is deliberately strong, and the Markdown parity control distinguishes search
policy gains from storage format. The substring comparator unions explicit
query variants, equivalent to separate legacy requests.

Thirteen declared scenarios include a changed tunnel configuration, aliases,
Italian queries, continuation conventions, release policy, unrelated queries,
nearby/obsolete identifiers and wrong-project content, with 0/100/1,000
distractors. The [frozen report](benchmarks/memory-retrieval-v1.json) shows:

| Adapter, 1,000 distractors | Correct first result, 9 positive cases | Negative queries returning results, 4 cases | Irrelevant value bytes |
|---|---:|---:|---:|
| Legacy substring | 3/9 | 0/4 | 0 |
| Markdown + BM25 | 8/9 | 3/4 | 3,359 |
| Hybrid lexical admission | 8/9 | 0/4 | 0 |
| Markdown + same admission | 8/9 | 0/4 | 0 |

These are synthetic regression cases, not general retrieval accuracy, an
independent holdout, autonomous task quality or proof of human consent. The
semantic-only paraphrase is deliberately missed by lexical modes; the report
does not claim perfect recall. A real MCP control separately verifies actual
supersession, new-process handoff, scope filtering before provider requests and
provider-failure behavior. No live user memory is read by these checks.

From a source checkout:

```sh
npm --prefix mcp-memory-server run build
npm --prefix mcp-memory-server run check:memory-retrieval
npm --prefix mcp-memory-server run study:memory-retrieval
# Explicit provider evaluation, using synthetic fixtures only:
node mcp-memory-server/scripts/run-memory-retrieval-study.mjs --live --summary
```

The live study reports a model-ID digest, not credentials or endpoint addresses.
Its sample threshold of 0.75 is an evaluation arm, not a recommended default.
An attempted live run during development accepted short probes but failed with
HTTP 502 on some fixture inputs. No successful live-model result is claimed.
The offline suite never requires a model, API key, paid service or network beyond
its own loopback fixture. A separate optional reranker comparison below does
not replace this older study or retroactively make that failed run successful.

## Optional learned reranking

The optional reranker is default-off and independent of extraction and
embeddings. Set `CAIRN_MEMORY_RERANK=1`, `CAIRN_MEMORY_RERANK_URL` (a base URL,
normally ending in `/v1`) and `CAIRN_MEMORY_RERANK_MODEL` on the memory-server
process. The client appends `/rerank`. If authentication is needed, set the
separate `CAIRN_MEMORY_RERANK_API_KEY`; extraction/embedding credentials are
never reused. `CAIRN_MEMORY_RERANK_TIMEOUT_MS` defaults to 2,000 ms and accepts
100–10,000 ms. Restart the server after configuration changes.

Only `memory_search` in the `memory` address space is reranked, for either
legacy or hybrid strategy. Notes, context packs, documents and the separate
team store are unchanged. Existing scope, current-value, typed and relevance
filters admit candidates first. The provider receives the original query
(at most 4 KiB) and at most 50 admitted key/value excerpts (at most 4 KiB each),
not the whole store. Candidate depth is `min(50, max(32, 4 * top_k))`.
Exact-key priority in hybrid search (including explicit aliases) and typed legacy exact-hit priority remain
ahead of model scores. The provider only reorders admitted records; it cannot
add facts, change authority, write memory or recover a candidate already
rejected by admission. A small final `top_k` can include a candidate outside
the original top-k prefix after reranking.

The endpoint must return every candidate index exactly once in a `results`
array with finite `relevance_score` numbers. Negative raw scores are accepted;
these are ranking values, not calibrated confidence. Returned memory text,
provenance and existing retrieval scores are unchanged; those scores need not
be descending after learned reranking. Ties preserve the
existing order. Timeout, HTTP errors, redirects, oversized responses, invalid
configuration or malformed/partial indices preserve the original order.
No retries or alternate provider fallback are made. Unset/disabled configuration
performs no reranker request and preserves existing discovery and responses.
When configured, `memory_search` remains read-only but advertises
`openWorldHint: true` because it can export candidate text.

`cairn doctor` uses synthetic text to check configured reranking and fails if
the configuration or response is invalid. Ordinary searches still fall back
safely; doctor does not mistake fallback for a healthy provider.

### Bounded provider comparison

The frozen `memory-reranker-study-v1.json` fixture contains 20 synthetic
continuity cases, including 16 positive and four negative cases. Both arms use
the same embedding vectors, admission rules, aliases and final top three.
Labels and the fixture digest were frozen before the first live ranking run.

| Metric | Hybrid + embeddings | Same candidates + reranker |
|---|---:|---:|
| Relevant first result, 16 positive cases | 6/16 | 15/16 |
| MRR@3 | 0.635417 | 0.968750 |
| NDCG@3 | 0.728416 | 0.976933 |
| Recall@3 | 1.0 | 1.0 |
| Negative queries returning results, 4 cases | 0/4 | 0/4 |

Ten cases improved and **one regressed**: `current-not-history` ranked a
topical interface distractor above the correct current fact. Hidden history
was still excluded. No scope/history violation or provider failure occurred.
Observed additional ranking latency was 9 ms median and 46 ms p95 in this
small local run; this is not a deployment latency guarantee.

This is an engineering-labeled synthetic comparison with deliberately
ambiguous topical distractors, not an independent holdout, a human study or
proof of general agent-quality gains. It justifies an optional experiment,
not default enablement. Evaluate your provider and corpus before opting in;
disable `CAIRN_MEMORY_RERANK` to reverse the change.

From a source checkout (these developer study scripts are not installed CLI
commands):

```sh
npm --prefix mcp-memory-server run check:memory-reranker
# Requires explicit existing embedding and reranker configuration:
node mcp-memory-server/scripts/run-memory-reranker-study.mjs --live --summary
```

Without `--live`, the study makes no provider calls even when configured.
Reports include fixture, implementation and model-ID digests, no URLs or keys.
The frozen fixture SHA-256 is
`f6a5d2de8d2846dd5a8de764096d92255716592805e8abfdc771181eac23beb1`.

## Research connection

[Alex Wang's associative-memory article](https://alexwang.ai/posts/associative-memory/)
provides a useful perspective on recall interference. Its neural-layer capacity
experiments do not establish limits for a text database. This implementation
applies selective retrieval at the application layer without changing model
weights. Merely applying softmax to an existing score list preserves ordering
and would not improve fixed-top-k selection.
