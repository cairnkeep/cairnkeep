# Explicit memory feedback (unreleased)

This source-only extension records self-reported usefulness, not factual
correctness, review, sharing consent or permission to execute. It adds no model,
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
tracked/untracked status. Changed or oversized results are omitted with explicit
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

Collection alone changes no ranking. A bounded ranking experiment is separate
work and must remain independently opt-in/default off. Self-reported task digests
are not independently verified identities: one caller can fabricate many tasks.
Vote counts are not anti-Sybil protection, factual confidence or authority.
No model-quality or human-productivity improvement is established by collection
and conformance tests. Legacy `context_usage_record` remains separate and unchanged.
