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
| Opt-in trajectory capture | None | Local `<project>/.agentfs/trajectory.db` only; no model or HTTP path exists |
| Opt-in deterministic note distillation | None | Reads redacted closed trajectories; writes local Markdown + manifest under `${CAIRN_AGENTFS_BASE_DIR:-~/.cairnkeep}/notes/` |
| Separately opted-in note enrichment | `CAIRN_LLM_API_KEY` | Sends bounded redacted note evidence to the explicit `CAIRN_LLM_API_URL` chat endpoint |

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

## Structured trajectory capture

`CAIRN_TRAJECTORY_CAPTURE` is unset and off by default. When explicitly set to
`1`, `true`, `yes`, or `on`, the existing Claude Code SessionEnd hook reads the
harness-owned transcript file named in its hook event, or the existing OpenCode
session-idle plugin requests that session's structured messages and parts from
the local SDK, or the Pi `session_shutdown` extension reads Pi's active branch
through its read-only session manager. Cairnkeep does not change, copy, retain,
or delete Claude Code's source transcript, and it does not control OpenCode or
Pi's own source retention.
Those harness-owned sources remain a separate privacy boundary.

The capture path allow-lists user messages, visible model outputs, tool
invocations, tool results, system events, timestamps, and usage/cost fields
when the harness exposes them. It does not store hidden reasoning text;
reasoning blocks and unknown record types are counted as omissions. Records are
normalized into the versioned trajectory schema, recursively redacted, bounded
by UTF-8 serialized size, and only then passed to AgentFS. Built-in rules redact
secret-like object keys, bearer/API-key/password forms, credential-bearing URLs,
private-key blocks, and exact values of secret-like environment variables.
For Pi, model and thinking-level changes become system events; hidden thinking
blocks are never written. Provider error messages become redacted system events
so failed sessions remain useful to later hindsight processing. Only the active branch is captured. The extension
passes the structured branch to the same local normalizer/store path, kills a
stalled capture subprocess after three seconds, and always fails open so a
capture error cannot change the Pi session's outcome.

Bootstrap writes `.ai/trajectory-redaction.json` with no custom rules and does
not enable capture. A project may add up to 32 bounded regular expressions to
that file, or select another project-contained file with
`CAIRN_TRAJECTORY_REDACTION_FILE`. Invalid, unreadable, outside-project, or
uncompilable configuration fails that capture attempt before any partial write.
Custom patterns are defense in depth: they can miss an unknown secret shape or
redact too broadly, so captured sessions must still be treated as sensitive.

The redacted v1 session and time index live only at
`<project>/.agentfs/trajectory.db`. Default limits are 5 MiB per session, 256
MiB logical total and 30 days. Capture and explicit `cairn trajectory prune`
apply age and oldest-first budget retention. `list`, `show`, `prune --dry-run`,
doctor output, SQLite `-wal`/`-shm` files, backups and terminal output remain
local but can expose redacted project content, paths, error output and metadata
to anyone who can access them. Cairnkeep provides no application-level
encryption; use host encryption and access controls.

Trajectory capture has no MCP tool or remote HTTP endpoint and never calls an
LLM, embedding service, AnythingLLM, telemetry service, or other network
destination. With the flag unset, the hook/plugin does not create or touch the
trajectory database. `cairn doctor --repair` may rebuild missing metadata and
indexes from valid full records but does not discard an invalid full record;
only capture retention, explicit prune, or explicit uninstall purge removes
trajectory sessions.

## Hindsight note distillation

`CAIRN_NOTE_DISTILLATION` is unset/off by default. With it off, every public
notes operation returns before reading trajectories, walking projects, opening
the note store, acquiring a lock, or making a request. Capture does not imply
distillation, and the presence of any API credential does not enable it.

The local deterministic flow is:

```text
harness-owned source
  → allow-listed, redacted, bounded trajectory in <project>/.agentfs/trajectory.db
  → conservative failure/validation evidence
  → versioned message + stack + component signature and lifecycle reducer
  → local managed Markdown, README indexes, and hidden manifest under ~/.cairnkeep/notes/
```

Only explicit failed tool results, structured nonzero statuses, provider-error
events, equivalent later successful validation calls, and a bounded set of
explicit abandonment phrases affect lifecycle. The note stores normalized
error/component data, session IDs/digests, timestamps, outcome evidence, and
optional generated prose; it does not copy full trajectories or hidden
reasoning. Visible Markdown omits absolute checkout roots. The hidden manifest
retains canonical project roots for local scheduling, lookup maps, lifecycle
records, and processed-session digests. Occurrence history is capped at 1024
entries per note and processed-session history at 4096 digests per project.
Notes have no automatic age deletion and survive trajectory pruning; inspect or
delete them under your local retention policy.

Markdown and manifest files, locks, backups, terminal JSON, and promoted shared
notes are sensitive derived project data. They are owner-readable local files,
not encrypted by Cairnkeep. Generated `cairnkeep:managed:v1` blocks may be
rewritten; text after the block is preserved. Promotion is explicit and local,
requires compatible evidence from two distinct projects plus `--confirm`, and
creates one shared canonical note with project provenance references.

Optional enrichment adds a second, independent egress boundary. It runs only
when `CAIRN_NOTE_ENRICHMENT` and the master flag are truthy and key, base URL,
and model are all explicitly configured. One changed note's bounded redacted
error, component, lifecycle, and attempt strings are sent to the configured
OpenAI-compatible `/chat/completions` endpoint; full trajectories, manifests,
manual Markdown, credentials, and hidden reasoning are not request fields.
Requests use a bounded output, timeout, strict response schema, and at most one
retry. Returned prose is labeled non-authoritative and cannot change identity,
lifecycle, exact keys, or provenance. Missing configuration or provider failure
leaves the deterministic note intact.

Redaction is best effort, not proof that content is non-sensitive. Unknown
secret formats or secrets embedded in unusual free text can survive imperfect
patterns and therefore reach local notes or, if enrichment is enabled, the
configured endpoint. Inspect redaction rules and representative local notes
before enabling enrichment for confidential projects. Endpoint operation,
retention, training, access control, jurisdiction, and deletion policy are the
operator's responsibility; Cairnkeep cannot verify them.

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
