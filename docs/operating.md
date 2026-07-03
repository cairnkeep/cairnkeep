# Operating guide

How to take a project from nothing to the full Cairnkeep workflow — durable
memory, the wiki layer, and the security/review commands — in one pass.

Cairnkeep has three moving parts:

1. **The memory server** (`cairn-memory`) — an MCP server your harness talks to.
2. **The project scaffold** — `.ai/` launchers and the `.planning/` knowledge
   layer, written by `cairn bootstrap`.
3. **The operating layer** — the commands, agents, and hooks that live in your
   harness config and drive the workflow.

`cairn bootstrap` only does step 2. Steps 1 and 3 are one-time-per-machine
installs. This guide covers all three in order.

## Prerequisites

- Node.js (for the memory server) and a supported harness: Claude Code or
  OpenCode.
- Optional: an OpenAI-compatible LLM endpoint for memory extraction and
  embedding-ranked search. Without it, memory search degrades to substring
  matching — everything else still works.

## Setup order (Claude Code)

This is the verified, primary path. Run it from a clone of this repo.

```bash
# 1. Build the memory server
cd mcp-memory-server
npm install
npm run build
npm test                      # offline smoke tests, no API key required
cd ..

# 2. Register the MCP server with your harness (server name: cairn-memory)
claude mcp add cairn-memory -s user -- node "$PWD/mcp-memory-server/dist/index.js"

# 3. Install the operating layer (commands, agents, hooks, scaffold templates)
scripts/sync-claude-assets.sh --apply

# 4. Scaffold a target project
cairn bootstrap /path/to/project
cp /path/to/project/.ai/env.example /path/to/project/.ai/.env
$EDITOR /path/to/project/.ai/.env    # see "Configuration" below

# 5. Launch the harness in the project
/path/to/project/.ai/start-claude.sh
```

Step 3 installs into `~/.claude` (override with `CLAUDE_CONFIG_DIR` or
`--live-root <path>`):

- **10 commands** → `commands/`: `remember`, `recall`, `memory-sync`,
  `memory-review`, `wiki-ingest`, `wiki-query`, `wiki-lint`, `security-audit`,
  `repo-review`, `graphify`
- **7 agents** → `agents/`: `code-reviewer`, the three `security-*` agents, and
  the three `wiki-*` agents
- **3 hooks** → `hooks/`, registered in `settings.json`:
  - `memory-wakeup.sh` on **SessionStart** — surfaces AgentFS memory + wiki index
  - `memory-capture.sh` on **SessionEnd** — extracts memory candidates to staging
  - `memory-recall.sh` on **PreToolUse** (Edit/Write/MultiEdit) — injects
    file-specific memory before an edit
- **scaffold templates** → `templates/`, used by `/security-audit` and `/wiki-*`

Re-running `sync-claude-assets.sh --apply` is idempotent; use `--check` to see
drift without writing. Run it again whenever you pull changes to `claude/`.

## Setup order (OpenCode)

OpenCode is a secondary path. Steps 1, 4, and 5 are identical (use
`start-opencode.sh` and register `cairn-memory` in your OpenCode MCP config).
The operating-layer assets are installed by topic-specific scripts:

```bash
scripts/sync-opencode-plugin-assets.sh   --apply   # memory-wakeup plugin
scripts/sync-opencode-wiki-assets.sh     --apply   # wiki commands/agents/workflows
scripts/sync-opencode-security-assets.sh --apply   # security-audit chain
scripts/sync-opencode-graphify-assets.sh --apply   # graphify command
```

Each installs into `~/.config/opencode` (override with `OPENCODE_CONFIG_DIR` or
`--live-root`). Note: the `memory-sync`, `memory-review`, and `code-review`
OpenCode commands under `opencode/command/` do not yet have a dedicated sync
script — copy them into your OpenCode `command/` directory manually if you need
them.

## Configuration

All configuration is environment-based (in `.ai/.env`) — the core hardcodes no
vendor or host.

| Variable | Purpose |
|---|---|
| `CAIRN_LLM_API_KEY` | API key for the extraction / embeddings endpoint (unset → substring-only memory) |
| `CAIRN_LLM_API_URL` | Base URL of the OpenAI-compatible endpoint |
| `CAIRN_LLM_EXTRACTION_MODEL` | Chat model for `memory-capture` extraction |
| `CAIRN_MEMORY_EMBEDDING_URL` | Embeddings endpoint (falls back to `CAIRN_LLM_API_URL`) |
| `CAIRN_MEMORY_EMBEDDING_MODEL` | Embedding model name (required for semantic search) |
| `CAIRN_AGENTFS_BASE_DIR` | Base dir for global memory scopes (default `~/.cairnkeep`) |
| `CAIRN_GIT_PROVIDER` | Git host for collaboration commands: `github`\|`gitlab`\|`codeberg`\|`forgejo`\|`none`. See [git-providers.md](git-providers.md) |

## The workflow

Once installed, the operating layer gives you:

**Memory** — durable facts that survive across sessions.
- `/remember <fact>` — persist an accepted finding to AgentFS + file-memory.
- `/recall <topic>` — read across memory layers mid-session.
- The three hooks run automatically: memory is surfaced at session start,
  captured at session end (to a review queue), and injected before file edits.
- `/memory-review` — the accept gate: promote staged candidates to durable
  memory, or discard them.
- `/memory-sync` — reconcile tracked PR/MR state into memory via the configured
  git provider.

**Wiki** — a sparse, citation-heavy derived-knowledge layer under
`.planning/wiki/`.
- `/wiki-ingest <path>` — compile one canonical source into a cited wiki page
  (`--refresh` to re-sync an existing page).
- `/wiki-query <question>` — answer from the wiki first, then canonical sources
  (`--writeback` to save a reusable answer).
- `/wiki-lint` — advisory audit for citation gaps, staleness, and contradictions.

**Security and review.**
- `/security-audit` — a governed local audit (target-selector → investigator →
  validator) that writes findings under `.planning/security/`.
- `/repo-review` — a code review across bugs, security, and maintainability that
  writes `REVIEW.md`.

Raw repository docs, tests, interfaces, and code always remain canonical; the
wiki and memory layers are derived and never overrule them.

## Verifying the install

- Memory server: `cd mcp-memory-server && npm test` (offline smoke tests).
- Claude operating layer: `scripts/sync-claude-assets.sh --check` should report
  no drift after an apply.
- End to end: launch the harness in a bootstrapped project; the SessionStart
  hook should surface a project-memory section, and `/recall test` should return
  from the `cairn-memory` MCP.
