# Cairnkeep

[![CI](https://github.com/cairnkeep/cairnkeep/actions/workflows/ci.yml/badge.svg)](https://github.com/cairnkeep/cairnkeep/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@cairnkeep/cli)](https://www.npmjs.com/package/@cairnkeep/cli)
[![license](https://img.shields.io/npm/l/@cairnkeep/cli)](LICENSE)

> A durable, harness-agnostic **memory + context layer** for coding agents.

A *cairn* is a stack of stones left as a trail marker for whoever follows; a
*keep* is where you store what matters. **Cairnkeep** is where coding agents
stack durable memory — decisions, pitfalls, patterns — and follow the trail
across sessions, projects, and harnesses (Claude Code, OpenCode, …).

## Status

Shipped: the memory server, the `cairn` CLI (`bootstrap`, `memory-server`, `sync`,
`doctor`, `memory`, `audit-timer`, `uninstall`) installable via `npm i -g @cairnkeep/cli`, and the
operating layer (commands,
agents, hooks) installed on both Claude Code and OpenCode. The generic launchers
expose wrapper seams (`.ai/pre-launch.sh`, `CAIRN_EXTRA_SETTINGS`,
`.ai/post-exit.sh`) so an enterprise wrapper can add provider/credential setup
without forking them. Also shipped: context exploration (`/context-explore`) and
a thin routing seam (`route_check`), both of which delegate to
[token-miser](https://github.com/cairnkeep/token-miser), a public
cairnkeep-org sibling project.

## Compatibility

Node.js 22 or 24 is recommended. Node.js 18 and 20 remain compatible for the
1.x line but are end-of-life upstream; the minimum will move in the next major
release.

| Client or platform | Support level |
|---|---|
| Claude Code on Linux/macOS | Memory server plus commands, agents, hooks, and launchers |
| OpenCode on Linux/macOS | Memory server plus commands, plugins, hooks, and launchers |
| Codex CLI | Memory MCP server; no Cairnkeep operating-layer assets |
| Other MCP clients | Memory and optional domain-knowledge MCP tools |
| Native Windows | Not supported by the Bash-based installer; use WSL (not yet CI-verified) |

Linux, macOS, Bash 3.2 portability, and a clean Node 18 compatibility install
are exercised in CI.

## Components

- **`mcp-memory-server/`** — an MCP server exposing durable, scoped memory
  (`memory_write`, `memory_search`, …) backed by AgentFS, with optional
  embedding-ranked search against any OpenAI-compatible endpoint.
- **`bin/cairn`** — the CLI. `cairn bootstrap [path]` scaffolds a project's
  `.ai/` launchers + env; `cairn doctor` health-checks the configured pieces;
  `cairn memory export|import` relocates the durable store between machines
  (`export` requires the optional `sqlite3` CLI);
  `cairn audit-timer` installs the scheduled memory+wiki audit; `cairn uninstall`
  reverses the install (backup-first, revertible).
- **`templates/`** — project scaffolding (generic launchers, env) plus the
  derived-knowledge layer (wiki, alignment, graph, security, planning).
- **`scripts/`** — asset-sync and maintenance utilities.

## Related projects

- **[token-miser](https://github.com/cairnkeep/token-miser)** — a public
  cairnkeep-org sibling that owns context exploration and request routing;
  cairnkeep's `context_explore` and `route_check` tools are thin delegates
  to it.

## Optional companion tools

cairnkeep runs standalone — none of the tools below are required. Its memory
server, `cairn bootstrap`, and derived-knowledge features work with none of
them. These are the accelerators the author pairs cairnkeep with; each is opt-in.

| Tool | What it adds | How it plugs in |
|------|--------------|-----------------|
| [lean-ctx](https://github.com/yvgude/lean-ctx) | Compressed reads/searches/shell/dir-maps — large token savings on exploration | Register as an MCP server in your harness |
| [token-miser](https://github.com/cairnkeep/token-miser) | Model routing (`route_check`) + codebase mapping (`context_explore`) | Already integrated, env-gated: `CAIRN_ROUTE_ENDPOINT` / `CAIRN_EXPLORE_BINARY` |
| [rtk](https://github.com/rtk-ai/rtk) | "Rust Token Killer": token-reduced proxy for git/npm/cargo output | Shell-level, no wiring needed |

## Setup

A working workflow needs three things: the memory server registered, the
operating layer (commands, agents, hooks) installed into your harness, and a
bootstrapped project. `cairn bootstrap` does only the last of these — the full
ordered walkthrough is in **[docs/operating.md](docs/operating.md)**.

This setup is local by default: the registered stdio server stores memory on
the user's computer. Cairnkeep never discovers or selects a remote host.
Remote HTTP storage requires an explicit server deployment and client URL; see
**[Memory storage and deployment](docs/storage.md)** before enabling it.

The short version for Claude Code:

```bash
# 1. Install cairnkeep and register the memory server (server name: cairn-memory)
npm install -g @cairnkeep/cli
claude mcp add cairn-memory -s user -- cairn memory-server

# 2. Install the operating layer (commands, agents, hooks, scaffold templates)
cairn sync --apply                       # add --live-root <proj>/.claude to scope it

# 3. Scaffold a project and configure it
cairn bootstrap /path/to/project
cp /path/to/project/.ai/env.example /path/to/project/.ai/.env   # then edit

# 4. Launch (and, optionally, check the wiring first)
cd /path/to/project && cairn doctor
./.ai/start-claude.sh
```

After setup, the basic workflow is intentionally small:

```text
> /remember Use transactional migrations for schema changes
Stored as patterns/transactional-migrations.

> /recall transactional migrations
patterns/transactional-migrations: Use transactional migrations for schema changes
```

The exact command rendering depends on the client. Any MCP client can call
`memory_write` and `memory_search` directly.

Prefer working from a clone? Build the server with `cd mcp-memory-server && npm
install && npm run build`, then use `scripts/sync-claude-assets.sh` and
`bin/cairn` in place of the installed `cairn`.

Step 2 is easy to miss and load-bearing: without it the memory server is
registered but none of the `/remember`, `/recall`, `/wiki-*`, `/security-audit`,
or `/repo-review` commands (and no memory hooks) exist. OpenCode uses the
`sync-opencode-*.sh` scripts instead — see the operating guide.

The launchers load `.ai/.env` and start the harness in the repo root. They stay
deliberately minimal — provider/profile specifics belong in your own wrapper,
which plugs in through the launcher seams below.

**Wrapper seams.** The generic launchers are no-ops beyond loading `.ai/.env`
unless a wrapper opts in:

- **`.ai/pre-launch.sh`** — sourced after `.env`, before the harness starts. May
  export env (e.g. a provider base URL) or abort the launch by returning
  non-zero. This is where credential refresh / connectivity setup lives.
- **`CAIRN_EXTRA_SETTINGS`** — path to a settings file layered onto the harness
  (`--settings` for Claude Code, `--config` for OpenCode). Process env still
  wins, so an inline value beats the profile.
- **`.ai/post-exit.sh`** — sourced after the harness exits, with
  `CAIRN_EXIT_STATUS` set to its exit code.

**Contributor mode.** Working on a repo you don't own? `cairn bootstrap
--untracked /path/to/project` additionally writes the scaffolded paths
(`.ai/`, `.planning/`, `.agentfs/`) into the repo's `.git/info/exclude`, so the workflow
files stay purely local: nothing to commit or push, invisible to every other
contributor, and no edit to the shared `.gitignore`. The trade-off is that
untracked planning state lives only on that clone — deleting the clone
deletes it. To move the durable memory itself between machines, use
`cairn memory export` / `cairn memory import`.

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
| `CAIRN_EXTRA_SETTINGS` | Optional settings/config file the launcher layers onto the harness (wrapper seam) |
| `CAIRN_ANYTHINGLLM_SYNC_SCRIPT` | Override path to the domain-knowledge sync script (when the integration lives outside the repo) |
| `CAIRN_ANYTHINGLLM_PROJECTS_FILE` | Override path to the bundled sync script's project configuration |
| `CAIRN_ANYTHINGLLM_STATE_FILE` | Override path to the bundled sync script's incremental state |

Without an API key, search degrades gracefully to substring matching.
There is no Cairnkeep telemetry. Optional extraction, embeddings, document RAG,
remote memory, and delegated exploration can send content to endpoints you
configure. Review [Privacy and data flow](docs/privacy-and-data-flow.md) before
enabling them.

## More

- **Optional document RAG** (`domain_knowledge_*` via AnythingLLM) — [docs/domain-knowledge.md](docs/domain-knowledge.md)
- **Building a private overlay** (wrap cairnkeep for your org/provider) — [docs/building-an-overlay.md](docs/building-an-overlay.md)
- **Managed overlay distributions** (wrapper CLI, policy lock, private registry, rollback) — [docs/overlay-distributions.md](docs/overlay-distributions.md)
- **Full operating guide** — [docs/operating.md](docs/operating.md)
- **Memory storage and deployment** — [docs/storage.md](docs/storage.md)
- **Privacy and data flow** — [docs/privacy-and-data-flow.md](docs/privacy-and-data-flow.md)
- **Git providers** — [docs/git-providers.md](docs/git-providers.md)
- **Support** — [SUPPORT.md](SUPPORT.md)
- **Contributing** — [CONTRIBUTING.md](CONTRIBUTING.md)
- **Security policy** — [SECURITY.md](SECURITY.md)

## License

Apache-2.0 © 2026 Stefano Tondo
