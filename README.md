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

## Bootstrap a project

```bash
cairn bootstrap /path/to/project   # writes .ai/start-claude.sh, start-opencode.sh, env.example
cp /path/to/project/.ai/env.example /path/to/project/.ai/.env
```

The launchers load `.ai/.env` and start the harness in the repo root. They stay
deliberately minimal — provider/profile specifics belong in your own wrapper.

## Memory server — quick start

```bash
cd mcp-memory-server
npm install
npm run build
npm test            # offline smoke tests
```

Register it with your harness — the server name is `cairn-memory`. For Claude Code:

```bash
claude mcp add cairn-memory -s user -- node "$PWD/dist/index.js"
```

Configure the LLM endpoint (any OpenAI-compatible API) for extraction and
embedding-ranked search:

| Variable | Purpose |
|---|---|
| `CAIRN_LLM_API_KEY` | API key for the extraction / embeddings endpoint |
| `CAIRN_LLM_API_URL` | Base URL of the OpenAI-compatible endpoint |
| `CAIRN_LLM_EXTRACTION_MODEL` | Chat model used for memory extraction |
| `CAIRN_MEMORY_EMBEDDING_URL` | Embeddings endpoint (falls back to `CAIRN_LLM_API_URL`) |
| `CAIRN_MEMORY_EMBEDDING_MODEL` | Embedding model name (required for semantic search) |
| `CAIRN_AGENTFS_BASE_DIR` | Base dir for global memory scopes (default `~/.cairnkeep`) |

Without an API key, search degrades gracefully to substring matching.

## License

Apache-2.0 © 2026 Stefano Tondo
