# Wiki Log

This log records wiki ingests, reusable query writebacks, and advisory lint runs.

Raw repository docs, tests, interfaces, config, and code remain canonical.

## Entries

<!-- wiki:entries:start -->
- Scaffold initialized. Append timestamped `wiki-ingest`, `wiki-query --writeback`, and `wiki-lint` entries below.
- 2026-07-02T23:46:30Z — wiki-ingest — `docs/git-providers.md` — pages: `sources/git-providers.md`, `index.md` — first-time ingest of a short repo doc; no contradictions found (AGENTS.md corroborates the provider-neutrality rule); noted that GitHub/GitLab tool names in the operations table are examples that may drift with upstream MCP servers. No topic/entity pages created.
- 2026-07-02T23:50:00Z — wiki-query --writeback — "Which setting selects the git host for the collaboration commands, and what happens when it is set to none or no provider MCP is registered?" — pages: `queries/2026-07-02T235000Z-git-host-selection.md`, `index.md` — answered from `docs/git-providers.md` (read directly) with `sources/git-providers.md` as the navigation aid; no contradictions; noted that command-template wiring was not re-inspected this session.
- 2026-07-02T23:55:00Z — wiki-lint — scope: full wiki — report: `REPORTS/2026-07-02T235500Z-lint.md` — register changes: 0 (scaffolded `CONTRADICTIONS.md`) — zero findings across citations, orphans, staleness, contradictions, and cross-references; wiki is 2 pages, both index-linked and freshly reviewed.
<!-- wiki:entries:end -->
