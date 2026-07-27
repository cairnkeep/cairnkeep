---
description: Answer from the project wiki first, then fall back to canonical repo sources, optionally writing back a reusable answer
argument-hint: "[--writeback] <question>"
allowed-tools: Read, Write, Edit, Bash, Grep, Glob, Task
---
<!-- cairn:capability-overlay:start -->
## Step -1 -- Capability contract boundary

This block is the contract-only overlay. It takes precedence over the legacy
command below and must run before any output, repository discovery, config read,
filesystem access, tool call, agent delegation, or other owner work.

1. Use Bash to run exactly:

   ```bash
   capability_guard=$(cairn capabilities guard wiki --harness claude-code --source operating-command --transport harness-command)
   ```

   Do not pass `$ARGUMENTS`, paths, queries, results, errors, or other metadata.
2. Parse the strict JSON result. If `disabled` is `true`, present that exact JSON
   object as the sole stable disabled result and **STOP**. Do not enter any part
   of the legacy command.
3. Immediately before entering the unchanged legacy owner body below, use Bash
   to run exactly:

   ```bash
   capability_start=$(cairn capabilities start wiki --harness claude-code --source operating-command --transport harness-command)
   ```

   If this second state check returns `disabled: true`, present that exact JSON
   object and **STOP**. If it contains `invocation_id`, retain the entire JSON
   object unchanged as `capability_handle`; otherwise the invocation is
   unmeasured and has no handle. Never add fields to the handle.
4. After the legacy owner settles, classify only its terminal outcome as
   `success`, `error`, or `timeout`. Before any final owner presentation, invoke
   `cairn capabilities finish --handle "$capability_handle" --outcome <outcome>`
   exactly once when a handle exists. Suppress and ignore finish failures so
   logging cannot change the owner's result. Never pass arguments, paths,
   queries, results, raw errors, or arbitrary metadata to finish. Every STOP,
   returned error, and timeout after start must follow this same final-only rule.

Guard resolution and overlay setup occur before measurement. The legacy owner
content, tools, agents, artifacts, and presentation remain owned by the command
below.
<!-- cairn:capability-overlay:end -->

<objective>
Answer a repository question using the compiled wiki as a first-pass map, without letting the wiki outrank raw sources.

Outputs:
- chat answer
- optional `.planning/wiki/queries/<timestamp>-<slug>.md`
- updated `.planning/wiki/index.md` and `.planning/wiki/log.md` when `--writeback` is used

Flag handling:
- `--writeback` — store a reusable answer artifact under `.planning/wiki/queries/` and refresh index/log

This is a retrieval-and-synthesis command. Raw repository docs, ADRs, tests, interfaces, and code remain canonical. Scaffold templates live at `$HOME/.claude/templates/wiki-*.template`.
</objective>

<context>
Arguments: $ARGUMENTS
</context>

<process>

## 0. Initialize repo context

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$ROOT" ]; then
  echo "Not inside a git repository. /wiki-query must run from a project repo."
  exit 1
fi
cd "$ROOT"
```

Parse flags from `$ARGUMENTS`: `--writeback`; the remaining text is the required `question`. If `question` is empty after flag parsing, stop with a clear error.

Capture: current UTC `timestamp`, `branch`, repo basename as `project_name`, `default_branch` (try `origin/HEAD`, then `origin/main`, `main`, `master`, then `HEAD`), `query_slug` (lowercase kebab from the question).

```bash
mkdir -p .planning/wiki/sources .planning/wiki/topics .planning/wiki/entities .planning/wiki/queries .planning/wiki/REPORTS .planning/wiki/tmp
```

Scaffold when missing from `$HOME/.claude/templates/wiki-*.template`: `.planning/wiki/index.md`, `.planning/wiki/log.md`, `.planning/wiki/POLICY.md`.

Paths: `index_path`, `log_path`, `policy_path`, `query_output_path = {ROOT}/.planning/wiki/queries/{timestamp}-{query_slug}.md` when `writeback` is true.

## 1. Build the retrieval scope

Read `AGENTS.md` (if present), `.planning/wiki/POLICY.md`, `.planning/wiki/index.md` first; use the index to shortlist relevant pages under `sources/`, `topics/`, `entities/`, `queries/`, and recent `REPORTS/`; read only the relevant wiki pages next; if the wiki is missing, stale, contradictory, or insufficient, read canonical repo docs/tests/interfaces/config/code directly.

Truth rules: canonical raw sources outrank derived wiki pages; prior query pages are hints, not proof; when the wiki conflicts with raw sources, preserve the contradiction and trust the raw sources.

## 2. Answer the question

Spawn the `wiki-query-analyst` subagent via the Task tool with `subagent_type: "wiki-query-analyst"` and prompt:

```text
<wiki_assignment>
project_root: {ROOT}
question: {question}
writeback: {writeback}
index_path: {ROOT}/.planning/wiki/index.md
log_path: {ROOT}/.planning/wiki/log.md
policy_path: {ROOT}/.planning/wiki/POLICY.md
output_path: {query_output_path or "null"}
timestamp: {timestamp}
branch: {branch}
project_name: {project_name}
</wiki_assignment>
```

If Task/subagent execution is unavailable, run the query-analyst role inline; still answer in chat and still write the reusable query page + update index/log when `writeback` is true.

## 3. Report results

Always answer in chat with preserved source references and caveats, calling out any contradictions or freshness uncertainty.

If `writeback` is true: mention the saved query page path; confirm the artifact is derived, not canonical; update the `Queries` section of `.planning/wiki/index.md` inside `<!-- wiki:queries:start -->`/`<!-- wiki:queries:end -->` when present (replace `- None yet.` for the first real entry); append the log entry inside `<!-- wiki:entries:start -->`/`<!-- wiki:entries:end -->` when present.

</process>

<success_criteria>
- [ ] Repo root resolved and wiki scaffold created if missing
- [ ] Index consulted before deeper reads
- [ ] Relevant wiki pages reviewed before canonical fallback
- [ ] Final chat answer preserved source references and caveats
- [ ] Reusable answer written under `.planning/wiki/queries/` when `--writeback` is used
- [ ] Index and log updated when `--writeback` is used
</success_criteria>
