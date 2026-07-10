# Cairnkeep

> A durable, harness-agnostic **memory + context layer** for coding agents.

A *cairn* is a stack of stones left as a trail marker for whoever follows; a
*keep* is where you store what matters. **Cairnkeep** is where coding agents
stack durable memory — decisions, pitfalls, patterns — and follow the trail
across sessions, projects, and harnesses (Claude Code, OpenCode, …).

## Status

Shipped: the memory server, the `cairn` CLI and project bootstrapper, and the
operating layer (commands, agents, hooks) installed on both Claude Code and
OpenCode. Also shipped: context exploration (`/context-explore`) and a thin
routing seam (`route_check`), both of which delegate to
[token-miser](https://github.com/cairnkeep/token-miser), a public
cairnkeep-org sibling project.

## Components

- **`mcp-memory-server/`** — an MCP server exposing durable, scoped memory
  (`memory_write`, `memory_search`, …) backed by AgentFS, with optional
  embedding-ranked search against any OpenAI-compatible endpoint.
- **`bin/cairn`** — the CLI. `cairn bootstrap [path]` scaffolds a project's
  `.ai/` launchers + env from the bundled templates.
- **`templates/`** — project scaffolding (generic launchers, env) plus the
  derived-knowledge layer (wiki, alignment, graph, security, planning).
- **`scripts/`** — asset-sync and maintenance utilities.

## Related projects

- **[token-miser](https://github.com/cairnkeep/token-miser)** — a public
  cairnkeep-org sibling that owns context exploration and request routing;
  cairnkeep's `context_explore` and `route_check` tools are thin delegates
  to it.

## Setup

A working workflow needs three things: the memory server registered, the
operating layer (commands, agents, hooks) installed into your harness, and a
bootstrapped project. `cairn bootstrap` does only the last of these — the full
ordered walkthrough is in **[docs/operating.md](docs/operating.md)**.

The short version for Claude Code, from a clone of this repo:

```bash
# 1. Build + register the memory server (server name: cairn-memory)
cd mcp-memory-server && npm install && npm run build && npm test && cd ..
claude mcp add cairn-memory -s user -- node "$PWD/mcp-memory-server/dist/index.js"

# 2. Install the operating layer (commands, agents, hooks, scaffold templates)
scripts/sync-claude-assets.sh --apply

# 3. Scaffold a project and configure it
cairn bootstrap /path/to/project
cp /path/to/project/.ai/env.example /path/to/project/.ai/.env   # then edit

# 4. Launch
/path/to/project/.ai/start-claude.sh
```

Step 2 is easy to miss and load-bearing: without it the memory server is
registered but none of the `/remember`, `/recall`, `/wiki-*`, `/security-audit`,
or `/repo-review` commands (and no memory hooks) exist. OpenCode uses the
`sync-opencode-*.sh` scripts instead — see the operating guide.

The launchers load `.ai/.env` and start the harness in the repo root. They stay
deliberately minimal — provider/profile specifics belong in your own wrapper.

**Contributor mode.** Working on a repo you don't own? `cairn bootstrap
--untracked /path/to/project` additionally writes the scaffolded paths
(`.ai/`, `.planning/`) into the repo's `.git/info/exclude`, so the workflow
files stay purely local: nothing to commit or push, invisible to every other
contributor, and no edit to the shared `.gitignore`. The trade-off is that
untracked planning state lives only on that clone — deleting the clone
deletes it.

## Configuration

The memory server and collaboration commands are configured entirely through
`.ai/.env` (any OpenAI-compatible API for extraction and embedding-ranked
search):

| Variable | Purpose |
|---|---|
| `CAIRN_LLM_API_KEY` | API key for the extraction / embeddings endpoint |
| `CAIRN_LLM_API_URL` | Base URL of the OpenAI-compatible endpoint |
| `CAIRN_LLM_EXTRACTION_MODEL` | Chat model used for memory extraction |
| `CAIRN_MEMORY_EMBEDDING_URL` | Embeddings endpoint (falls back to `CAIRN_LLM_API_URL`) |
| `CAIRN_MEMORY_EMBEDDING_MODEL` | Embedding model name (required for semantic search) |
| `CAIRN_AGENTFS_BASE_DIR` | Base dir for global memory scopes (default `~/.cairnkeep`) |
| `CAIRN_GIT_PROVIDER` | Git host for collaboration commands: `github`\|`gitlab`\|`codeberg`\|`forgejo`\|`none` ([docs/git-providers.md](docs/git-providers.md)) |
| `CAIRN_ROUTE_ENDPOINT` | Base URL of an already-running token-miser routing/tiering proxy (unset → `route_check` is inert) |
| `CAIRN_EXPLORE_BINARY` | Absolute path to the `token_miser` binary used by `context_explore` (unset → the tool throws) |
| `CAIRN_EXPLORE_REPO_ROOT` | Default repo root for `context_explore` when no per-call `repo_root` is given |

Without an API key, search degrades gracefully to substring matching.

## License

Apache-2.0 © 2026 Stefano Tondo
