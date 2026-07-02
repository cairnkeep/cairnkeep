# Project Knowledge Wiki Policy

This repository uses `.planning/wiki/` as a derived, sparse, citation-heavy compiled-knowledge layer.

## Canonical Sources

- Raw repository docs, ADRs, tests, interfaces, config, and code remain the canonical sources of truth.
- The wiki must never overrule the default-branch implementation or canonical repository documents.
- Use wiki pages to summarize, cross-link, and preserve reusable answers, not to duplicate every file.

## Branch Rules

- Project: `REPLACE_WITH_PROJECT_NAME`
- Default branch: `REPLACE_WITH_DEFAULT_BRANCH`
- Update wiki pages on the same branch as the source changes they depend on.
- If the wiki and raw sources disagree, record the contradiction explicitly instead of silently normalizing it.

## Provenance Rules

- Every non-trivial claim in `sources/`, `topics/`, `entities/`, and `queries/` should cite canonical source paths.
- Prefer direct repo-relative paths and specific sections or line ranges when practical.
- Record `Last reviewed` on every derived page.
- If freshness is uncertain, say so directly.

## Scope Rules

- Do not auto-generate a wiki page per code file.
- Prefer source summaries for repository docs, design docs, ADRs, standards, and a small number of stable interfaces or subsystems.
- Topic and entity pages are optional and rare. Create them only when the same synthesis is needed across three or more sources or recurring queries. An empty `topics/`, `entities/`, or `queries/` directory is a healthy, expected state — a sources-only wiki is the normal stable shape for engineering repos, not a gap to fill.

## Contradiction Severity

When the wiki disagrees with a canonical source or with itself, classify and record it in `.planning/wiki/CONTRADICTIONS.md` (the persistent register) using one of:

- **soft** — non-blocking, contextual difference; coexists, no action required.
- **scope-mismatch** — the claims apply to different scopes and do not truly conflict; recorded to prevent confusion.
- **hard** — genuinely conflicting claims that cannot both be correct; must be resolved before downstream work relies on either page. Surfaced at session start.

`/wiki-lint` opens and resolves entries in the register in place. An entry is `resolved` only after the conflicting wiki page has actually been reconciled to the canonical source, not merely acknowledged. Do not silently normalize a contradiction away — if raw sources disagree, record it explicitly.

## Maintenance

- Use `/wiki-ingest <path>` to create a source summary, or `/wiki-ingest <path> --refresh` to re-sync an existing summary to the current canonical source (re-read, update only changed stable facts, bump `Last reviewed`, log a `wiki-refresh` entry). Run a refresh whenever the MR/PR or code state behind a page changes.
- Use `/wiki-query --writeback <question>` only when the answer is likely reusable.
- Use `/wiki-lint` for advisory checks on citations, freshness, contradictions, discoverability, and link hygiene. Lint also updates the persistent `CONTRADICTIONS.md` register.
- At session start, scan `CONTRADICTIONS.md` for any `severity: hard` open entries and surface them before doing dependent work.
- Lint reports under `REPORTS/` are advisory snapshots; the register is the durable record. Raw docs and code remain the source of truth.
