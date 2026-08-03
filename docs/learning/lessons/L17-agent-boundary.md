# L17 - The agent boundary

**Status:** Brief
**Track:** Evidence and Evaluation
**Planned time:** 25 minutes

## Outcome

Separate Cairnkeep's shipped evidence, evaluation, and narrow skill-file
lifecycle from the design-only general meta-agent proposal, and identify which
authority always remains with the operator and external harness.

## Planned lesson

- Current facts: typed capability state, local evidence, immutable evaluation
  inputs, isolated schedules, independent verification, and canonical reports.
- Shipped in 2.8.0: reviewed hindsight candidates, bounded edits to one existing
  `SKILL.md`, isolated baseline/candidate comparison, held-out confirmation,
  exact-digest application, and rollback ledgers.
- Design only: general natural-language configuration compilation, arbitrary
  target types, autonomous scheduling, and an owner inference loop.
- Cairnkeep coordinates evidence; it does not own a harness inference loop.
- Natural language is untrusted proposal data, not executable authorization.
- Separate human gates for form, evaluation, application, confirmation, and
  rollback.
- Why the shipped `cairn skill` command does not authorize or imply the broader
  proposed meta-agent loop or a product quality claim.

## Hands-on lab

Give learners a fictional automation proposal. Ask them to mark each operation
as a current Cairnkeep capability, an operator/external-adapter responsibility,
or future design-only work. Then identify the minimum approval, immutable input,
path boundary, resource ceiling, evidence, and rollback information that would
be required before any future implementation could act.

## Acceptance criteria

- No learner attempts to invoke a meta-agent command or treats an illustrative
  block as a supported schema.
- The learner can distinguish supported `cairn skill` operations from the
  broader design-only proposal.
- Every inference execution remains owned by an operator-configured adapter.
- A capability digest is not treated as approval, identity proof, or evidence
  of improvement.
- Held-out confirmation data never becomes candidate-generation feedback.
- The learner can name at least one explicit future prerequisite and one
  unconditional human stop point.

## Source material

- [Meta-agent design contract](../../design/meta-agent.md)
- [Evaluation and ablation](L16-evaluation.md)
