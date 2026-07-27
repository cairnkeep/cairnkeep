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

- Node.js 22 or newer (for the memory server) and a supported harness: Claude
  Code, OpenCode, or Pi.
- Optional: the `sqlite3` CLI for `cairn memory export`. Runtime memory and
  `cairn memory import` do not require it.
- Optional: an OpenAI-compatible LLM endpoint for memory extraction and
  embedding-ranked search. Without it, memory search degrades to substring
  matching — everything else still works.
- Optional: rootless Podman for the containerized memory server and isolated
  workspace base described in [Containers](containers.md).

## Shell completion

Generate completion definitions directly from the CLI:

```bash
cairn completion bash
cairn completion zsh
cairn completion fish
```

Distributions can install these outputs into the platform's normal completion
directories. They can also be loaded for the current shell, for example with
`source <(cairn completion bash)`.

## Setup order (Claude Code)

The commands below install the default local topology: `cairn-memory` runs as a
stdio child process and writes SQLite databases on this computer. Nothing in
the installer discovers or selects a remote host. Read
[Memory storage and deployment](storage.md) before choosing remote HTTP mode.

**Via npm** (simplest — everything is on `PATH` as `cairn`):

```bash
npm install -g @cairnkeep/cli
claude mcp add cairn-memory -s user -- cairn memory-server
cairn sync --apply                       # operating layer into ~/.claude
cairn bootstrap /path/to/project         # add --untracked if you don't own the repo
cp /path/to/project/.ai/env.example /path/to/project/.ai/.env && $EDITOR "$_"
cd /path/to/project && cairn doctor && ./.ai/start-claude.sh
```

**From a clone** (equivalent; use the in-repo scripts):

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
bin/cairn bootstrap /path/to/project
cp /path/to/project/.ai/env.example /path/to/project/.ai/.env
$EDITOR /path/to/project/.ai/.env    # see "Configuration" below
# Not the repo's owner? Add --untracked to keep the scaffold out of git
# entirely (written to .git/info/exclude; local-only, nothing to commit).

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
- **5 hooks** → `hooks/`, registered in `settings.json`:
  - `memory-wakeup.sh` on **SessionStart** — surfaces AgentFS memory + wiki index
  - `memory-capture.sh` on **SessionEnd** — extracts memory candidates to staging
  - `memory-recall.sh` on **PreToolUse** (Edit/Write/MultiEdit) — injects
    file-specific memory before an edit
  - `context-explore-pretask.sh` on **UserPromptSubmit** — inert unless the
    separate context-exploration opt-in is enabled
  - `compaction-capture.sh` on **PostCompact** — inert unless local compaction
    continuity is enabled
- **scaffold templates** → `templates/`, used by `/security-audit` and `/wiki-*`

Re-running `sync-claude-assets.sh --apply` is idempotent; use `--check` to see
drift without writing. Run it again whenever you pull changes to `claude/`.

To keep the memory-server runtime in a container, install the npm package for
the launcher and replace the registration command with:

```bash
claude mcp add cairn-memory -s user -- cairn-container stdio
```

This still stores memory locally, in the `cairnkeep-data` Podman volume. It
does not configure remote HTTP storage or containerize the harness. See
[Containers](containers.md) for those separate deployment choices.

## Setup order (OpenCode)

OpenCode is a secondary path. Steps 1, 4, and 5 are identical (use
`start-opencode.sh` and register `cairn-memory` in your OpenCode MCP config).
The operating-layer assets are installed by topic-specific scripts:

```bash
scripts/sync-opencode-plugin-assets.sh   --apply   # memory wakeup/capture/recall plugins
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

### Headless round-trip harness — model precondition

`scripts/verify-opencode-live-parity.sh` proves the `/remember`→`/recall`
round-trip against a real, registered `cairn-memory` MCP server. Reliable
headless reproduction of that round-trip requires **a no-thinking,
tool-call-reliable local model** — the publicly-known model that has passed
is `qwen3.5-27b`. A thinking model that narrates pseudo-tool-call syntax
instead of emitting real `tool_use` events will not pass, and no amount of
retry fixes that — retry in this harness only absorbs opencode's own
run-completion flakiness, never a model that fails to call tools for real.

Model selection stays operator-env-driven through the existing
`CAIRN_LLM_API_KEY` / `CAIRN_LLM_API_URL` / `CAIRN_LLM_EXTRACTION_MODEL`
variables (see "Configuration" below) — the harness commits no default model
and carries no known-good allowlist.

## Setup order (Pi)

Pi trajectory capture uses the same project scaffold and store, but its source
is a native TypeScript extension installed into Pi's agent root:

```bash
npm install -g @cairnkeep/cli
cairn sync-pi --apply                    # default: ~/.pi/agent
cairn bootstrap /path/to/project
cp /path/to/project/.ai/env.example /path/to/project/.ai/.env
cd /path/to/project && cairn doctor && ./.ai/start-pi.sh
```

This command does not install an MCP bridge. Cairnkeep does not own or select a
Pi bridge; if you want `cairn memory-server` tools inside Pi as well, configure
a user-chosen Pi extension/bridge separately.

Use `cairn sync-pi --check` to report drift without writing, or
`--live-root DIR` to target an isolated Pi agent root. The command owns exactly
`extensions/cairnkeep-trajectory.ts`; `cairn uninstall --pi-live-root DIR`
removes that file backup-first and leaves every other Pi asset untouched.

The extension listens for Pi's native `session_shutdown` event and reads only
the active branch from the read-only session manager. It returns before doing
that work unless `CAIRN_TRAJECTORY_CAPTURE` is explicitly enabled. Capture is
local, fail-open, and capped at three seconds so it cannot hold Pi open.

Before burning a multi-run soak, a preflight probe drives one real tool call
and fails fast with a trait-named message if the configured model is not
tool-call-reliable. The harness keeps a three-tier speed structure:
`--stage wakeup` (fastest per-commit signal), `--full` (one-shot regression
of every stage), and `--repeat N` — e.g. `scripts/verify-opencode-live-parity.sh --repeat 5`
— the slow reliability soak that runs N independent cold reproductions of the
round-trip stage; run it to confirm reliability, not on every commit.

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
| `CAIRN_MEMORY_EMBEDDING_TIMEOUT_MS` | Embedding request timeout before substring fallback (default `15000`) |
| `CAIRN_AGENTFS_BASE_DIR` | Server-side base dir for named/global memory scopes (default `~/.cairnkeep`); it does not affect `project` scope |
| `CAIRN_TRAJECTORY_CAPTURE` | Opt in to local structured session capture (`1`, `true`, `yes`, or `on`; unset/default → no capture work) |
| `CAIRN_TRAJECTORY_SESSION_MAX_BYTES` | Maximum serialized bytes per session (default `5242880`, 5 MiB; minimum 1024) |
| `CAIRN_TRAJECTORY_STORE_MAX_BYTES` | Logical local trajectory budget (default `268435456`, 256 MiB; must be at least the session maximum) |
| `CAIRN_TRAJECTORY_RETENTION_DAYS` | Age retention applied on capture/prune (default `30`; `0` removes sessions once they are older than the current instant) |
| `CAIRN_TRAJECTORY_REDACTION_FILE` | Optional redaction JSON path contained by the project (default `.ai/trajectory-redaction.json` when that file exists) |
| `CAIRN_REDACTION_FILE` | Optional project-contained redaction JSON shared by trajectories and artifacts; takes precedence over `CAIRN_TRAJECTORY_REDACTION_FILE` |
| `CAIRN_COMPACTION_CAPTURE` | Opt in to supported local compaction capture and automatic structured recovery (off by default; unset means zero new work) |
| `CAIRN_ARTIFACT_STORE` | Expose the four local stdio artifact tools (off by default; independent of compaction capture) |
| `CAIRN_ARTIFACT_HTTP` | Separately expose artifact tools over authenticated HTTP (off by default; also requires `CAIRN_ARTIFACT_STORE`) |
| `CAIRN_ARTIFACT_MAX_BYTES` | Per-artifact stored-byte cap (default `1048576`, minimum `1024`) |
| `CAIRN_ARTIFACT_SESSION_MAX_BYTES` | Per-session logical-byte cap (default `16777216`; at least the artifact cap) |
| `CAIRN_ARTIFACT_STORE_MAX_BYTES` | Total logical-byte cap (default `268435456`; at least the session cap) |
| `CAIRN_ARTIFACT_RETENTION_DAYS` | Age retention in days (default `30`, minimum `0`) |
| `CAIRN_COMPACTION_MAX_REVISIONS` | Immutable compaction revisions retained per session (default `8`, minimum `1`) |
| `CAIRN_ARTIFACT_GENERATED_FILE_SNAPSHOT_MAX_BYTES` | Generated-file inline snapshot cap (default `262144`; effective cap is the lower of this and the artifact cap) |
| `CAIRN_NOTE_DISTILLATION` | Master opt-in for local one-shot/scheduled hindsight distillation and exact lookup (unset/default → disabled before I/O) |
| `CAIRN_NOTE_ENRICHMENT` | Separate opt-in for provider prose enrichment; credentials alone never enable it |
| `CAIRN_NOTE_ENRICHMENT_MODEL` | Explicit OpenAI-compatible chat model for note enrichment (no default) |
| `CAIRN_NOTE_ENRICHMENT_TIMEOUT_MS` | Enrichment timeout in milliseconds (default `15000`, allowed `100`–`120000`) |
| `CAIRN_TYPED_MEMORY_NODES` | Add typed metadata, filters, logical note address spaces, and `memory_import` (unset/default off; restart after changing) |
| `CAIRN_CAPABILITY_CONTRACT` | Enable the managed eight-capability contract (unset/default off) |
| `CAIRN_CAPABILITY_LOGGING` | Strict per-process callback-logging override (`1`/`0`; compatibility default off) |
| `CAIRN_CAPABILITY_MEMORY_WRITE` | Strict per-process override for `memory.write` |
| `CAIRN_CAPABILITY_MEMORY_SEARCH` | Strict per-process override for `memory.search` |
| `CAIRN_CAPABILITY_NOTES_DISTILL` | Strict per-process override for `notes.distill` |
| `CAIRN_CAPABILITY_WIKI` | Strict per-process override for `wiki` |
| `CAIRN_CAPABILITY_GRAPH` | Strict per-process override for `graph` |
| `CAIRN_CAPABILITY_SECURITY_AUDIT` | Strict per-process override for `security.audit` |
| `CAIRN_CAPABILITY_ROUTE_CHECK` | Strict per-process override for `route.check` |
| `CAIRN_CAPABILITY_CONTEXT_EXPLORE` | Strict per-process override for `context.explore` |
| `CAIRN_GIT_PROVIDER` | Git host for collaboration commands: `github`\|`gitlab`\|`codeberg`\|`forgejo`\|`none`. See [git-providers.md](git-providers.md) |
| `CAIRN_ROUTE_ENDPOINT` | Base URL of an already-running token-miser routing/tiering proxy (unset → the `route_check` tool is inert) |
| `CAIRN_EXPLORE_BINARY` | Absolute path to the `token_miser` binary used by `context_explore` (unset → the tool throws at call time) |
| `CAIRN_EXPLORE_REPO_ROOT` | Default repo root for `context_explore` when no per-call `repo_root` is given (unset + no param → the tool throws) |
| `CAIRN_EXPLORE_CACHE` | Caches `context_explore` results keyed on query + repo HEAD + dirty-state; default ON, set to `0` to disable |
| `CAIRN_EXPLORE_AUTOINVOKE` | Opt-in flag for the `UserPromptSubmit` pre-task hook; set to `1` together with `CAIRN_EXPLORE_BINARY` to let the hook auto-invoke `context_explore` for each task prompt (unset -> inert, no hook behavior) |
| `ANYTHINGLLM_API_KEY` | Required to enable the optional `domain_knowledge_*` RAG tools (unset → those tools error at call time; nothing else affected). See [domain-knowledge.md](domain-knowledge.md) |
| `ANYTHINGLLM_BASE_URL` | AnythingLLM base URL for `domain_knowledge_*` (default `http://localhost:3001`) |
| `CAIRN_ANYTHINGLLM_SYNC_SCRIPT` | Override path to the `domain_knowledge_sync` document-sync script (unset → in-repo default) |
| `CAIRN_ANYTHINGLLM_PROJECTS_FILE` | Override path to the bundled sync script's project configuration |
| `CAIRN_ANYTHINGLLM_STATE_FILE` | Override path to the bundled sync script's incremental state |

### Managed capability contract (opt-in)

The managed contract is a narrow state and measurement boundary around eight
existing owners. It adds no runtime dependency and does not move business logic
from the MCP server, note CLI/timer, installed workflows, or the external
token-miser delegates.

The canonical registry is exactly:

| ID | Kind | Owner | Compatibility default | Environment override | Restart required |
|---|---|---|---:|---|---:|
| `memory.write` | `mcp-tool` | `mcp-memory-server:index#memory_write` | on | `CAIRN_CAPABILITY_MEMORY_WRITE` | yes |
| `memory.search` | `mcp-tool` | `mcp-memory-server:index#memory_search` | on | `CAIRN_CAPABILITY_MEMORY_SEARCH` | yes |
| `notes.distill` | `offline-job` | `mcp-memory-server:note-cli#distill` | `CAIRN_NOTE_DISTILLATION`, otherwise off | `CAIRN_CAPABILITY_NOTES_DISTILL` | no |
| `wiki` | `operating-workflow` | `operating-layer:wiki` | on | `CAIRN_CAPABILITY_WIKI` | no |
| `graph` | `operating-workflow` | `operating-layer:graph` | `.planning/config.json` `graphify.enabled`, otherwise off | `CAIRN_CAPABILITY_GRAPH` | no |
| `security.audit` | `operating-workflow` | `operating-layer:security-audit` | on | `CAIRN_CAPABILITY_SECURITY_AUDIT` | no |
| `route.check` | `mcp-tool` | `mcp-memory-server:index#route_check` | on | `CAIRN_CAPABILITY_ROUTE_CHECK` | yes |
| `context.explore` | `mcp-tool` | `mcp-memory-server:index#context_explore` | on | `CAIRN_CAPABILITY_CONTEXT_EXPLORE` | yes |

`CAIRN_CAPABILITY_CONTRACT` is the default-off rollout gate. When it is unset,
the launchers and sync commands retain byte-identical legacy installed
Markdown/workflow assets and add no capability command, process, configuration,
digest, logging, or store work. With it enabled at launch, the Claude and
OpenCode launchers render isolated guarded overlays under
`.ai/capability-contract/` and select those harness roots. Every direct command
and directly invokable workflow in those overlays checks effective state before
directory, process, delegate, or owner-output work, so a workflow cannot bypass
the guard by being invoked directly. Normal installed assets remain in place;
toggling never deletes configuration, retained data, or installed files.

Bootstrap creates a mode-`0600` `.ai/capabilities.json` only if it is absent:

```json
{
  "schema_version": 1,
  "capabilities": {},
  "logging": { "callbacks": false }
}
```

Use the managed CLI; do not hand-edit the file:

```bash
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities list
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities status
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities status --json
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities enable wiki
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities disable memory.search
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities reset memory.search
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities reset --all
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities logging enable
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities logging disable
CAIRN_CAPABILITY_CONTRACT=1 cairn capabilities logging reset
```

Precedence is strict: the derived per-capability environment value (or
`CAIRN_CAPABILITY_LOGGING`) wins over the project value, which wins over the
compatibility resolver. Every derived key uses the `CAIRN_CAPABILITY_` prefix
followed by the uppercased ID with dots replaced by underscores. Accepted
values are `1|true|yes|on` and
`0|false|no|off`, case-insensitively. An invalid top-level value is reported
with a fixed value-free issue and falls directly back to compatibility; it does
not reveal the raw value or consult a lower project override. Unknown IDs and
invalid project rows are likewise reported without their values. Each bad row
falls back independently, so it cannot disable another capability or the
server.

`reset` removes the explicit override; `reset --all` clears every capability
and logging override. The returned schema-v1 status orders all eight rows and
reports `enabled`, `source` (`environment`, `project`, or `compatibility`),
`restart_required`, contract/logging state, fixed issue codes, and the SHA-256
`configuration_digest` of the canonical effective snapshot. The digest is
evidence, not a signature or secret. MCP state is resolved once before server
registration, so changes to `memory.write`, `memory.search`, `route.check`, or
`context.explore` require a new server start; a disabled tool is omitted from
`tools/list`. Notes and operating workflows resolve current state for the next
invocation. Disabled notes retain the existing structured `enabled: false`
offline result.

Wiki covers ingest, query, and lint; graph covers its command family; security
audit covers its command and workflow family. There are no subcommand-level
switches. The four enabled MCP tools retain their exact names, schemas,
responses, timeout/error behavior, and owners. In particular, `route_check`
and `context_explore` remain thin token-miser delegates; Cairnkeep does not gain
endpoint, model, tier, sandbox, or inference-loop ownership.

Callback logging is separately default-off. When all three consents are on
(`CAIRN_CAPABILITY_CONTRACT`, managed callback logging, and
`CAIRN_TRAJECTORY_CAPTURE`), the wrapper measures only the capability-owned
invocation. State is resolved first; the timer starts immediately before the
owned body and stops after its terminal outcome but before final presentation.
Discovery, configuration resolution, guard work, and unrelated harness overhead
are excluded. Logging is payload-free, local-only, final-only, and fail-open;
HTTP callbacks are never persisted. See the privacy and storage guides for the
exact record and retention contract.

Phase 19 must explicitly enable all eight capabilities to establish its
baseline before disabling one at a time. This contract records status/digest
and callback evidence only: it does not implement tasks, a runner, turns/tokens,
statistics, confidence intervals, or a quality/efficiency claim.

### Typed memory nodes and note address spaces (opt-in)

Set `CAIRN_TYPED_MEMORY_NODES=1` in the memory-server process and restart it.
Tool schemas are selected when `createMemoryServer` constructs a stdio server
or authenticated HTTP session. With the flag unset, Cairnkeep retains the
existing 14-tool list, required inputs, structured response roots, raw KV
values, files, processes, network behavior, and output. Enabled mode adds
optional fields to the existing lifecycle tools and exactly `memory_import`;
it does not add `memory_edit`, `memory_update`, `memory_remove`, or duplicate
read/delete tools. Use `memory_supersede` for both content and metadata edits.

Types are `memory`, `knowledge`, `hindsight`, `shared`, `provenance`, or a
lowercase namespaced extension such as `team:runbook`. Tags are trimmed, ASCII
lowercased, normalize whitespace/underscore runs to one hyphen, collapse
hyphens, deduplicate, and sort. `memory_list` and `memory_search` accept
non-empty `node_types`, `tags_all`, and `tags_any`; these are hard eligibility
filters applied before `top_k`, cache lookup, or embedding. Case-insensitive
key matches and exact canonical tag/type matches sort before semantic results.
Endpoint failure or absent embedding configuration falls back to stable local
substring matching over key, value, type, and tags.

Enabled `memory_write` without any Phase 16 field preserves collision-safe
legacy overwrite behavior. Supplying `address_space`, `node_type`, `tags`, or
`note` makes it create-only on a differing live node and returns `CONFLICT`;
use `memory_supersede` to preserve the complete prior value/type/tags snapshot.
Delete also records the complete final snapshot, and recreation is allowed.

`memory_import` takes `schema_version: 1`, one concrete `scope`, optional
`address_space` (default `memory`), 1–256 `nodes`, optional `import_id`,
`dry_run`, and `conflict_policy` (default `reject`, or explicit `supersede`).
Each unique logical key is a contained relative slash path; values are limited
to 256 KiB UTF-8 each and 5 MiB per batch. The content digest excludes retry
controls, while `import_id` durably binds to it. Dry-run performs no create,
lock, cache, journal, or mutation and returns only the digest, sorted actions,
and counts. Committed and replay results likewise omit values. Stable failures
include `INVALID_SCHEMA`, `INVALID_SCOPE`, `INVALID_PATH`, `CONFLICT`,
`IMPORT_ID_REUSE`, and `UNSUPPORTED_TARGET`.

`project-notes` and `shared-notes` both require `scope: project`; no named
memory scope is reserved. Keys such as `knowledge/build-cache` are logical,
not client filesystem paths. Rich hindsight/shared/provenance imports require
the complete nested note record; knowledge values must still losslessly encode
the validated record. Canonical Markdown and its manifest remain authoritative.
Unmanaged collisions are refused, and bytes after the managed marker are
preserved exactly. Local stdio derives project identity from its working
directory. Authenticated HTTP project notes require validated
`X-Cairn-Project`; the bearer token still defines the trust domain.

An interrupted note mutation blocks later note writes with `RECOVERY_REQUIRED`.
`cairn doctor --repair` rolls prepared/committing journals back to verified
pre-images, but verifies and finalizes committed-before-cleanup journals without
undoing the completed operation. Unverifiable committed state remains failed
and untouched for backup-guided manual recovery.

### Domain knowledge (RAG via AnythingLLM, opt-in)

`domain_knowledge_query` / `domain_knowledge_sync` bridge to an optional
[AnythingLLM](https://anythingllm.com/) instance for document RAG. Off unless
configured — full setup, workspaces, and the memory-config format are in
[domain-knowledge.md](domain-knowledge.md).

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

The server runs locally over stdio by default. Setting `MCP_HTTP_PORT` switches
it to a streamable HTTP transport so one long-lived process can serve many
clients within one trusted storage domain. The databases then live on the HTTP
server host. Because that exposes every memory tool over the network, HTTP mode
is guarded and **fails closed**:

| Variable | Purpose |
|---|---|
| `MCP_HTTP_PORT` | Enable HTTP mode on this port (unset → stdio) |
| `MCP_HTTP_HOST` | Bind address (default `127.0.0.1`) |
| `CAIRN_MEMORY_HTTP_TOKEN` | **Required** in HTTP mode — clients send `Authorization: Bearer <token>`; the server refuses to start without it |
| `CAIRN_MEMORY_HTTP_ALLOWED_ORIGINS` | Comma-separated browser origins allowed via CORS (default: none — no cross-origin access) |
| `CAIRN_MEMORY_HTTP_ALLOWED_HOSTS` | Comma-separated allowed `Host` headers for DNS-rebinding protection (default: the bind host + `localhost` on the chosen port) |
| `CAIRN_ARTIFACT_HTTP` | Additional consent for artifact tools (default off; requires `CAIRN_ARTIFACT_STORE`, a valid `X-Cairn-Project`, bearer auth, and the normal Host/CORS checks) |

Requests without a valid bearer token get `401`; requests with an unexpected
`Host` header get `403`. Keep HTTP mode bound to `127.0.0.1` unless you have a
specific reason to expose it, and use a long random token. HTTP mode has no
per-user ACL or tenant isolation. Clients may bind sessions to separate project
databases with validated `X-Cairn-Project` routing metadata, but that metadata
is not an authorization boundary. See [Memory storage and deployment](storage.md)
for the placement rules, client registration, TLS requirements, project headers,
and backup boundaries.

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

## Wrapper & operations seams

These let an enterprise wrapper add provider/credential specifics — and let you
maintain a running install — without forking the core. All are opt-in.

### Launcher seams

The generic launchers (`.ai/start-claude.sh`, `.ai/start-opencode.sh`) run three
optional hooks around the harness, each a no-op when absent:

| Seam | When | Purpose |
|---|---|---|
| `.ai/pre-launch.sh` | sourced after `.env`, before launch | export env (e.g. a provider base URL / auth), refresh credentials, or abort by returning non-zero |
| `CAIRN_EXTRA_SETTINGS` | read just before launch | path to a settings file layered on the harness (`--settings` / `--config`); process env still wins over it |
| `.ai/post-exit.sh` | sourced after the harness exits | teardown; `CAIRN_EXIT_STATUS` holds the exit code |

A wrapper that needs a non-default provider drops a `pre-launch.sh` that renders
its settings file and exports `CAIRN_EXTRA_SETTINGS` — no change to the launcher.

### `cairn doctor`

Health-checks the bundled local memory server with a real MCP stdio handshake,
then checks `./.ai/.env` (or the current environment). It does not inspect a
harness's remote HTTP registration. Unconfigured optional dependencies are
skipped; it exits non-zero when the local server probe fails or a configured
dependency (LLM/embedding endpoint, writable store) is unreachable.

It also checks an existing project-local trajectory database for SQLite
integrity, schema compatibility and index consistency. Because capture is
opt-in, a missing database is skipped. Metadata or indexes can be rebuilt from
valid full records only through the explicit repair operation:

```bash
cd /path/to/project && cairn doctor
cd /path/to/project && cairn doctor --repair
```

The same command checks `.agentfs/artifacts.db`. Absence is a healthy skip
because both producers are opt-in. A valid schema, full-record digest, index,
dedupe row, compaction pointer, and retention state passes. `--repair` may
rebuild only derived indexes/dedupe/pointers from valid authoritative records.
Unsupported schema, SQLite failure, invalid full records, or digest corruption
fails untouched with guidance to preserve the database before manual recovery.

### Structured session trajectories (opt-in)

Trajectory capture is disabled by default. To enable it for a launched Claude
Code, OpenCode, or Pi session, set the flag in the project's private `.ai/.env`:

```bash
CAIRN_TRAJECTORY_CAPTURE=1
```

The Claude Code SessionEnd hook, OpenCode session-idle plugin, or Pi
`session_shutdown` extension then normalizes the closed session, redacts it,
and writes it locally without a model, API key, or remote request. Inspect and
manage the result from the project root:

```bash
cairn trajectory list
cairn trajectory show <session-id-or-unambiguous-prefix>
cairn trajectory prune --dry-run
cairn trajectory prune
```

All commands accept `--json`; `--dry-run` applies to `prune`. Bootstrap creates
`.ai/trajectory-redaction.json` with an empty custom-pattern list but does not
enable capture. Add bounded regular-expression entries there only for
project-specific secrets; built-in credential patterns always apply. See
[Privacy and data flow](privacy-and-data-flow.md) for the exact capture boundary
and [Memory storage and deployment](storage.md) for retention and backup.

### Compaction continuity and artifacts (opt-in)

The two flags are independent and off by default. Enable either in the private
project `.ai/.env`, sync the harness assets, and restart both the harness and
the MCP server when changing tool registration:

```bash
cd /path/to/project
printf '%s\n' 'CAIRN_COMPACTION_CAPTURE=1' >> .ai/.env
printf '%s\n' 'CAIRN_ARTIFACT_STORE=1' >> .ai/.env
cairn sync --apply                 # Claude Code PostCompact + SessionStart
# OpenCode: re-run scripts/sync-opencode-plugin-assets.sh --apply from a clone
# Restart the harness and cairn-memory after changing flags.

# Disable: remove/comment both lines, sync again, and restart.
```

Compaction continuity accepts only the pinned Claude Code `PostCompact`
2.1.219 and 2.1.220 payloads and OpenCode `session.compacted` 1.17.20 payload.
The Claude hook resolves the local CLI version and passes that exact version to
the normalizer. Unknown or malformed versions fail open, retain none of the
unknown payload, and leave only a
bounded value-free doctor diagnostic. The flag is checked before parsing,
SDK, subprocess, filesystem, database, network, stdout, stderr, or injection
work. Capture forwards the harness-produced summary unchanged to the local
normalizer; it never generates a summary, changes a prompt, or triggers
compaction.

Automatic recovery prefers the exact current/resumed harness session. When a
fresh session has no match, it chooses the newest valid project compaction. It
injects provenance, revision, time, age, completeness, and only structured
goals/decisions/TODOs/critical errors. Old state is still shown with a stale
warning to validate it against the repository. The redacted raw summary is
available only through explicit `artifact_read` or `cairn artifact show`.

`CAIRN_ARTIFACT_STORE=1` registers exactly `artifact_write`, `artifact_read`,
`artifact_list`, and `artifact_delete`. The first schema supports exactly
`compaction_summary`, `diff`, `test_output`, and `generated_file`. Writes are
bounded inline values; generated-file paths are labels and are never read.
Operator commands remain available for already-retained local data:

```bash
cairn artifact list --kind compaction_summary --session SESSION-REF --json
cairn artifact show ARTIFACT-ID --json
cairn artifact delete ARTIFACT-ID --dry-run --json
cairn artifact delete ARTIFACT-ID --json
cairn artifact prune --dry-run --json
cairn artifact prune --dry-run --include-protected --json
```

Defaults are 1 MiB per artifact, 16 MiB per session, 256 MiB total, 30 days,
eight compaction revisions, and a 256 KiB generated-file snapshot cap. Pruning
is oldest-first after age/revision eligibility and protects the newest valid
project compaction unless `--include-protected` or explicit delete is used.
Hard delete removes the body and derived rows with no tombstone.

No key, model, endpoint, or network is required. Stdio access needs only
`CAIRN_ARTIFACT_STORE`. HTTP requires double consent—both artifact flags—plus
the existing bearer token, allowed `Host`, CORS policy, and a valid
`X-Cairn-Project`; the latter derives an isolated server-side artifact root.
Artifact HTTP does not expose trajectories. See [storage](storage.md#artifact-storage)
and [privacy](privacy-and-data-flow.md#compaction-and-artifact-flows).

### Hindsight notes (opt-in)

Note distillation is a separate asynchronous/one-shot capability. It never runs
inside SessionEnd, session-idle, `session_shutdown`, or any other online agent
callback. It consumes only closed, schema-validated trajectories already
redacted by the capture path. Enable the master flag in the process that runs
the command:

```bash
export CAIRN_NOTE_DISTILLATION=1

# Incremental current project, or one exact session for deterministic replay
cd /path/to/project
cairn notes distill --json
cairn notes distill --session SESSION-ID --json

# Scheduled/manual sweep below one explicit PARA root
cairn notes distill --all-projects --para-root "$HOME/PARA" --json

# Exact signature lookup; stdin avoids quoting a real multiline stack trace
printf '%s\n' 'TypeError: cache closed' '    at loadCache (/tmp/src/cache.ts:44:2)' \
  | cairn notes search-error --project /path/to/project --json

# Validate/rebuild generated indexes, or explicitly promote corroborated notes
cairn notes doctor --json
cairn notes doctor --repair --json
cairn notes promote NOTE-ID --with CORROBORATING-NOTE-ID --confirm --json
```

The hierarchy is `${CAIRN_AGENTFS_BASE_DIR:-~/.cairnkeep}/notes/README.md`,
`shared/`, and `projects/<slug--stable-id>/{README.md,knowledge/,hindsight/}`.
Each Markdown leaf has validated `id`, `title`, `description`, `keywords`,
`node_type`, and `tags` front matter. Hindsight nodes add a deterministic
signature and `unresolved`, `resolved`, or `abandoned` lifecycle. A later
recurrence reopens the same stable node. Generated content is enclosed by
`cairnkeep:managed:v1` markers; text after that block is preserved. An existing
unmarked target is treated as a collision and is never overwritten.

JSON distillation output separates `created`, `updated`, `already_processed`,
`enrichment_skipped`, `enrichment_failed`, and session-level `failed` results.
Project locks reject concurrent writers. Exact lookup normalizes the message,
causal stack, and component with the same versioned implementation used by the
index; it runs without embeddings or network access. Promotion requires two
compatible notes from distinct projects plus `--confirm`, creates one shared
canonical body, and converts each project note into a provenance reference.

Optional prose enrichment requires all of the master flag,
`CAIRN_NOTE_ENRICHMENT=1`, `CAIRN_LLM_API_KEY`, `CAIRN_LLM_API_URL`, and an
explicit `CAIRN_NOTE_ENRICHMENT_MODEL`. It sends bounded already-redacted
evidence to `{CAIRN_LLM_API_URL}/chat/completions`, labels returned prose as
non-authoritative, and cannot change signature, lifecycle, or provenance. Any
missing configuration, malformed response, timeout, or provider failure leaves
the deterministic note usable and is reported as skipped/failed. Review the
[privacy data flow](privacy-and-data-flow.md#hindsight-note-distillation) before
enabling it.

### `cairn memory export|import|path`

Relocate named/global memory (one SQLite `.db` per scope under
`CAIRN_AGENTFS_BASE_DIR`) between machines or backends:

```bash
cairn memory path                    # print the store location
cairn memory export store.tgz        # WAL-safe snapshot of every scope db
cairn memory import store.tgz        # restore on another machine (backs up existing)
```

`cairn memory export` requires the `sqlite3` CLI so it can use SQLite's online
backup operation and produce a consistent snapshot while WAL mode is active.
It does not include project memory at `<project>/.agentfs/project.db`; see
[Memory storage and deployment](storage.md) for project backup instructions.

### `cairn audit-timer`

`memory-wiki-audit.sh` is the deterministic invalidation backstop meant to run on
a schedule. `cairn audit-timer` installs it as a systemd user timer (opt-in):

```bash
cairn audit-timer --on-calendar daily            # install + enable the timer
cairn audit-timer --render-only ./units          # just render the unit files
# no systemd? cron:  @daily .../scripts/memory-wiki-audit.sh --para-root "$HOME/PARA" --report ...
```

The timer inherits its process environment. With `CAIRN_NOTE_DISTILLATION`
truthy it launches exactly one separate `cairn notes distill --all-projects`
process after the wiki scan and reports its bounded status. With the flag unset
it performs no note work. Note failure does not replace wiki findings or change
their actionable exit status; no credentials are embedded in rendered units.
