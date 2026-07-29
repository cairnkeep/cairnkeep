# L16 - Evaluation and ablation

**Status:** Brief
**Track:** Evidence and Evaluation; Operator
**Planned time:** 50 minutes

## Outcome

Validate and run the bundled offline fixture, inspect a canonical two-pass
report, and explain what a one-capability ablation can and cannot establish.

## Planned lesson

- The default-off coordinator and operator-owned adapter boundary.
- Immutable task sets, paired seeds, fresh isolated workspaces, independent
  verification, and deterministic serial schedules.
- Run 1 versus fresh Run 2 with a task-contained immutable note snapshot.
- An all-enabled baseline versus exactly one disabled capability.
- Eligible pairs, missingness, compatible turn semantics, reported token/cost
  fields, bootstrap intervals, and bounded reports.
- `offline-framework` evidence versus separately validated live evidence.
- Dry validation, invocation estimates, explicit `--yes`, cancellation, report
  retention, dry-run pruning, and deletion.

## Hands-on lab

Build the server, enable evaluation only for the commands below, and use a
temporary output directory with the committed fake task set and adapter.

```bash
npm run build:server
output=$(mktemp -d)
CAIRN_EVAL=1 bin/cairn eval validate \
  --task-set examples/eval/task-set.json \
  --adapter examples/eval/adapter.json --output "$output" --json
CAIRN_EVAL=1 bin/cairn eval run \
  --task-set examples/eval/task-set.json \
  --adapter examples/eval/adapter.json --output "$output" --yes --json
```

Inspect the reported experiment ID with `cairn eval report`, then run one
`memory.search` ablation only after reviewing the printed invocation estimate.
Finish with a dry-run prune. The complete lesson will pin exact expected fields
after the lab is rehearsed from the packaged CLI rather than a source clone.

## Acceptance criteria

- `validate` invokes no adapter and writes no experiment.
- Every run uses isolated task workspaces and an independent verifier result.
- Unknown or infrastructure outcomes are not counted as pass or fail.
- The learner reports estimates, intervals, missingness, and evidence scope
  without claiming causality, significance, or product improvement.
- Course cleanup is limited to its temporary contained experiment root.

## Source material

- [Operating guide: evaluation harness](../../operating.md#evaluation-harness-opt-in)
- [Privacy and data flow](../../privacy-and-data-flow.md#evaluation-adapter-and-report-flow)
- [Bundled offline evaluation fixture](../../../examples/eval/README.md)
- [Evaluation task schema](../../../schemas/eval-task-set.schema.json)
