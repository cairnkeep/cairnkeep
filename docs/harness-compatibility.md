# Harness compatibility

Cairnkeep separates memory transport from harness-specific operating assets.
An MCP client can use the memory tools without also supporting Cairnkeep's
commands, hooks, plugins, or trajectory adapters.

## Support levels

| Harness | Supported surface | Runtime status |
|---|---|---|
| Claude Code | Memory MCP, commands, agents, hooks, launcher | Exercised by Cairnkeep tests |
| OpenCode | Memory MCP, commands, workflows, plugins, launcher | Exercised by Cairnkeep tests |
| Kimi Code | Memory MCP, `AGENTS.md`, launcher | Launcher tested; remote MCP tested with Kimi Code 0.30.0 |
| Pi | Native opt-in trajectory extension and launcher | Exercised by Cairnkeep tests; no bundled MCP bridge |
| Codex CLI | Memory MCP | Configuration supported; no Cairnkeep operating-layer assets or launcher |
| Other MCP clients | Memory and optional domain-knowledge tools | Protocol-compatible; not automatically runtime-tested |

Only Claude Code and OpenCode currently receive the complete operating layer.
Kimi skills and hooks require harness-specific adaptation and validation before
they can be presented as equivalent. In Kimi, call MCP tools directly or use
ordinary prompts until that work is complete.

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

## Candidate memory clients

The following clients have documented MCP support and are reasonable adapter
candidates, but Cairnkeep does not yet ship their launchers, configuration
writers, operating assets, or runtime CI:

| Client | Documented MCP surface | Cairnkeep status |
|---|---|---|
| Gemini CLI | `mcpServers` in `settings.json` | Candidate for stdio and HTTP memory tests |
| GitHub Copilot CLI | `copilot mcp` and `.mcp.json` | Candidate for memory plus shared skills |
| Qwen Code | `qwen mcp` and MCP configuration | Candidate for stdio and HTTP memory tests |
| goose | MCP extensions and CLI session extension loading | Candidate for memory and recipe integration |

Primary references:

- [Gemini CLI MCP](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md)
- [GitHub Copilot CLI MCP](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
- [Qwen Code MCP](https://qwenlm.github.io/qwen-code-docs/en/users/features/mcp/)
- [goose](https://github.com/aaif-goose/goose)

Support should be added one client at a time with a clean install, a local
stdio handshake, an authenticated HTTP handshake, a real write/recall canary,
storage-path verification, and removal instructions. Documented MCP support by
itself is not enough to claim Cairnkeep support.
