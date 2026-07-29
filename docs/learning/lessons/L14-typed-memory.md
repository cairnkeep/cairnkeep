# L14 - Typed memory and controlled import

**Status:** Brief
**Track:** Evidence and Evaluation
**Planned time:** 40 minutes

## Outcome

Use typed metadata and hard filters, preview a bounded structured import, and
explain how project-note and shared-note address spaces differ from filesystem
paths and ordinary memory scopes.

## Planned lesson

- `CAIRN_TYPED_MEMORY_NODES` as a default-off server-start contract.
- Core node types, canonical tags, exact-match ordering, and hard filters before
  semantic ranking.
- Logical `memory`, `project-notes`, and `shared-notes` address spaces.
- Bounded schema-v1 `memory_import`, stable `import_id`, dry run, reject by
  default, and explicit supersession with preserved history.
- Journaled note-address transactions, replay, and `cairn doctor --repair`.
- Why typed metadata adds discovery structure but does not make a fact true.

## Hands-on lab

Start an isolated local server with typed nodes enabled. Write synthetic nodes
with two types and several normalized tags, compare unfiltered and hard-filtered
searches, then dry-run a two-item import. Apply it once with reject semantics,
replay the same `import_id`, and inspect history after one explicit superseding
import.

## Acceptance criteria

- Restarting the server after changing the feature flag is part of the lab.
- Type and tag filters exclude nonmatching nodes before ranking.
- The dry run writes nothing, the replay is idempotent, and the default policy
  cannot overwrite an existing key.
- Imported values never appear in command diagnostics or course screenshots.
- The learner does not present a logical note address as a host path.

## Source material

- [Operating guide: typed memory nodes](../../operating.md#typed-memory-nodes-and-note-address-spaces-opt-in)
- [Storage and deployment](../../storage.md#typed-metadata-import-replay-and-history)
- [Typed memory schema](../../../schemas/memory-node.schema.json)
