# Compact memory maps (opt-in since 2.28.0)

A map answers “what is here, and where should I read next?” without copying
stored memory text into the prompt. It groups current ordinary keys by their
first slash prefix and lists explicitly curated entities with current anchors.
It is navigation, not a summary, verification, permission or replacement for
exact reads. Nothing is injected automatically into startup or `AGENTS.md`.

Available since Cairnkeep 2.28.0, this feature remains opt-in, not production activation.
Use disposable stores. Legacy stores can supply untracked key navigation without
conversion; reliable provenance, freshness and entities require the explicitly
initialized [tracked format](storage.md#tracked-store-foundation-opt-in-since-2280).
Existing-store conversion remains out of scope.

## Use

```sh
cairn memory-context map --scope project --project /path/to/disposable-project --json
cairn memory-context map --scope project --project /path/to/disposable-project --max-bytes 8192 --limit 50 --json
```

The local CLI resolves one concrete scope. With `CAIRN_MEMORY_CONTEXT=1`, an MCP
client can call `memory_map` with `scope`, optional `max_bytes` and `limit`:

```json
{"scope":"all","max_bytes":4096,"limit":50}
```

The tool is read-only, closed-world, subject to `memory.search` and the MCP tool
profile. A custom allowlist cannot enable the feature. HTTP additionally requires
`CAIRN_MEMORY_CONTEXT_HTTP=1`, authentication, validated project binding and the
existing Host/CORS protections. Client-supplied paths/project overrides refuse.
`all` selects only configured visible ordinary scopes and returns separate
physical-store partitions; there is no cross-store graph or entity resolution.
Team stores, context packs and skills are not opened or promoted into the map.

## Result and limits

`partitions` contains `scope`, `tracked` and deterministic `entries`. Prefix
entries give an observed `count`, freshness counts and up to three navigation
keys with source references. Entity entries give ID, title, ambiguity and the
anchor navigation. Overlapping current titles/aliases signal ambiguity rather
than selecting an identity. If a scan is incomplete, an otherwise uncollided
entity reports `ambiguous:null` (unknown), not a uniqueness claim. No claims,
edges or ordinary source values appear.

Each tracked navigation binds owner, scope, store UUID, restore epoch, key,
generation, content digest and context revision. Freshness labels are asserted
policy state, not truth; inspection is still needed for detailed dates/evidence.
Legacy navigation uses null source references and `untracked`, never a hash
pretending to be a reliable revision. Reserved history/review provenance is
excluded before grouping, counts and caching.

Default budget is 4,096 UTF-8 bytes; `max_bytes` accepts 1,024–8,192. The maximum
is 50 entries across the whole result, not per partition. Budgeting includes the
serialized MCP CallToolResult, including text content, structuredContent,
escaping and truncation flags. JSON-RPC IDs and HTTP/SSE envelopes are outside
this tool-result budget.
An oversized entry is omitted intact; even zero entries may be `truncated:true`.
`navigation_truncated` marks prefix samples. Counts are observed partial counts
when the scan is truncated, not authoritative totals. Use exact reads next.

The whole request materializes at most 5,000 source/assertion rows and 8 MiB of
source/assertion UTF-8 payloads, including keys/IDs and both agreement reads
across all scopes. Reserve half the remaining allowance for each read: at most
2,500 rows and 4 MiB can contribute from one snapshot, less when freshness/entity
records or earlier stores consume capacity. These are materialized-data limits,
not SQLite execution-step or total process-memory limits. Per-value ordinary
JSON is capped at 32 KiB. SQLite suppresses payloads before worker replies if
they cannot fit the remaining allowance; no counter is clipped after overread.
Fields cross the worker boundary as bounded raw bytes and are charged before
strict UTF-8 decoding, preserving valid BOM characters. Malformed stored text
refuses rather than expanding replacement characters beyond the allowance.
Original SQLite storage classes are checked before conversion: only TEXT keys
and values qualify. BLOB keys cannot be decoded into reserved history/review
navigation, and BLOB values never acquire TEXT source provenance.
Legacy reads use one bounded key per query without requiring window functions;
their child exchange also has a stricter 48 KiB encoded-key window. Oversized
sources and exhausted budgets signal truncation.
Two fresh snapshots must agree before a partition is returned; concurrent change
produces an empty truncated partition. This does not promise cross-store or
post-response linearizability. Changes, source ABA, stale assertions and managed
restore cannot reactivate cached entity anchors.

## Disposable cache and privacy

An optional private `.memory-map-cache/` sibling of each existing ordinary
database contains a bounded derived preview, never authoritative memory. Its
slot is owner/path/scope-partitioned, and its revision digest includes store/
epoch, visible source/context revisions and current entity/freshness projection.
Every request re-reads live authorized data and compares cached output with the
deterministic current result. Cache membership never grants visibility.

Missing/corrupt/unsafe caches rebuild or degrade to uncached results. Symlinks
and unsafe paths are not followed; private modes/ACLs and atomic replacement use
the existing platform primitives. Cache failures do not enable writable database
fallbacks. Missing stores create neither database nor cache. Local observations
make no provider/network calls and do not change verification or ordinary text.

The preview contains sensitive key names, titles, counts and provenance. Protect
it like memory. It is outside managed database backups and can be discarded with
clients stopped; never delete the database to clear a cache. An interrupted
process can leave an owned `.tmp` cache remnant; it is not an active map. Remote
results cross only the explicitly enabled authenticated memory-server boundary.
No telemetry, model, background refresh or new runtime dependency is added.
Ordinary uninstall retains it with memory; explicit backup-first `--purge-memory`
removes the selected store directory, including its map cache.

## Reproduce

```sh
npm --prefix mcp-memory-server run build
node mcp-memory-server/scripts/smoke-memory-map.mjs
node mcp-memory-server/scripts/smoke-memory-map-mcp.mjs
node mcp-memory-server/scripts/run-memory-continuity-study.mjs --features freshness,links,maps --check --summary
```

The synthetic replay independently enumerates equivalent curated Markdown and
checks identical bounded navigation, provenance and freshness. It reports actual
returned bytes and cold/warm costs; live revalidation means caching need not make
the warm read faster. This is not an autonomous task-quality, productivity or
human-pilot result. The frozen baseline is unchanged. The
[combined opt-in workflow](memory-continuity-workflow.md) now covers maps
with freshness, links and explicit feedback, including restore and handoff.
Its bounded map can omit an entity: the demonstrated related-query alias is
explicit caller input, not an invented complete inventory. Ranking stays off;
package qualification is separate from production admission.
