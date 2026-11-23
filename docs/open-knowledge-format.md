# Open Knowledge Format exchange

Cairnkeep can ingest Open Knowledge Format (OKF) 0.1 and 0.2 bundles as
immutable context packs and can export an explicitly reviewed subset of local
knowledge as OKF 0.2. This is an exchange boundary, not a second memory store,
an agent runtime, or a synchronization service.

The unreleased source candidate additionally reads OKF 0.3. Existing 0.1/0.2
imports and the 0.2 export format remain supported; no installed pack is
rewritten or automatically updated. The compatibility rules below describe
that candidate, not an already published release.

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
duplicate YAML keys, and the normal context-pack size limits. In the candidate,
Markdown without a non-empty `type` is skipped with a diagnostic rather than
imported as a concept. This includes untyped `README.md`, `AGENTS.md` and
`SKILL.md`; dot files/directories are excluded. Unknown metadata, including
nested extension keys, remains available for forward-compatible
reading. A future OKF version produces a diagnostic and is consumed on a
best-effort basis rather than being treated as fully supported.

OKF provenance is preserved in the `okf` field returned by
`context_pack_list`, `context_pack_search`, and `context_pack_read`. It includes
the format version, file role, concept identity and type, declared sources,
generation and verification events, trust tier, status, staleness, links, and
diagnostics. These are source assertions: Cairnkeep reports them but does not
turn them into publisher authenticity or executable authority.

## OKF 0.3 compatibility (unreleased)

The candidate follows the [upstream 0.3 specification](https://github.com/open-knowledge-format/open-knowledge-format/blob/main/SPEC.md)
for the exchange features described here:

- Root `index.md` accepts `title`, `description`, `license` and extension
  metadata alongside `okf_version`. Import still requires an explicit pack
  license; a source declaration is not a license-verification service.
- Only valid verification events at or after `generated.at` contribute to the
  declared trust tier. If generation is absent, a valid dated verification can
  qualify. Missing/malformed dates cannot grant a review label, and an old
  human review cannot qualify revised content. Original events and extensions
  remain in source bytes/metadata. This conservative trust correction also
  applies when reading older bundles; historical labels may be downgraded.
  Existing 0.2 shared-note exports have an undated generation event: their
  promotion history is retained, but cannot establish a current verification.
  Export bytes remain unchanged; the importer does not invent a generation date.
- Date-only values mean midnight UTC. RFC 3339 timestamps require an explicit
  offset. `stale_after` is evaluated at its actual instant, including on later
  reads of a cached pack. Malformed deadlines are never fresh. Stale means
  recheck, not false; leap-second values are conservatively treated as malformed.
- Optional null/empty metadata and singleton lists are accepted. Incomplete
  source/verification entries are ignored for derived provenance. Unknown
  lifecycle statuses remain visible and are not relabeled `stable`.
- `superseded_by` on deprecated concepts supplies a local replacement edge.
  Retrieval continues to show lifecycle metadata rather than silently hiding
  historical documents or automatically replacing a requested document.

This remains a bounded UTF-8 text importer, not support for every possible OKF
asset or computation runtime. The existing per-file, entry and total-byte limits
apply; binary assets, symlinks and YAML aliases remain rejected. Metadata never
executes scripts, approves skills, publishes memory or grants permissions.

## Deterministic links and retrieval

With `CAIRN_CONTEXT_PACKS=1`, imported packs also expose the read-only,
closed-world `context_pack_related` MCP tool. It traverses local Markdown links
in `outbound`, `inbound`, or `both` directions. External URLs are never fetched.
Broken and unsafe local links remain diagnostics. The derived graph cache lives
outside immutable objects and is keyed by the authoritative pack digest; it can
always be rebuilt from the object.

The candidate also recognizes reference-style Markdown links and replacement
path fields. `/path.md` means the bundle root, not the host filesystem; other
paths resolve relative to the containing file. Only declared 0.1/0.2 or
unversioned bundles can use the legacy bundle-root fallback for an unresolved
path field. A traversal or encoded escape never triggers an outside read.

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
