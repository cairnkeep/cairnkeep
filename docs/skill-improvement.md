# Validated skill improvement

`cairn skill` turns recurring project hindsight into a proposed change to one
existing skill file, then requires independent evidence before that change can
be applied. It is an operator-controlled lifecycle, not an autonomous rewrite
loop.

## Safety contract

- Harvest reads only project hindsight notes and requires failures from at
  least two distinct sessions by default.
- Evidence remains local until `review --approve` records explicit approval.
- Proposal generation invokes only the configured executable, sends one strict
  bounded JSON request, exposes only allowlisted environment variables, and
  accepts a bounded edit list rather than an arbitrary rewritten tree.
- Proposal and evaluation artifacts bind the adapter executable digest;
  evaluation rechecks it after exploration and confirmation.
- Proposal and evaluation use candidate content without modifying the live
  target.
- Evaluation requires repository-root tasks in two different committed task
  sets with at least two tasks each. Task IDs and exact task definitions cannot
  overlap, and both sets must bind the same immutable source revision.
- Confirmation runs only after exploration passes. Confirmation results never
  return to proposal generation.
- Apply requires an eligible exact evaluation, an unchanged target, and the
  full proposal digest. It creates a private backup before atomic replacement.
- Rollback refuses to overwrite a target changed after application.

## Prepare a target and proposal adapter

The target is one existing project-relative regular file named `SKILL.md`, for example
`.claude/skills/generated-client-review/SKILL.md`. It cannot be a symlink and
is limited to 256 KiB.

The proposal adapter configuration is strict JSON:

```json
{
  "schema_version": 1,
  "id": "local-skill-proposer",
  "command": {
    "program": "/absolute/path/to/proposal-adapter",
    "args": []
  },
  "environment_allowlist": ["PROPOSAL_PROVIDER_TOKEN"],
  "limits": {
    "elapsed_ms": 120000,
    "stdout_bytes": 1048576
  }
}
```

The executable receives the approved candidate, its digest, current target
content and digest, and edit budget on stdin. It returns `add`, `replace`, or
`delete` edits with exact anchors and rationales. The executable path must be
absolute, executable, and not a symlink. Cairnkeep does not provide a model,
endpoint, credential, or network default. The machine-readable contracts are
[`schemas/skill-adapter.schema.json`](../schemas/skill-adapter.schema.json) and
[`schemas/skill-proposal-protocol.schema.json`](../schemas/skill-proposal-protocol.schema.json).
Process-isolation variables such as `HOME`, `PATH`, temporary directories,
XDG roots, and Node runtime injection settings cannot be allowlisted.
This environment boundary is not an operating-system sandbox: the configured
program runs with the invoking user's filesystem and network authority. Use
only a trusted adapter or add a separate host sandbox.

## Run the lifecycle

```bash
# 1. Find recurring hindsight evidence. This performs no model call.
cairn skill harvest --project . --json
cairn skill show --kind candidate --id CANDIDATE_ID

# 2. Approve the exact evidence that may cross the adapter boundary.
cairn skill review --candidate CANDIDATE_ID --approve --json

# 3. Generate a bounded proposal. The live target remains unchanged.
cairn skill propose --candidate CANDIDATE_ID \
  --target .claude/skills/generated-client-review/SKILL.md \
  --adapter ./private/proposal-adapter.json --edit-budget 4 --json

# 4. Measure baseline versus candidate in fresh isolated worktrees.
export CAIRN_EVAL=1
cairn skill evaluate --proposal PROPOSAL_ID \
  --exploration-task-set eval/skill-exploration.json \
  --confirmation-task-set eval/skill-confirmation.json \
  --adapter eval/harness-adapter.json \
  --repetitions 2 --minimum-improvement 1 --yes --json

# 5. Inspect artifacts and apply only the exact eligible proposal.
cairn skill show --kind proposal --id PROPOSAL_ID
cairn skill show --kind evaluation --id EVALUATION_ID
cairn skill apply --proposal PROPOSAL_ID --evaluation EVALUATION_ID \
  --confirm FULL_PROPOSAL_DIGEST --json

# 6. Revert if later evidence warrants it.
cairn skill rollback --application APPLICATION_ID --confirm --json
```

`propose --json` includes `proposal_digest`, which is the value required by
`apply --confirm`. `list` shows every artifact class; use `--kind candidate`,
`proposal`, `evaluation`, or `application` to narrow it.

## Evaluation semantics

Each task runs twice in each arm. The baseline arm overlays the exact unchanged
target content; the treatment arm overlays the exact candidate content. Every
observation must complete, return the expected capability digest, and receive a
known result from the independent verifier. A task with any candidate-only pass
counts once as improved; a task with any baseline-only pass counts once as
regressed and rejects the candidate.

Exploration must have no unknown pairs, no regression, and at least
`--minimum-improvement` improvements. Otherwise evaluation stops without
opening the confirmation set. Confirmation must independently satisfy the same
gate. This is deliberately strict and suited to small, high-value task sets;
it is not a statistical proof that a skill is universally better.

## What this does not do

It does not scrape native harness transcripts, schedule periodic self-edits,
invent task sets, approve evidence, choose an inference provider, or publish a
changed skill. These remain explicit operator responsibilities. Start with a
small target and representative tasks; expand only when the stored evaluation
artifacts make the decision auditable.
