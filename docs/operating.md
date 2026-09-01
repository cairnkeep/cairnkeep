# Operating guide

How to take a project from nothing to the full Cairnkeep workflow — durable
memory, the wiki layer, and the security/review commands — in one pass.

Cairnkeep has three moving parts:

1. **The memory server** (`cairn-memory`) — an MCP server your harness talks to.
2. **The project scaffold** — `.ai/` launchers and the `.planning/` knowledge
   layer, written by `cairn setup` or the compatibility-oriented
   `cairn bootstrap` primitive.
3. **The operating layer** — the commands, agents, and hooks that live in your
   harness config and drive the workflow.

`cairn setup` is the recommended project entry point. `cairn bootstrap`
retains its established deterministic behavior for existing automation. Steps
1 and 3 are one-time-per-machine installs; project setup reports the explicit
sync command but never runs it automatically. This guide covers all three.

## Prerequisites

- Node.js 22 or newer (for the memory server) and a supported harness. Claude
  Code and OpenCode receive the full operating layer. Kimi Code receives the
  memory MCP, launcher, and opt-in graph Skill; Qwen Code receives the memory
  MCP and launcher. Pi receives a maintained local stdio MCP extension, native
  trajectory adapter, graph prompt, and launcher after explicit machine sync.
- Cairnkeep 1.x remains the legacy line for older Node.js runtimes. New
  installations should use the supported Cairnkeep 2.x and Node.js 22-or-newer
  matrix.
- Optional: the `sqlite3` CLI for `cairn memory export`. Runtime memory and
  `cairn memory import` do not require it.
- Optional: an OpenAI-compatible LLM endpoint for memory extraction and
  embedding-ranked search. Without it, memory search degrades to substring
  matching — everything else still works.
- Optional: rootless Podman for the containerized memory server and isolated
  workspace base described in [Containers](containers.md).

Native Windows x64 is supported directly from PowerShell or Command Prompt;
WSL and Git Bash are not required. The npm package installs a Node entry point,
and bootstrap emits `.cmd` plus PowerShell launchers. See
[Native Windows operation](native-windows.md) for the exact setup and recovery
contract. Windows ARM64 currently uses x64 emulation.

## Shell completion

Generate completion definitions directly from the CLI:

```bash
cairn completion bash
cairn completion zsh
cairn completion fish
cairn completion powershell
```

Distributions can install these outputs into the platform's normal completion
directories. They can also be loaded for the current shell, for example with
`source <(cairn completion bash)`.

In PowerShell, load completion for the current session with:

```powershell
Invoke-Expression (& cairn completion powershell | Out-String)
```

## Guided project setup

Interactive terminals may run `cairn setup [PATH]`. Use Up/Down and Enter for
Git and memory, Space to tick one or more harness checkboxes, `a` to toggle all
harnesses, and the final selectable confirmation before anything is written.
If the terminal cannot provide raw keyboard input, Cairnkeep falls back to the
original text questions. Automation must make every choice explicit:

```bash
cairn setup /path/to/project --git init --harness claude,pi --memory local --yes
```

The deterministic form accepts `--git init|existing|none`, a comma-separated
subset of `claude,opencode,pi,kimi,qwen,codex`, and `--memory local|none`. `--git
existing` requires the target to be in an existing work tree. `--git init`
requires Git and is the only non-interactive authorization to initialize a
repository. `--git none` is an explicit limited mode: repository-aware features
remain unavailable, and both setup output and `cairn doctor` say so. A missing
or empty interactive target recommends initialization and asks before writing;
an existing non-Git tree is never initialized silently.

Setup first classifies the target and Git state without writing, then creates or
reconciles only the selected project launchers and common scaffold assets.
Identical managed files remain unchanged, changed managed files are updated,
and unrelated files are preserved. The result reports created, updated,
unchanged, and skipped counts; `cairn doctor`; an exact launcher per selected
harness; and the deterministic setup command to use for recovery. `--json`
returns the same schema-v1 result. The private mode-`0600`
`.ai/cairnkeep.json` record stores the package version, Git and memory modes,
selected harnesses, and digests/modes/template identifiers for setup-owned
assets. It contains no credentials, endpoints, or absolute paths.

Setup never installs or refreshes machine-level harness assets. Its
`machine_sync.automatic` field is always false, and the human output labels the
reported command as not run automatically. For selections such as Codex and
Qwen that need no machine sync, `machine_sync.command` is `null` and the human
output says that sync is not required. Apply any reported command explicitly,
check it, then diagnose and launch:

```bash
cairn sync --apply                    # Claude Code operating assets
cairn sync-pi --apply                 # Pi extension and prompt
cairn sync-pi --check
cd /path/to/project && cairn doctor
./.ai/start-pi.sh
```

`cairn bootstrap [--untracked] PATH` remains available for scripts that depend
on its original scaffold and Git-exclusion contract.

## Setup order (Codex CLI)

Codex uses project-scoped configuration, so setup owns the complete local MCP
wiring without editing user-wide state:

```bash
npm install -g @cairnkeep/cli
cairn setup /path/to/project --git init --harness codex --memory local --yes
cd /path/to/project
cairn doctor
./.ai/start-codex.sh                    # native Windows: .\.ai\start-codex.cmd
```

Review `.codex/config.toml` and accept Codex's project-trust prompt before use.
An existing different file is preserved and reported as skipped; merge the
generated `mcp_servers.cairn-memory-local` table into it, then run `cairn doctor`.
Uninstall leaves that operator-owned file intact. Selecting
`--memory none` creates the launcher but deliberately omits the MCP entry.

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

## Optional Graphify workflow

Graphify is an optional local structural index. Install only its isolated CLI:

```bash
uv tool install graphifyy
# or: pipx install graphifyy
```

Do not run `graphify install`: Cairnkeep owns the harness commands, policies,
and hooks, so Graphify-owned assets would duplicate that operating layer.
With the managed capability contract enabled, run
`cairn capabilities enable graph`; otherwise enable the compatibility setting
`graphify.enabled` in `.planning/config.json`. Then use the managed command
surface. Claude Code and OpenCode receive the native wrapper:

```text
/graphify build
/graphify status
/graphify query putTrajectory
/graphify explain putTrajectory
/graphify path putTrajectory resolveCapabilityStatus
/graphify diff
```

Install the equivalent thin adapters for Kimi Code and Pi:

```bash
cairn sync-kimi --apply
cairn sync-pi --apply
```

Kimi then exposes `/graphify` and `/skill:graphify`; Pi exposes `/graphify`.
Both adapters delegate exclusively to the same portable CLI, which also remains
available directly from their project shell:

```bash
cairn graph build
cairn graph status
cairn graph query putTrajectory
cairn graph explain putTrajectory
cairn graph path putTrajectory resolveCapabilityStatus
cairn graph diff
```

The same direct CLI works with Qwen Code, Codex, and other shell-capable
clients. Pi sync separately installs Cairnkeep's maintained local stdio MCP
extension; the graph prompt remains a thin adapter and does not expand the rest
of Pi's operating surface.

All six modes delegate to `cairn graph`. Managed builds run Graphify's local
code-only `update` path with provider credentials removed from the subprocess
environment, then atomically publish validated artifacts under
`.planning/graphs/`. Previous published artifacts are isolated during the scan
so Graphify cannot re-index its own generated HTML/report/JSON. Managed builds
do not perform Graphify's optional semantic document extraction. Prefer exact
function, class, or file names; broad natural-language graph queries are less
precise. Cairnkeep does not install or update Graphify automatically.
Set `CAIRN_GRAPHIFY_BINARY` to override the `graphify` command when Graphify is
installed at a specific path. Native executables run directly; `.js`, `.mjs`,
and `.cjs` helpers run through the active Node runtime on every platform.

Graphify also maintains an incremental `graphify-out/` work directory at the
repository root. It is separate from Cairnkeep's published
`.planning/graphs/` view and can contain the same sensitive structural data.
Keep both locations local. Before the first build in a Git repository, add
`/graphify-out/` to the clone-local exclude file or the repository's ignore
policy, and verify with `git status --short` after every build.

## Setup order (Kimi Code)

Kimi Code can use the Cairnkeep memory MCP, generated project launcher, and one
thin graph Skill. Install the Skill into `$KIMI_CODE_HOME` (default
`~/.kimi-code`) with:

```bash
cairn sync-kimi --apply
```

Use `cairn sync-kimi --check` to detect drift or `--live-root DIR` for an
isolated Kimi root. The command owns only `skills/graphify/SKILL.md`; `cairn
uninstall --kimi-live-root DIR` removes it backup-first. It adds no hooks,
agents, plugins, or new data flow.

For local stdio memory, create `.kimi-code/mcp.json` in the project:

```json
{
  "mcpServers": {
    "cairn-memory": {
      "command": "cairn",
      "args": ["memory-server"]
    }
  }
}
```

Then launch from the project root with `./.ai/start-kimi.sh`. The launcher
loads `.ai/.env`, runs the optional pre-launch and post-exit hooks, and forwards
all arguments to `kimi`.

Remote HTTP configuration needs one extra precaution: Kimi validates `url` as
a literal URL and does not expand `${CAIRN_MEMORY_REMOTE_URL}` there. Put the
resolved URL in a private `.kimi-code/mcp.json` and use
`bearerTokenEnvVar: "CAIRN_MEMORY_HTTP_TOKEN"` so the token value remains in
the environment. A repository-root `.mcp.json` must also be valid because Kimi
parses it before applying its private override. See
[Harness compatibility](harness-compatibility.md#kimi-code) for the complete
configuration and trust-boundary guidance.

## Setup order (Qwen Code)

Qwen Code can use the Cairnkeep memory MCP and the generated project launcher.
It does not yet receive Cairnkeep-specific skills, commands, or hooks.

For local stdio memory, create `.qwen/settings.json` in the project:

```json
{
  "mcpServers": {
    "cairn-memory": {
      "command": "cairn",
      "args": ["memory-server"]
    }
  }
}
```

Review and approve the project server, then launch it:

```bash
qwen mcp approve cairn-memory
./.ai/start-qwen.sh
```

For authenticated remote HTTP, use `httpUrl` plus environment-expanded headers
in `.qwen/settings.json`. Keep the endpoint and bearer token in `.ai/.env` or a
machine secret store, not in the JSON file. See
[Harness compatibility](harness-compatibility.md#qwen-code) for the tested
configuration, approval behavior, and overlay guidance.

## Setup order (Pi)

Pi uses the same project scaffold and local memory store. Its explicit sync
installs the maintained memory extension, native trajectory extension, and thin
`/graphify` prompt into Pi's agent root:

```bash
npm install -g @cairnkeep/cli
cairn sync-pi --apply                    # default: ~/.pi/agent
cairn setup /path/to/project --git init --harness pi --memory local --yes
cp /path/to/project/.ai/env.example /path/to/project/.ai/.env
cd /path/to/project && cairn doctor && ./.ai/start-pi.sh
```

The memory extension starts `cairn memory-server` as a local stdio child from
the project root. It dynamically discovers the effective server catalog, so
feature gates, capability state, and the current MCP tool profile remain
authoritative. It does not contain a second hard-coded catalog. Startup is
bounded to 10 seconds, calls to 30 seconds, results to 4 MiB, and retained child
stderr to the newest 16 KiB. Cancellation is propagated, child or protocol
failure is surfaced, and session shutdown closes the child.

Tool names, descriptions, input and output schemas, content,
`structuredContent`, `_meta`, and failure behavior cross the bridge without
semantic rewriting. The exact MCP annotations are preserved in the trusted Pi
result `details`, together with the discovered tool metadata and original
content. Pi 0.84.1 has no native annotations field in its public tool API, so
Cairnkeep does not claim native model-facing annotation propagation or invent a
substitute field.

The bridge is tools-only: it does not run prompts, activate context-pack skills,
create an autonomous loop, add remote access, or bypass server-side tool
restrictions. Removing `MCP_HTTP_PORT` from the child environment deliberately
keeps this integration on local stdio.

Use `cairn sync-pi --check` to report drift without writing, or
`--live-root DIR` to target an isolated Pi agent root. The command owns exactly
`extensions/cairnkeep-memory.ts`, `extensions/cairnkeep-trajectory.ts`, and
`prompts/graphify.md`; `cairn doctor` reports a selected Pi extension that is
missing or drifted and points to `cairn sync-pi --apply`. `cairn uninstall
--pi-live-root DIR` removes those files backup-first and leaves every other Pi
asset untouched.

Pi 0.84.1 is the validated minimum supported version for this extension. The
v2.11 release passed the complete setup and bridge matrix on separate Pi 0.84.1
minimum and registry-current installations, Node.js 22, 24, and 26, Bash 3.2,
and native Windows. The two Pi executable paths differed, while both reported
0.84.1 because that was also the registry-current release.

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
| `CAIRN_WORK_EVIDENCE` | Capture bounded Git state around generated harness launches (off by default) |
| `CAIRN_WORK_EVIDENCE_PATCH` | Request an optional redacted patch artifact (off by default; requires `CAIRN_ARTIFACT_STORE`) |
| `CAIRN_WORK_EVIDENCE_RETENTION_DAYS` | Work-evidence retention (default `30`; `0` disables age pruning) |
| `CAIRN_WORK_EVIDENCE_STORE_MAX_BYTES` | Project-local metadata budget (default `67108864`, 64 MiB) |
| `CAIRN_WORK_EVIDENCE_MAX_TOUCHED_PATHS` | Maximum touched-path labels per record (default and hard maximum `4096`) |
| `CAIRN_WORK_EVIDENCE_PATCH_MAX_BYTES` | Optional patch cap (default `1048576`, 1 MiB; the artifact cap can lower it) |
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
| `CAIRN_EVAL` | Opt in to the local evaluation coordinator (`1`, `true`, `yes`, or `on`; unset/default → stable disabled result before input reads, writes, or adapter execution) |
| `CAIRN_HARNESS_STATE_DIR` | Optional absolute local root for recoverable native capability leases (default `${XDG_STATE_HOME:-~/.local/state}/cairn/harness`) |
| `CAIRN_GIT_PROVIDER` | Git host for collaboration commands: `github`\|`gitlab`\|`codeberg`\|`forgejo`\|`none`. See [git-providers.md](git-providers.md) |
| `CAIRN_ROUTE_ENDPOINT` | Base URL of an already-running token-miser routing/tiering proxy (unset → the `route_check` tool is inert) |
| `CAIRN_GRAPHIFY_BINARY` | Optional Graphify command/path override; JavaScript helpers run through the active Node runtime (default `graphify` from `PATH`) |
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

`CAIRN_CAPABILITY_CONTRACT` is the default-off rollout gate. Master off is exact
legacy behavior: the launchers and sync commands preserve the legacy installed
assets byte-for-byte, install and invoke no capability hook or plugin, introduce
no capability block, and create no capability measurement state. Master on is
not enough to modify the normal harness root. The launcher must also select the
explicit `capability-overlay` mode; only that two-factor path renders the
isolated `.ai/capability-contract/` root and installs its native hooks/plugins.
Normal installed assets remain in place, and toggling never deletes
configuration, retained data, or installed files.

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

The five operating command surfaces are still `wiki-ingest`, `wiki-query`,
`wiki-lint`, `graphify`, and `security-audit`. Their installed commands, agents,
and workflows remain the owners described by D-10, D-12, and D-16; the native
boundary admits or blocks an invocation and settles evidence, but does not move
or duplicate owner logic.

#### Native operating lifecycle

Claude Code uses two native hooks. `capability-command-start.sh` runs on
`UserPromptExpansion`, before command or MCP-prompt expansion can enter owner
I/O. It validates the exact target-command event and binds the canonical
project root from the event to the process root. The coordinator then creates
an issued recoverable lease for an eligible measured invocation. That validated
project identity and lease are immutable for the invocation: terminal events
carry neither a replacement project path nor a caller-selected handle.
`capability-command-finish.sh` maps `Stop` to success and maps `StopFailure`
immediately to an error terminal; error settlement is not deferred to
`SessionEnd`. `SessionEnd` performs abandonment cleanup only for unfinished
leases, while `CwdChanged` updates lifecycle state without rebinding the
start-time project.

OpenCode uses the pinned native plugin for OpenCode 1.17.20.
`command.execute.before` validates the target command, session, output shape,
and the one canonical project identity supplied at plugin initialization before
expansion. `session.idle` and `session.status:idle` settle success,
`session.error` settles error, and `session.deleted` performs abandonment
cleanup only for an unfinished invocation. Plugin disposal likewise abandons
only unfinished leases. Both harnesses settle the issued lease atomically and
idempotently: one terminal can win, replay cannot add another final, and
crash-recovery cleanup cannot rewrite a settled outcome.

The three operating states are exact. With master off, no native capability
owner is installed or invoked and no measurement state exists. With master on
and a target disabled, the native boundary returns the fixed block before owner
I/O regardless of measurement consent. Only when all three consents are on may
that block settle exactly one D-25/D-26 value-free `disabled` final through an
issued lease; if either measurement consent is off, it blocks with no state.
With master on and a target enabled, either measurement consent being off
preserves owner execution unchanged and creates no measurement state.

Deterministic native-boundary tests prove pinned event shapes, admission before
owner delegation, terminal ordering, and overlay installation. They are not
exhaustive live real-owner evidence. Phase 18 also requires the complete live
eight-by-seven matrix: eight capabilities across seven target-disabled cells,
56 genuine owner executions in total. Any missing, failed, or unavailable cell
keeps Phase 18 incomplete.

Callback logging is separately default-off. When all three consents are on
(`CAIRN_CAPABILITY_CONTRACT`, managed callback logging, and
`CAIRN_TRAJECTORY_CAPTURE`), the native boundary measures only the capability-owned
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

## Project playbooks

Guided setup and tracked bootstrap create private `.ai/playbooks.json` mode
`0600` with the `balanced` profile and reconcile a delimited block in the
project's `AGENTS.md`. `--untracked` bootstrap leaves the shared `AGENTS.md`
untouched. The policy can select only eight canonical Cairnkeep actions; it
cannot contain commands, prompts, URLs, or extensions.

The same ownership-safe block contains a generic durable-context protocol. For
nontrivial work that may depend on existing decisions, conventions,
constraints, recurring failures, or prior work, compatible agents derive one
short query directly from the task and call `memory_search` with
`scope: project` as their first tool or command, before `pwd`, `ls`, repository
inventory, or search commands such as `rg --files`, `find`, `tree`, or broad
text search. A result is only a locator:
the maintained repository source must still be read and verified. Missing
tools and zero results fall back to normal inspection, and the protocol never
authorizes an automatic memory write, supersede, or approval.

```bash
cairn playbook list
cairn playbook status --project .
cairn playbook set strict
cairn playbook enable review.security must
cairn playbook disable learning.capture
cairn playbook reset learning.capture
```

At task start, use `check start`; after a material risk or scope change, use
`check check`; before completion, use `check finish`. Supply actual changed
paths and evidence rather than trusting a model's unsupported claim:

```bash
cairn playbook check finish --changed src/auth.ts docs/security.md \
  --risk security --public-change \
  --completed verify.tests review.repository review.security docs.update \
  --enforce
```

Exit 3 means applicable `must` evidence is missing. Exit 2 means the policy has
diagnostic issues. Otherwise the check succeeded. `should` actions remain
advisory and should carry a concrete `--skipped ACTION=REASON` when omitted.
Checking never executes the displayed commands, contacts a service, enables a
capability, or grants approval.

Material outcomes can be stored one action per call using the exact policy and
decision digests from the check:

```bash
cairn playbook record --policy POLICY_DIGEST --decision DECISION_DIGEST \
  --event finish --action verify.tests --outcome completed \
  --session SESSION --reason 'targeted tests passed'
cairn playbook record --help
```

Inspect receipts with `cairn playbook receipts list|show`; validate state with
`cairn playbook doctor`. Actor and session options are provenance labels only:
v2.15 does not authenticate them and does not provide team ACLs. See
[team mode](design/team-mode.md) for the future admission contract.

The corresponding process overrides are optional:

| Variable | Default | Purpose |
|---|---|---|
| `CAIRN_PLAYBOOK_PROFILE` | project policy, then `balanced` | Select `minimal`, `balanced`, or `strict` without changing the project file |
| `CAIRN_PLAYBOOK_ACTOR` | `local-agent` | Supply the unauthenticated local actor label used by checks and receipts |
| `CAIRN_PLAYBOOK_ACTOR_KIND` | `agent` | Classify the local actor as `user`, `agent`, or `service` |
| `CAIRN_PLAYBOOK_SESSION` | `local-<process-id>` | Supply the bounded local session label used by decisions and receipts |

Command-line `--actor`, `--actor-kind`, and `--session` values take precedence
over these process defaults. None of these labels establish identity or grant
authority.

The managed instruction lifecycle is explicit and ownership-safe:

```bash
cairn playbook instructions check
cairn playbook instructions install
cairn playbook instructions remove
```

Claude and OpenCode receive `/cairn-work`; Pi and Kimi receive corresponding
thin prompt/Skill adapters when their explicit machine sync runs. Codex and
Qwen follow the project `AGENTS.md` block. Instruction exposure does not prove
tool invocation, so evaluations and audits should verify the actual
`memory_search` event. These surfaces route to the same CLI and do not create a
Cairnkeep-owned agent loop.

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

The generic launchers (`.ai/start-claude.sh`, `.ai/start-opencode.sh`,
`.ai/start-kimi.sh`, `.ai/start-qwen.sh`, `.ai/start-codex.sh`, and `.ai/start-pi.sh`) run optional hooks around the
harness, each a no-op when absent:

| Seam | When | Purpose |
|---|---|---|
| `.ai/pre-launch.sh` | sourced after `.env`, before launch | export env (e.g. a provider base URL / auth), refresh credentials, or abort by returning non-zero |
| `CAIRN_EXTRA_SETTINGS` | read just before launch | path to a settings file layered on Claude Code (`--settings`) or OpenCode (`OPENCODE_CONFIG`); Kimi, Qwen, Codex, and Pi leave the variable available to hooks but do not interpret it |
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

When `.ai/cairnkeep.json` exists, doctor also validates its private state,
selected assets, digests, and modes. It reports `limited` for explicit
`--git none`, fails an incomplete or drifted setup with the recorded
deterministic `cairn setup` recovery command, and checks the Pi machine
extension when Pi was selected. `cairn sync-pi --apply` repairs that
machine-level drift; setup itself never performs the sync.

### Evaluation harness (opt-in)

`cairn eval` is a local, serial experiment coordinator. It is disabled unless
`CAIRN_EVAL` is explicitly truthy. The disabled path returns before reading a
task set or adapter configuration, creating a workspace or report, opening a
database, starting a subprocess, or making a network request. Enabling the
flag does not choose a harness, model, endpoint, or credential: inference
remains owned by the operator-configured adapter process.

Task sets and adapters are strict schema-v1 JSON. Each task names an immutable
source commit, fixed input, shell-free preparation and verification commands,
and limits. An adapter configuration is one program-plus-arguments array and
an exact turn-semantics ID plus definition. Cairnkeep sends one bounded JSON
request on stdin and accepts exactly one bounded, strict JSON observation on
stdout. The adapter may report terminal status, turns under its declared
semantics, independently optional token components and total, optional
currency-bearing cost, component identities, capability digest, and local
trajectory/artifact references. The independent task verifier—not the
adapter—assigns pass, fail, or unknown. Arbitrary adapter stderr remains live
operator diagnostics and is not copied into the report.

The request's `workspace_path` is the task's Cairnkeep project root for all
trajectory-producing harness work. An adapter that returns `trajectory_ref`
must run that work against the supplied root so the closed trajectory is in
that task's local store. The reference is a bounded session identifier, not a
filesystem locator. A task manifest with `workspace.path: "."` remains the
compatible repository-root case; there is no second trajectory-root field.

Validate before spending or mutating:

```bash
export CAIRN_EVAL=1
cairn eval validate --task-set tasks.json --adapter adapter.json \
  --output .agentfs/eval/experiments --json

# Two serial observations per task and repetition: Run 1, then fresh Run 2.
cairn eval run --task-set tasks.json --adapter adapter.json \
  --output .agentfs/eval/experiments --repetitions 1 --seed trial-1 --yes --json

# Four serial observations per task and repetition: all-on and one-off,
# with Run 1 and Run 2 in each arm. Only one capability may be disabled.
cairn eval ablate --disable memory.search --task-set tasks.json \
  --adapter adapter.json --output .agentfs/eval/experiments --seed trial-1
# Inspect the printed invocation estimate and both configuration digests, then
# repeat with --yes to confirm execution.

cairn eval report --experiment EXPERIMENT-ID --json
cairn eval prune --older-than-days 30 --dry-run --json
cairn eval prune --older-than-days 30 --json
cairn eval delete --experiment EXPERIMENT-ID --dry-run --json
cairn eval delete --experiment EXPERIMENT-ID --json
```

`validate` resolves task/adapter bytes and digests, immutable revisions,
commands, limits, output containment, seeds, and the complete deterministic
schedule without invoking the adapter. `run` requires `--yes` and prints its
serial invocation estimate. `ablate` first prints the estimate, the explicit
all-eight-enabled baseline, the exactly-one-disabled treatment, and their
configuration digests; execution likewise requires `--yes`. There are no
automatic retries: repetitions and paired seeds are explicit experiment
inputs.

The packaged fake workflow uses `examples/eval/task-set.json` and
`examples/eval/adapter.json` with the same `validate`, `run`, `report`,
`prune`, and `delete` commands. Its manifest must match the package-owned ID,
version, canonical bytes, and digest. It is deterministic and network-free,
but proves framework behavior only; it is not live performance evidence.

Run 1 starts every task from a fresh workspace without evaluation notes. After
a closed trajectory, the existing offline note distiller may create an
experiment-owned immutable snapshot. Run 2 uses another fresh workspace and
can see only its own task's snapshot. Tasks with `no_notes`, failed, or skipped
distillation still run and remain visible. Reports show the full committed
population and the note-eligible subset, plus executed, verified, paired, and
missing populations and reason-coded missingness.

Turns are paired or aggregated only when exact turn-semantics IDs match.
Token fields remain independent and totals are never inferred. Verified pass
rates exclude unknown verifier outcomes while retaining them in denominators
and missingness tables. Task-clustered paired bootstrap intervals use recorded
seeds and streams; fewer than two valid pairs has no interval and fewer than
20 emits a small-sample warning. Results are estimates and may be
inconclusive—reports do not make causal, significance, quality, or efficiency
claims.

SIGINT or SIGTERM stops schedule admission, terminates the active adapter,
checkpoints a `cancelled` observation, waits for bounded cleanup, and retains
an inspectable partial report. On POSIX systems the runner targets the child
process group with TERM then bounded KILL escalation. Native Windows targets
the adapter and its descendant tree with `taskkill.exe /T`, escalating to `/F`
after the bounded grace period.

See [storage](storage.md#evaluation-report-and-note-snapshot-storage) for local
retention/removal and [privacy](privacy-and-data-flow.md#evaluation-adapter-and-report-flow)
for the exact request, observation, environment, and persistence boundaries.

### Validated skill improvement (opt-in)

After hindsight-note distillation has recorded the same failure family in at
least two sessions, `cairn skill harvest` creates a local candidate under
`.agentfs/skills/`. Review its exact evidence with `show`, approve it explicitly,
then use a private proposal adapter to generate a bounded edit list for one
existing skill file. Proposal and evaluation do not modify the live target.

Evaluation reuses the default-off evaluation coordinator and therefore requires
`CAIRN_EVAL=1`, `--yes`, an explicit harness adapter, and two disjoint committed
task sets. Only a complete, no-regression improvement in exploration opens the
confirmation set. Only the same result on confirmation makes the proposal
eligible for exact-digest application. See
[Validated skill improvement](skill-improvement.md) for the command sequence,
adapter contract, task constraints, and rollback procedure.

### Git-linked work evidence (opt-in)

Set `CAIRN_WORK_EVIDENCE=1` in `.ai/.env` and use a generated harness launcher.
The launcher opens a local evidence interval before Claude Code, OpenCode, Pi,
Kimi, Qwen or Codex and settles it after exit. A missing Git executable, a
non-repository directory or a capture error produces a warning and never blocks
the harness. Direct harness launches do not create launcher-owned evidence.
The launcher reserves `CAIRN_WORK_EVIDENCE_ID` and `CAIRN_WORK_EVIDENCE_ROOT`
for child-process correlation; operators must not set either variable directly.

```bash
cairn evidence list --json
cairn evidence show EVIDENCE-ID --json
cairn evidence delete EVIDENCE-ID --dry-run --json
cairn evidence prune --dry-run --json
cairn evidence doctor --json
```

The start/end record includes commits, branch/detached/unborn state, dirty
state, canonical status/workspace digests, touched path labels, timestamps and
exit status. It can append exact trajectory, artifact and reviewed-memory
identifiers produced by descendant processes. It captures no prompts,
keystrokes, command history or reasoning. Concurrent writers are not
attributed, and a path changed then restored to its starting state is invisible.

Patch capture is a separate consent boundary: both
`CAIRN_WORK_EVIDENCE_PATCH=1` and `CAIRN_ARTIFACT_STORE=1` are required. The
redacted, bounded diff is computed from the starting commit to the ending
worktree, so it can include tracked changes that predated the session; untracked
bodies are omitted. Cairnkeep has no apply, restore or replay operation.

When enabled, local stdio exposes only `work_evidence_list` and
`work_evidence_read`; they are read-only, non-destructive, idempotent and
closed-world. HTTP never exposes them. See [Git-linked work evidence](work-evidence.md),
[storage](storage.md#git-linked-work-evidence) and
[privacy](privacy-and-data-flow.md#git-linked-work-evidence).

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

## Least-authority MCP profiles

Inspect the annotation-derived catalog and then choose the smallest profile the
client needs:

```bash
cairn mcp-tools list
cairn mcp-tools set read-only --project .
cairn mcp-tools set custom --tool memory_read --tool memory_search --project .
cairn mcp-tools status --project . --json
```

Restart the memory server after `set` or `reset`. Environment overrides win over
the mode-`0600` project file. A profile can only remove tools; feature and
capability gates still apply. Invalid names make both startup and doctor fail.
See [MCP tool profiles](mcp-tool-profiles.md).

## Context packs (opt-in)

Build and validate a local pack before installing it, then enable the immutable
digest for exactly one project:

```bash
cairn pack init ./reference --id reference --version 1.0.0 \
  --title Reference --description "Reviewed project context" --license Apache-2.0
cairn pack lock ./reference
cairn pack validate ./reference
cairn pack install ./reference
cairn pack enable PACK-DIGEST --project .
CAIRN_CONTEXT_PACKS=1 cairn memory-server
```

Git sources additionally require `--ref`. Updates are a manual `--check`, then
an `--apply --confirm CANDIDATE-DIGEST`. Use `cairn pack skills` and exact-digest
approval before a bundled skill can be read through MCP. HTTP needs the separate
`CAIRN_CONTEXT_PACK_HTTP=1` flag and all existing authentication/Host/CORS
controls. See [Immutable context packs](context-packs.md).

Validate and import an OKF bundle without converting it by hand:

```bash
cairn pack validate-okf ./knowledge
cairn pack import-okf ./knowledge --id reviewed-knowledge \
  --version 1.0.0 --license CC-BY-4.0
```

Imported OKF packs preserve structured source/trust/freshness metadata and add
read-only related-document traversal. Privacy-reviewed export is an explicit
`export-okf --check` followed by `--apply --confirm PREVIEW-DIGEST`; only named
Markdown files and promoted shared notes are eligible. See
[Open Knowledge Format exchange](open-knowledge-format.md).

## Context-intelligence operations

The v2.17 context-intelligence surfaces are opt-in and independently bounded:

```sh
# Existing context-pack gate; default search stays flat and compatible.
CAIRN_CONTEXT_PACKS=1

# Optional local usage-receipt mutation.
CAIRN_CONTEXT_USAGE=1

# Optional external retrieval provider (AnythingLLM remains the default).
CAIRN_DOMAIN_RETRIEVAL_PROVIDER=openviking
CAIRN_OPENVIKING=1
CAIRN_OPENVIKING_BASE_URL=http://127.0.0.1:1933
```

For authenticated remote MCP, context packs still require
`CAIRN_CONTEXT_PACK_HTTP=1`; OpenViking retrieval separately requires
`CAIRN_OPENVIKING_MCP_HTTP=1`. Neither setting weakens authentication, Host, or
CORS checks.

Use these source-checkout checks during upgrades and incident diagnosis:

```sh
npm --prefix mcp-memory-server run check:context-pack-retrieval
npm --prefix mcp-memory-server run check:context-usage
npm --prefix mcp-memory-server run check:domain-retrieval
npm --prefix mcp-memory-server run check:retrieval-benchmark
cairn proposals doctor --project /path/to/project --json
(cd /path/to/project && cairn doctor)
```

Proposal extraction is manual. Create, inspect, and apply the exact digest:

```sh
cairn proposals create --session SESSION_ID --scope project --project /path/to/project --json
cairn proposals show PROPOSAL_DIGEST --project /path/to/project --json
cairn proposals apply PROPOSAL_DIGEST --project /path/to/project --json
```

No background process synchronizes OpenViking, creates proposals, applies
memory, enables packs, or approves skills.
