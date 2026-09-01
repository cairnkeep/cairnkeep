# L24 - Reviewed knowledge exchange

**Status:** Ready
**Tested with:** Cairnkeep 2.17.2 and Node.js 22 or newer
**Time:** 35 minutes

## Outcome

Validate and import an OKF bundle as immutable project context, inspect its
structured provenance and deterministic links, then export an explicitly
selected, redacted OKF 0.2 bundle without confusing exchange with durable
memory or publisher trust.

## Exercise

Create a disposable OKF 0.2 bundle:

```bash
lab=$(mktemp -d)
mkdir -p "$lab/source/concepts" "$lab/project"
cat >"$lab/source/index.md" <<'EOF'
---
okf_version: "0.2"
---
# Local catalog

* Policy
EOF
printf '%s%s\n' '* [Policy]' '(concepts/policy.md)' >>"$lab/source/index.md"
cat >"$lab/source/concepts/policy.md" <<'EOF'
---
type: Policy
title: Synthetic policy
description: Offline course fixture.
sources:
  - resource: urn:course:fixture
verified: { by: human:course-reviewer }
---
# Synthetic policy

This content is deliberately non-sensitive.
EOF
export CAIRN_PACK_BASE_DIR="$lab/store"
cairn pack validate-okf "$lab/source"
cairn pack import-okf "$lab/source" --id course-okf \
  --version 1.0.0 --license CC0-1.0 --json >"$lab/import.json"
digest=$(node -e 'process.stdout.write(require(process.argv[1]).digest)' "$lab/import.json")
cairn pack enable "$digest" --project "$lab/project"
```

Start the project memory server with `CAIRN_CONTEXT_PACKS=1`. Through an MCP
client, confirm that list/search/read results contain `okf.version`, concept
type, source, trust tier, freshness state, links, and diagnostics. Call
`context_pack_related` for `concepts/policy.md`; it performs no URL fetch and
returns only enabled files from the same digest-pinned pack.

Now preview and apply an allowlist-only export:

```bash
mkdir -p "$lab/project/docs"
printf '# Reviewed decision\n\nSynthetic approved text.\n' \
  >"$lab/project/docs/decision.md"
cairn pack export-okf --project "$lab/project" --output "$lab/export" \
  --file docs/decision.md --check
# Copy the printed preview digest only after inspecting the file list.
cairn pack export-okf --project "$lab/project" --output "$lab/export" \
  --file docs/decision.md --apply --confirm PREVIEW-DIGEST
cairn pack validate-okf "$lab/export"
```

## Common failures

- A concept without YAML `type`, a YAML alias, a symlink, invalid UTF-8, or an
  unsafe path fails validation.
- Git input needs an explicit `--ref`; local validation/import does not use the
  network.
- Export rejects broad private/runtime paths and accepts only named Markdown or
  promoted shared notes.
- Any selected-byte or redaction change invalidates the preview digest. An
  existing output directory is never replaced.

## Privacy and trust boundary

Import metadata is reported, not vouched for. A pack digest proves byte
integrity but not publisher authenticity, and OKF computation/attestation
metadata is never executed. Optional embedding search can send chunks to the
configured endpoint; substring search and link traversal stay local. Export
applies redaction, but explicit review of both preview and output is still
required before publication.

An external knowledge adapter remains deferred unless a representative task
demonstrates a necessary capability that memory, promoted notes, context packs,
links, embeddings, and OKF exchange cannot provide with lower operational and
privacy cost.

## Recovery and acceptance

```bash
cairn pack disable course-okf --project "$lab/project"
cairn pack remove "$digest"
unset CAIRN_PACK_BASE_DIR
rm -rf "$lab"
```

- Validation and import preserve OKF 0.1/0.2 provenance without modifying the
  source.
- Related-document retrieval is deterministic, closed-world, and read-only.
- The regression fixture detects wrong top results, stale metadata, missing
  provenance, and broken links.
- Export check performs no writes; apply requires the exact recomputed digest
  and creates only the reviewed destination.
