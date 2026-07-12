---
description: Review staged memory candidates extracted from prior sessions and accept (write to AgentFS) or discard them
argument-hint: "[--all]"
tools:
  read: true
  write: true
  edit: true
  bash: true
  grep: true
  glob: true
  agent: true
  question: true
---
<objective>
Review memory candidates that the SessionEnd hook (memory-capture.sh) extracted
automatically from prior sessions and staged under `.planning/memory-staging/`.
This is the accept gate between autonomous extraction and durable AgentFS writes:
no candidate becomes a memory fact until you accept it here.

Accepted candidates are written via the cairn-memory MCP (`memory_write`).
Discarded ones are deleted from staging. This keeps writes agent-gated (no
premature or auto writes) while making extraction fully automatic.

Argument handling:
- no args: review candidates from the most recent staged session
- `--all`: review candidates across all staged sessions
</objective>

<execution_context>
@$HOME/.config/opencode/workflows/memory-review-workflow.md
</execution_context>

<context>
Arguments: $ARGUMENTS
</context>

<process>
Execute the memory-review workflow end-to-end. In summary: load staged JSON
candidates from `.planning/memory-staging/`, judge each against the acceptance
rules (durable, branch-safe, non-duplicate — check existing memory with
`memory_search`), write accepted ones via `memory_write`/`memory_supersede`,
clear reviewed staging files, and report counts. No speculative, branch-local,
or trivial claims should be written to AgentFS.
</process>
