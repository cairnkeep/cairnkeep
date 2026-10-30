# Fresh and connected memory: source-only workflow

Status: **unreleased**, source-only exercises in disposable stores. Installing
the released 2.27.0 package does not enable these tools or convert existing
memory. No production enrollment, new provider or harness asset sync is required.

Ordinary memory already supports continuing work across sessions and clients.
This optional extension adds explicit freshness warnings, evidence-backed
relationships, bounded orientation and usefulness receipts. It does not add
an agent loop, automatically verify facts or select the correct project from
an arbitrary working folder. Memory text records what was stored; maintained
project sources and outside facts still need their own verification.

## Start with the right boundary

The released CLI still requires Node 22 or newer. Fresh tracked stores additionally
need the Node 22.16+ built-in SQLite API **and** patched bundled SQLite: 3.51.3+
or the documented 3.50.7/3.44.6 backports. The API floor alone is insufficient.
Use a current patched runtime; see [storage admission](storage.md#unreleased-tracked-store-foundation-source-checkout-only).
Older database drivers refuse the new format; existing-store conversion and
in-place restore are not provided. Turning off tools does not undo the format.

Run developer commands from the matching source checkout, not an older global
installation. `node bin/cairn memory-context --help` selects that checkout's CLI.
The automated exercises below create and clean up their own private synthetic
stores; do not substitute a real memory directory.

```sh
npm ci
npm run build:server
node bin/cairn memory-context --help
node mcp-memory-server/scripts/smoke-memory-context-integration.mjs
node mcp-memory-server/scripts/smoke-memory-integrated-study.mjs
node mcp-memory-server/scripts/run-memory-continuity-study.mjs --features freshness,links,maps,feedback --check --summary
# Frozen baseline, individual controls, actual joint workflow and feedback study:
node mcp-memory-server/scripts/run-memory-continuity-study.mjs --all --check --summary
```

After dependencies are installed, the tests need no model, key or external
service. Local stdio processes trap attempted network access. The separate authenticated HTTP test deliberately uses loopback;
zero external requests is not a claim that HTTP uses no network.

## A small, explicit workflow

The synthetic task follows a sensor through a tunnel to a gateway. An operator
has explicitly recorded aliases, relationships and their evidence first.
Neither the tool nor a model infers that graph from arbitrary prose.

| Step | Tool | What to check |
|---|---|---|
| Orient | `memory_map` | Scope, prefix navigation, source references and `truncated` |
| Follow a known association | `memory_related` | An explicit caller-supplied alias, ambiguity and current evidence |
| Read all three linked records | Three `memory_read` calls | Exact keys and original source text |
| Search current admitted candidates | `memory_context_search` | Provenance, freshness labels and valid empty results |
| Inspect the anchor | `memory_inspect` | Asserted dates/status, not factual confidence |

This is **seven tool calls**, not a single improved search request. The bounded
map can omit entities or sample only some keys; the known alias is an additional
caller input, not secretly recovered from an omitted entry. The replay reports
those calls and summed bytes/time. Its two native workflow arms returned about
23 KiB in one local run. That total is not a whole-conversation limit: maps have
a 4 KiB default/8 KiB hard complete-result budget, while inspection, related
context and context search have their own 32 KiB complete-result limits.
JSON-RPC/HTTP envelopes are outside those budgets.

The joint replay reports 30 operator plan/apply calls, plus 17 seed mutations and
30 development feedback calls. This is the replay's total cost, **not a minimum onboarding requirement**.
Standalone graph re-curation/removal and cold/warm-map adversarial controls still
run separately, including through `--all`; the joint replay does not repeat them.
It is not free automatic graph retrieval. See the individual
[freshness](operating.md#revision-bound-freshness-unreleased-source-checkout-only),
[connections](memory-connections.md), [maps](memory-maps.md) and
[feedback](memory-feedback.md) contracts before any manual lab.

## What the evidence does—and does not—show

The original corpus, query splits, policy and frozen 2.27 baseline remain
unchanged. The explicit linked workflow reaches three of three required records,
versus one of three in the frozen single-search baseline, with extra curation
and calls disclosed. An independently enumerated Markdown control receives the
same text, assertions, links and votes and reaches the same records.

The joint ordinary-query comparisons retain eight held-out cases per arm:
first-hit rate 1.0, mean recall@5 0.8333, one stale return, one freshness warning
and zero negative false positives. Freshness warns about the old cross-key fact;
it does not silently filter it, pick truth or supersede it. Ranking gives
**no ranking gain**, so collection-only remains recommended and
`CAIRN_MEMORY_FEEDBACK_RANKING` stays off by default. Held-out queries never
create feedback records or tune the policy. These engineering-labeled cases
are not a blind independent study, autonomous task-quality proof or a human pilot.

Native timings include actual MCP, workers and permission checks. Markdown is an
in-process file control, with its own simulated result framing—not another MCP
server. The report is **not a storage-efficiency comparison**, and neither SQLite
nor a faster in-process control establishes better practical recall. Cairnkeep's
value is its maintained shared interface, scope routing and checked lifecycle;
a carefully maintained Markdown folder remains a valid alternative.

## Handoff and invalidation

The tests use actual separate MCP clients/processes with different names, not
recordings of native harness interfaces. Shared identity memory survives a
generic working folder. Local project memory follows the selected project root;
HTTP project memory uses validated `X-Cairn-Project`, independent of server cwd.
Those local and HTTP resolver paths are different physical stores. A shared
HTTP bearer defines one trusted storage domain, **not per-user ACLs**.

Source or asserted-metadata changes invalidate old associations and feedback.
A→B→A does not revive them merely because text matches again. A same-value
tag/type race must omit the old typed result rather than attach fresh provenance.
Changing clients requires a new search receipt: receipts are session-bound,
while eligible recorded outcomes remain project-local.

The managed restore drill closes clients and preserves the entire old store
directory, including auxiliary files, before restoring to an absent same-owner
destination. A **same-secret** receipt control isolates epoch invalidation from
session restart. All 15 old feedback records survive as history, but none remain
eligible—even votes about an unchanged shared source. Old graph assertions are
inactive and maps revalidate. Raw-copy replay and cross-owner/in-place restore
are not covered or supported. Follow [managed recovery](storage.md#unreleased-tracked-store-foundation-source-checkout-only),
not filesystem deletion or an improvised migration.

## Consent, privacy and stopping

`CAIRN_MEMORY_CONTEXT=1` exposes the five optional tools. The four observations
require search allowance; explicit `memory_feedback_record` requires write
allowance. Full/read-only/custom profiles can only restrict exposure. Neither
an allowlist nor the ranking flag can enable a disabled feature. HTTP needs
separate `CAIRN_MEMORY_CONTEXT_HTTP=1`, authentication, project binding and
Host/CORS checks. Local curation/administration never becomes an MCP tool.

Inspection, graph traversal, maps and feedback recording call no provider.
Context search can use existing explicitly configured embeddings/reranking;
its read-only annotation is not a promise of no network. Team memory, notes,
packs and skills are separate, never implicitly admitted by a relationship.

Feedback retains digests, opaque IDs, outcome and time, not query/value/receipt
text. That is data minimization, not encryption or anonymity. Protect the project
database and exported records. Eligibility lasts 30 days; stored history remains
until exact-selection forget, and the 10,000-row cap includes old history.
Self-reported task digests are not verified users or anti-Sybil protection.

To stop the experiment, unset the context/HTTP/ranking flags and restart its MCP
processes. Existing ordinary tools remain available, but a tracked database still
requires its compatible backend. Never remove a real database to disable a tool.
No release, production activation, new recording or fleet change follows from
running these tests.
