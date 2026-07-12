# Query: Git host selection for collaboration commands

- Asked at: 2026-07-02T23:50:00Z
- Question: Which setting selects the git host for the collaboration commands, and what happens when it is set to none or no provider MCP is registered?
- Answer status: grounded in canonical doc; command-template wiring not independently re-verified this session (see notes)
- Last reviewed: 2026-07-02T23:50:00Z

## Answer

- The git host is selected per project by a single setting: `CAIRN_GIT_PROVIDER` in the project's `.ai/.env` (`docs/git-providers.md`, "Configure", lines 11-15).
- Allowed values: `github | gitlab | codeberg | forgejo | none` (`docs/git-providers.md`, line 14).
- The setting applies to the collaboration commands `memory-sync`, `repo-review` / `code-review`, and `security-audit`, which reach the host through whatever git-provider MCP server is registered (`docs/git-providers.md`, lines 3-7).
- `CAIRN_GIT_PROVIDER=none` disables the provider steps: commands run locally only, but still write memory and still produce local review/audit reports (`docs/git-providers.md`, lines 17-18).
- Same graceful degradation applies when no git-provider MCP server is registered: commands skip the provider steps and keep working (`docs/git-providers.md`, lines 35-36).
- Keeping this layer configurable (never hardcoding a host) is a hard repo convention (`AGENTS.md`, "Conventions").

## Wiki Pages Consulted

- `sources/git-providers.md` (Last reviewed 2026-07-02T23:46:30Z) — matched the canonical doc on every point checked.

## Canonical Sources

- `docs/git-providers.md` (primary; read directly this session)
- `AGENTS.md` — "Conventions" section

## Contradictions And Freshness Notes

- No contradiction between the wiki page and `docs/git-providers.md`.
- The doc's GitHub/GitLab tool names (e.g. `list_pull_requests`) are examples of the operation shape, not contracts; they track third-party MCP servers and may drift upstream (`docs/git-providers.md`, lines 33-36).
- Verification limit: the per-command template wiring (commit `553e817` "Wire collaboration commands to the configurable git provider") could not be re-inspected this session because directory-listing/search tooling was unavailable; the behavioral claims here rest on `docs/git-providers.md` and `AGENTS.md`.

## Suggested Follow-up

- Ingest the collaboration command templates (operating layer under `templates/`) with `/wiki-ingest` to cite the exact wiring that checks `CAIRN_GIT_PROVIDER` and implements the `none`/no-MCP skip path.
