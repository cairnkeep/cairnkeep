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
