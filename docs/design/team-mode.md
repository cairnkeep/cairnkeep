# Team mode design contract

**Status:** design only; not shipped in Cairnkeep 2.15

Cairnkeep 2.15 remains a local, single-operator product. Its playbook receipts
carry provider-neutral project and actor fields so a future authenticated team
service can preserve provenance, but those fields are caller assertions and
must not be used for authorization. This document defines the boundary a team
implementation must satisfy before that statement can change.

## Goal and non-goals

Team mode would let an organization share reviewed memory, context packs,
policies, decisions, and workflow evidence without turning private local
stores into a common bucket. It must retain local-first operation and explicit
promotion. It is not collaborative editing, an agent runtime, employee
monitoring, automatic message ingestion, or an implicit channel for prompts,
credentials, source trees, or session transcripts.

## Identity and project scope

The service must authenticate a human or workload before accepting a team
operation. Stable internal subject IDs, organization IDs, and canonical project
IDs are authoritative; display names, email addresses, Git usernames, and the
current 2.15 `--actor` value are labels only. Authentication adapters may use
OIDC/OAuth, mTLS workload identity, or a locally administered service token,
but normalized claims must include issuer, subject, audience, authentication
time, and credential class. Tokens and raw identity claims never enter memory
or receipts.

Every object has exactly one scope:

| Scope | Owner | Default visibility | Promotion |
|---|---|---|---|
| personal | authenticated subject | that subject | explicit review request |
| project | canonical project | authorized project members | project review policy |
| team | organization collection | named collection members | collection review policy |

Reads never fall through from one project or organization to another. A
personal object is not discoverable through project search until its selected,
redacted form has been approved and copied as a new immutable project object.

## Authorization

Authorization must be deny-by-default and evaluated server-side after
authentication. Minimum roles are `reader`, `contributor`, `reviewer`,
`maintainer`, and `auditor`. Roles map to explicit operations rather than broad
administrator shortcuts:

- readers may list and read approved project objects;
- contributors may create private proposals and submit review requests;
- reviewers may approve or reject proposals but cannot alter their bytes;
- maintainers may manage membership, retention, and project policy but cannot
  approve their own content unless an explicit small-team exception is enabled
  and audited;
- auditors may read append-only audit records, not content by default.

Capability contracts and MCP profiles remain an additional intersection. An
ACL cannot enable a disabled capability, broaden a tool profile, satisfy a
human confirmation, or make a destructive operation read-only.

## Review and conflict model

Shared durable memory and policies use immutable proposals. A proposal binds
the source scope, source object digest, redacted candidate bytes, base revision,
target scope, submitter identity, policy digest, and expiry. Approval creates a
new immutable revision and an audit event; it never mutates the proposal.

Concurrent proposals against the same base remain separate. The service may
compute a deterministic conflict report but must not select or merge a winner.
A reviewer resolves the conflict by accepting one proposal or submitting new
combined bytes. Playbook distribution follows the same review path and may not
silently replace a project override.

## Audit and receipts

Accepted operations append a canonical event containing organization,
project, subject, credential class, operation, object identity and digests,
authorization decision, policy revision, request ID, server time, and result.
Rejected privileged operations append a value-free denial event. Audit records
exclude prompt bodies, source content, secrets, tokens, full environment
snapshots, and unredacted personal data.

Audit history is append-only, hash-linked, bounded by an explicit retention
class, exportable by auditors, and covered by backup/restore verification.
Corrections append superseding events; they never rewrite history. A team
playbook receipt must distinguish the authenticated server subject from any
agent label supplied by a harness.

## Tenant isolation and storage

Organization and project identity must be part of every storage key and every
cache key. Database row policies or physically separate stores must be tested
with cross-tenant negative cases. Context-pack objects may be content-addressed
globally only when existence, metadata, timing, and deduplication cannot leak
across tenants; otherwise storage is tenant-local. Encryption keys, backup
namespaces, search indexes, embedding caches, temporary files, logs, and rate
limits observe the same boundary.

The HTTP deployment must retain authentication, Host and CORS validation,
request-size limits, timeouts, and explicit feature consent. No unauthenticated
compatibility mode may expose team data.

## Retention, deletion, and portability

Each scope declares retention for content, proposals, receipts, audit events,
indexes, and backups. Legal hold is an explicit audited state. Deletion first
revokes visibility, then schedules content and derived indexes for removal;
immutable audit tombstones retain only the minimum identifiers required by the
declared policy. An organization export uses open, versioned schemas with
digests and includes neither credentials nor another tenant's deduplicated
metadata.

## Migration and compatibility

Enabling team mode is an explicit deployment and project decision. Existing
local memory, packs, policies, and receipts remain local until individually
selected for a previewable import. The importer validates schemas and digests,
shows destination scope and redactions, and requires confirmation. There is no
automatic upload, background synchronization, or inference from local paths.

Offline local commands keep working when a team service is unavailable. Local
and server configuration use separate names and provenance so failover cannot
mistake an unverified local actor for an authenticated subject. Downgrade and
export paths must be documented before general availability.

## Admission gates

Team mode is not releasable until all of the following have evidence:

1. Threat model and independent security review covering authentication,
   authorization, confused-deputy attacks, tenant isolation, and audit integrity.
2. Cross-tenant tests for every read, search, cache, export, backup, and error
   path, plus concurrent proposal and stale-policy tests.
3. A privacy review with data inventory, retention/deletion exercises, and
   proof that local projects never upload implicitly.
4. Restore and disaster-recovery rehearsal preserving scope, audit links, and
   revision digests.
5. A migration pilot using synthetic data, followed by an explicitly approved
   limited real-world pilot with rollback.
6. Operational ownership for identity-provider failures, revocation latency,
   incident response, audit export, and key rotation.

Until these gates pass, Cairnkeep documentation and output must describe actor
identity as unverified and team support as deferred.
