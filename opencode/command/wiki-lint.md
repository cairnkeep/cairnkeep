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
