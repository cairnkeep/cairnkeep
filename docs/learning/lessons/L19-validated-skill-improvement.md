# L19 - Validated skill improvement

**Status:** Brief
**Track:** Evidence and Evaluation
**Planned time:** 50 minutes
**Introduced in:** Cairnkeep 2.8.0

## Outcome

Turn repeated failure and demonstrated resolution evidence into one reviewed
skill proposal, measure it on separate exploration and confirmation tasks,
apply only the exact eligible digest, and prove rollback without risking a real
project.

## Planned lesson

- Why harvest requires failures from at least two sessions and at least one
  recorded resolution.
- How `harvest`, `show`, and `review --approve` keep evidence local until the
  learner consents to proposal-adapter egress.
- How the strict proposal adapter receives a bounded request, a private process
  environment, and an edit budget for one existing `SKILL.md`.
- Why proposal generation and evaluation never modify the live target.
- How separate committed sets with at least two disjoint task IDs and
  definitions each, one immutable source revision, fresh Git worktrees, exact
  adapter digests, and an independent verifier protect the gate.
- Why improvements count distinct tasks, any regressed task rejects the
  candidate, and small passing fixtures are not universal quality proof.
- How full proposal-digest confirmation, backup-first atomic replacement, and
  concurrent-edit-safe rollback limit application authority.

## Hands-on lab

Use a future disposable `course-09-skill` checkpoint containing synthetic
hindsight evidence, a small `SKILL.md`, deterministic proposal and evaluation
adapters, and separate committed task sets. The lab will run:

```bash
cairn skill harvest --project . --json
cairn skill show --kind candidate --id CANDIDATE_ID
cairn skill review --candidate CANDIDATE_ID --approve --json
cairn skill propose --candidate CANDIDATE_ID --target skills/demo/SKILL.md \
  --adapter fixtures/proposal-adapter.json --json

export CAIRN_EVAL=1
cairn skill evaluate --proposal PROPOSAL_ID \
  --exploration-task-set eval/exploration.json \
  --confirmation-task-set eval/confirmation.json \
  --adapter eval/adapter.json --repetitions 2 --yes --json

cairn skill apply --proposal PROPOSAL_ID --evaluation EVALUATION_ID \
  --confirm FULL_PROPOSAL_DIGEST --json
cairn skill rollback --application APPLICATION_ID --confirm --json
```

The lesson remains a Brief until that checkpoint is public and every command is
rehearsed against the release package.

## Acceptance criteria

- No candidate exists for repeated failure without resolution evidence.
- Proposal execution cannot inherit unapproved credentials or isolation-owned
  environment variables.
- The live `SKILL.md` is byte-identical before and after propose/evaluate.
- Overlapping task IDs, changed adapters, unknown verifier results, and any
  regression fail closed.
- Apply rejects a wrong digest or changed target.
- Rollback restores the original bytes and refuses to overwrite a later edit.
- The learner can explain why an eligible small task set supports one local
  decision but not a universal performance claim.

## Privacy and trust boundary

Hindsight excerpts and skill content remain local until candidate approval.
Approval permits those exact fields to enter the explicitly configured proposal
adapter. Evaluation adapters receive isolated worktrees with baseline or
candidate skill bytes, not the hindsight evidence. Candidate, proposal,
evaluation, application, backup, and report artifacts remain sensitive local
project state under `.agentfs/`.

## Source material

- [Validated skill improvement](../../skill-improvement.md)
- [Evaluation and ablation](L16-evaluation.md)
- [The agent boundary](L17-agent-boundary.md)
- [Storage](../../storage.md#validated-skill-storage)
- [Privacy and data flow](../../privacy-and-data-flow.md#validated-skill-improvement-flow)
