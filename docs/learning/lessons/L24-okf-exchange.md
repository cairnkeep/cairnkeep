# L24 - Reviewed knowledge exchange

**Status:** Ready
**Tested with:** Cairnkeep 2.29.0 and Node.js 22 or newer
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
generated: { by: process:course-fixture, at: 2026-08-01T00:00:00Z }
verified: { by: human:course-reviewer, at: 2026-08-02T00:00:00Z }
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

- In stable 2.29, a concept without YAML `type` fails validation. The unreleased
  candidate skips such Markdown with a diagnostic and never exposes it through
  pack tools. YAML aliases, symlinks, invalid UTF-8 and unsafe paths still fail.
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

## Candidate extension: current reviews and OKF 0.3

This extension requires the unreleased OKF 0.3 source candidate, not stable
2.29. Do not present it as installed availability in a stable-only lesson.

In a second disposable source, declare `okf_version: "0.3"` and add root
`title`, `description` and `license`. Include an untyped README and SKILL file;
validate/import and confirm neither enters the pack manifest or read/search
results. They are packaging files, not approved skills or executable authority.

Move the policy's `generated.at` forward to `2026-08-03T00:00:00Z` without
changing the verification. Import under a different ID (or use the explicit
update check/confirmation workflow). Its old human review must now yield
`unverified`. Add a new verification at `2026-08-04T00:00:00Z`: only a new
digest-pinned import/update may show the declared human-review label again.
The old object and original verification history remain unchanged.

Also try an offset-bearing `stale_after`, a malformed deadline, and a deprecated
concept with `superseded_by: ./replacement.md`. Inspect staleness diagnostics
and the replacement edge. None of these metadata claims grant authorization.

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
