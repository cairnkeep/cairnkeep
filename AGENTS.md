# Cairnkeep — agent guide

Cairnkeep is a durable, harness-agnostic memory + context layer for coding
agents. This file is the operating contract for agents working *in this repo*.

## Layout
- `mcp-memory-server/` — the memory MCP server (`cairn-memory`). TypeScript.
- `bin/cairn` — the CLI (`cairn bootstrap [path]`).
- `scripts/` — bootstrap and maintenance utilities.
- `templates/` — project scaffolding (launchers, env) + the derived-knowledge
  layer (wiki, alignment, graphs, security, planning).

## Build & test
```bash
cd mcp-memory-server
npm ci
npm run build
npm test        # offline smoke tests — no API key required
```
`npm test` must pass before committing changes to the memory server.

## Memory model (what the server exposes)
- Scoped, durable key/value memory over AgentFS: `memory_write`, `memory_read`,
  `memory_search`, `memory_supersede`, `memory_history`, `memory_extract`.
- Keys are short kebab-case with a prefix: `decisions/`, `pitfalls/`,
  `patterns/`, `bugs/`, `constraints/`, `conventions/`.
- Search uses embeddings when `CAIRN_LLM_API_KEY` and an endpoint URL are set;
  otherwise it degrades to substring match.

## Conventions
- Keep the core provider-neutral: no vendor names, no hardcoded endpoints. All
  LLM configuration comes from `CAIRN_LLM_*` / `CAIRN_MEMORY_*` environment
  variables.
- Keep the git-host layer configurable via `CAIRN_GIT_PROVIDER`
  (see `docs/git-providers.md`); never hardcode a specific host.
- Match the existing style; prefer the smallest change that solves the task.
- Run the relevant checks before closing work.

## Working rules (hard)
- This repo never references a specific employer, vendor, internal host/IP, or
  private repo name — in code, comments, commit messages, or docs.
- No AI/assistant authorship references anywhere (commits, comments, docs).
- Scan every commit — the diff **and** the message — for the above before
  creating it.
- Commit locally, review, then push.
