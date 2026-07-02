---
description: Compile one canonical source into a sparse, citation-heavy project wiki page, or re-sync an existing page to the current source with --refresh
argument-hint: "<source-path> [--refresh]"
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task
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

Scaffold templates live at `$HOME/.claude/templates/wiki-*.template` (installed by `scripts/sync-claude-assets.sh`).
</objective>

<context>
Arguments: $ARGUMENTS
</context>

<process>

## 0. Initialize repo context

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$ROOT" ]; then
  echo "Not inside a git repository. /wiki-ingest must run from a project repo."
  exit 1
fi
cd "$ROOT"
```

Parse `$ARGUMENTS`: require exactly one non-flag argument as `source_input`; reject empty input or multiple positional arguments with a clear error; capture an optional `--refresh` flag into `refresh_mode` (default false).

Capture: current UTC `timestamp`, `branch`, repo basename as `project_name`, `default_branch` (try `origin/HEAD`, then `origin/main`, `main`, `master`, then `HEAD`).

Resolve `source_input`: (1) if an existing absolute path, use as `source_abs`; (2) else if `$ROOT/$source_input` exists, use it; (3) else stop with a clear error.

Derive: `source_rel` (when inside the repo, else absolute), `source_slug` (lowercase kebab), `source_kind` (one of `repo_doc`, `repo_code`, `repo_config`, `external_doc`, `generated_or_binary`), `source_page_path = {ROOT}/.planning/wiki/sources/{source_slug}.md`.

```bash
mkdir -p .planning/wiki/sources .planning/wiki/topics .planning/wiki/entities .planning/wiki/queries .planning/wiki/REPORTS .planning/wiki/tmp
```

Scaffold when missing from `$HOME/.claude/templates/wiki-*.template`:
- `.planning/wiki/index.md` (project name filled in)
- `.planning/wiki/log.md`
- `.planning/wiki/POLICY.md` (project name + default branch filled in)

## 1. Gather canonical context

Read `AGENTS.md` (if present), `.planning/wiki/POLICY.md`, `.planning/wiki/index.md`, the target source directly, and nearby repo docs only when needed to disambiguate.

Truth rules: the target source is canonical for its own content; the wiki is derived and must not replace the source; for code, extract only stable interfaces/invariants/behaviors (no whole-file paraphrase); for generated/vendored/binary sources, write a minimal note pointing back to the canonical path.

## 2. Write or refresh the source summary

In `refresh_mode` (the `--refresh` flag was passed): the source page should already exist at `source_page_path`; if it does not, fall back to a normal ingest and note this in the log. Pass `refresh_mode: true` in the assignment so the ingester re-reads the canonical source, updates only the stable facts that changed, preserves the existing page structure and unchanged facts, bumps `Last reviewed`, re-evaluates the `Contradictions And Freshness Notes` section, and logs the action as `wiki-refresh`. Refresh is the primary maintenance loop: run it whenever the MR/PR, code, or doc behind a page changes.

Default path (no `--refresh`): spawn the `wiki-ingester` subagent via the Task tool with `subagent_type: "wiki-ingester"` and prompt:

```text
<wiki_assignment>
project_root: {ROOT}
source_abs: {source_abs}
source_rel: {source_rel}
source_kind: {source_kind}
source_page_path: {ROOT}/.planning/wiki/sources/{source_slug}.md
index_path: {ROOT}/.planning/wiki/index.md
log_path: {ROOT}/.planning/wiki/log.md
policy_path: {ROOT}/.planning/wiki/POLICY.md
timestamp: {timestamp}
branch: {branch}
project_name: {project_name}
refresh_mode: {refresh_mode}
</wiki_assignment>
```

If Task/subagent execution is unavailable, run the ingester role inline and still write the source page and update index/log.

## 3. Conservative topic and entity maintenance

After the source page exists, create/update a topic page under `.planning/wiki/topics/` only if the source adds a durable concept appearing across multiple sources or repeated queries; create/update an entity page under `.planning/wiki/entities/` only if it identifies a stable interface, component, owner, or bounded concept that improves cross-linking. Every new topic/entity page must stay shorter than its combined raw sources, include `Last reviewed`, include canonical references, and call out contradictions or freshness uncertainty. Do not create a page for every file or hide uncertainty behind definitive language.

## 4. Update index and log

Ensure the source page is linked once in the `Sources` section of `.planning/wiki/index.md` (update only inside `<!-- wiki:sources:start -->`/`<!-- wiki:sources:end -->` when present, replacing `- None yet.` for the first real entry). Link any created topic/entity page once in the correct section. Append one entry to `.planning/wiki/log.md` (timestamp, action — `wiki-ingest` or `wiki-refresh` in refresh mode — source path, pages touched, conservative-mode/refresh-delta note), inside `<!-- wiki:entries:start -->`/`<!-- wiki:entries:end -->` when present.

## 5. Report results

Display the source page path, any topic/entity pages updated, and a short note that raw sources remain canonical.

</process>

<success_criteria>
- [ ] Repo root resolved and wiki scaffold created if missing
- [ ] Canonical source resolved from the input path
- [ ] One source summary page written or refreshed under `.planning/wiki/sources/`
- [ ] Index updated and log appended
- [ ] No fake duplicate code-manual page created for a raw code file
</success_criteria>
