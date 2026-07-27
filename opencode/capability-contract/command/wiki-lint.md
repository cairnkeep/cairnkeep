---
description: Audit the project wiki for citation gaps, orphan pages, stale claims, contradictions, and broken cross-references; mirror contradictions into the persistent register
argument-hint: "[--focus <path>]"
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
Run an advisory lint pass over `.planning/wiki/`.

Output artifacts:
- `.planning/wiki/REPORTS/<timestamp>-lint.md` (advisory snapshot)
- `.planning/wiki/CONTRADICTIONS.md` (persistent register, updated in place)
- updated `.planning/wiki/log.md`

Flag handling:
- `--focus <path>` — restrict advisory checks to one wiki page or subdirectory under `.planning/wiki/`

This is an advisory governance command. Raw repository docs, ADRs, tests, interfaces, and code remain canonical even when the wiki disagrees or is stale.

Contradictions are classified by severity (`soft` / `scope-mismatch` / `hard`) and written to the persistent `CONTRADICTIONS.md` register. Unlike the per-run REPORTS snapshot, the register is durable: lint opens, updates, and resolves entries in place so contradictions do not leak (get reported and forgotten). An entry is `resolved` only after the conflicting wiki page has actually been reconciled to the canonical source.
</objective>

<execution_context>
@$HOME/.config/opencode/workflows/wiki-lint-workflow.md
</execution_context>

<context>
Arguments: $ARGUMENTS

Default behavior:
- ensure `.planning/wiki/` scaffold exists
- inspect the wiki index, policy, log, and relevant derived pages
- check for missing citations, orphan pages, stale claims, contradicted claims, missing obvious pages, and broken cross-references
- write a durable lint report and append a log entry

Important rules:
- lint findings are advisory and must not outrank canonical raw sources
- prefer conservative findings over speculative cleanup demands
- call out contradictions and freshness uncertainty explicitly instead of rewriting them away
</context>

<process>
Execute the wiki-lint workflow from @$HOME/.config/opencode/workflows/wiki-lint-workflow.md end-to-end.
</process>
