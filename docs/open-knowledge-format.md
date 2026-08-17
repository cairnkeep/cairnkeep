# Open Knowledge Format exchange

Cairnkeep can ingest Open Knowledge Format (OKF) 0.1 and 0.2 bundles as
immutable context packs and can export an explicitly reviewed subset of local
knowledge as OKF 0.2. This is an exchange boundary, not a second memory store,
an agent runtime, or a synchronization service.

## Validate and import

```bash
cairn pack validate-okf ./knowledge
cairn pack import-okf ./knowledge \
  --id reviewed-knowledge --version 1.0.0 --license CC-BY-4.0
cairn pack enable reviewed-knowledge --project ./project
```

The importer accepts a local directory without network access. A Git source
requires `--ref`; Cairnkeep resolves and records the exact commit using the
system `git` executable. Repository metadata is excluded. Import copies only
validated UTF-8 bundle files into a new immutable object and never modifies the
source.

Validation rejects symlinks, devices, unsafe paths, invalid UTF-8, YAML aliases,
missing concept `type`, duplicate YAML keys, and the normal context-pack size
limits. Unknown concept metadata remains available for forward-compatible
reading. A future OKF version produces a diagnostic and is consumed on a
best-effort basis rather than being treated as fully supported.

OKF 0.2 provenance is preserved in the `okf` field returned by
`context_pack_list`, `context_pack_search`, and `context_pack_read`. It includes
the format version, file role, concept identity and type, declared sources,
generation and verification events, trust tier, status, staleness, links, and
diagnostics. These are source assertions: Cairnkeep reports them but does not
turn them into publisher authenticity or executable authority.

## Deterministic links and retrieval

With `CAIRN_CONTEXT_PACKS=1`, imported packs also expose the read-only,
closed-world `context_pack_related` MCP tool. It traverses local Markdown links
in `outbound`, `inbound`, or `both` directions. External URLs are never fetched.
Broken and unsafe local links remain diagnostics. The derived graph cache lives
outside immutable objects and is keyed by the authoritative pack digest; it can
always be rebuilt from the object.

Search still follows the context-pack retrieval contract: deterministic
substring matching is always available, while configured embeddings are an
optional enhancement with a clean lexical fallback. Regression fixtures cover
the expected top result, source/trust preservation, stale-content warnings,
missing-metadata diagnostics, broken links, and embedding-independent graph
results.

## Privacy-reviewed export

Export is allowlist-only and uses a two-step confirmation:

```bash
cairn pack export-okf --project ./project --output ./reviewed-okf \
  --file docs/decision.md --note shared-example --check

cairn pack export-okf --project ./project --output ./reviewed-okf \
  --file docs/decision.md --note shared-example \
  --apply --confirm PREVIEW-DIGEST
```

`--check` writes nothing. It reads only the named Markdown files and promoted
shared notes, applies the local redaction policy, and returns the exact output
list, output digests, redaction count, and confirmation digest. `--apply`
recomputes that plan and writes atomically only when the digest matches. It
refuses an existing output directory.

Private runtime directories, Git metadata, dependencies, and most planning
state cannot be selected. The reviewed wiki subtree is the sole planning-state
exception and is mapped to `wiki/`. Project hindsight and provenance notes are
not exportable: only already-corroborated `shared` notes pass the note reader.
The resulting bundle can still contain sensitive domain content, so review the
preview and the output before publishing it.

## External adapter decision gate

No live external knowledge-system adapter is included. Native memory, promoted
notes, immutable packs, deterministic links, optional embeddings, and OKF
import/export already cover local capture, reviewed sharing, retrieval, and
portable exchange.

An adapter should be added only when a concrete workflow demonstrates all of
the following:

1. It needs a capability Cairnkeep cannot express through those native
   surfaces, not merely another UI or duplicate graph.
2. The benefit is measured on a representative task set and exceeds the added
   privacy, availability, migration, and operational cost.
3. Cairnkeep remains the sole owner of durable-memory mutations; the adapter is
   read-only or has an explicit, reversible write boundary.
4. Authentication, data egress, deletion, backup, and failure behavior are
   testable without weakening local/offline defaults.
5. A provider-neutral interface and fixture can be maintained without adding a
   background agent loop or automatic activation.

Until a use case passes that gate, OKF exchange is the smaller and safer
integration seam.
