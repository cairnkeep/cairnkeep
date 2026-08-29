# Git-linked work evidence

Cairnkeep can record a bounded, local account of the Git state surrounding a
harness session. The feature is off by default. Enable it in the project's
`.ai/.env`:

```sh
CAIRN_WORK_EVIDENCE=1
```

Generated Claude Code, OpenCode, Pi, Kimi, Qwen and Codex launchers then start
an evidence record before the harness and settle it after the harness exits.
The harness still launches when Git is unavailable, the directory is not a Git
worktree, or evidence capture fails; Cairnkeep prints a warning instead of
turning optional evidence into an availability dependency.

## Recorded metadata

Each completed record contains the harness, start/end timestamps, exit status,
repository-relative identity, and the start/end commit, branch, detached or
unborn state, dirty state, status digest and workspace digest. It also contains
a bounded list of paths whose observed state changed during the session and an
overall evidence digest.

Workspace digests are content-derived, including for observed untracked files.
They do not retain file bodies, but low-entropy candidate content can sometimes
be tested against a known digest; do not treat hashing as redaction.

Records may link to exact trajectories, artifacts and reviewed-memory writes
created while that launcher-owned session is active. Links are append-only and
carry identifiers, not copied content. Cairnkeep does not capture keystrokes,
prompts, shell history or model reasoning.

The record describes a time interval, not authorship. Concurrent processes can
change the same worktree, and a file changed and restored to its starting state
will not appear as touched. Treat the evidence as integrity-linked operational
context, not proof that a particular person or model made a change.

## Optional patch artifact

Patch capture requires two independent feature flags:

```sh
CAIRN_WORK_EVIDENCE_PATCH=1
CAIRN_ARTIFACT_STORE=1
```

The patch is produced at session end from the starting commit to the ending
worktree. It can therefore include tracked changes that already existed when
the session started. Untracked file names can appear in metadata, but their
bodies are not included. The patch is redacted, bounded by the lower of the
work-evidence and artifact limits, and stored in the existing artifact store.
Cairnkeep provides no patch apply, restore or replay command.

## Context-usage receipts

With context packs enabled, `context_pack_search` can return stable references
when called with `include_refs: true`. With `CAIRN_WORK_EVIDENCE=1` active, set
`CAIRN_CONTEXT_USAGE=1` as the second gate to expose the
local-only `context_usage_record` mutation. It links `task_digest`,
`result_digest`, and an outcome (`used`, `unused`, or `unknown`) to the active
work-evidence record, or to an explicit `evidence_id`.

Receipts intentionally exclude the query, prompt, retrieved text, and model
response. Their ID is deterministic, repeat recording is idempotent, conflicting
outcomes fail, and the normal work-evidence doctor and retention rules apply.
Because recording changes evidence, the read-only MCP profile excludes the tool.

## Inspect and maintain

```sh
cairn evidence list [--status pending|complete] [--json]
cairn evidence show <evidence-id-or-prefix> [--json]
cairn evidence delete <evidence-id-or-prefix> [--dry-run] [--json]
cairn evidence prune [--dry-run] [--json]
cairn evidence doctor [--repair] [--json]
```

Metadata and links live below
`<repository>/.agentfs/work-evidence/v1/`. Records default to 30-day retention,
1 MiB per optional patch, 4,096 touched paths and a 64 MiB metadata budget.
Interrupted sessions remain visibly pending rather than being fabricated as
complete. `doctor` reports malformed records, broken links, permission drift,
temporary remnants and stale pending sessions. `--repair` can remove temporary
remnants, but it does not change records or invent an ending Git state.

With the feature enabled, local stdio MCP registers `work_evidence_list` and
`work_evidence_read`. Both are read-only, non-destructive, idempotent and
closed-world. They are never exposed by the HTTP transport. MCP profiles can
further restrict them, but cannot enable the feature.

Ordinary uninstall retains the project `.agentfs` boundary. As with other
project evidence stores, `cairn uninstall --purge-memory` backs up and removes
it only after explicit confirmation.
