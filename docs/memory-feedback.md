# Explicit memory feedback (opt-in since 2.28.0)

Available since Cairnkeep 2.28.0, this opt-in extension records self-reported
usefulness, not factual correctness, review, sharing consent or permission to execute. It adds no model,
framework or automatic usage tracking. Use disposable projects: no existing
store is converted, and no production activation follows from an upgrade.

## Search and record

With `CAIRN_MEMORY_CONTEXT=1`, `memory_context_search` uses the existing admitted
ordinary-memory hybrid pipeline, configured embeddings and optional reranker.
It does not change `memory_search`. Example arguments:

```json
{"scope":"project","query":"network/tunnel","top_k":5,"task_digest":"<64 lowercase hex characters>"}
```

The optional task digest is a caller-chosen opaque task identifier, not raw
prompt text. Results include current source provenance, asserted freshness and
tracked/untracked status. Changed text or typed fields (tags/node type), and
oversized results, are omitted with explicit
truncation. Query limit is 4,096 UTF-8 bytes, aliases at most eight of 256 bytes,
results at most 50, and the complete serialized MCP CallToolResult at most
32 KiB, including text, structured content and escaping, not transport envelopes.
Exact-key precedence and existing admission remain authoritative.

When both source and project ledger are tracked, a requested task digest can
yield an opaque authenticated receipt. Explicitly call `memory_feedback_record`
with only `receipt`, the same `task_digest`, and outcome `useful`, `stale` or
`wrong_context`. No arbitrary key, score or free-text field is accepted. Repeating
the same task/result/outcome is a no-op; a conflicting outcome refuses. A new
receipt cannot create a second vote for the same task/result identity.

Receipts use an ephemeral per-server-session secret, expire within 24 hours,
and bind project, source generation/content/context revision, source restore
epoch and project ledger identity/epoch. Restarting or changing the session
invalidates receipts. Source ABA/deletion and managed restore invalidate them,
even if text returns to the same value. A receipt is not authorization: transport,
current scope configuration, capability and profile checks still apply.

Context search requires `memory.search`; recording requires `memory.write`.
Read-only profiles cannot record. Search is annotated open-world when existing
embedding/reranking providers are configured; recording itself is closed-world.
HTTP additionally requires `CAIRN_MEMORY_CONTEXT_HTTP=1`, authenticated validated
project binding and existing Host/CORS controls. No administration is exposed
through MCP. Team stores, notes, packs and skills do not participate.

## Storage, retention and deletion

Feedback lives in `cairn_memory_feedback_v1` in the project's existing tracked
ordinary database, including votes about returned configured shared-scope
sources. Missing or legacy project stores can still be searched but receive no
feedback receipts. Search/receipt issuance never initializes feedback tables;
only explicit recording does. No second memory store or feedback sidecar.

Records retain digests, opaque ledger IDs, outcome and capture time, not source
keys, values, queries, prompts, credentials or the receipt itself. The surrounding
ordinary database still contains its original authoritative memory. Feedback is
included in managed backups; restore preserves history but invalidates eligibility.
Current-source checks run inside the ledger transaction; external-store checks
use a separate read snapshot, not a cross-database linearizability guarantee.
A concurrent later source change makes its old vote ineligible before ranking.

The project ledger accepts at most 10,000 records, including stale and expired
history. Exhaustion refuses writes, never silently purges. Votes older than 30
days are ineligible; records remain until explicit forget. Inspect/export locally:

```sh
cairn memory-context feedback list --scope project --project /path/to/disposable-project --json
cairn memory-context feedback export --scope project --project /path/to/disposable-project --json
cairn memory-context doctor --scope project --project /path/to/disposable-project --json
```

Export goes to stdout; protect any redirected copy. To forget up to 500 explicit
record IDs, prepare `{"schema_version":1,"ids":["<record digest>"]}` in a JSON file:

```sh
cairn memory-context feedback forget --scope project --project /path/to/disposable-project --input selection.json --json
cairn memory-context feedback forget --scope project --project /path/to/disposable-project --input selection.json --apply --confirm PLAN_DIGEST --json
```

Apply rechecks the exact selected records and ledger epoch transactionally. A
stale selection refuses without broadening deletion. Forget changes neither
ordinary memory nor freshness. Ranking reads current records directly; no
persistent feedback-ranking cache can retain a forgotten vote.

## Ranking boundary

Collection alone changes no ranking. `CAIRN_MEMORY_FEEDBACK_RANKING=1` separately
opts in to the experimental `feedback-adjacent-v1` policy, only for
`memory_context_search`. It is off by default. Existing hybrid admission,
filters, configured reranking and response truncation happen first. Feedback
never adds or removes a result, changes its original score/text, crosses a
physical store, or moves an exact key/explicit alias.

At least three distinct current task digests per source are needed for a vote
adjustment. Useful votes contribute +1; stale/wrong-context votes contribute -1.
Their mean produces a maximum score adjustment of 0.02. Only adjacent candidates
in the same original 0.1 score tier may swap, when the adjustment difference
exceeds their original score gap. Disjoint swaps limit each result to one slot.
Only moved results receive a self-reported-usefulness explanation. If explanation
bytes would exceed the response limit, baseline order is retained. Missing,
expired or damaged optional feedback falls back to baseline order; no-feedback
and kill-switch paths leave ranking unchanged. There is no learned model or
persistent aggregate/cache. Revalidation uses per-store snapshots, not an atomic
snapshot across all stores or a guarantee against a later concurrent change.

Self-reported task digests are not independently verified identities: one caller
can fabricate many tasks. Minimum counts and bounded influence are not anti-Sybil
protection, factual confidence or authority. Legacy `context_usage_record`
remains separate and unchanged.

## Reproduce the evidence

From this source checkout, using only disposable synthetic data:

```sh
npm --prefix mcp-memory-server run build
node mcp-memory-server/scripts/smoke-memory-feedback-ranking.mjs
node mcp-memory-server/scripts/smoke-memory-feedback-ranking-mcp.mjs
node mcp-memory-server/scripts/run-memory-continuity-study.mjs --all --check --summary
```

The frozen eight-case held-out replay showed **no ranking gain**: first-hit rate
1.0, mean recall@5 0.8333, one stale return and zero negative false positives,
unchanged by feedback. Collection adds provenance bytes and ranking adds local
work; these costs are reported, not hidden. Only development-query labels train
votes, and an independently implemented equal-information Markdown policy
matches. `--all` retains those separate controls and now includes an actual
[joint continuity replay](memory-continuity-workflow.md), with explicit tool
sequence, independent Markdown policy, costs and same-secret restore controls.
Neither the separate nor joint replay is proof of a combined autonomous agent effect. No model-quality, productivity,
live-harness or broad retrieval-quality improvement is established. Recommend
collection-only experiments; keep ranking disabled pending broader evidence.
