# L17 - The agent boundary

**Status:** Brief
**Track:** Evidence and Evaluation
**Planned time:** 25 minutes

## Outcome

Separate Cairnkeep's shipped evidence and evaluation substrates from the
design-only bounded meta-agent proposal, and identify which authority always
remains with the operator and external harness.

## Planned lesson

- Current facts: typed capability state, local evidence, immutable evaluation
  inputs, isolated schedules, independent verification, and canonical reports.
- Design only: natural-language form compilation, candidate generation,
  candidate injection, comparison, proposal bundles, patch application, and
  rollback ledgers.
- Cairnkeep coordinates evidence; it does not own a harness inference loop.
- Natural language is untrusted proposal data, not executable authorization.
- Separate human gates for form, evaluation, application, confirmation, and
  rollback.
- Why no CLI command, schema, runtime default, or quality claim ships for the
  proposed meta-agent loop.

## Hands-on lab

Give learners a fictional automation proposal. Ask them to mark each operation
as a current Cairnkeep capability, an operator/external-adapter responsibility,
or future design-only work. Then identify the minimum approval, immutable input,
path boundary, resource ceiling, evidence, and rollback information that would
be required before any future implementation could act.

## Acceptance criteria

- No learner attempts to invoke a meta-agent command or treats an illustrative
  block as a supported schema.
- Every inference execution remains owned by an operator-configured adapter.
- A capability digest is not treated as approval, identity proof, or evidence
  of improvement.
- Held-out confirmation data never becomes candidate-generation feedback.
- The learner can name at least one explicit future prerequisite and one
  unconditional human stop point.

## Source material

- [Meta-agent design contract](../../design/meta-agent.md)
- [Evaluation and ablation](L16-evaluation.md)
