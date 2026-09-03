# L21 - Immutable context packs and skill approval

**Status:** Ready
**Tested with:** Cairnkeep 2.17.3 and Node.js 22 or newer
**Time:** 40 minutes

## Outcome

Build a local offline context pack, verify its immutable identity, pin it to a
disposable project, and explain why document enablement and skill approval are
different trust decisions.

## Exercise

```bash
lab=$(mktemp -d)
mkdir -p "$lab/pack" "$lab/project"
printf '# Local guide\n\nSynthetic offline guidance.\n' >"$lab/pack/guide.md"
export CAIRN_PACK_BASE_DIR="$lab/store"
cairn pack init "$lab/pack" --id course-guide --version 1.0.0 \
  --title "Course guide" --description "Synthetic local reference" \
  --license Apache-2.0
cairn pack lock "$lab/pack"
cairn pack validate "$lab/pack"
cairn pack install "$lab/pack" --json >"$lab/install.json"
digest=$(node -e 'process.stdout.write(require(process.argv[1]).digest)' "$lab/install.json")
cairn pack enable "$digest" --project "$lab/project"
cairn pack show "$digest" --json
cairn pack skills --project "$lab/project" --json
```

The local lifecycle makes no network request. The pack digest covers exact
manifest and content bytes; `version` is a label, not identity. Objects remain
under `$CAIRN_PACK_BASE_DIR` after disablement and ordinary uninstall.

Add a file with `kind: skill`, refresh it with `cairn pack lock`, install the new
digest, and enable it. `cairn pack skills` shows the skill but the MCP list/read
surface does not expose it until:

```bash
cairn pack approve-skill NEW-PACK-DIGEST path/to/SKILL.md \
  --confirm FILE-DIGEST --project "$lab/project"
```

Approval binds the project, pack, path, and file bytes. A later pack update
invalidates it. Approval makes instructions readable only; it never executes or
copies them into a harness.

## Common failures

- Adding a file after `init` requires declaring it in the manifest before
  `lock`; undeclared content is rejected.
- Git installation without `--ref`, a stale update confirmation, and removal of
  an enabled digest all fail closed.
- Enabling the pack does not expose a skill until its current file digest is
  approved.

## Privacy and trust boundary

Local pack operations are offline. Configured semantic search can send enabled
chunks and a query to the explicit embedding endpoint; failure falls back to
substring search. A digest detects changed bytes but does not authenticate the
publisher. Approved instructions remain untrusted readable context, not code.

## Recovery and acceptance

```bash
cairn pack disable course-guide --project "$lab/project"
cairn pack remove "$digest"
unset CAIRN_PACK_BASE_DIR
rm -rf "$lab"
```

- Traversal, symlinks, undeclared files, invalid UTF-8, and digest tampering fail
  validation.
- `update --check` never switches a project; apply requires the inspected digest.
- `CAIRN_CONTEXT_PACKS=1` enables local read-only tools only after restart.
- HTTP additionally requires `CAIRN_CONTEXT_PACK_HTTP=1` and existing auth.
- A digest proves integrity, not publisher authenticity.

Continue with [L24](L24-okf-exchange.md) for structured OKF provenance,
deterministic related-document retrieval, regression diagnostics, and the
privacy-reviewed export workflow.
