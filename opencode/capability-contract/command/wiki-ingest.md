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
