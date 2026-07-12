<purpose>
Answer repository questions by consulting the compiled wiki first and canonical raw sources second. Optionally store a reusable derived answer under `.planning/wiki/queries/`.
</purpose>

<required_reading>
@$HOME/.config/opencode/templates/wiki-policy.md.template
@$HOME/.config/opencode/templates/wiki-index.md.template
@$HOME/.config/opencode/templates/wiki-log.md.template
@$HOME/.config/opencode/templates/wiki-query-answer.md.template
</required_reading>

<available_agent_types>
Valid GSD subagent types (use exact names — do not fall back to 'general-purpose'):
- wiki-query-analyst
</available_agent_types>

<process>

## 0. Initialize Repo Context

Resolve the repo root:

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$ROOT" ]; then
  echo "Not inside a git repository. /wiki-query must run from a project repo."
  exit 1
fi
cd "$ROOT"
```

Parse flags from `$ARGUMENTS`:
- `--writeback`
- the remaining text is the required `question`

If `question` is empty after flag parsing:
- stop with a clear error explaining that the command needs a question

Capture:
- current UTC `timestamp`
- `branch`
- repo basename as `project_name`
- `default_branch` using `origin/HEAD`, then `origin/main`, `main`, `master`, then `HEAD`
- `query_slug` from the question, normalized to lowercase kebab case

Create directories:

```bash
mkdir -p .planning/wiki/sources .planning/wiki/topics .planning/wiki/entities .planning/wiki/queries .planning/wiki/REPORTS .planning/wiki/tmp
```

Scaffold files when missing:
- `.planning/wiki/index.md` from `wiki-index.md.template` with project name filled in
- `.planning/wiki/log.md` from `wiki-log.md.template`
- `.planning/wiki/POLICY.md` from `wiki-policy.md.template` with project name and default branch filled in

Paths:
- `index_path = {ROOT}/.planning/wiki/index.md`
- `log_path = {ROOT}/.planning/wiki/log.md`
- `policy_path = {ROOT}/.planning/wiki/POLICY.md`
- `query_output_path = {ROOT}/.planning/wiki/queries/{timestamp}-{query_slug}.md` when `writeback` is true

## 1. Build The Retrieval Scope

Before answering:
- read `AGENTS.md` if present
- read `.planning/wiki/POLICY.md`
- read `.planning/wiki/index.md` first
- use the index to shortlist relevant pages under `sources/`, `topics/`, `entities/`, `queries/`, and recent `REPORTS/` when needed
- read only the relevant wiki pages next
- if the wiki is missing, stale, contradictory, or insufficient, read the canonical repo docs, tests, interfaces, config, or code directly

Truth rules:
- canonical raw repo sources outrank derived wiki pages
- reusable prior query pages are helpful context, not proof by themselves
- when the wiki conflicts with raw sources, preserve the contradiction and trust the raw sources

## 2. Answer The Question

Preferred path: spawn `wiki-query-analyst`.

```text
◆ Building wiki-grounded answer...
```

Spawn with:

```text
Task(
  prompt="Read $HOME/.config/opencode/agents/wiki-query-analyst.md for instructions. FIRST ACTION: change into {ROOT}.\n\n<wiki_assignment>\nproject_root: {ROOT}\nquestion: {question}\nwriteback: {writeback}\nindex_path: {ROOT}/.planning/wiki/index.md\nlog_path: {ROOT}/.planning/wiki/log.md\npolicy_path: {ROOT}/.planning/wiki/POLICY.md\noutput_path: {query_output_path or \"null\"}\ntimestamp: {timestamp}\nbranch: {branch}\nproject_name: {project_name}\n</wiki_assignment>",
  subagent_type="wiki-query-analyst",
  description="Wiki: query analyst"
)
```

If Task/subagent execution is unavailable:
- run the query-analyst role inline
- still answer in chat
- still write the reusable query page and update index/log when `writeback` is true

## 3. Report Results

Always:
- answer in chat with preserved source references and caveats
- call out any contradictions or freshness uncertainty explicitly

If `writeback` is true:
- mention the saved query page path
- confirm that the query artifact is derived, not canonical
- update the `Queries` section of `.planning/wiki/index.md` inside `<!-- wiki:queries:start -->` and `<!-- wiki:queries:end -->` when those markers exist, replacing `- None yet.` when adding the first real entry
- append the log entry inside `<!-- wiki:entries:start -->` and `<!-- wiki:entries:end -->` when those markers exist

</process>

<success_criteria>
- [ ] Repo root resolved and wiki scaffold created if missing
- [ ] Index consulted before deeper reads
- [ ] Relevant wiki pages reviewed before canonical fallback
- [ ] Final chat answer preserved source references and caveats
- [ ] Reusable answer written under `.planning/wiki/queries/` when `--writeback` is used
- [ ] Index and log updated when `--writeback` is used
</success_criteria>
