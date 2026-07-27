# Cairnkeep

[![CI](https://github.com/cairnkeep/cairnkeep/actions/workflows/ci.yml/badge.svg)](https://github.com/cairnkeep/cairnkeep/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@cairnkeep/cli)](https://www.npmjs.com/package/@cairnkeep/cli)
[![license](https://img.shields.io/npm/l/@cairnkeep/cli)](LICENSE)

> A durable, harness-agnostic **memory + context layer** for coding agents.

A *cairn* is a stack of stones left as a trail marker for whoever follows; a
*keep* is where you store what matters. **Cairnkeep** is where coding agents
stack durable memory — decisions, pitfalls, patterns — and follow the trail
across sessions, projects, and harnesses (Claude Code, OpenCode, Pi, …).

## Status

Shipped: the memory server, the `cairn` CLI (`bootstrap`, `memory-server`, `sync`, `sync-pi`,
`doctor`, `trajectory`, `artifact`, `notes`, `memory`, `audit-timer`, `completion`, `uninstall`) installable via
`npm i -g @cairnkeep/cli`, and the
operating layer (commands,
agents, hooks) installed on Claude Code and OpenCode, plus a native Pi
trajectory extension. The generic launchers
expose wrapper seams (`.ai/pre-launch.sh`, `CAIRN_EXTRA_SETTINGS`,
`.ai/post-exit.sh`) so an enterprise wrapper can add provider/credential setup
without forking them. Also shipped: context exploration (`/context-explore`) and
a thin routing seam (`route_check`), both of which delegate to
[token-miser](https://github.com/cairnkeep/token-miser), a public
cairnkeep-org sibling project.

## Compatibility

Node.js 22, 24, and 26 are supported. Cairnkeep 2.x requires Node.js 22 or
newer; Cairnkeep 1.x remains available for older runtimes, although Node.js 18
and 20 are end-of-life upstream.

| Client or platform | Support level |
|---|---|
| Claude Code on Linux/macOS | Memory server plus commands, agents, hooks, and launchers |
| OpenCode on Linux/macOS | Memory server plus commands, plugins, hooks, and launchers |
| Pi on Linux/macOS | Native opt-in trajectory extension and launcher; no bundled MCP bridge |
| Codex CLI | Memory MCP server; no Cairnkeep operating-layer assets |
| Other MCP clients | Memory and optional domain-knowledge MCP tools |
| Native Windows | Not supported by the Bash-based installer; use WSL (not yet CI-verified) |

Linux, macOS, Bash 3.2 portability, and clean Node 22/24/26 runtime checks
are exercised in CI.

## Try with Podman

The minimal OCI image runs the memory server as an unprivileged user and keeps
all databases in a named volume:

```bash
podman run --rm -i \
  --userns=keep-id:uid=10001,gid=10001 \
  --read-only --cap-drop=all --security-opt=no-new-privileges \
  --tmpfs=/tmp:rw,noexec,nosuid,size=64m,mode=1777 \
  --volume cairnkeep-data:/data:Z,U \
  ghcr.io/cairnkeep/cairnkeep:latest stdio
```

For persistent authenticated HTTP, rootless Quadlet, isolated workspace mode,
storage paths, secrets, and private derived images, see
**[Containers](docs/containers.md)**.

## Components

- **`mcp-memory-server/`** — an MCP server exposing durable, scoped memory
  (`memory_write`, `memory_search`, …) backed by AgentFS, with optional
  embedding-ranked search against any OpenAI-compatible endpoint.
- **`bin/cairn`** — the CLI. `cairn bootstrap [path]` scaffolds a project's
  `.ai/` launchers + env; `cairn doctor` health-checks the configured pieces;
  `cairn trajectory list|show|prune` manages opt-in local session trajectories;
  `cairn artifact list|show|delete|prune` manages opt-in local artifacts;
  `cairn notes distill|search-error|promote|doctor` compiles and searches
  default-off local hindsight notes outside the online agent path;
  `cairn memory export|import` relocates the durable store between machines
  (`export` requires the optional `sqlite3` CLI);
  `cairn audit-timer` installs the scheduled memory+wiki audit;
  `cairn completion bash|zsh|fish` generates shell completion definitions; and
  `cairn sync-pi` installs the native Pi trajectory extension;
  `cairn uninstall` reverses the install (backup-first, revertible).
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

For Pi, install the local trajectory adapter and use the scaffolded launcher:

```bash
cairn sync-pi --apply
cairn bootstrap /path/to/project
cd /path/to/project && ./.ai/start-pi.sh
```

This installs trajectory capture only. Cairnkeep does not bundle or select a Pi
MCP bridge; configure a user-chosen bridge separately if you also want the MCP
memory tools inside Pi.

Closed trajectories can be compiled into local hindsight notes without a model
or embedding service. Capture and distillation are separate opt-ins:

```bash
export CAIRN_TRAJECTORY_CAPTURE=1     # affects future closed sessions
export CAIRN_NOTE_DISTILLATION=1
cairn notes distill --project /path/to/project --json
printf '%s\n' 'TypeError: example' | cairn notes search-error --project /path/to/project --json
```

Notes keep deterministic failure, resolution, abandonment, and recurrence
history under `~/.cairnkeep/notes/`. Shared promotion is never automatic: it
requires compatible evidence from two distinct projects and an explicit
`cairn notes promote NOTE-ID --with NOTE-ID --confirm`. See the
[operating guide](docs/operating.md#hindsight-notes-opt-in) before enabling
optional model enrichment.

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
  (`--settings` for Claude Code, `--config` for OpenCode). Pi has no equivalent
  generic settings-file flag, so its launcher leaves this variable unused.
  Process env still wins, so an inline value beats the profile.
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
| `CAIRN_MEMORY_EMBEDDING_TIMEOUT_MS` | Embedding request timeout before substring fallback (default `15000`) |
| `CAIRN_AGENTFS_BASE_DIR` | Base dir for global memory scopes (default `~/.cairnkeep`) |
| `CAIRN_TRAJECTORY_CAPTURE` | Opt in to local structured session capture (`1`, `true`, `yes`, or `on`; default off) |
| `CAIRN_TRAJECTORY_SESSION_MAX_BYTES` | Maximum serialized bytes per captured session (default `5242880`, 5 MiB) |
| `CAIRN_TRAJECTORY_STORE_MAX_BYTES` | Maximum logical bytes across local trajectories (default `268435456`, 256 MiB) |
| `CAIRN_TRAJECTORY_RETENTION_DAYS` | Retain captured sessions for this many days (default `30`) |
| `CAIRN_TRAJECTORY_REDACTION_FILE` | Optional project-contained redaction config (default `.ai/trajectory-redaction.json` when present) |
| `CAIRN_REDACTION_FILE` | Optional project-contained redaction config shared by trajectories and artifacts (falls back to `CAIRN_TRAJECTORY_REDACTION_FILE`) |
| `CAIRN_COMPACTION_CAPTURE` | Opt in to local harness-produced compaction capture and fresh-session recovery (off by default) |
| `CAIRN_ARTIFACT_STORE` | Expose four local stdio artifact tools (off by default; independent of compaction capture) |
| `CAIRN_ARTIFACT_HTTP` | Separately consent to artifact tools over authenticated HTTP (off by default; also requires `CAIRN_ARTIFACT_STORE`) |
| `CAIRN_ARTIFACT_MAX_BYTES` | Maximum stored bytes per artifact (default `1048576`, 1 MiB) |
| `CAIRN_ARTIFACT_SESSION_MAX_BYTES` | Maximum logical bytes per artifact session (default `16777216`, 16 MiB) |
| `CAIRN_ARTIFACT_STORE_MAX_BYTES` | Maximum logical bytes in one artifact store (default `268435456`, 256 MiB) |
| `CAIRN_ARTIFACT_RETENTION_DAYS` | Artifact age retention (default `30`) |
| `CAIRN_COMPACTION_MAX_REVISIONS` | Retained compaction revisions per session (default `8`) |
| `CAIRN_ARTIFACT_GENERATED_FILE_SNAPSHOT_MAX_BYTES` | Generated-file inline snapshot cap (default `262144`, 256 KiB; lower if the artifact cap is lower) |
| `CAIRN_NOTE_DISTILLATION` | Opt in to one-shot/scheduled local note distillation and lookup (default off) |
| `CAIRN_NOTE_ENRICHMENT` | Separately opt in to remote/local prose enrichment; never implied by credentials (default off) |
| `CAIRN_NOTE_ENRICHMENT_MODEL` | Explicit chat model for optional note enrichment (no default) |
| `CAIRN_NOTE_ENRICHMENT_TIMEOUT_MS` | Optional enrichment timeout (default `15000`) |
| `CAIRN_TYPED_MEMORY_NODES` | Opt in to typed metadata, filters, logical note address spaces, and `memory_import` (default off; restart the server after changing) |
| `CAIRN_CAPABILITY_CONTRACT` | Opt in to the managed eight-capability contract (default off) |
| `CAIRN_CAPABILITY_LOGGING` | Override payload-free local callback logging (`1`/`0`; default off) |
| `CAIRN_CAPABILITY_MEMORY_WRITE` | Override `memory.write` for this process |
| `CAIRN_CAPABILITY_MEMORY_SEARCH` | Override `memory.search` for this process |
| `CAIRN_CAPABILITY_NOTES_DISTILL` | Override `notes.distill` for this process |
| `CAIRN_CAPABILITY_WIKI` | Override `wiki` for this process |
| `CAIRN_CAPABILITY_GRAPH` | Override `graph` for this process |
| `CAIRN_CAPABILITY_SECURITY_AUDIT` | Override `security.audit` for this process |
| `CAIRN_CAPABILITY_ROUTE_CHECK` | Override `route.check` for this process |
| `CAIRN_CAPABILITY_CONTEXT_EXPLORE` | Override `context.explore` for this process |
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

### Managed capability contract (opt-in)

`CAIRN_CAPABILITY_CONTRACT=1` enables one versioned, typed boundary around the
existing capability owners. The master flag and callback logging are both off
by default. With the master flag unset, MCP registration, installed
Markdown/workflow bytes, commands, processes, configuration reads, logging,
output, and performance remain on the legacy path.

| Capability ID | Kind | Existing owner | Compatibility default | Process override |
|---|---|---|---:|---|
| `memory.write` | MCP tool | `memory_write` | on | `CAIRN_CAPABILITY_MEMORY_WRITE` |
| `memory.search` | MCP tool | `memory_search` | on | `CAIRN_CAPABILITY_MEMORY_SEARCH` |
| `notes.distill` | offline job | note distillation CLI/timer | off | `CAIRN_CAPABILITY_NOTES_DISTILL` |
| `wiki` | operating workflow | installed wiki commands/workflows | on | `CAIRN_CAPABILITY_WIKI` |
| `graph` | operating workflow | installed graph commands | inherited from `graphify.enabled`, otherwise off | `CAIRN_CAPABILITY_GRAPH` |
| `security.audit` | operating workflow | installed security commands/workflows | on | `CAIRN_CAPABILITY_SECURITY_AUDIT` |
| `route.check` | MCP tool | existing token-miser routing delegate | on | `CAIRN_CAPABILITY_ROUTE_CHECK` |
| `context.explore` | MCP tool | existing token-miser exploration delegate | on | `CAIRN_CAPABILITY_CONTEXT_EXPLORE` |

Manage project overrides in `.ai/capabilities.json` through the CLI rather than
editing JSON:

```bash
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities list
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities status --json
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities disable context.explore
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities reset context.explore
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities logging enable
```

Process overrides take precedence over project values, which take precedence
over compatibility defaults. `reset` removes an explicit override and restores
the inherited state; it does not mean enabled. Changes to the four MCP
capabilities (`memory.write`, `memory.search`, `route.check`, and
`context.explore`) require a fresh memory-server start and disabled tools are
omitted from `tools/list`. Offline and operating workflows resolve state at
each invocation. Enabling the master does not enable `notes.distill` or graph
when their compatibility inputs remain off.

Callback records are local, payload-free operating evidence, not evaluation
results or telemetry. They require the contract, callback logging, and local
trajectory capture to be enabled together. Cairnkeep makes no capability gain,
memory-quality, or efficiency claim from this instrumentation; Phase 19 must
first create an explicit all-enabled baseline and measure one-disabled states.
See the [operating guide](docs/operating.md#managed-capability-contract-opt-in),
[storage contract](docs/storage.md#capability-callback-storage), and
[privacy flow](docs/privacy-and-data-flow.md#capability-callback-flow).

### Typed memory nodes and structured import (opt-in)

`CAIRN_TYPED_MEMORY_NODES=1` adds schema-v1 `node_type`, canonical `tags`,
`address_space`, hard list/search filters (`node_types`, `tags_all`,
`tags_any`), and exactly one new MCP tool: `memory_import`. The flag is read
when each server/session is created, so restart after changing it. Unset keeps
the existing 14 tools, schemas, response roots, raw values, files, processes,
network behavior, and output unchanged. It adds no read/edit/update/delete
aliases; `memory_supersede` remains the sole edit operation.

Core types are `memory`, `knowledge`, `hindsight`, `shared`, and `provenance`;
extensions use a namespaced form such as `team:runbook`. Tags are ASCII
lowercase, with whitespace and underscores normalized to hyphens, deduplicated,
and sorted. Filters are applied before ranking. Exact key/tag/type hits precede
semantic results; without a working configured embedding endpoint, search uses
stable local substring matching.

`memory_import` accepts one inline schema-v1 batch for one concrete scope and
one `memory`, `project-notes`, or `shared-notes` address. It supports 1–256
unique relative keys, values up to 256 KiB each and 5 MiB total, optional
`import_id`, `dry_run`, and `conflict_policy: reject|supersede`. Results contain
only digests, counts, keys, and actions—never supplied values. The default
reject policy cannot overwrite; explicit supersede preserves typed history.
Note addresses require `scope: project` and logical keys, never filesystem
paths. See the [operating guide](docs/operating.md#typed-memory-nodes-and-note-address-spaces-opt-in).

### Compaction continuity and artifacts (opt-in)

`CAIRN_COMPACTION_CAPTURE=1` captures only harness-produced compaction summaries
from the pinned Claude Code `PostCompact` 2.1.219 and 2.1.220 payloads and
OpenCode `session.compacted` 1.17.20 seam. It stores redacted immutable revisions locally and injects the latest
valid structured goals, decisions, TODOs, and critical errors when a session
starts. A resumed session is preferred; a fresh session falls back to the
newest valid project summary and marks stale context for validation. The raw
redacted summary is available only through an explicit read. Cairnkeep never
generates or triggers compaction.

`CAIRN_ARTIFACT_STORE=1` independently exposes exactly four stdio MCP tools:
`artifact_write`, `artifact_read`, `artifact_list`, and `artifact_delete`.
The initial kinds are exactly `compaction_summary`, `diff`, `test_output`, and
`generated_file`. Generated-file paths are labels only; the server never reads
them. Operators can inspect retained local data whether or not MCP writes are
currently enabled:

```bash
cairn artifact list --kind compaction_summary --json
cairn artifact show ARTIFACT-ID --json
cairn artifact delete ARTIFACT-ID --dry-run --json
cairn artifact prune --dry-run --include-protected --json
```

Both capabilities are default-off, local, and require no key, model, endpoint,
telemetry, or network. Remote tools require double consent:
`CAIRN_ARTIFACT_STORE=1` plus `CAIRN_ARTIFACT_HTTP=1`, as well as the existing
bearer, `Host`, and validated `X-Cairn-Project` controls. Artifact HTTP never
exposes trajectory data. See the [operating guide](docs/operating.md#compaction-continuity-and-artifacts-opt-in),
[storage contract](docs/storage.md#artifact-storage), and
[privacy flows](docs/privacy-and-data-flow.md#compaction-and-artifact-flows).

## More

- **Guided learning paths and video scripts** — [docs/learning/README.md](docs/learning/README.md)
- **Optional document RAG** (`domain_knowledge_*` via AnythingLLM) — [docs/domain-knowledge.md](docs/domain-knowledge.md)
- **Building a private overlay** (wrap cairnkeep for your org/provider) — [docs/building-an-overlay.md](docs/building-an-overlay.md)
- **Managed overlay distributions** (wrapper CLI, policy lock, private registry, rollback) — [docs/overlay-distributions.md](docs/overlay-distributions.md)
- **Full operating guide** — [docs/operating.md](docs/operating.md)
- **Memory storage and deployment** — [docs/storage.md](docs/storage.md)
- **Podman and OCI containers** — [docs/containers.md](docs/containers.md)
- **Privacy and data flow** — [docs/privacy-and-data-flow.md](docs/privacy-and-data-flow.md)
- **Git providers** — [docs/git-providers.md](docs/git-providers.md)
- **Support** — [SUPPORT.md](SUPPORT.md)
- **Contributing** — [CONTRIBUTING.md](CONTRIBUTING.md)
- **Security policy** — [SECURITY.md](SECURITY.md)

## License

Apache-2.0 © 2026 Stefano Tondo
