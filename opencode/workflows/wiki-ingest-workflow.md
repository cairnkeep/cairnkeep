<purpose>
Compile one canonical source into the repo-local project wiki while keeping raw sources authoritative. Produce or refresh a source summary under `.planning/wiki/sources/`, update `.planning/wiki/index.md`, and append `.planning/wiki/log.md`.
</purpose>

<required_reading>
@$HOME/.config/opencode/templates/wiki-policy.md.template
@$HOME/.config/opencode/templates/wiki-index.md.template
@$HOME/.config/opencode/templates/wiki-log.md.template
@$HOME/.config/opencode/templates/wiki-source-summary.md.template
</required_reading>

<available_agent_types>
Valid GSD subagent types (use exact names — do not fall back to 'general-purpose'):
- wiki-ingester
</available_agent_types>

<process>

## 0. Initialize Repo Context

Resolve the repo root:

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$ROOT" ]; then
  echo "Not inside a git repository. /wiki-ingest must run from a project repo."
  exit 1
fi
cd "$ROOT"
```

Parse arguments from `$ARGUMENTS`:
- require exactly one non-flag argument as `source_input`
- reject empty input or multiple positional arguments with a clear error
- capture an optional `--refresh` flag into `refresh_mode` (default false)

Capture:
- current UTC `timestamp`
- `branch`
- repo basename as `project_name`
- `default_branch` using `origin/HEAD`, then `origin/main`, `main`, `master`, then `HEAD`

Resolve `source_input`:
1. if it is an existing absolute path, use it as `source_abs`
2. else if `$ROOT/$source_input` exists, use that path
3. else stop with a clear error

Derive:
- `source_rel` when the file is inside the repo, otherwise use the absolute path
- `source_slug` from the relative path or basename, normalized to lowercase kebab case
- `source_kind` as one of `repo_doc`, `repo_code`, `repo_config`, `external_doc`, or `generated_or_binary`
- `source_page_path = {ROOT}/.planning/wiki/sources/{source_slug}.md`

Create directories:

```bash
mkdir -p .planning/wiki/sources .planning/wiki/topics .planning/wiki/entities .planning/wiki/queries .planning/wiki/REPORTS .planning/wiki/tmp
```

Scaffold files when missing:
- `.planning/wiki/index.md` from `wiki-index.md.template` with project name filled in
- `.planning/wiki/log.md` from `wiki-log.md.template`
- `.planning/wiki/POLICY.md` from `wiki-policy.md.template` with project name and default branch filled in

## 1. Gather Canonical Context

Before any synthesis:
- read `AGENTS.md` if present
- read `.planning/wiki/POLICY.md`
- read `.planning/wiki/index.md`
- read the target source directly
- read nearby repo docs only when needed to disambiguate the source

Truth rules:
- the target source is canonical for its own content
- the wiki is derived and may summarize or cross-link, but must not replace the source
- when the source is code, do not paraphrase the whole file or create a fake per-file manual; extract only stable interfaces, invariants, behaviors, or references worth reusing
- if the source is generated, vendored, or mostly binary, write a minimal source note that points back to the canonical path and explains why no richer summary was created

## 2. Write Or Refresh The Source Summary

In `refresh_mode` (the `--refresh` flag was passed):
- the source page must already exist at `source_page_path`; if it does not, fall back to a normal ingest and note this in the log
- pass `refresh_mode: true` to the `wiki-ingester` assignment so it re-reads the canonical source, updates only the stable facts that changed, preserves the existing page structure and unchanged facts, bumps `Last reviewed` to the current timestamp, re-evaluates the `Contradictions And Freshness Notes` section, and logs the action as `wiki-refresh`
- refresh is the primary maintenance loop: run it whenever the MR/PR, code, or doc behind a page changes, so the derived wiki tracks state instead of going stale

Default path (no `--refresh`): spawn `wiki-ingester`.

```text
◆ Compiling wiki source summary...
```

Spawn with:

```text
Task(
  prompt="Read $HOME/.config/opencode/agents/wiki-ingester.md for instructions. FIRST ACTION: change into {ROOT}.\n\n<wiki_assignment>\nproject_root: {ROOT}\nsource_abs: {source_abs}\nsource_rel: {source_rel}\nsource_kind: {source_kind}\nsource_page_path: {ROOT}/.planning/wiki/sources/{source_slug}.md\nindex_path: {ROOT}/.planning/wiki/index.md\nlog_path: {ROOT}/.planning/wiki/log.md\npolicy_path: {ROOT}/.planning/wiki/POLICY.md\ntimestamp: {timestamp}\nbranch: {branch}\nproject_name: {project_name}\nrefresh_mode: {refresh_mode}\n</wiki_assignment>",
  subagent_type="wiki-ingester",
  description="Wiki: source ingester"
)
```

If Task/subagent execution is unavailable:
- run the ingester role inline
- still write the source page and update index/log

## 3. Conservative Topic And Entity Maintenance

After the source page exists:
- create or update a topic page under `.planning/wiki/topics/` only if the source adds a durable concept that already appears across multiple sources or repeated queries
- create or update an entity page under `.planning/wiki/entities/` only if the source identifies a stable interface, component, owner, or bounded concept that improves cross-linking
- every new topic or entity page must:
  - stay shorter than the combined raw sources it points to
  - include `Last reviewed`
  - include canonical source references
  - call out contradictions or freshness uncertainty explicitly

Do not:
- create topic or entity pages for every file
- mirror whole code modules into wiki pages
- hide uncertainty behind definitive language

## 4. Update Index And Log

Ensure:
- the source page is linked once in the `Sources` section of `.planning/wiki/index.md`
- if `<!-- wiki:sources:start -->` and `<!-- wiki:sources:end -->` exist, update only inside that block and replace `- None yet.` when adding the first real entry
- any created topic or entity page is linked once in the correct section, using the matching marker blocks when present
- `.planning/wiki/log.md` gets one new append-only entry with timestamp, command, source path, pages touched, and whether the run stayed in conservative code-summary mode
- in `refresh_mode`, log the action as `wiki-refresh` (not `wiki-ingest`) so the maintenance loop is distinguishable from first-time ingests
- if `<!-- wiki:entries:start -->` and `<!-- wiki:entries:end -->` exist, append inside that block

## 5. Report Results

Display:
- source page path
- any topic or entity pages updated
- a short note that raw sources remain canonical

</process>

<success_criteria>
- [ ] Repo root resolved and wiki scaffold created if missing
- [ ] Canonical source resolved from the input path
- [ ] One source summary page written or refreshed under `.planning/wiki/sources/`
- [ ] Index updated
- [ ] Log appended
- [ ] No fake duplicate code-manual page created for a raw code file
</success_criteria>
