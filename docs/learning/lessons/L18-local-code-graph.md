# L18 - Local code graph

**Status:** Brief
**Track:** Practitioner
**Planned time:** 35 minutes
**Introduced in:** Cairnkeep 2.7.0

## Outcome

Build and inspect an optional local structural graph without confusing derived
graph data with canonical source code or granting an external tool ownership of
the Cairnkeep operating layer.

## Planned lesson

- When a structural graph answers a code-navigation question better than
  durable memory, the wiki, or broad text search.
- Why the graph capability is disabled unless the managed capability contract
  enables `graph` or the compatibility setting `graphify.enabled` is true.
- How to install only the isolated `graphify` executable with `uv tool install
  graphifyy` or `pipx install graphifyy`. Do not run `graphify install` because
  Cairnkeep owns the harness commands, policies, and lifecycle.
- How `cairn graph build`, `cairn graph status`, `cairn graph query`,
  `cairn graph explain`, `cairn graph path`, and `cairn graph diff` share one
  portable owner across harnesses and the shell.
- Why builds index local code only, use a reduced subprocess environment, avoid
  provider credentials and semantic document extraction, and publish validated
  artifacts atomically under `.planning/graphs/` while Graphify maintains its
  separate incremental work directory under `graphify-out/`.
- How the previous successful graph snapshot supports `diff`, and why `--force`
  is appropriate only when an intentional code deletion reduces the graph.
- Why exact symbols and narrow terms are more reliable than broad prose, and
  why every graph result must be checked against canonical source files.
- How Claude Code and OpenCode receive managed `/graphify` wrappers while
  `cairn sync-kimi --apply` and `cairn sync-pi --apply` install thin delegates
  that call only `cairn graph`.

## Hands-on lab

Use the synthetic course repository at checkpoint `course-08-graph` in a
disposable clone. Confirm that a disabled graph fails before Graphify or graph
artifacts are accessed. Install only the isolated executable, enable the graph
through one documented capability path, and then run:

```bash
cairn graph build
cairn graph status
cairn graph query addItem
cairn graph explain addItem
cairn graph path addItem writeLedger
```

Make one reversible change to the synthetic ledger, rebuild, and inspect
`cairn graph diff`. Revert the source change, rebuild again, and verify the
status. Inspect `.planning/graphs/` and `graphify-out/` without adding either
derived location to Git.

## Acceptance criteria

- The disabled-path check creates or changes no graph artifact.
- `status` identifies whether the published graph is present and current.
- `query`, `explain`, and `path` return structural discovery evidence that the
  learner verifies against `src/trail-ledger.mjs`.
- A second successful build produces a snapshot-backed diff.
- The learner can explain why `--force` is not a generic retry flag.
- The repository contains no Graphify-owned harness assets and neither
  `graphify-out/` nor a published graph artifact is staged for commit.
- The learner can distinguish graph storage and subprocess data flow from
  Cairnkeep memory storage and optional embedding traffic.

## Common failures

- If `graphify` is missing, install the isolated CLI and verify it is on
  `PATH`; do not run its harness installer.
- If the capability is disabled, enable it through the managed contract or the
  compatibility setting rather than bypassing the owner.
- If no previous snapshot exists, make a successful build after a real code
  change before requesting `diff`.
- If a path or explanation is empty, retry with exact symbol names and verify
  the source directly instead of treating a broad query as proof.

## Privacy and trust boundary

The managed build passes the repository path to a local Graphify subprocess and
publishes a validated view locally. Its reduced environment excludes provider
credentials, and the managed workflow does not perform semantic document
extraction. Graphify's incremental `graphify-out/` workspace and Cairnkeep's
published `.planning/graphs/` view can both contain sensitive structural data.
Keep both local by default, review ignore rules, and never present the graph as
canonical evidence.

## Source material

- [Operating guide](../../operating.md#optional-graphify-workflow)
- [Harness compatibility](../../harness-compatibility.md)
- [Privacy and data flow](../../privacy-and-data-flow.md)
- [L15 - Capability governance](L15-capability-governance.md)
