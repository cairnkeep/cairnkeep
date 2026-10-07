# Audit actual memory use

**Availability:** Unreleased source feature; not included in published v2.21.1.

`cairn eval protocol` observes structured calls in an existing normalized
trajectory or an explicitly supplied Codex exec JSONL export. It checks project-scoped retrieval ordering, interpretable search
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

Claude Code, OpenCode, and Pi use **normalized Cairnkeep trajectories**.
Codex uses the separate explicit export below, not its internal session files.
Capture remains separately
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

## Native Codex exec exports

[Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
documents `codex exec --json` as a structured JSONL event stream. Export a
single task-aligned turn to a private file, then audit it explicitly:

```sh
umask 077
# This command runs a live agent; review permissions and the task first.
codex exec --json --ephemeral --sandbox workspace-write "YOUR TASK" > native.jsonl
# This separate command only reads the file offline.
CAIRN_EVAL=1 cairn eval protocol --codex-jsonl native.jsonl --json
```

Use exactly one of `--trajectory` or `--codex-jsonl`. The adapter is tested
against the CLI/TypeScript SDK 0.160.1 exec event contract; it does not claim
compatibility with arbitrary future streams, app-server events or internal
rollout files. Persisted trajectory schemas and capture hooks are unchanged.
The audit adds no SDK dependency and does not launch Codex.

MCP items must identify the `cairn-memory` (or `cairn_memory`) server and the
exact memory tool. Dispatch order comes from `item.started`; completions and
updates must retain the same ID, server, tool and arguments. Parallel calls
are correlated independently. A terminal-only MCP item cannot prove dispatch
order. Native `structured_content` results or textual MCP content are accepted.

Unknown records/fields, missing lifecycle events, failed turns and incomplete
items make evidence inconclusive. Duplicate/mismatched IDs, malformed JSONL,
multiple turns or events following a terminal turn are invalid input. Split
multi-turn work into separately captured task-aligned turns; do not remove
tool events to manufacture a passing audit. One terminal newline is allowed;
blank records are rejected. The same 16 MiB byte limit applies, with at most
50,000 source records and 50,000 normalized events.

Reasoning and narrated messages are not tool evidence; their text is not
retained by the adapter. File changes, commands and web searches are opaque
effects, not proof of approved indirect writes. Native exports contain no
authenticated project identity, timestamps or consent. Never publish private
exports; the report keeps the same payload-free observation boundary.

The packaged `examples/eval/protocol-codex.jsonl` is a synthetic positive
control, not a recorded model run. Rehearse without launching Codex:

```sh
CAIRN_EVAL=1 bin/cairn eval protocol \
  --codex-jsonl examples/eval/protocol-codex.jsonl --json
```

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

The [bounded release-ledger lab](research/release-ledger-task.md) provides a
concrete task and a separate 15-check artifact grader. Offline controls cross
all four combinations of passing/failing protocol and correct/incorrect code.
A live lab uses the actual managed `AGENTS.md`, isolated read-only memory MCP
tools and a closed single-turn export. Retain its raw evidence privately;
do not substitute the synthetic positive fixture for a live trace.
