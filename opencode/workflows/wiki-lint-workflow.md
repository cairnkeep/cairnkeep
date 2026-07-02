<purpose>
Run an advisory lint pass over the repo-local project wiki. Produce a durable report under `.planning/wiki/REPORTS/` and append `.planning/wiki/log.md`.
</purpose>

<required_reading>
@$HOME/.config/opencode/templates/wiki-policy.md.template
@$HOME/.config/opencode/templates/wiki-index.md.template
@$HOME/.config/opencode/templates/wiki-log.md.template
@$HOME/.config/opencode/templates/wiki-lint-report.md.template
@$HOME/.config/opencode/templates/wiki-contradictions.md.template
</required_reading>

<available_agent_types>
Valid GSD subagent types (use exact names — do not fall back to 'general-purpose'):
- wiki-lint-auditor
</available_agent_types>

<process>

## 0. Initialize Repo Context

Resolve the repo root:

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$ROOT" ]; then
  echo "Not inside a git repository. /wiki-lint must run from a project repo."
  exit 1
fi
cd "$ROOT"
```

Parse flags from `$ARGUMENTS`:
- optional `--focus <path>` pointing to one page or subdirectory under `.planning/wiki/`

Capture:
- current UTC `timestamp`
- `branch`
- repo basename as `project_name`
- `default_branch` using `origin/HEAD`, then `origin/main`, `main`, `master`, then `HEAD`
- `report_path = {ROOT}/.planning/wiki/REPORTS/{timestamp}-lint.md`
- `register_path = {ROOT}/.planning/wiki/CONTRADICTIONS.md`

Create directories:

```bash
mkdir -p .planning/wiki/sources .planning/wiki/topics .planning/wiki/entities .planning/wiki/queries .planning/wiki/REPORTS .planning/wiki/tmp
```

Scaffold files when missing:
- `.planning/wiki/index.md` from `wiki-index.md.template` with project name filled in
- `.planning/wiki/log.md` from `wiki-log.md.template`
- `.planning/wiki/POLICY.md` from `wiki-policy.md.template` with project name and default branch filled in
- `.planning/wiki/CONTRADICTIONS.md` from `wiki-contradictions.md.template`

## 1. Gather Wiki And Canonical Context

Before linting:
- read `AGENTS.md` if present
- read `.planning/wiki/POLICY.md`
- read `.planning/wiki/index.md`
- read `.planning/wiki/log.md`
- read the relevant wiki pages under `sources/`, `topics/`, `entities/`, and `queries/`
- read canonical raw docs or code when needed to verify suspected stale or contradicted claims
- do not consult memory tools for this command
- do not scan unrelated repo files; stay within the wiki plus directly cited canonical sources unless a contradiction requires one extra raw-source check

Linting truth rules:
- raw repo docs, tests, interfaces, config, and code remain canonical
- lint findings are advisory and should bias toward high-signal discrepancies
- prefer a smaller number of real issues over speculative style cleanup

## 2. Run The Advisory Checks

Check for:
- missing citations on non-trivial claims
- orphan pages that are not discoverable from `.planning/wiki/index.md` or any other wiki page
- stale claims whose `Last reviewed` context clearly lags the cited canonical sources
- contradicted claims where the wiki no longer matches the cited raw sources
- missing obvious pages, but only when the gap is clear and recurring rather than speculative
- broken cross-references to missing wiki files or raw repo files

Contradiction severity (classify every contradiction found, mirroring the policy):
- `hard` — genuinely conflicting claims that cannot both be correct; must be resolved before downstream work relies on either page
- `scope-mismatch` — the two claims apply to different scopes/contexts and do not truly conflict
- `soft` — non-blocking, contextual difference; coexists

Run this lint pass inline in the current command.

Reliability rule:
- do not spawn another agent or task for `/wiki-lint`
- do not create todos for this command
- inspect the current wiki state, write the report directly, then append the log entry and return

Write the report directly to `report_path` using the required structure from `wiki-lint-report.md.template`.

Conservative execution rule:
- if there are zero meaningful findings, still write a report with zero counts and `- None.` in each findings section
- if there is one clear contradiction or drift issue, report that instead of searching for additional speculative findings

## 3. Update The Contradiction Register

Mirror every contradiction finding into the persistent register at `.planning/wiki/CONTRADICTIONS.md`. This is what stops contradictions from leaking (reported once, then forgotten):

- read the existing register
- for each contradiction found this run: if an open entry for the same page-pair/claim already exists, update it (severity, evidence, last-seen timestamp); otherwise open a new entry under `<!-- wiki:contradictions:open:start -->` with severity, `Status: open`, affected pages, the conflicting claims, and the detection date
- for contradictions that previously existed but whose underlying wiki page(s) now agree with the canonical source: flip `Status: open` → `resolved`, move the entry to the `<!-- wiki:contradictions:resolved:start -->` block, and record the resolution date and the refresh/ingest that fixed it
- do not delete entries — move resolved ones to the Resolved section so the history is preserved
- a contradiction is `resolved` only after the conflicting page was actually reconciled (via `/wiki-ingest --refresh` or a manual edit), not merely acknowledged

## 4. Report Results

Display:
- report path
- a short summary of the highest-signal findings
- a reminder that the report is advisory and raw sources remain canonical
- append the log entry inside `<!-- wiki:entries:start -->` and `<!-- wiki:entries:end -->` when those markers exist

</process>

<success_criteria>
- [ ] Repo root resolved and wiki scaffold created if missing
- [ ] Relevant wiki pages and cited canonical sources inspected
- [ ] Advisory lint report written under `.planning/wiki/REPORTS/`
- [ ] Log appended
- [ ] Missing citations, orphan pages, stale or contradicted claims, missing obvious pages, and broken links were considered conservatively
- [ ] Final user-facing summary kept raw sources as the source of truth
</success_criteria>
