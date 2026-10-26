# Team operations: bounded history without automatic deletion

Available from **Cairnkeep 2.27.0**. Use 2.27.0 or newer client/API/admin
binaries for paging and archival; older releases do not include these commands.
The team preview remains default off and is not general production admission.

## Optional pagination

`list`, `history`, `proposals`, `audit` and `search` accept an optional `page`:

```json
{"organization":"demo-org","project":"alpha","operation":"list","page":{"size":20}}
```

The result is `{ "items": [...], "next_cursor": "..." }`; the final cursor
is `null`. Without `page`, existing bounded arrays and ordering remain unchanged.
Sizes are 1–100, or 1–10 for search. The existing team MCP list/search/history
tools accept the same optional object. No admin/review tool is added to MCP.
CLI equivalents are `--page-size N --cursor CURSOR`. Repeat the same project,
operation, filters and page size when continuing.

Cursors are authenticated and bound to the credential, project, roles/policy,
filters and visible result set. Tampering or cross-identity reuse fails;
changed results cause a conflict requiring a new first page. Every call checks
current membership, expiry and revocation. Cursor validity is not authorization.
Audit paging freezes an upper sequence so its own read events do not invalidate
the traversal. New events are visible in a fresh traversal. Restore invalidates
old cursors; its new credentials require a fresh traversal too.

## Capacity before refusal

`cairn team doctor --data DIR` remains local, metadata-only and non-mutating.
It reports record/audit entries, UTF-8 bytes, ceilings, remaining space and
`available`, `near-limit` (80%) or `exhausted` status. These are diagnostics,
not a guarantee that the next write fits. Records remain bounded at 32,768 and
16 MiB. Ordinary audit admission is 99,000 events/16 MiB, with a separate local
operator reserve of 1,000 events/256 KiB. Nothing is evicted automatically.
Archiving audit does not free record capacity.

## Offline, exact-digest archival

Only the trusted local OS operator can archive. **Stop the team API and bridge
writers first**, and use the matching new admin binary. Existing older server
processes cannot be retroactively made schema-aware. Do not archive a store
while an older service still has it open.

Choose private paths outside source trees; ancestors must not be writable by
other users/groups. Keep the backup and archive on durable protected storage.
The following paths are placeholders, not production defaults:

```sh
CAIRN_TEAM=1 cairn team doctor --data /absolute/private/team
CAIRN_TEAM=1 cairn team backup --data /absolute/private/team --read-only \
  --output /absolute/private/backups/pre-archive.json
CAIRN_TEAM=1 cairn team audit-export --data /absolute/private/team \
  --backup /absolute/private/backups/pre-archive.json \
  --output /absolute/private/backups/audit-segment.json
CAIRN_TEAM=1 cairn team audit-verify \
  --input /absolute/private/backups/audit-segment.json
```

`--read-only` makes a consistent backup without adding an audit event, including
when the local reserve is full. Normal backup retains its existing audit event.
The export verifies its backup against current state, writes exclusively with
private permissions and file fsync (plus a directory flush on POSIX), and changes
no database state. Node cannot flush directory handles on Windows; protect and
retain the exported files on reliable storage before applying compaction.
It contains audit
metadata, not memory values or raw bearer tokens. Names and activity are still
sensitive; an export is not a public report.

Use the returned **archive_digest**, not a memory or backup digest:

```sh
# No-write plan:
CAIRN_TEAM=1 cairn team audit-archive --data /absolute/private/team \
  --input /absolute/private/backups/audit-segment.json \
  --backup /absolute/private/backups/pre-archive.json --confirm ARCHIVE_DIGEST
# Repeat the exact command with --apply to compact the verified active prefix.
```

Wrong/tampered/stale backups, archives or confirmation fail. Any intervening
audited operation makes the plan stale: stop writers and produce a fresh pair.
Apply atomically records the archive/backup digests and terminal sequence/hash,
removes the active audit prefix, and appends an archival event. A failed database
transaction rolls back checkpoint, schema change and removal together. No file
is removed or overwritten. Keep **all segments and backups** under an explicit
operator-owned retention policy; no background job or default expiry is added.

## Compatibility, recovery and limits of evidence

Unarchived stores and snapshots stay version 1. Explicit archival changes only
this separate team store to version 2; subsequent snapshots carry its checkpoint.
Older server/admin binaries reject reopening that store. Legacy remote clients
can still use unchanged non-paged API calls with the new service. To roll back
the server format, use the retained pre-archive v1 backup in a fresh location;
never point an older binary at the compacted database. Restore continues to
revoke every copied credential. Reissue credentials and approve reactivation
explicitly; never overwrite a live store with a restore.

Doctor and snapshot validation check the active audit suffix anchored at its
checkpoint. They do **not** open external archives or prove full historical
retention. Verify retained segments with `audit-verify`; pass `--previous FILE`
to check the adjacent archive link. One successful segment check is not a claim
that every earlier segment is present. Digests provide integrity, not publisher
authenticity, independent timestamping or protection against a malicious OS owner.
Compaction is not secure erasure: backups, archives and SQLite pages may retain
data. Audit capacity still fails closed if operators take no action.

## Synthetic continuity endurance

From a matching built source checkout, in a private disposable lab:

```sh
lab=$(mktemp -d)
CAIRN_TEAM_SOAK=1 node mcp-memory-server/scripts/run-team-continuity-soak.mjs \
  --cycles 120 --duration-ms 1200000 --out "$lab/report.json"
```

This exercises two actual stdio MCP client processes across working folders,
separate API process restarts (including an unclean termination), private
token-file rotation, revoked credentials, audit
archival and fresh restore. Its human-class reviewer is a **synthetic policy
fixture**, not actual human consent. No paid model, provider, real memory or
production configuration is used. Reports contain counts, digests and latency,
not selected text or bearer credentials. This is transport/authorization
continuity evidence, not a native-harness UI trial or a model-quality benchmark.
