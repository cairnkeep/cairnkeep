# Audit actual memory use

`cairn eval protocol` observes structured calls in an existing normalized
trajectory. It checks project-scoped retrieval ordering, interpretable search
results, and direct memory mutation attempts without asserted capture consent.
It does not run an agent, execute recorded commands, contact services, write
memory or alter trajectories. It is disabled unless `CAIRN_EVAL=1`.

## Safe offline controls

From a source checkout after building the server:

```sh
CAIRN_EVAL=1 bin/cairn eval protocol \
  --trajectory examples/eval/protocol-project-search.json --json
CAIRN_EVAL=1 bin/cairn eval protocol \
  --trajectory examples/eval/protocol-narration.json --json
```

The positive control passes; the narrated pseudo-call fails. These are
synthetic parser controls, not live model performance evidence. An empty search
is a successful retrieval observation: a memory hit is not mandatory. Never
repeat or widen searches merely to manufacture a hit.

## Inspect your own evidence

Only Claude Code, OpenCode, and Pi **normalized Cairnkeep trajectories** are
supported, not native transcripts or Codex sessions. Capture remains separately
opt-in; this audit does not enable it. In the project where a session was
captured, export one closed, task-aligned session privately:

```sh
umask 077
cairn trajectory show SESSION_ID --json > trajectory.json
CAIRN_EVAL=1 cairn eval protocol --trajectory trajectory.json --json
```

The export can contain private prompts, paths and outputs despite capture
redaction. Keep it local; do not commit or upload it. The audit emits fixed
codes, counts, harness identity and SHA-256 digests—not the input path, session
ID, prompts, arguments, outputs or memory keys. Input must be a UTF-8 regular
file, at most 16 MiB and 50,000 events. Symlinks (including parent paths) and
files changing during inspection are rejected. Use a canonical physical path
if your filesystem path uses aliases.

## Read the checks separately

- `evidence_complete`: ordered calls with results, without omitted unknown
  records, truncation or incomplete calls. Duplicate IDs, out-of-order sequences
  and orphan results are invalid input, not successful evidence.
- `memory_first`: the first recorded tool invocation is a project-scoped
  `memory_search`. Task boundaries are not inferred. Trivial tasks need not
  follow this protocol; tool availability is also not inferred. Apply this
  check only to nontrivial tasks where direct retrieval was available, not
  indiscriminately to every session or legitimate unavailable-tool fallback.
- `retrieval_result`: a project search has a correlated, non-error,
  interpretable semantic or substring result. Narration never counts. Failed
  or missing results are inconclusive, not model-quality failures.
- `direct_write_boundary`: direct `memory_*` mutation attempts are classified
  from the MCP annotation catalog. Denied attempts still count. Opaque tools,
  including shell commands, make indirect effects unverifiable.

If the user or an applicable reviewed workflow explicitly authorized capture,
add `--capture-authorized`. This is an **operator assertion**, not authenticated
consent and never permission to write. The asserted policy and its digest are
included in the report. Do not add the flag merely to turn a failure green.

Exit codes: `0` all checks pass, `1` an observed violation, `2` invalid/unsafe
input or command, `3` inconclusive without an observed violation. The disabled
path returns its existing disabled envelope with exit `0` before reading any
input; that is not a passing audit. Inspect `enabled` and `status`, not just
the process exit code.

## What this cannot prove

A local trajectory is editable. Digests identify bytes and asserted policy;
they do not authenticate a harness, server, publisher, user or tool result.
Known direct tool names are recognized exactly, not by a permissive suffix.
CLI-mediated retrieval/mutations, generic MCP dispatchers, opaque tools and
full playbook start/finish enforcement are not certified here.

Protocol compliance does not establish relevance, source verification,
correctness, productivity or baseline improvement. Use the independent task
verifier in the [evaluation harness](operating.md#evaluation-harness-opt-in)
and the maintained [agent contract](agents.md). A realistic coding session may
show successful retrieval while its overall audit remains inconclusive because
shell effects cannot be certified. Do not convert this into a quality score or
advertise a perfect agent benchmark.
