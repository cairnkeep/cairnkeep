# L19 - Validated skill improvement

**Status:** Ready
**Track:** Evidence and Evaluation
**Time:** 50 minutes
**Tested with:** Cairnkeep 2.15.0

## Outcome

Turn repeated failure and demonstrated resolution evidence into one reviewed
skill proposal, measure it on separate exploration and confirmation tasks,
apply only the exact eligible digest, and prove rollback without risking a real
project.

## Lesson

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

Use the disposable `course-09-skill` checkpoint from the synthetic course
repository. It contains bounded hindsight evidence, one existing `SKILL.md`,
deterministic proposal and evaluation adapters, and separate committed task
sets. Keep every generated artifact under `.course-state/`:

```bash
git switch --detach course-09-skill
scripts/reset-course-state.sh --yes
node scripts/setup-skill-lab.mjs
core=$(node scripts/locate-cairnkeep-core.mjs)
lab="$PWD/.course-state/skill-project"
export CAIRN_AGENTFS_BASE_DIR="$PWD/.course-state/agentfs"

"$core/bin/cairn" skill harvest --project "$lab" --json
"$core/bin/cairn" skill show --project "$lab" \
  --kind candidate --id CANDIDATE_ID
"$core/bin/cairn" skill review --project "$lab" \
  --candidate CANDIDATE_ID --approve --json
"$core/bin/cairn" skill propose --project "$lab" \
  --candidate CANDIDATE_ID --target skills/course-review/SKILL.md \
  --adapter "$lab/fixtures/proposal-adapter.json" --json

export CAIRN_EVAL=1
"$core/bin/cairn" skill evaluate --project "$lab" \
  --proposal PROPOSAL_ID \
  --exploration-task-set "$lab/eval/exploration.json" \
  --confirmation-task-set "$lab/eval/confirmation.json" \
  --adapter "$lab/eval/eval-adapter.json" \
  --repetitions 1 --minimum-improvement 1 --yes --json

"$core/bin/cairn" skill apply --project "$lab" \
  --proposal PROPOSAL_ID --evaluation EVALUATION_ID \
  --confirm FULL_PROPOSAL_DIGEST --json
"$core/bin/cairn" skill rollback --project "$lab" \
  --application APPLICATION_ID --confirm --json
```

Before applying, deliberately try an incorrect digest and verify it is rejected.
After rollback, compare the target with `fixtures/skill/SKILL.md` byte for byte.

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

## Common failures

- If harvest returns no candidate, confirm the evidence contains the same
  failure family in at least two distinct sessions and a recorded resolution.
- If proposal validation rejects the adapter program, regenerate the lab and
  verify its configuration resolves to the reviewed executable by absolute
  path.
- If evaluation is disabled, set `CAIRN_EVAL=1` only for this disposable lab
  and retain the explicit `--yes` confirmation.
- If task validation reports overlap or a mutable revision, use the committed
  exploration and confirmation fixtures from `course-09-skill` unchanged.
- If apply rejects the confirmation, copy the full `proposal_digest` from the
  reviewed proposal rather than an ID, prefix, or candidate-content digest.
- If rollback reports a concurrent target change, stop and inspect that edit;
  do not overwrite it by copying the backup manually.

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
