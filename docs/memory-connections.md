# Evidence-backed memory connections (opt-in since 2.28.0)

Available since Cairnkeep 2.28.0, this opt-in feature adds explicit entities,
aliases and directed links to **fresh tracked stores only**. It does not convert existing memory, infer a
graph from prose, add a model or provider, or enable anything in production.
Start with disposable data; production admission remains a separate decision.
See [tracked-store requirements](storage.md#tracked-store-foundation-opt-in-since-2280)
before initializing a store; the Node API floor alone is not sufficient.

## What a connection means

An operator gives an entity a UUID, title, explicit aliases and an anchor memory
key. A directed link joins two entity UUIDs with a predicate and one to eight
evidence keys. Curation captures exact source identity, generation, content
digest, freshness metadata revision and restore epoch. Links additionally pin
both endpoint assertion digests. These are recorded assertions, not proof that
their prose, relationships or claimed values are true.

Changing an anchor, evidence source, endpoint assertion or its bound freshness
metadata makes the old association unavailable. Identical text after A→B→A,
delete/recreate or managed restore does not revive it. Entity/link removals keep
revision tombstones, so recreating an ID also cannot revive an old edge or plan.
Recurate deliberately after inspecting the new sources. No similarity-based
entity merge, automatic alias, automatic fact correction or source fetching occurs.

## Curate locally, with an exact plan

Use an already initialized disposable tracked project containing ordinary keys
`devices/sensor` and `routes/tunnel`. Create two private JSON inputs with distinct
UUIDs; for example, `sensor.json`:

```json
{
  "schema_version": 1,
  "id": "fc3ff904-2c14-4fe4-8f57-29c842650098",
  "title": "Sensor",
  "aliases": ["lumen"],
  "anchor_key": "devices/sensor",
  "claims": []
}
```

Plan first; inspect the captured sources and digest, then repeat the same command
with `--apply --confirm PLAN_DIGEST`:

```sh
cairn memory-context entity set --scope project --project /path/to/disposable-project --input sensor.json --json
```

Create the tunnel entity with UUID `74fc90ad-25cd-4092-83f1-2432777c1495`,
title `Tunnel` and anchor `routes/tunnel` in the same way. A link input then
names those UUIDs, not titles or guessed aliases:

```json
{
  "schema_version": 1,
  "id": "bfebd0cb-8c3a-40ab-b7a0-f21569e7d9aa",
  "from": "fc3ff904-2c14-4fe4-8f57-29c842650098",
  "to": "74fc90ad-25cd-4092-83f1-2432777c1495",
  "predicate": "uses",
  "evidence_keys": ["devices/sensor", "routes/tunnel"]
}
```

```sh
cairn memory-context link set --scope project --project /path/to/disposable-project --input link.json --json
```

Again, apply only the inspected digest. Apply rechecks the entire graph pre-state
and observed sources in one immediate SQLite transaction. Stale confirmations
refuse, including replay after a successful apply. No-write planning creates no
graph tables; the first successful apply creates both tables atomically.

To remove an entity or link, provide only `{"schema_version":1,"id":"UUID"}` to
`entity remove` or `link remove`, then inspect and confirm its plan. Removing an
entity does not silently delete its incident link records: they become inactive.
These local administration commands are never MCP tools and do not write ordinary
memory, change sharing permissions or advance source verification dates.

## Observe through one trusted scope

```sh
cairn memory-context related --scope project --project /path/to/disposable-project --entity lumen --direction outbound --depth 2 --limit 50 --json
cairn memory-context doctor --scope project --project /path/to/disposable-project --json
```

With `CAIRN_MEMORY_CONTEXT=1`, an MCP client can instead call:

```json
memory_related {"scope":"project","entity":"lumen","direction":"outbound","depth":2,"limit":50}
```

The tool is read-only, closed-world and governed by `memory.search`, feature
gates and the MCP profile. A custom profile may allow `memory_related`; this does
not enable the feature. HTTP also requires `CAIRN_MEMORY_CONTEXT_HTTP=1`, existing
authentication/Host/CORS checks and a validated project binding. No client path
or project override is accepted. `all` is refused: traversal uses exactly one
configured physical store and never joins projects or scopes.

UUIDs resolve exactly. Other inputs resolve exact titles or explicitly curated
aliases; matching is case-sensitive. Ambiguity returns bounded matches and no
selected node or edges. Unknown or stale identities return no association.
Missing and legacy stores return an untracked empty result without conversion.
Results include assertion and source provenance, not automatic permission to
execute a remembered action. Two independent read snapshots must agree; a race
returns an empty, truncated result rather than mixing associations. This is not
a claim of cross-store or post-response linearizability.

## Explicit possible conflicts

An entity may carry up to 16 claims, each with `key`, `attribute` and `value`.
Claims are curated, not extracted automatically. Different current keys claiming
different values for one attribute on that same canonical entity produce a
`possible_conflicts` signal. `memory_related` returns bounded conflict evidence;
the separately gated `memory_inspect` includes `claim_conflicts` on affected
returned candidates. No winner is chosen, no hidden-scope count is exposed, and
neither source is overwritten. Equal values or unrelated entities are not labeled
conflicts. A stale claim is omitted without discarding an otherwise valid anchor;
links still require their own current evidence and exact endpoint assertion.

## Limits, storage and privacy

Inputs and resolved records are capped at 64 KiB. Titles/aliases are at most 512
UTF-8 bytes, with 16 aliases; predicates/attributes are at most 128 bytes. Queries
use depth 1 or 2, at most 50 nodes and 100 edges, and a 32 KiB complete serialized
MCP result including both text and structured content. Omitted results set
`truncated`; conflict signals describe returned evidence, not hidden totals.

Each store permits at most 5,000 graph rows including tombstones and an 8 MiB
assertion scan. Source validation is also bounded to 5,000 distinct keys and
32 KiB of stored JSON per source. Exceeding scan limits refuses categorically;
it does not fetch, silently truncate identities or use stale evidence. A large
unrelated graph/source can therefore make a query refuse. Doctor checks graph
schema/record integrity and reports metadata counts, not source values; it never
chooses versions, reconstructs evidence or repairs graph assertions.

The two metadata tables live inside the existing ordinary tracked database and
are included in its backups. Graph revisions are independent of per-key freshness
revisions. There is no new graph service, sidecar, embedding, telemetry, background
task or network request. Protect aliases, claims and provenance like memory text:
they can themselves be sensitive. Remote results cross only the separately
approved authenticated memory-server boundary.

## Reproduce the evidence

From a source checkout:

```sh
npm --prefix mcp-memory-server run build
node mcp-memory-server/scripts/run-memory-continuity-study.mjs --check --summary
node mcp-memory-server/scripts/run-memory-continuity-study.mjs --features freshness,links --check --summary
```

The frozen baseline remains unchanged. The separate feature replay curates the
same explicit aliases, links and provenance for both native storage and a
searchable Markdown resolver. It checks two-hop retrieval, ambiguity, renames,
project isolation, harness/cwd continuity, source ABA, endpoint/link
re-curation/removal/recreation and overdue freshness
without network access. Improved linked recall in this synthetic fixture is not
evidence of model intelligence, human productivity or general superiority over
well-maintained Markdown. The separate [compact-map supplement](memory-maps.md)
adds bounded orientation and its own parity/cost controls. Feedback and automatic
extraction are not tested or implied by this feature.
