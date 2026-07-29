# L13 - Session evidence and hindsight

**Status:** Brief
**Track:** Practitioner; Evidence and Evaluation
**Planned time:** 45 minutes

## Outcome

Enable one optional capture path in a disposable project, inspect what was
retained, distil a local hindsight note, and remove the course evidence without
confusing it with reviewed durable memory.

## Planned lesson

- The lifecycle: transient harness context, redacted trajectory, deterministic
  hindsight note, explicit shared promotion, and reviewed memory.
- Independent consent flags for trajectory capture, note distillation, note
  enrichment, compaction capture, artifact tools, and artifact HTTP access.
- Claude Code and OpenCode hooks versus Pi's native `session_shutdown` adapter.
- Pre-write redaction, reasoning omission, size limits, 30-day defaults, and
  fail-open capture behavior.
- Compaction summaries as harness-produced continuity evidence, never trusted
  instructions and never automatic fresh-session context.
- `cairn trajectory`, `cairn notes`, `cairn artifact`, and `cairn doctor
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
- [Storage and deployment](../../storage.md)
