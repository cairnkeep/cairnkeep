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
| Opt-in session trajectories | `<harness project root>/.agentfs/trajectory.db` |
| Opt-in local artifacts and compaction revisions | `<project root>/.agentfs/artifacts.db` |
| Opt-in derived hindsight notes | `${CAIRN_AGENTFS_BASE_DIR:-~/.cairnkeep}/notes/` |
| Any named/global scope, such as `identity` or `work` | `${CAIRN_AGENTFS_BASE_DIR:-~/.cairnkeep}/<scope>.db` |

For the local launchers, the server working directory is normally the project
root. Bootstrap installs `.agentfs/.gitignore` so private project memory is not
accidentally committed. SQLite may also create `-wal` and `-shm` sidecar files.

`CAIRN_LLM_API_URL` and `CAIRN_MEMORY_EMBEDDING_URL` select optional model
services used to process/search memory. They do not change where the SQLite
databases are stored. Git-provider and routing configuration do not change
storage either.

Trajectory storage is deliberately separate from MCP memory. The harness hook
writes `.agentfs/trajectory.db` on the client machine where Claude Code,
OpenCode, or Pi is running; it is never redirected to the remote HTTP memory server.
The database contains versioned full-session records and small time-ordered
indexes. Defaults are 5 MiB per serialized session, 256 MiB logical total and
30 days retention. Capture and `cairn trajectory prune` remove expired records
and then the oldest records needed to meet the logical budget. `prune
--dry-run` reports the same decision without changing the database.

Hindsight notes are also separate derived data. They are human-readable
Markdown below `notes/projects/` and `notes/shared/`, with a local schema-v1
manifest and lock directories below `notes/.cairnkeep/`. Project paths are
represented in visible filenames by readable slugs plus stable local hashes;
the hidden local manifest retains the canonical project root needed for later
all-project runs. Occurrence provenance is capped at 1024 entries per note and
the processed-session ledger at 4096 digests per project. Note bodies do not
expire automatically: inspect/delete them according to your own retention
policy. Trajectory pruning does not delete already-derived notes.

## Artifact storage

Artifacts are deliberately separate from memory and trajectories. Local
compaction hooks, recovery, operator commands, and stdio MCP tools use
`<project>/.agentfs/artifacts.db` with restrictive permissions. Existing
memory/trajectory databases are not migrated, rewritten, or mirrored into it.
SQLite `-wal` and `-shm` sidecars share the same sensitive backup boundary.

The schema-v1 authoritative rows are immutable full envelopes containing ID,
kind, creation time, stable session reference, optional typed-node reference,
media type, logical/stored bytes, digest, provenance, redaction/truncation
metadata, optional supersession, and bounded content. Small derived namespaces
hold created/session/kind indexes, request-dedupe bindings, monotonic
`compaction/sequence/<session>` counters, and latest session/project pointers.
Artifact indexes contain value-minimized metadata and references, never bodies.
Full record, indexes, dedupe, counter, and pointer updates share one immediate
transaction. An identical retry returns the existing ID; changed content
appends a new immutable revision. Deleted revision numbers are never reused.

Defaults are 1 MiB per artifact, 16 MiB per session, 256 MiB total, 30 days,
eight compaction revisions per session, and a 256 KiB generated-file snapshot
cap (or the lower artifact cap). Automatic retention applies age and revision
limits, then removes the oldest eligible records to meet session/store budgets.
It protects the newest valid project compaction. Explicit delete or
`cairn artifact prune --include-protected` may remove that record. Hard delete
removes content, indexes, dedupe rows, and affected pointers; there is no
tombstone or hidden retained body.

`cairn doctor` validates SQLite integrity, schema, authoritative envelopes and
digests, derived indexes, dedupe state, revision pointers, and retention state.
`--repair` rebuilds only safely derived indexes/dedupe/pointers from valid full
records. Unsupported schema, invalid full records, digest mismatch, or SQLite
corruption remains failed and untouched; preserve `.agentfs/artifacts.db` and
its sidecars before manual inspection.

Generated-file `path_label` values are contained project-relative labels only.
They are never dereferenced by MCP, CLI, capture, doctor, or recovery. Binary
or oversized candidates become metadata-only; optional inline text is bounded.

For separately enabled HTTP artifact access, the server requires a validated
`X-Cairn-Project` and derives the database under the server-side configured
base directory as `${CAIRN_AGENTFS_BASE_DIR}/<project-id>/.agentfs/artifacts.db`.
Clients cannot supply a filesystem path, and different project identities use
separate derived roots. The bearer token still defines the trust domain.
Neither `CAIRN_ARTIFACT_HTTP` nor remote memory registration redirects local
compaction hooks or trajectories.
Artifact backup follows the project `.agentfs/` backup boundary described below.

When the memory server runs in the official container, the same rule applies:
the process stores databases below `/data`, normally backed by the
`cairnkeep-data` named volume. Replacing the container preserves that volume;
removing the volume removes the databases. See [Containers](containers.md) for
the exact paths and backup boundary.

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

The same backup boundary applies to `<project>/.agentfs/trajectory.db`, which
is not included in `cairn memory export`. `cairn uninstall PROJECT` retains the
whole `.agentfs/` directory by default. `cairn uninstall --purge-memory PROJECT`
backs it up and removes it, including memory and trajectories; the generated
`revert.sh` can restore it.

The same boundary includes `<project>/.agentfs/artifacts.db` and its sidecars.
`cairn memory export` does not include artifacts. Default uninstall retains the
whole `.agentfs/` tree. `cairn uninstall --purge-memory PROJECT` backs it up
before removal, and the generated `revert.sh` restores the exact durable bytes.
No automatic export or migration of existing artifact stores is performed.

Global hindsight notes share the `${CAIRN_AGENTFS_BASE_DIR}` durable-store
boundary. `cairn uninstall` keeps them by default. `cairn uninstall
--purge-memory` backs up and removes the entire boundary, including `notes/`,
and the generated bundle's `revert.sh` restores the exact files. Back up both
the global store and each project's `.agentfs/` when moving a complete setup;
`cairn memory export` covers SQLite memory scopes, not the Markdown note tree.

## Typed metadata, import replay, and history

With `CAIRN_TYPED_MEMORY_NODES=1`, each concrete AgentFS database keeps raw
live values in the existing `kv_store`. The same SQLite transaction stores
only additive metadata in `cairn_node_metadata_v1` and optional import-ID
bindings in `cairn_node_import_replays_v1`. A legacy row with no metadata is
projected as schema-v1 type `memory` with no tags; reading it creates no table,
row, cache, or rewritten value. There is no ORM or schema-push step: tables are
created lazily only by enabled mutations.
The public portable contract is `schemas/memory-node.schema.json`; matching
runtime validation lives in the packaged server.

Supersede, metadata-only supersede, reviewed changes, import replacement, and
delete write complete value/type/tag snapshots under hidden `__history__` keys
in the same immediate transaction. Delete removes the live metadata row but
retains its final snapshot; recreating the key is supported. Import commit
rechecks conflicts and replay inside one concrete store transaction. Dry-run
does not create the database or metadata tables.

SQLite backups and `cairn memory export` include metadata, replay bindings, and
history. `cairn doctor` treats absent tables as healthy legacy state. Repair
may remove provably orphaned derived metadata, but never rewrites raw KV,
infers non-default types, discards corrupt authoritative metadata, or repairs
a divergent replay digest.

## Canonical note lifecycle and recovery

Note address spaces remain file-backed. The canonical set includes Markdown
leaves, `README.md` indexes, `.cairnkeep/manifest-v1.json`, typed history,
`note-import-replays-v1.json`, and transaction directories below
`notes/.cairnkeep/transactions/<transaction-id>/`. Create, supersede, delete,
and import render immutable path/byte/pre-image/hash plans and install them
through one journal primitive, with the manifest last. There is no AgentFS
mirror and clients never supply filesystem paths.

Staged same-filesystem bytes, backups, and a `prepared` journal are durable
before live replacement. `committing` records completed paths; `committed`
records intended final hashes. Any pending journal blocks later mutations.
Doctor repair restores verified pre-images for prepared/committing state. For
committed-before-cleanup state it verifies final hashes, preserves the completed
operation, and removes only transaction artifacts. Failed verification leaves
the journal and live state untouched; a committed operation is never treated
as an uncommitted rollback candidate.

Generated managed blocks may change, but unmarked maintainer bytes after the
managed marker are preserved exactly. Default uninstall retains databases,
note history, replay ledgers, and journals. `--purge-memory` uses the existing
backup-first whole-store boundary; `revert.sh` restores their exact bytes.

## Reviewed-memory integration

External review systems should not compose `memory_write`, `memory_read`, and
`memory_delete` into their own promotion protocol. That sequence is not atomic
and can delete a newer manual revision during lifecycle invalidation.

Cairnkeep exposes two additive MCP tools for reviewed integrations:

- `memory_apply_reviewed` takes `scope`, `review_id`, `key`, and `value`. It is
  idempotent for the same review and content, preserves a displaced live value
  in memory history, and rejects reuse of the review ID with different content.
- `memory_invalidate_reviewed` takes `scope`, `review_id`, `key`, and an optional
  `reason`. It removes the live value only when it still matches that reviewed
  revision. If apply has not arrived yet, it records a tombstone so a delayed
  apply cannot resurrect invalid memory.

Provenance and tombstones use a hidden reserved namespace in the same scoped
database. Generic memory writes and deletes cannot modify those records. Review
IDs must be stable, non-secret idempotency identifiers; evidence payloads and
credentials do not belong in them.

These tools are for an explicit, trusted integration. Cairnkeep itself does not
approve candidates, discover an evidence service, or promote memory
automatically. Existing clients and the original memory tools remain unchanged.

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
