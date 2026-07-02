---
description: Compile one canonical source into a sparse, citation-heavy project wiki page, or re-sync an existing page to the current source with --refresh
argument-hint: "<source-path> [--refresh]"
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
Compile one canonical source into the repo-local project wiki under `.planning/wiki/`, or re-sync an existing summary to the current canonical source.

Output artifacts:
- `.planning/wiki/sources/<slug>.md`
- updated `.planning/wiki/index.md`
- updated `.planning/wiki/log.md`
- optional conservative updates under `.planning/wiki/topics/` or `.planning/wiki/entities/`

This is a derived-knowledge command. Raw repository docs, ADRs, tests, interfaces, and code remain canonical. The wiki must stay sparse, citation-heavy, and conservative.

Argument handling:
- accepts exactly one non-flag argument: an absolute source path or a repo-relative path inside the current repository
- optional `--refresh` flag: re-sync an existing source summary to the current canonical source instead of writing it from scratch. In refresh mode: re-read the canonical source, update only the stable facts that changed, bump `Last reviewed`, keep the page's existing structure, and append a `wiki-refresh` log entry. Use this whenever the MR/PR, code, or doc behind a page has changed.
- the source may be a repo doc, ADR, runbook, config surface, or a code file that defines a stable interface or behavior
- do not restate an entire code file into a fake duplicate wiki page; summarize only stable, reusable facts with citations
</objective>

<execution_context>
@$HOME/.config/opencode/workflows/wiki-ingest-workflow.md
</execution_context>

<context>
Arguments: $ARGUMENTS

Default behavior:
- resolve the repo root and the requested source path
- ensure `.planning/wiki/` scaffold exists
- treat the source as immutable and canonical
- write or refresh one source summary page under `.planning/wiki/sources/`
- refresh the wiki index and append a log entry
- update topic or entity pages only when the source clearly adds reusable, cross-source knowledge

Important rules:
- the wiki complements repo docs, AgentFS memory, and AnythingLLM; it does not replace them
- source summaries must preserve provenance, freshness, and contradiction notes
- when the source is code, prefer narrow interface or invariant summaries over file paraphrase
</context>

<process>
Execute the wiki-ingest workflow from @$HOME/.config/opencode/workflows/wiki-ingest-workflow.md end-to-end.
</process>
