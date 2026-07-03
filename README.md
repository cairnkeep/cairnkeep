# Cairnkeep

> A durable, harness-agnostic **memory + context layer** for coding agents.

A *cairn* is a stack of stones left as a trail marker for whoever follows; a
*keep* is where you store what matters. **Cairnkeep** is where coding agents
stack durable memory — decisions, pitfalls, patterns — and follow the trail
across sessions, projects, and harnesses (Claude Code, OpenCode, …).

## Status

Early. Cairnkeep is being carved out of a larger private workflow repo into a
clean open-source core. The first component landed here is the memory server;
launchers, the project bootstrapper, and the compiled-knowledge (wiki) layer
follow.

## Components

- **`mcp-memory-server/`** — an MCP server exposing durable, scoped memory
  (`memory_write`, `memory_search`, …) backed by AgentFS, with optional
  embedding-ranked search against any OpenAI-compatible endpoint.
- **`bin/cairn`** — the CLI. `cairn bootstrap [path]` scaffolds a project's
  `.ai/` launchers + env from the bundled templates.
- **`templates/`** — project scaffolding (generic launchers, env) plus the
  derived-knowledge layer (wiki, alignment, graph, security, planning).
- **`scripts/`** — asset-sync and maintenance utilities.

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

Without an API key, search degrades gracefully to substring matching.

## License

Apache-2.0 © 2026 Stefano Tondo
