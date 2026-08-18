# Harness compatibility

Cairnkeep separates memory transport from harness-specific operating assets.
An MCP client can use the memory tools without also supporting Cairnkeep's
commands, hooks, plugins, or trajectory adapters.

All six generated launchers—Claude Code, OpenCode, Kimi, Qwen, Pi and Codex—
support the same opt-in Git-linked work-evidence wrapper. The wrapper is local,
requires `CAIRN_WORK_EVIDENCE=1`, and fails open so optional capture cannot
prevent a harness from launching. It does not imply that the harness supports
Cairnkeep commands, hooks or native trajectory capture.

## Support levels

| Harness | Supported surface | Runtime status |
|---|---|---|
| Claude Code | Memory MCP, commands (including `/cairn-work`), agents, hooks, launcher | Exercised by Cairnkeep tests |
| OpenCode | Memory MCP, commands (including `/cairn-work`), workflows, plugins, launcher | Exercised by Cairnkeep tests |
| Kimi Code | Memory MCP, `AGENTS.md`, launcher, opt-in graph and cairn-work Skills | Launcher tested; remote MCP tested with Kimi Code 0.30.0; Skills contract-tested |
| Qwen Code | Memory MCP, launcher, project `AGENTS.md` durable-context and playbook guidance | Launcher tested; stdio and remote MCP tested with Qwen Code 0.21.1 |
| Pi | Memory MCP through maintained local stdio extension, native opt-in trajectory extension, launcher, graph and cairn-work prompts | Pi 0.84.1 validated minimum; deterministic and real bridge/lifecycle tests |
| Codex CLI | Project-scoped memory MCP, launcher, and project `AGENTS.md` durable-context and playbook guidance | Setup and launcher contract-tested on POSIX and simulated native Windows; project trust remains operator-controlled |
| Other MCP clients | Memory plus optional domain-knowledge and context-pack tools | Protocol-compatible; not automatically runtime-tested |

Only Claude Code and OpenCode currently receive the complete operating layer.
Kimi receives narrow graph and playbook Skills, while Pi receives matching narrow prompts;
neither is equivalent to the full commands, agents, hooks, and plugins surface.
Qwen skills and hooks still require harness-specific adaptation and validation.
Codex receives a project-local MCP entry, launcher, and portable durable-context
and playbook instructions, but not Cairnkeep-specific commands, hooks, agents,
or automatic skill activation. The durable-context protocol makes its
task-derived search the first tool or command, and the playbook instructions
provide bounded signal values, executable receipt syntax, and command- or
event-scoped help.
Harness behavior remains probabilistic; instruction presence must not be
reported as a tool invocation without runtime evidence.

Every MCP client receives complete tool annotations and may use a Cairnkeep
least-authority profile independent of harness assets. Context-pack tools are
ordinary read-only MCP tools (including imported-OKF link traversal) and require the pack feature gate; authenticated
HTTP additionally requires separate pack-HTTP consent. Approved pack skills
remain context documents, not native harness Skills or automatic instructions.

`cairn graph` is a separate, harness-independent project-shell CLI. Kimi Code,
Pi, Qwen Code, Codex, and other shell-capable clients can invoke
`cairn graph build|query|status|diff|explain|path` when `cairn` and the isolated
`graphify` executable are on `PATH`. `cairn sync-kimi --apply` registers a Kimi
Skill as `/graphify` (or `/skill:graphify`), and `cairn sync-pi --apply`
registers a Pi prompt template as `/graphify`; both delegate exclusively to
that CLI. Pi sync separately installs the Cairnkeep-owned local stdio memory
extension; it does not expand the other support levels.

## Pi

Run `cairn sync-pi --apply` explicitly to install
`extensions/cairnkeep-memory.ts`, `extensions/cairnkeep-trajectory.ts`, and
`prompts/graphify.md`, and `prompts/cairn-work.md` under the Pi agent root. Use `--check` for drift and
`cairn doctor` from a project that selected Pi for setup-aware diagnosis. Setup
reports this machine command but never runs it automatically. Uninstall removes
only those owned paths, backup-first.

The memory extension supervises `cairn memory-server` as a local stdio child.
It discovers the effective MCP catalog dynamically and preserves names,
descriptions, input/output schemas, original content, `structuredContent`,
`_meta`, failure behavior, and the exact tool annotations in trusted result
`details`. Pi 0.84.1 exposes no native annotations field in its public tool API,
so those annotations are not claimed as native model-facing metadata. Server
feature gates, capability state, and least-authority profiles continue to
decide which tools exist.

Startup, calls, results, stderr retention, cancellation, and shutdown are
bounded. The extension adds tools only: it does not run prompts, activate
context-pack skills, create an autonomous loop, or add a remote transport.
Pi 0.84.1 is the validated minimum. The v2.11 release matrix passed separate
installations for that minimum and the explicitly versioned registry-current Pi
release, together with Node.js 22/24/26, Bash 3.2, and native Windows. The
executable paths were distinct; both reported 0.84.1 because that was also the
registry-current release.

## Kimi Code

Kimi Code reads three MCP files, in increasing precedence:

1. `~/.kimi-code/mcp.json`;
2. the repository-root `.mcp.json`, for Claude compatibility;
3. `.kimi-code/mcp.json` in the working directory.

Each file must be valid before entries are merged. A later Kimi-specific entry
does not rescue an invalid repository-root entry.

### Local stdio

Create `.kimi-code/mcp.json` in a trusted project:

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

Then launch through the generated project launcher:

```bash
./.ai/start-kimi.sh
```

The server is a local child process and writes to the storage selected by the
launcher's `.ai/.env`. Kimi warns that project MCP commands execute when a
session starts, so use this only in a repository you trust.

### Remote HTTP

Kimi validates `url` as a literal URL and does not expand `${VAR}` there. Keep
the resolved URL in a private `.kimi-code/mcp.json`, reference the bearer token
by environment-variable name, and keep non-secret routing headers explicit:

```json
{
  "mcpServers": {
    "cairn-memory": {
      "url": "https://memory.example.com/mcp",
      "bearerTokenEnvVar": "CAIRN_MEMORY_HTTP_TOKEN",
      "headers": {
        "X-Cairn-Project": "example-project",
        "X-Cairn-Scopes": "identity,personal,project",
        "X-Cairn-AnythingLLM-Workspaces": "example-workspace"
      }
    }
  }
}
```

Do not commit the private file when the endpoint or routing metadata is private.
Add it to `.git/info/exclude` or generate it through an overlay. The token value
stays in `.ai/.env` and is read at connection time.

If the repository-root `.mcp.json` contains
`"url": "${CAIRN_MEMORY_REMOTE_URL}"`, Kimi fails before launch with
`Invalid URL`. Replace that private file's URL with a resolved value, or remove
the entry when Kimi's private override is the intended owner. Do not place the
token value in either file.

Kimi MCP configuration is documented at
[Kimi Code MCP](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html).

## Qwen Code

Qwen Code can read MCP definitions from user settings, project
`.qwen/settings.json`, and compatible repository `.mcp.json` files. Use the
Qwen-specific project settings file for remote HTTP so its `httpUrl` transport
and environment expansion are explicit.

### Local stdio

Create `.qwen/settings.json` in a trusted project:

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

Project MCP definitions are approval-gated. Review the file, then run:

```bash
qwen mcp approve cairn-memory
./.ai/start-qwen.sh
```

The server is a local child process. Its storage stays on this computer unless
the operator deliberately replaces this stdio definition with a remote one.

### Remote HTTP

Qwen Code 0.21.1 was exercised with environment expansion in project settings:

```json
{
  "mcpServers": {
    "cairn-memory": {
      "httpUrl": "${CAIRN_MEMORY_REMOTE_URL}",
      "headers": {
        "Authorization": "Bearer ${CAIRN_MEMORY_HTTP_TOKEN}",
        "X-Cairn-Project": "example-project",
        "X-Cairn-Scopes": "identity,personal,project",
        "X-Cairn-AnythingLLM-Workspaces": "example-workspace"
      }
    }
  }
}
```

Keep the endpoint and token in `.ai/.env` or a machine secret store. The
generated launcher exports `.ai/.env` before Qwen reads the settings. Re-run
`qwen mcp approve cairn-memory` after changing the project definition because
the approval is bound to the configuration digest.

The authenticated recipe above is validated for `.qwen/settings.json`.
Cairnkeep does not assume that a one-shot `--mcp-config` input performs the same
environment expansion. A private overlay should write the project settings
backup-first, preserve unrelated keys, exclude private routing metadata from
Git, and leave secret values as environment references.

Qwen MCP configuration is documented at
[Qwen Code MCP](https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/).

## Codex CLI

Select Codex during setup to create a project-scoped local stdio entry and
launcher:

```bash
cairn setup /path/to/project --git init --harness codex --memory local --yes
cd /path/to/project
./.ai/start-codex.sh
```

Native Windows uses `.\.ai\start-codex.cmd`. The generated
`.codex/config.toml` contains only:

```toml
[mcp_servers.cairn-memory]
command = "cairn"
args = ["memory-server"]
```

Review this file before accepting Codex's project-trust prompt. Cairnkeep does
not grant trust, edit the user-wide Codex configuration, or start Codex during
setup. If an operator-owned `.codex/config.toml` already differs, setup reports
`skipped` and leaves it unchanged; merge the table manually and run `cairn
doctor` to verify the effective entry. Uninstall never removes an
operator-owned configuration file.

The launcher loads `.ai/.env`, runs optional pre/post hooks, changes to the
project root, and passes all arguments to `codex`. It does not install native
Codex Skills or instructions and does not activate approved context-pack skills.

Codex uses MCP annotations when deciding whether a tool needs approval. In
non-interactive `codex exec`, an unapproved mutating call is cancelled rather
than silently executed. Cairnkeep intentionally does not autoapprove memory
writes during setup. An operator who has explicitly authorized a bounded,
unattended workflow may add narrow per-tool policy to the isolated Codex config:

```toml
[mcp_servers.cairn-memory.tools.memory_write]
approval_mode = "approve"

[mcp_servers.cairn-memory.tools.memory_supersede]
approval_mode = "approve"
```

Do not add this to shared or ordinary interactive configuration merely to avoid
prompts. Keep the allowlist limited to the authorized tools and continue to use
Cairn MCP profiles and project isolation. See the
[official Codex MCP configuration reference](https://developers.openai.com/codex/mcp)
for approval-mode semantics.

## Candidate memory clients

The following clients have documented MCP support and are reasonable adapter
candidates, but Cairnkeep does not yet ship their launchers, configuration
writers, operating assets, or runtime CI:

| Client | Documented MCP surface | Cairnkeep status |
|---|---|---|
| Antigravity CLI | Workspace `.agents/mcp_config.json` and plugins | Current successor candidate for memory plus native operating assets |
| Cursor | Project `.cursor/mcp.json`, plugins, and Agent CLI | Candidate for memory plus native operating assets |
| GitHub Copilot CLI | `copilot mcp` and `.mcp.json` | Candidate for memory plus shared skills |
| Factory Droid | Native plugin marketplace | Candidate for reusing a compatible operating-layer package |
| goose | MCP extensions and CLI session extension loading | Candidate for memory and recipe integration |
| Gemini CLI | `mcpServers` in `settings.json` | Legacy candidate for enterprise or API-key users only |

Primary references:

- [Antigravity MCP](https://antigravity.google/docs/mcp)
- [Cursor MCP](https://docs.cursor.com/context/model-context-protocol)
- [GitHub Copilot CLI MCP](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
- [goose](https://github.com/aaif-goose/goose)
- [Gemini CLI transition announcement](https://github.com/google-gemini/gemini-cli/discussions/28017)
- [Superpowers harness integrations](https://github.com/obra/superpowers)

Superpowers is a useful comparison because it keeps shared behavior in one
source tree and ships thin native adapters through each harness's supported
plugin, extension, hook, or context mechanism. Cairnkeep follows the same
principle for future operating-layer ports: reuse common content, map real tool
names and lifecycle events per harness, and document degraded capabilities
instead of copying one harness's files into another.

Support should be added one client at a time with a clean install, a local
stdio handshake, an authenticated HTTP handshake, a real write/recall canary,
storage-path verification, and removal instructions. Documented MCP support by
itself is not enough to claim Cairnkeep support.
