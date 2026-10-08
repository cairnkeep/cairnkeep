# L29 - Reviewed team continuity preview

**Status:** Brief; unreleased feature-branch preview
**Compatibility:** source checkout containing `team-cli.ts`; Node 22.13 or newer.
The released Cairnkeep 2.22.5 baseline does not include this exercise.

## Outcome

Carry an approved project decision from one client process and working folder
to another, without exposing personal memory or granting an agent review power.
Explain the difference between a restrictive MCP profile and server membership.

## Prerequisites

Complete L20 and L28. Use only synthetic subjects and disposable local stores.
Build the feature checkout with `npm --prefix mcp-memory-server ci` followed by
`npm --prefix mcp-memory-server run build`. Read [Team continuity](../../team.md).
Do not connect a real organization or reuse a production credential.

## Source-checkout rehearsal

From the checkout, run the offline controls:

```sh
node mcp-memory-server/scripts/smoke-team.mjs
node mcp-memory-server/scripts/smoke-team-review.mjs
node mcp-memory-server/scripts/smoke-team-http.mjs
node mcp-memory-server/scripts/smoke-team-mcp.mjs
node mcp-memory-server/scripts/smoke-team-restore.mjs
node mcp-memory-server/scripts/smoke-team-cli.mjs
```

These create disposable local fixtures and an authenticated loopback service,
invoke actual stdio MCP clients, then clean their generated directories.
No model, personal store, external API or corporate system is used. The MCP
control changes client identity/cwd and retrieves the same approved decision;
it does not infer authority from the working folder or a display name.

Trace the lifecycle beside the operator commands in the reference:

```text
selected text → immutable proposal → different human reviews exact digest
             → approved revision → authorized readers across client sessions
```

Stop at each negative control: unapproved proposal invisible to readers;
self/workload review denied; stale policy/base conflicts; unrelated project
denied; revoked credential blocked; restore refuses a live target and revokes
all copied credentials. A confirmed value hash is not evidence of human consent.

For project offboarding, use:

```sh
cairn team member remove SUBJECT --project ID --data DIR
```

Verify that a connected client immediately loses access while the subject's
other project memberships still work. Re-enroll with `member set` and
an explicit nonempty `--roles` list; revoke credentials separately when needed.

## Acceptance criteria

- Two independent stdio clients retrieve identical approved text and provenance.
- Personal memory is untouched, and failed team retrieval never changes scope.
- Reader profiles contain observations only; proposal creation requires consent.
- Human review is absent from the MCP catalog and cannot be performed by workload tokens.
- Role changes and offboarding apply to already-connected clients.
- Backup verifies digests and audit links; restored data needs fresh credentials.
- CLI administration returns to the shell; credentials are never printed.
- Temporary restore remnants are reported, never silently deleted or activated.
- Independent security review and an explicitly approved real pilot remain open.

## Privacy and trust boundary

Proposals and snapshots contain selected shared text and identities. Keep them
private and encrypted by the surrounding storage/backup system. Roles do not
make retrieved text executable authority. The OS owner administers membership
and can rewrite the local database; hash links are not independent signatures.
Team search is deterministic substring matching with no provider request.
This token-first JSON API plus local stdio bridge is not OAuth remote MCP HTTP.

## Recovery

The controls clean only their own temporary fixtures. For manual rehearsal,
stop the disposable service, verify the exact generated paths and remove only
that lab. Never run a purge against a real store for a recording. Logical key
deletion does not erase old backup copies or guarantee physical erasure.
Restoring a real service, enrolling users and publishing a release need separate
admission evidence; passing this rehearsal does not supply it.
