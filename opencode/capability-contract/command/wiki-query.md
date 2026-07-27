---
description: Answer from the project wiki first, then fall back to canonical repo sources, optionally writing back a reusable answer
argument-hint: "[--writeback] <question>"
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
<!-- cairn:capability-overlay:start -->
## Capability contract boundary

This contract-only block takes precedence over the legacy command below. Run it
before output, repository discovery, configuration reads, filesystem access,
tool calls, workflow loading, delegation, or any other owner work.

1. Use Bash to run exactly:

   ```bash
   capability_guard=$(cairn capabilities guard wiki --harness opencode --source operating-command --transport harness-command)
   ```

   Do not pass `$ARGUMENTS`, paths, queries, results, errors, or metadata.
2. Parse the strict JSON result. If `disabled` is `true`, present that exact JSON
   object as the sole stable disabled result and **STOP** without loading or
   entering the workflow.
3. Immediately before delegating to the unchanged workflow, use Bash to run:

   ```bash
   capability_start=$(cairn capabilities start wiki --harness opencode --source operating-command --transport harness-command)
   ```

   If `disabled` is `true`, present that exact object and **STOP**. If the result
   contains `invocation_id`, retain the entire strict JSON object unchanged as
   `capability_handle` in the workflow invocation context. Otherwise delegate
   without a handle. Never add arguments or owner data to the handle.
4. The delegated workflow is the sole completion owner. It invokes
   `cairn capabilities finish` exactly once for a valid inherited handle after
   terminal settlement and before presentation. This command must not invoke or
   retry finish, so command-to-workflow delegation cannot create two records.

Guard and state resolution stay outside measurement. The legacy command and
workflow below retain ownership of all behavior and presentation.
<!-- cairn:capability-overlay:end -->
<objective>
Answer a repository question using the compiled wiki as a first-pass map, without letting the wiki outrank raw sources.

Outputs:
- chat answer
- optional `.planning/wiki/queries/<timestamp>-<slug>.md`
- updated `.planning/wiki/index.md` and `.planning/wiki/log.md` when `--writeback` is used

Flag handling:
- `--writeback` — store a reusable answer artifact under `.planning/wiki/queries/` and refresh index/log

This is a retrieval-and-synthesis command. Raw repository docs, ADRs, tests, interfaces, and code remain canonical.
</objective>

<execution_context>
@$HOME/.config/opencode/workflows/wiki-query-workflow.md
</execution_context>

<context>
Arguments: $ARGUMENTS

Default behavior:
- read `.planning/wiki/index.md` first
- inspect only relevant wiki pages next
- if wiki pages are missing, stale, contradictory, or insufficient, read the canonical repo sources directly
- answer in chat with preserved source references
- if `--writeback` is present, write a reusable answer with citations and caveats

Important rules:
- treat `.planning/wiki/` as a derived layer, not a canonical one
- preserve contradiction and freshness notes instead of smoothing them over
- when raw sources disagree with the wiki, trust the raw sources and say so explicitly
</context>

<process>
Execute the wiki-query workflow from @$HOME/.config/opencode/workflows/wiki-query-workflow.md end-to-end.
</process>
