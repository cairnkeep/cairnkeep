# Source: docs/git-providers.md

- Canonical source: `docs/git-providers.md`
- Source kind: repo_doc
- Derived status: derived summary — the raw doc remains authoritative
- Last reviewed: 2026-07-02T23:46:30Z

## Why This Source Matters

- Defines how Cairnkeep's collaboration commands reach a git host without hardcoding one, which is a hard repo convention (`AGENTS.md`, "Conventions": keep the git-host layer configurable via `CAIRN_GIT_PROVIDER`; never hardcode a specific host).
- The single reference for the provider setting, its allowed values, and the minimal operation set any provider MCP server must map to.

## Stable Facts

- Collaboration commands — `memory-sync`, `repo-review` / `code-review`, and `security-audit` — talk to the git host through whatever git-provider MCP server is registered (`docs/git-providers.md`, intro, lines 3-7).
- The host is selected per project by one setting: `CAIRN_GIT_PROVIDER` in the project's `.ai/.env` (`docs/git-providers.md`, "Configure", lines 11-14).
- Allowed values: `github | gitlab | codeberg | forgejo | none` (`docs/git-providers.md`, "Configure", line 14).
- `CAIRN_GIT_PROVIDER=none` disables the provider steps; commands run locally only but still write memory and still produce local review/audit reports (`docs/git-providers.md`, lines 17-18).
- Commands rely on a small, stable set of five operations: list open changes, get change diff, post inline comment, get change state, create issue (`docs/git-providers.md`, "Operations the commands use", table at lines 25-31).
- GitHub/GitLab tool names in the table (e.g. `list_pull_requests` / `list_merge_requests`) are examples of the common shape, not contracts; exact tool names depend on the specific MCP server installed (`docs/git-providers.md`, lines 25-34).
- Graceful degradation: if no git-provider MCP is registered (or provider is `none`), the commands skip the provider steps and keep working (`docs/git-providers.md`, lines 35-36).

## Contradictions And Freshness Notes

- No contradictions found. `AGENTS.md` ("Conventions") independently states the same rule and points to this doc.
- Freshness caveat: the example MCP tool names (GitHub/GitLab columns) track third-party MCP servers and may drift upstream; the doc itself flags them as examples only (`docs/git-providers.md`, lines 33-34).

## Related Wiki Pages

- None yet.

## Canonical References

- `docs/git-providers.md` (primary)
- `AGENTS.md` — "Conventions" section (git-host layer must stay configurable via `CAIRN_GIT_PROVIDER`)
