# Synthetic longitudinal memory baseline

This source-checkout study freezes the ordinary-memory behavior of Cairnkeep
2.27.0 before adding freshness, relationships, maps or feedback. It is not a
benchmark of autonomous coding, a native-harness recording or a human pilot.

## Reproduce

After building the memory server, run from the repository root:

```bash
node mcp-memory-server/scripts/smoke-memory-context-contract.mjs --baseline
node mcp-memory-server/scripts/run-memory-continuity-study.mjs --baseline --check --summary
node mcp-memory-server/scripts/probe-memory-context-revisions.mjs --baseline
```

These tests use disposable local stores and sanitized child environments.
Stdio server processes have a network trap: even a caught networking failure is
recorded and makes the contract fail. No existing memory, endpoint, credentials
or production configuration is needed. Each fixture process/store is cleaned up;
no source is automatically changed to update the frozen expectations.

## What is measured

Seventeen actual MCP mutations replay supersession, deletion and value reversal.
Thirteen queries cover changed gateways, explicit aliases, ambiguous aliases,
linked route information, exact keys, different project folders, fresh client
processes and negative queries. Local project memory follows its working folder;
identity memory remains shared across folders. Changing synthetic client labels
is not proof of running either native harness or an agent model.

The Markdown arm independently enumerates its own current files after the same
mutations, receives the same text and curation data, and uses the same hybrid
admission/ranking policy. Equal policies are required to return identical record
IDs. This deliberately makes no claim that SQLite improves retrieval quality.
The baseline receives relationship data but does not traverse it in either arm.

The fixture freezes query variants before feature implementation. A `held-out`
label alone does not establish a blind or statistically independent evaluation.
Later experiments must not tune a policy against those expected answers.

## Baseline observations

- Exact-key and shared-identity continuity checks pass.
- All four negative queries remain empty; no foreign/history record is returned.
- One older cross-key route fact is returned without a freshness warning.
- One ambiguous alias returns both matching records without an ambiguity signal.
- The linked-route case retrieves one of three required context records.
- Cairnkeep and the equal-policy Markdown arm have identical retrieval results.

Hit@1, recall@5, returned bytes, serialized scope safety, p50/p95 and storage
costs are reported with fixture/source/configuration/profile digests. Timings and
physical database sizes vary by platform and run; they are not frozen scores or
a backend-efficiency comparison. No embeddings or reranker are used. The gaps
justify investigating better context signals, not replacing working continuity
or promising a perfect score against a baseline.

## Historical SDK feasibility gate

Reliable source revision tracking must distinguish A→B→A, deletion/recreation
and restored copies, not merely compare a content hash and a timestamp. The
probe deterministically demonstrates an A→B→A hash/timestamp collision.

The original transparent-trigger proposal was blocked with AgentFS SDK
0.6.4/database dependency 0.4.4:

- Creating SQL triggers fails because experimental triggers are disabled.
- An unchanged AgentFS client also refuses to reopen a database containing a
  trigger created by another SQLite implementation.
- The failed schema transaction rolls back without changing ordinary values.

Enabling triggers elsewhere was therefore not a backward-compatible workaround.
That evidence remains valid for the original proposal, not a current blocker
for the separately implemented fresh-only tracked format. The revised source
uses a checked built-in SQLite worker, refuses old database clients and never
converts an existing store. See [storage admission and recovery](../storage.md#unreleased-tracked-store-foundation-source-checkout-only).

The original SDK capability probe still deliberately exits **2**. It probes that
old backend, not qualification of the revised tracked architecture:

```bash
node mcp-memory-server/scripts/probe-memory-context-revisions.mjs
```

Its `--baseline` mode asserts the known limitation and passes the regression
suite; that pass does **not** establish transparent old-client compatibility.
The old `smoke-memory-context-contract.mjs --expect-red` probe is retired now
that its tools exist; do not use it as a current passing test. The maintained
default-off snapshot and tracked-format tests are separate:

```bash
node mcp-memory-server/scripts/smoke-memory-context-contract.mjs --baseline
node mcp-memory-server/scripts/smoke-memory-database.mjs
node mcp-memory-server/scripts/smoke-memory-store-restore.mjs
```

Freshness, connections, maps and feedback remain unreleased source-only features,
not an upgrade enrollment or production-admission decision. The
[joint workflow guide](../memory-continuity-workflow.md) documents actual combined
replay, independent same-information Markdown, invalidation and honest costs.
The frozen corpus/report and this baseline's observations remain unchanged;
later evidence does not retroactively turn the failed original proposal into a
successful compatible migration.
