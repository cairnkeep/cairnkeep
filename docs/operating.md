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

- **11 commands** → `commands/`: `remember`, `recall`, `memory-sync`,
  `memory-review`, `wiki-ingest`, `wiki-query`, `wiki-lint`, `security-audit`,
  `repo-review`, `graphify`, `context-explore`
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
scripts/sync-opencode-memory-assets.sh   --apply   # memory-sync/review + code-review
scripts/sync-opencode-wiki-assets.sh     --apply   # wiki commands/agents/workflows
scripts/sync-opencode-security-assets.sh --apply   # security-audit chain
scripts/sync-opencode-graphify-assets.sh --apply   # graphify command
scripts/sync-opencode-explore-assets.sh --apply    # context-explore command
```

Each installs into `~/.config/opencode` (override with `OPENCODE_CONFIG_DIR` or
`--live-root`) and is idempotent — re-run with `--check` to see drift without
writing.

**No Claude install required.** The OpenCode memory-wakeup plugin is self-sufficient
of Claude assets — it surfaces AgentFS project memory natively via OpenCode's own
`experimental.chat.system.transform` hook and never reads `~/.claude`.

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
| `CAIRN_ROUTE_ENDPOINT` | Base URL of an already-running token-miser routing/tiering proxy (unset → the `route_check` tool is inert) |
| `CAIRN_EXPLORE_BINARY` | Absolute path to the `token_miser` binary used by `context_explore` (unset → the tool throws at call time) |
| `CAIRN_EXPLORE_REPO_ROOT` | Default repo root for `context_explore` when no per-call `repo_root` is given (unset + no param → the tool throws) |
| `CAIRN_EXPLORE_CACHE` | Caches `context_explore` results keyed on query + repo HEAD + dirty-state; default ON, set to `0` to disable |
| `CAIRN_EXPLORE_AUTOINVOKE` | Opt-in flag for the `UserPromptSubmit` pre-task hook; set to `1` together with `CAIRN_EXPLORE_BINARY` to let the hook auto-invoke `context_explore` for each task prompt (unset -> inert, no hook behavior) |

### Routing seam (`route_check`, opt-in)

`route_check` is a thin MCP tool that checks whether an external token-miser
routing/tiering proxy is reachable. It hosts no proxy, endpoint list, model
list, or tier config itself — the proxy runs elsewhere and `route_check` only
confirms the wire to it is live. This is the full contract; no source reading
required.

- **Reads exactly one env var:** `CAIRN_ROUTE_ENDPOINT`. Unset or malformed
  (fails `new URL(...)`) → the tool throws at call time.
- **Issues exactly one request:** `GET {CAIRN_ROUTE_ENDPOINT}/health`, with a
  short per-call timeout (`timeout_seconds`, default 10s).
- **Execution-tier failures** (connection refused, non-2xx status, malformed
  JSON body, or timeout) never throw — they return `{ ok: false, error, ... }`.
- **Success** (2xx + parseable JSON) returns
  `{ ok: true, status, cluster_healthy }`.

**What it does NOT do:** it does not drive `/v1/chat/completions` or
`/v1/messages` — it never sends chat/messages traffic itself, only an
overlay that owns real routing decisions does that. It does not report which
tier serves a request, or any tier/model/endpoint configuration at all — a
`/health` 200 proves the proxy process is alive and reachable, not that a
routing decision was exercised.

The proxy this seam talks to is owned by
[token-miser](https://github.com/cairnkeep/token-miser), a public
cairnkeep-org sibling project.

`scripts/verify-routing-seam.sh` proves this against the real token_miser
binary (not a mock) — see the script's `--help` for usage.

### Exploration cache (`context_explore`, on by default)

`context_explore` caches its result keyed on (normalized query, resolved
repo_root, `git rev-parse HEAD`, and a content-sensitive dirty-state hash
over `git diff HEAD` plus untracked-file size/mtime). A second identical
call against an unchanged repo returns `cached: true` and never re-spawns
the `token_miser` binary; any repo change — a tracked-file edit, a staged
change, or a new untracked file — invalidates the entry and forces a fresh
invocation. Entries live under `${XDG_CACHE_HOME:-~/.cache}/cairn/explore/`,
never inside the explored repo, with an oldest-first prune once the
directory holds more than ~200 entries. Set `CAIRN_EXPLORE_CACHE=0` to
disable caching entirely (every call spawns the binary, always
`cached: false`). The cache stores only the raw citations/stats the binary
returned — nothing else is layered on top of a cached entry.

`node dist/index.js explore "<query>"` runs the exact same code path as the
MCP tool (shared `runContextExplore()`), so a pre-task hook or any other
script-driven caller gets identical cache behavior without an MCP session.

### Citation cross-referencing (`context_explore`, always on)

Every `context_explore` citation is cross-referenced against the explored
repo's own project memory and `.planning/wiki/sources/*.md` pages: for each
cited path with a basename stem of at least 4 characters, a case-insensitive
substring match against memory entries and wiki pages attaches `memory_refs`/
`wiki_refs` to that citation and appends a compact `<- memory: ... - wiki: ...`
marker to its rendered line. Cross-refs are recomputed on every call (cache
hit or miss alike, since memory/wiki evolve independently of repo HEAD) and
fail open — a missing `.agentfs` database or wiki directory, or any read
error, simply yields no refs. A citation with no hits gets no marker at all,
so a result with zero cross-ref hits renders byte-identical to a result from
before this feature existed.

### Pre-task auto-invoke hook (`context_explore`, opt-in, Claude Code only)

Claude Code's `UserPromptSubmit` hook `context-explore-pretask.sh` can
auto-invoke `context_explore` for a task's prompt with no manual
`/context-explore` call — it supplements the manual command, it does not
replace it. It is double opt-in: inert unless both `CAIRN_EXPLORE_BINARY`
and `CAIRN_EXPLORE_AUTOINVOKE=1` are set. When active, it also skips
low-signal prompts (too short, a slash command, or a bare acknowledgement
like "ok"/"thanks") so it only fires on task-shaped prompts. It shells out to
the same `explore` CLI subcommand described above with an explicit ~20s
timeout — well inside Claude Code's own hook budget — and injects only
compact `path:start-end` citations plus their cross-ref flags (never the
full expanded snippets) as `additionalContext`, prefixed so the model knows
the context was auto-invoked. Any error (timeout, missing binary, malformed
output) injects nothing; the hook always exits 0.

**Known gap:** OpenCode currently exposes no plugin event that delivers the
user's message text before the LLM call runs, so this auto-invoke hook is a
Claude-Code-only path this milestone — there is no OpenCode parity plugin.

### HTTP transport (opt-in, network-facing)

The server runs over stdio by default. Setting `MCP_HTTP_PORT` switches it to a
streamable HTTP transport so one long-lived process can serve many clients — but
because that exposes every memory tool over the network, HTTP mode is guarded and
**fails closed**:

| Variable | Purpose |
|---|---|
| `MCP_HTTP_PORT` | Enable HTTP mode on this port (unset → stdio) |
| `MCP_HTTP_HOST` | Bind address (default `127.0.0.1`) |
| `CAIRN_MEMORY_HTTP_TOKEN` | **Required** in HTTP mode — clients send `Authorization: Bearer <token>`; the server refuses to start without it |
| `CAIRN_MEMORY_HTTP_ALLOWED_ORIGINS` | Comma-separated browser origins allowed via CORS (default: none — no cross-origin access) |
| `CAIRN_MEMORY_HTTP_ALLOWED_HOSTS` | Comma-separated allowed `Host` headers for DNS-rebinding protection (default: the bind host + `localhost` on the chosen port) |

Requests without a valid bearer token get `401`; requests with an unexpected
`Host` header get `403`. Keep HTTP mode bound to `127.0.0.1` unless you have a
specific reason to expose it, and use a long random token.

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

**Context exploration.**
- `/context-explore <query>` — delegates to the external `token_miser explore`
  subprocess and relays compact path:line-range citations; owned by
  [token-miser](https://github.com/cairnkeep/token-miser), the public
  cairnkeep-org sibling, and holds no endpoint/model config of its own.
- Citations are cross-referenced against project memory and the wiki, results
  are cached keyed on the query + repo HEAD/dirty-state, and (Claude Code
  only, opt-in) a pre-task hook can auto-invoke exploration for a task's
  prompt with no manual call — see "Citation cross-referencing",
  "Exploration cache", and "Pre-task auto-invoke hook" above.

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
- OpenCode operating layer: `scripts/sync-opencode-explore-assets.sh --check`
  (and the other `sync-opencode-*-assets.sh --check` siblings) should report no
  drift after an apply — a manual sanity check, not a CI job.
- End to end: launch the harness in a bootstrapped project; the SessionStart
  hook should surface a project-memory section, and `/recall test` should return
  from the `cairn-memory` MCP.
