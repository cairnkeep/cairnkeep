# L13 - Session evidence and hindsight

**Status:** Brief
**Track:** Practitioner; Evidence and Evaluation
**Planned time:** 60 minutes

## Outcome

Enable one optional capture path in a disposable project, inspect what was
retained, distil a local hindsight note, and remove the course evidence without
confusing it with reviewed durable memory.

## Planned lesson

- The lifecycle: transient harness context, redacted trajectory, deterministic
  hindsight note, explicit shared promotion, and reviewed memory.
- Independent consent flags for trajectory capture, note distillation, note
  enrichment, compaction capture, artifact tools, and artifact HTTP access.
- Launcher-owned Git work evidence, its local-only read surface, its separate
  patch consent boundary, and why interval evidence is not authorship proof.
- Claude Code and OpenCode hooks versus Pi's native `session_shutdown` adapter.
- Pre-write redaction, reasoning omission, size limits, 30-day defaults, and
  fail-open capture behavior.
- Compaction summaries as harness-produced continuity evidence, never trusted
  instructions and never automatic fresh-session context.
- `cairn trajectory`, `cairn notes`, `cairn artifact`, `cairn evidence`, and `cairn doctor
  --repair` inspection and recovery paths.

## Hands-on lab

Use a disposable repository and synthetic error. Enable only trajectory capture
and note distillation in its `.ai/.env`; point `CAIRN_AGENTFS_BASE_DIR` at a
course-only directory inside that disposable root. Start a supported harness
through the project launcher, reproduce and resolve the error, then close the
session.
Inspect the trajectory, distil the exact session, search its failure signature,
and preview pruning before removing the disposable project and isolated course
note root.

Core inspection commands:

```bash
cairn trajectory list --json
cairn trajectory show SESSION-ID --json
cairn notes distill --session SESSION-ID --json
printf '%s\n' 'TypeError: course fixture' \
  | cairn notes search-error --project "$PWD" --json
cairn notes doctor --json
cairn trajectory prune --dry-run --json
cairn artifact list --json
```

## Acceptance criteria

- Nothing is captured before explicit opt-in.
- The retained trajectory contains no reasoning field or planted secret.
- Distillation is local and deterministic when enrichment remains disabled.
- The learner can distinguish a trajectory, note, artifact, and reviewed
  memory by purpose, store, lifecycle, and trust level.
- Cleanup targets only the disposable course evidence.

## Source material

- [Operating guide: structured trajectories](../../operating.md#structured-session-trajectories-opt-in)
- [Operating guide: hindsight notes](../../operating.md#hindsight-notes-opt-in)
- [Privacy and data flow](../../privacy-and-data-flow.md#structured-trajectory-capture)
- [Git-linked work evidence](../../work-evidence.md)
- [Storage and deployment](../../storage.md)

## Git-linked work evidence lab

Use a disposable Git repository and a generated launcher. Add this to
`.ai/.env` without enabling patch capture:

```sh
CAIRN_WORK_EVIDENCE=1
```

Launch the selected harness, edit one tracked file and create one untracked
file, then exit normally. Inspect the result:

```sh
cairn evidence list --json
cairn evidence show EVIDENCE-ID --json
cairn evidence doctor --json
cairn evidence prune --dry-run --json
```

The learner should be able to identify the start/end Git state, touched path
labels, exit status and overall digest; explain why the record does not prove
authorship; and confirm that no prompt, keystroke, command history or reasoning
was retained. Repeat with the feature unset and verify that no work-evidence
directory is created.

For the optional patch exercise, use only synthetic content and set both
`CAIRN_WORK_EVIDENCE_PATCH=1` and `CAIRN_ARTIFACT_STORE=1`. Begin with an
already-dirty tracked file, make another edit, then verify that the artifact can
include both because its scope is the start commit to the end worktree. Confirm
that an untracked file body is absent and that Cairnkeep exposes no apply or
restore command.

## Recording outline

1. Show the default-off launcher and empty evidence list.
2. Enable metadata-only capture, run a short session and inspect its digests.
3. Follow one exact trajectory or artifact link without copying its body.
4. Demonstrate missing-Git fail-open behavior and the preserved harness exit.
5. Enable the two patch prerequisites with synthetic data and explain the
   pre-existing-dirty and untracked-body boundaries.
6. Finish with dry-run deletion/pruning, local-only MCP exposure and uninstall
   retention.
