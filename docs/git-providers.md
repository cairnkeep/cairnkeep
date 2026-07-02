# Git provider configuration

Cairnkeep's collaboration commands — `memory-sync`, `repo-review` / `code-review`,
and `security-audit` — talk to your git host through whatever git-provider MCP
server you have registered. The host is selected per project by one setting, so
the same commands work on GitHub, GitLab, Codeberg/Forgejo, and anything else
that has an MCP server.

## Configure

Set the provider in the project's `.ai/.env`:

```bash
CAIRN_GIT_PROVIDER=github   # github | gitlab | codeberg | forgejo | none
```

`none` disables the provider steps — the commands run locally only (still write
memory, still produce local review/audit reports).

## Operations the commands use

The commands need a small, stable set of operations. Map each to the tool your
provider's MCP server exposes:

| Operation | Purpose | GitHub (example) | GitLab (example) |
|---|---|---|---|
| list open changes | find tracked PRs/MRs | `list_pull_requests` | `list_merge_requests` |
| get change diff | review a PR/MR diff | `get_pull_request_diff` | `get_merge_request_diffs` |
| post inline comment | post review findings | `create_review_comment` | `create_merge_request_discussion` |
| get change state | sync memory with PR/MR status | `get_pull_request` | `get_merge_request` |
| create issue | file an accepted finding | `create_issue` | `create_issue` |

Exact tool names depend on the specific MCP server you install; the table shows
the common shape. Codeberg/Forgejo and other hosts follow the same operations
with their own tool names. If no git-provider MCP is registered (or
`CAIRN_GIT_PROVIDER=none`), the commands skip the provider steps and keep working.
