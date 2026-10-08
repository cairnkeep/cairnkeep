# Team continuity preview

Status: experimental feature-branch preview, **not production-admitted**.
Independent security review and a separately approved limited real pilot remain
required. Existing local memory and trusted shared-token HTTP are unchanged.

Team memory is a separate store of explicitly selected, reviewed project
context. It never scans or uploads personal stores, prompts, transcripts or
repositories. The same project IDs work across harnesses and working folders.
Sharing changes visibility: inspect and redact the selected text first.

## Trust boundary

The initial service has one organization, server-owned subjects, explicit
project memberships and expiring/revocable human or workload credentials.
Caller-supplied actor labels do not grant authority. Each operation rechecks
credentials and membership inside its transaction.

Roles are independent: reader retrieves approved memory; contributor submits
and inspects their proposals; reviewer inspects and approves/rejects proposals;
auditor reads scoped audit metadata. Maintainer does **not** imply review or
read authority. Membership administration currently trusts the local OS owner,
not a remote maintainer token. Workload credentials cannot review, even when
their subject has a reviewer role. Self-review is always refused.

Proposals retain exact selected bytes, source digest, base revision, expiry and
policy digest. Review confirms the proposal digest; stale policy/base produces a
conflict, never automatic merging. Publication, head update and audit append are
atomic. Audit stores identities, digests and outcomes—not memory text or tokens.
Hash links detect corruption; they do not prevent a trusted storage owner from
rewriting the database. Digests establish integrity, not publisher authenticity.

## Enable explicitly

Use Node 22.13 or newer for the optional built-in SQLite store. Node 24/26 are
also supported by the implementation; platform admission requires CI evidence.
No new runtime dependency or personal-store migration is needed.

```sh
export CAIRN_TEAM=1
cairn team init --organization demo-org --data /absolute/private/team
cairn team project create alpha --data /absolute/private/team
cairn team member set alice --project alpha --roles reader,contributor --data /absolute/private/team
cairn team member set bob --project alpha --roles reader,reviewer --data /absolute/private/team
cairn team credential issue alice --class workload --expires-at 2026-12-01T00:00:00Z --output /absolute/private/alice.token --data /absolute/private/team
```

Choose a future expiry appropriate to the deployment (maximum one year), not
the example date blindly. Credential output is exclusive and private; the raw
token is never printed. Keep tokens outside source/harness directories.
Organization state defaults to `~/.cairnkeep/team`, overridden by
`CAIRN_TEAM_BASE_DIR` or `--data`. This path convention is not required.

```sh
export CAIRN_TEAM_HTTP=1
cairn team serve --data /absolute/private/team --port 7955
```

The server binds loopback only. Access remotely through an encrypted,
authenticated tunnel; direct unauthenticated/public exposure is unsupported.
The API refuses browser origins, unexpected Host headers, oversized/invalid
requests and revoked credentials. It does not support CORS browser applications.
This is a token-first JSON API—not an OAuth-authorized remote MCP endpoint.
OIDC/SSO and standards-compliant remote MCP HTTP authorization are deferred.

## Harness connection

Set `CAIRN_TEAM_URL`, `CAIRN_TEAM_ORGANIZATION` and `CAIRN_TEAM_TOKEN_FILE` in the
local harness environment, alongside `CAIRN_TEAM=1`. Tokens are file-only.
The URL may be loopback HTTP through a tunnel or HTTPS, without embedded
credentials, query, fragment or path prefix. Redirects are never followed.

Register **an additional** local stdio MCP named `cairn-team-memory`, command
`cairn`, arguments `team mcp --project-root /absolute/project`. Do not replace
the existing `cairn-memory` server or unrelated MCP entries. Every team call
names the explicit server project ID; cwd and display labels never select
authority. Existing personal memory remains independently available.

Tools: `team_memory_list`, `team_memory_read`, `team_memory_search`,
`team_memory_history` and `team_memory_propose`. No review/admin MCP exists.
Retrieval is deterministic substring matching, with no model/provider calls.
The remote boundary is marked open-world in MCP annotations; four retrieval
tools are observations, while proposal creation is an additive mutation and
requires the harness's explicit mutation consent. Approved memory is context,
not executable instruction or authority over maintained source.

The ordinary `CAIRN_MCP_TOOL_PROFILE`/project profile applies through equivalent
core names (`memory_list/read/search/history/write`). Optional
`CAIRN_TEAM_MCP_TOOL_PROFILE=full|read-only|custom` and
`CAIRN_TEAM_MCP_ALLOWED_TOOLS` further restrict the team catalog. Custom names
must be exact team tool names. `memory.write` and `memory.search` capability
settings restrict proposal and search when `CAIRN_CAPABILITY_CONTRACT` is on.
These intersections cannot grant server authority. Team results include a
separate effective profile digest; existing core/capability digests are unchanged.

Human CLI review uses a separately issued human credential in
`CAIRN_TEAM_TOKEN_FILE`:

```sh
cairn team proposals --project alpha
cairn team proposal-show --project alpha --proposal PROPOSAL_ID
cairn team review --project alpha --proposal PROPOSAL_ID --decision approve --confirm PROPOSAL_DIGEST
cairn team search --project alpha --query gateway
cairn team read --project alpha --key decisions/gateway
```

Propose with a private JSON input file containing request UUID, key, selected
value, source_scope (`selected-local` or `selected-project`), source_digest,
base_revision (null for a new key) and expires_at. Confirm the selected value's
UTF-8 SHA-256 with `cairn team propose --project alpha --input FILE --confirm DIGEST`.
Neither CLI nor MCP derives a candidate by reading personal memory for you.
Inspect the proposal's exact content and provenance before confirming review.

Failure is explicit; the bridge never falls back to personal/global storage or
a different identity. Local memory commands still work independently offline.

## Recovery, retention and credential rotation

Local administration requires access as the trusted storage OS owner. It is
not exposed over HTTP or MCP. Keep the data directory private (`0700` on POSIX,
owner-only ACL on Windows); database, WAL, credential and snapshot files are
private too. Do not put a live store inside a source checkout or another store.

```sh
cairn team doctor --data /absolute/private/team
cairn team backup --data /absolute/private/team --output /absolute/private/team-snapshot.json
cairn team restore --input /absolute/private/team-snapshot.json --confirm SNAPSHOT_DIGEST --data /absolute/private/restored-team
cairn team doctor --data /absolute/private/restored-team
```

Backup is a consistent transaction including records and value-free audit.
The output must be a new file; it contains shared text, proposals, subject IDs,
memberships and token hashes. Encrypt and restrict retained copies separately:
the store and JSON snapshot are not encrypted by Cairnkeep. Restore checks
schema, object digests, references and audit links before publishing a new
directory. It never overwrites an existing store. Concurrent cooperating
restores are exclusive; a failure never activates partial restored state.
Every restored credential is revoked. Issue fresh credentials and explicitly
select the restored store only after doctor passes. No automatic service switch
or identity approval occurs. Snapshot digests prove integrity, not authenticity.

Doctor reports temporary-remnant counts without deleting or selecting them.
If an interrupted restore leaves a lock or temporary directory, stop competing
administration, verify process ownership and preserve a copy before manually
removing the exact abandoned path. Doctor never chooses which version to use.

Rotate a credential by issuing a fresh private token file, distributing it
through a separate secure channel, and revoking the old credential ID with
`cairn team credential revoke ID --data DIR`. Replacing the configured token
file makes the bridge use it on the next request; revocation and membership
changes are also enforced on already-connected clients. There are no cached
authorization grants. Protect human reviewer tokens from agent environments.

For a compromised workload token, revoke it first and remove project roles if
needed. Inspect `cairn team audit --project ID` using an auditor credential;
accepted, denied and conflicted authenticated operations record bounded
metadata. Invalid credentials do not create unauthenticated identity records.
Audit integrity is not external tamper resistance against the OS owner.

Current retention is manual: approved revisions, pending/rejected proposals
and audit events do not expire out of storage automatically. Proposal expiry
prevents review, not retention. An operator can delete a selected shared key,
its revisions and associated proposals/reviews using its current head digest:

```sh
cairn team memory-delete --project alpha --key decisions/gateway --confirm REVISION_DIGEST --data /absolute/private/team
```

This is logical deletion, not certified erasure: audit metadata, SQLite free
pages/WAL and older snapshots may retain traces or bytes. Apply a separately
reviewed storage/backup disposal policy if erasure is required. Ordinary
uninstall retains team data. Purge operations overlapping the configured team
store are refused before any uninstall changes; a store selected only through
`--data` must remain outside purge targets or also be set as
`CAIRN_TEAM_BASE_DIR` for that retention check.

## Bounded preview and admission

Selected values are at most 64 KiB UTF-8; requests 512 KiB; responses 2 MiB;
snapshots 64 MiB. Records are capped at 32,768 and 16 MiB of stored JSON;
audit at 100,000 events and 16 MiB, with a 1,000-event/256 KiB OS-operator reserve.
Limits fail closed rather than discarding records. Back up and review retention
before approaching them; the preview has no audit archival/compaction command.
Retrieval is bounded (100 list/history items, ten search results); the API
currently has no pagination. HTTP limits each connection-address and subject
to 120 requests per minute, with at most 512 rate-limit identities; tunneled
clients may share an address budget. Headers are capped at 32 KiB, inactive
requests at ten seconds, and bridge fetches at fifteen seconds.

Digest confirmation proves selected bytes match; it cannot prove a human
clicked approval. MCP hosts must obtain mutation consent. Only separate human
CLI credentials can review, and the OS owner remains trusted to assign them.
No automatic setup, existing MCP replacement or fleet deployment is performed.

Before production: independent security review; Node 22/24/26, native Windows,
real Bash 3.2, installed-package and container verification; then a separately
approved limited real pilot covering offboarding, role changes, restore and
project isolation. Synthetic controls are regression evidence, not that pilot.
OIDC/SSO, multi-organization tenancy, team packs, remote maintainer administration,
provider retrieval and externally anchored audit are deferred.
