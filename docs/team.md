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
