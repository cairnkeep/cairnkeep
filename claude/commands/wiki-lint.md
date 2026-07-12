---
description: Audit the project wiki for citation gaps, orphan pages, stale claims, contradictions, and broken cross-references; mirror contradictions into the persistent register
argument-hint: "[--focus <path>]"
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

<objective>
Run an advisory lint pass over `.planning/wiki/`.

Output artifacts:
- `.planning/wiki/REPORTS/<timestamp>-lint.md` (advisory snapshot)
- `.planning/wiki/CONTRADICTIONS.md` (persistent register, updated in place)
- updated `.planning/wiki/log.md`

Flag handling:
- `--focus <path>` — restrict advisory checks to one wiki page or subdirectory under `.planning/wiki/`

This is an advisory governance command. Raw repository docs, ADRs, tests, interfaces, and code remain canonical even when the wiki disagrees or is stale. Scaffold templates live at `$HOME/.claude/templates/wiki-*.template`.

Contradictions are classified by severity (`soft` / `scope-mismatch` / `hard`) and written to the persistent `CONTRADICTIONS.md` register. Unlike the per-run REPORTS snapshot, the register is durable: lint opens, updates, and resolves entries in place so contradictions do not leak (get reported and forgotten). An entry is `resolved` only after the conflicting wiki page has actually been reconciled to the canonical source.

Reliability rule: run the lint inline in this command. Do not spawn a subagent and do not create todos for `/wiki-lint`.
</objective>

<context>
Arguments: $ARGUMENTS
</context>

<process>

## 0. Initialize repo context

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$ROOT" ]; then
  echo "Not inside a git repository. /wiki-lint must run from a project repo."
  exit 1
fi
cd "$ROOT"
```

Parse flags from `$ARGUMENTS`: optional `--focus <path>` pointing to one page or subdirectory under `.planning/wiki/`.

Capture: current UTC `timestamp`, `branch`, repo basename as `project_name`, `default_branch` (try `origin/HEAD`, then `origin/main`, `main`, `master`, then `HEAD`), `report_path = {ROOT}/.planning/wiki/REPORTS/{timestamp}-lint.md`, `register_path = {ROOT}/.planning/wiki/CONTRADICTIONS.md`.

```bash
mkdir -p .planning/wiki/sources .planning/wiki/topics .planning/wiki/entities .planning/wiki/queries .planning/wiki/REPORTS .planning/wiki/tmp
```

Scaffold when missing from `$HOME/.claude/templates/wiki-*.template`: `.planning/wiki/index.md`, `.planning/wiki/log.md`, `.planning/wiki/POLICY.md`, `.planning/wiki/CONTRADICTIONS.md`.

## 1. Gather wiki and canonical context

Read `AGENTS.md` (if present), `.planning/wiki/POLICY.md`, `.planning/wiki/index.md`, `.planning/wiki/log.md`, and the relevant wiki pages under `sources/`, `topics/`, `entities/`, `queries/`. Read canonical raw docs or code only when needed to verify a suspected stale or contradicted claim. Do not consult memory tools and do not scan unrelated repo files; stay within the wiki plus directly cited canonical sources unless a contradiction requires one extra raw-source check.

Truth rules: raw repo docs/tests/interfaces/config/code remain canonical; lint findings are advisory and should bias toward high-signal discrepancies; prefer a smaller number of real issues over speculative style cleanup.

## 2. Run the advisory checks (inline)

Check for: missing citations on non-trivial claims; orphan pages not discoverable from the index or any other wiki page; stale claims whose `Last reviewed` clearly lags the cited canonical sources; contradicted claims where the wiki no longer matches cited raw sources; missing obvious pages (only when the gap is clear and recurring); broken cross-references to missing wiki files or raw repo files.

Finding-signal severity: `high` for contradicted claims or broken links on heavily used pages; `medium` for missing citations, stale, or orphan pages; `low` for optional missing pages or minor hygiene gaps.

Contradiction severity (separate axis — classify every contradiction): `hard` (genuinely conflicting, must resolve), `scope-mismatch` (different scopes, coexists), `soft` (contextual, coexists).

Write the report directly to `report_path` using the structure from `wiki-lint-report.md.template`:
- `# Wiki Lint Report`; bullets for `Project`, `Generated at`, `Scope`, `Advisory status`
- `## Summary` (counts per finding class, with contradiction severity breakdown); `## Contradictions (severity-tagged)`; `## High Signal Findings`; `## Medium Signal Findings`; `## Low Signal Findings`; `## Suggested Next Steps`

Conservative rule: if there are zero meaningful findings, still write a report with zero counts and `- None.` in each findings section. If there is one clear contradiction or drift issue, report that instead of hunting for speculative findings.

Then update the persistent contradiction register at `register_path` (`.planning/wiki/CONTRADICTIONS.md`): for each contradiction found, open or refresh an entry under `<!-- wiki:contradictions:open:start -->` with severity, `Status: open`, affected pages, conflicting claims, detection date; for contradictions whose page(s) now agree with the canonical source, flip `Status: open` → `resolved` and move the entry to `<!-- wiki:contradictions:resolved:start -->` with a resolution date. Do not delete entries — move resolved ones. An entry is `resolved` only after the page was actually reconciled, not merely acknowledged.

## 3. Report results

Display the report path, a short summary of the highest-signal findings, the number of register changes, and a reminder that the report is advisory and raw sources remain canonical. Append one `wiki-lint` entry to `.planning/wiki/log.md` (timestamp, focus scope, report path, register change count, short summary), inside `<!-- wiki:entries:start -->`/`<!-- wiki:entries:end -->` when present.

</process>

<success_criteria>
- [ ] Repo root resolved and wiki scaffold created if missing
- [ ] Relevant wiki pages and cited canonical sources inspected
- [ ] Advisory lint report written under `.planning/wiki/REPORTS/`
- [ ] Log appended
- [ ] Final user-facing summary kept raw sources as the source of truth
</success_criteria>
