# Memory storage and deployment

## The placement rule

Cairnkeep stores memory on the filesystem of the machine running the
`cairn-memory` server process. It does not discover a cloud service, VPS, or
shared host, and installing the npm package does not contact one.

The standard registration is local:

```bash
claude mcp add cairn-memory -s user -- cairn memory-server
```

This starts `cairn memory-server` as a local stdio child process. With that
registration, memory remains on that computer.

| Scope | Database path |
|---|---|
| `project` | `<server working directory>/.agentfs/project.db` |
| Any named/global scope, such as `identity` or `work` | `${CAIRN_AGENTFS_BASE_DIR:-~/.cairnkeep}/<scope>.db` |

For the local launchers, the server working directory is normally the project
root. Bootstrap installs `.agentfs/.gitignore` so private project memory is not
accidentally committed. SQLite may also create `-wal` and `-shm` sidecar files.

`CAIRN_LLM_API_URL` and `CAIRN_MEMORY_EMBEDDING_URL` select optional model
services used to process/search memory. They do not change where the SQLite
databases are stored. Git-provider and routing configuration do not change
storage either.

## Remote HTTP mode

Remote storage is explicit. An operator starts Cairnkeep in HTTP mode on a
server, configures storage in that server process's environment, and registers
the resulting URL in each client harness. For example:

```bash
# On the server host. Put TLS in front of this listener before remote use.
CAIRN_AGENTFS_BASE_DIR=/var/lib/cairnkeep \
CAIRN_MEMORY_HTTP_TOKEN="$(openssl rand -hex 32)" \
CAIRN_MEMORY_HTTP_ALLOWED_HOSTS=memory.example.com \
MCP_HTTP_HOST=127.0.0.1 MCP_HTTP_PORT=7801 \
cairn memory-server

# On a client. CAIRN_MEMORY_HTTP_TOKEN must contain the server's token.
claude mcp add --transport http -s user \
  --header "Authorization: Bearer $CAIRN_MEMORY_HTTP_TOKEN" \
  cairn-memory https://memory.example.com/mcp
```

With this topology, the databases are on the server host, not the client PC.
Setting `CAIRN_AGENTFS_BASE_DIR` on the client does not redirect a remote
server; set it in the server service environment.

### Per-project remote sessions

Remote clients can bind an MCP session to a stable project identity and send
the memory configuration that a local server would read from `memory.json`:

| Header | Purpose |
|---|---|
| `X-Cairn-Project` | Kebab-case project identity, up to 64 characters |
| `X-Cairn-Scopes` | Comma-separated scopes used when a tool reads scope `all` |
| `X-Cairn-AnythingLLM-Workspaces` | Comma-separated AnythingLLM workspace slugs; the first non-`engineering-patterns` workspace is the default |

When `X-Cairn-Project` is present, `project` scope is stored at
`${CAIRN_AGENTFS_BASE_DIR}/projects/<project-id>.db`. Sessions with different
project identities therefore do not share project memory. Without the header,
HTTP mode retains the legacy behavior and resolves `project` from the server
working directory.

These headers are session routing metadata, not authorization. The bearer
token still grants access to the entire server, including the ability to choose
another valid project identity. Use separate server instances for separate
trust domains.

HTTP mode is one trusted storage domain:

- One bearer token grants access to every exposed memory tool.
- There is no per-user ACL, tenant isolation, or client-specific filesystem.
- Sessions without `X-Cairn-Project` share the project database resolved from
  the server process's working directory.
- Use one server instance per isolation boundary. Do not offer one instance to
  mutually untrusted users.
- Keep the Cairnkeep listener on loopback behind a TLS reverse proxy, or use an
  encrypted private network. Do not expose its raw HTTP listener publicly.

## Inspecting and moving memory

For a local server, these commands report and move named/global scopes only:

```bash
cairn memory path
cairn memory export global-memory.tgz
cairn memory import global-memory.tgz
```

`cairn memory path` reports the local process's global-scope directory; it
cannot inspect a harness's remote HTTP registration. Export uses SQLite's
online backup operation and requires the `sqlite3` CLI.

Project memory is separate at `<project>/.agentfs/project.db` and is not
included in `cairn memory export`. Back it up while the server is stopped, or
take an online snapshot with SQLite:

```bash
sqlite3 /path/to/project/.agentfs/project.db \
  ".backup '/safe/path/project-memory.db'"
```

Treat every database and export archive as sensitive. They may contain source
paths, decisions, incident details, and other project context.

## Automating trusted personal clients

Keep fleet-specific values in a private dotfiles repository or secret manager,
not in Cairnkeep. A personal bootstrap can install the public package and then
perform the explicit remote registration:

```bash
# Populate these from a private secret manager on each trusted PC.
export CAIRN_MEMORY_REMOTE_URL=https://memory.example.com/mcp
export CAIRN_MEMORY_HTTP_TOKEN=replace-from-secret-manager

npm install -g @cairnkeep/cli

claude mcp remove cairn-memory -s user 2>/dev/null || true
claude mcp add --transport http -s user \
  cairn-memory "$CAIRN_MEMORY_REMOTE_URL" \
  --header "Authorization: Bearer $CAIRN_MEMORY_HTTP_TOKEN"

codex mcp remove cairn-memory 2>/dev/null || true
codex mcp add cairn-memory \
  --url "$CAIRN_MEMORY_REMOTE_URL" \
  --bearer-token-env-var CAIRN_MEMORY_HTTP_TOKEN
```

Codex reads the bearer token from the named environment variable when it
starts. Do not run `codex mcp login cairn-memory`: that command starts an OAuth
flow, while Cairnkeep intentionally uses a static bearer token and advertises
no OAuth authorization endpoint.

OpenCode is configured separately in its per-user `opencode.json`. It supports
environment references in remote MCP headers, so the token does not need to be
written literally into the JSON:

```json
{
  "mcp": {
    "cairn-memory": {
      "type": "remote",
      "url": "https://memory.example.com/mcp",
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:CAIRN_MEMORY_HTTP_TOKEN}"
      }
    }
  }
}
```

Ensure the secret-manager bootstrap exports `CAIRN_MEMORY_HTTP_TOKEN` before
OpenCode starts. Preserve any other keys already present in `opencode.json`
rather than replacing the whole file. The URL, token, private host names, and
device-specific configuration must never be committed to this public project.

For distinct project memory, install a project-local MCP entry with the same
URL and authorization header plus the three routing headers. Claude Code
expands `${VAR}` references in project `.mcp.json` URL and header values;
OpenCode uses `{env:VAR}` references. A private overlay should generate and
merge these files so secrets remain in the process environment rather than the
repository.

For Codex, put the routing configuration in the trusted project's private
`.codex/config.toml` and exclude it from version control:

```toml
[mcp_servers.cairn-memory]
url = "https://memory.example.com/mcp"
bearer_token_env_var = "CAIRN_MEMORY_HTTP_TOKEN"

[mcp_servers.cairn-memory.http_headers]
"X-Cairn-Project" = "example-project"
"X-Cairn-Scopes" = "identity,personal,project"
"X-Cairn-AnythingLLM-Workspaces" = "engineering-patterns"
```
