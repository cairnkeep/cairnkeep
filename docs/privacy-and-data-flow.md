# Privacy and data flow

Cairnkeep has no telemetry, analytics collector, hosted control plane, or
automatic remote-service discovery. A default local stdio installation stores
memory in SQLite on the machine running the MCP server and makes no model or RAG
request unless the corresponding endpoint and credential are configured.

## Data flows

| Feature | Data that can leave the server machine | Destination |
|---|---|---|
| Local substring search | None | Local SQLite only |
| Embedding-ranked search | Stored memory values that are not cached, plus the search query | `CAIRN_MEMORY_EMBEDDING_URL` or `CAIRN_LLM_API_URL` |
| `memory_extract` | The transcript supplied to the tool | `CAIRN_LLM_API_URL` |
| `domain_knowledge_query` | Workspace slug and query | `ANYTHINGLLM_BASE_URL` |
| `domain_knowledge_sync` | Files selected by the sync configuration | `ANYTHINGLLM_BASE_URL` |
| `route_check` | A health request, with no memory or prompt content | `CAIRN_ROUTE_ENDPOINT` |
| `context_explore` | Repository path and query are passed to the configured local executable | `CAIRN_EXPLORE_BINARY`; any further data flow is controlled by that tool |
| Remote HTTP memory | MCP requests and responses, including memory content | The explicitly registered Cairnkeep HTTP server |

Model endpoints may be local or remote. Cairnkeep cannot determine a provider's
retention, training, or logging policy; verify it before sending confidential
material. Disabling `CAIRN_LLM_API_KEY`, `ANYTHINGLLM_API_KEY`, remote HTTP
registration, and delegated tools keeps the core memory workflow local.

## Data at rest

Memories are stored in SQLite databases. They are not encrypted by Cairnkeep at
the application layer. Use operating-system disk encryption, restrictive file
permissions, encrypted backups, and host access controls appropriate to the
sensitivity of the material. SQLite `-wal` and `-shm` sidecars and exported
archives can contain sensitive content too.

Project-scoped and named/global database locations are documented in
[Memory storage and deployment](storage.md). A remote client stores memory on
the remote server host; changing a storage environment variable on the client
does not relocate that server's databases.

The official container stores all databases below `/data`. A named volume
persists them after container replacement and remains sensitive data. Sandbox
workspace mode also retains a repository copy in its named volume. Neither
volume is encrypted by Cairnkeep; remove it explicitly when its retention
period ends. See [Containers](containers.md).

## Credentials and transport

Keep API keys and bearer tokens out of repositories and command output. Load
them from a secret manager or protected environment file. For remote HTTP mode,
use TLS or an encrypted private network and keep the raw listener on loopback.
One HTTP bearer token grants access to the entire server; Cairnkeep does not
provide tenant isolation or per-scope authorization.

Before sharing diagnostics, remove credentials, private endpoints, database
files, memory values, local paths, and project names. Report vulnerabilities
through the private channel in [SECURITY.md](../SECURITY.md).
