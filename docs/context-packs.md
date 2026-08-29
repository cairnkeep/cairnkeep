# Immutable context packs

Context packs provide project-approved reference documents and skills without
copying them into a harness or promoting them into durable memory. They are
local, immutable, disabled by default, and never execute instructions.

## Format and identity

The root `context-pack.json` follows
[`schemas/context-pack.schema.json`](../schemas/context-pack.schema.json). It
declares a kebab-case ID, semantic version, descriptive metadata, license, and
an ordered list of UTF-8 `document` or `skill` files with SHA-256 digests.

Validation rejects unknown manifest fields, absolute or traversing paths,
symlinks, devices, duplicate, missing or undeclared files, invalid UTF-8, and
digest mismatches. Limits are 1 MiB per file, 1,024 entries, and 64 MiB total.
The authoritative pack digest covers the exact manifest bytes plus sorted
path/content bytes. The version label is informative; the digest is identity.

```bash
cairn pack init ./my-pack --id my-pack --version 1.0.0 \
  --title "My pack" --description "Reviewed local guidance" --license Apache-2.0
# Edit metadata/kinds if needed, then refresh file hashes.
cairn pack lock ./my-pack
cairn pack validate ./my-pack
```

## Installation and project pinning

```bash
cairn pack install ./my-pack
cairn pack install https://example.invalid/repository.git --ref v1.0.0
cairn pack list
cairn pack show PACK-DIGEST
cairn pack enable PACK-DIGEST --project ./project
cairn pack disable my-pack --project ./project
cairn pack remove PACK-DIGEST
```

Local installation performs no network operation. Git installation requires
`--ref`, invokes the system `git` executable with an argument array, records
the exact resolved commit, rejects credentials embedded in URLs, and stores no
checkout metadata. Immutable objects live under `CAIRN_PACK_BASE_DIR` (default
`~/.cairnkeep/packs`). Project pointers are atomic and digest-pinned. Remote
administration may use a validated `--project-id` instead of a local path.

Objects are retained until explicitly removed. Removal is refused while any
project points to the digest. Ordinary uninstall retains them; use
`cairn uninstall --purge-packs` only after reviewing the dry run and backup.

Updates never synchronize in the background:

```bash
cairn pack update my-pack --check --project ./project
cairn pack update my-pack --apply --confirm CANDIDATE-DIGEST --project ./project
```

`--check` does not install or switch a project. `--apply` re-inspects the source,
requires the candidate digest, installs an immutable object, and atomically
switches only the named project.

## Retrieval and skill approval

Set `CAIRN_CONTEXT_PACKS=1` and restart the memory server to register the
read-only, closed-world tools: `context_pack_list`, `context_pack_search`,
`context_pack_read`, and `context_pack_related`. The related tool is available
for imported OKF bundles and traverses only deterministic local document links.
Every file or search result includes pack ID, version,
pack digest, path, kind, and file digest. Search uses the existing optional
embedding configuration and falls back to deterministic substring matching if
configuration or the endpoint is unavailable. Embedding cache data is stored
outside immutable objects.

Markdown is split deterministically at headings and paragraphs, with chunks
bounded to 8 KiB and 512-byte overlap. Only packs enabled for the current
project are searched.

Skills remain invisible until their exact file digest is approved:

```bash
cairn pack skills --project ./project
cairn pack approve-skill PACK-DIGEST path/to/SKILL.md \
  --confirm FILE-DIGEST --project ./project
cairn pack revoke-skill PACK-DIGEST path/to/SKILL.md --project ./project
```

Approval binds the project identity, pack digest, path, and file digest. A pack
update invalidates approval. Approved skills are only discoverable/readable
through the context-pack tools; Cairnkeep does not copy, activate, or execute
them.

Authenticated HTTP deployments need the separate
`CAIRN_CONTEXT_PACK_HTTP=1` consent flag in addition to
`CAIRN_CONTEXT_PACKS=1`, the existing bearer token, Host/CORS guards, and a
project header. Pack digests prove integrity, not publisher authenticity.
Publisher signatures remain future work.

## Progressive hierarchy and stable result references

The default `context_pack_search` request remains flat content search, preserving
the established schema and response shape. Agents can opt into progressive
disclosure without changing pack contents:

```json
{
  "query": "deployment rollback",
  "strategy": "hierarchical",
  "detail": "overview",
  "explain": true,
  "include_refs": true
}
```

`strategy` is `flat` or `hierarchical`; `detail` is `abstract`, `overview`, or
`content`. The optional trace is bounded and sanitized. `context_pack_tree`
returns the visible hierarchy at `abstract` or `overview` detail, optionally
limited by pack ID, `id@version`, or digest.

Summaries are deterministic derived cache entries below
`${CAIRN_PACK_BASE_DIR:-~/.cairnkeep/packs}/cache/context/`. They are bound to the
pack digest and visible-file-set digest, not stored in immutable objects, and can
be rebuilt without choosing an enabled version or granting approval. Search with
`include_refs: true` adds per-result `chunk_digest` values and a response-level
`result_digest` for optional usage receipts.

Only enabled documents and explicitly approved skills contribute to the tree,
summary cache, search results, or explanation trace. A skill approval remains
bound to project identity, pack digest, path, and file digest; a changed pack
digest cannot inherit it.

## Open Knowledge Format exchange

Use `cairn pack validate-okf` and `cairn pack import-okf` to consume OKF 0.1 or
0.2 as an immutable pack. Use the preview-and-confirm `cairn pack export-okf`
workflow to export only named project Markdown and promoted shared notes. See
[Open Knowledge Format exchange](open-knowledge-format.md) for the provenance,
graph, privacy, regression, and external-adapter decision contracts.
