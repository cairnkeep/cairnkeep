# L29 - Reviewed team continuity preview

**Status:** Brief; opt-in experimental preview in Cairnkeep 2.25.0
**Compatibility:** Cairnkeep 2.25.0 or newer for manual connection; 2.26.0 or newer
on both client and team API for guided connection. Node 22.13 or newer for team storage.
Use a matching source checkout for the executable regression exercises below.
Installing the released CLI does not enable team sharing.

## Outcome

Carry an approved project decision from one client process and working folder
to another, without exposing personal memory or granting an agent review power.
Explain the difference between a restrictive MCP profile and server membership.

## Prerequisites

Complete L20 and L28. Use only synthetic subjects and disposable local stores.
Build the matching checkout with `npm --prefix mcp-memory-server ci` followed by
`npm --prefix mcp-memory-server run build`. Read [Team continuity](../../team.md).
Do not connect a real organization or reuse a production credential.
For an explicitly approved native-harness trial, follow the
[isolated pilot guide](../../team-pilot.md); do not use automated rehearsal as
a substitute for the human review or release-admission steps.

## Source-checkout rehearsal

From the checkout, run the offline controls:

```sh
node mcp-memory-server/scripts/smoke-team.mjs
node mcp-memory-server/scripts/smoke-team-review.mjs
node mcp-memory-server/scripts/smoke-team-http.mjs
node mcp-memory-server/scripts/smoke-team-mcp.mjs
node mcp-memory-server/scripts/smoke-team-restore.mjs
node mcp-memory-server/scripts/smoke-team-cli.mjs
node mcp-memory-server/scripts/smoke-team-onboarding.mjs
```

These create disposable local fixtures and an authenticated loopback service,
invoke actual stdio MCP clients, then clean their generated directories.
No model, personal store, external API or corporate system is used. The MCP
control changes client identity/cwd and retrieves the same approved decision;
it does not infer authority from the working folder or a display name.

Use the [role-based handoff](../../team-onboarding.md) to separate operator,
reader/contributor and human-reviewer tasks. Its executable reader check uses
the original 2.25.0 CLI or newer. The 2.26.0 guided connection exercise below is
still opt-in, not automatic enrollment or deployment. Complete
the readiness checklist with missing decisions marked pending; do not enroll
real users or introduce real data during this exercise.

## Guided client exercise (2.26 or newer)

Use the [guided connection recipe](../../team-onboarding.md#guided-connection-next-release--matching-source-checkout)
with a disposable project and the operator's synthetic workload-reader file.
Run `cairn team connect` once without `--apply`: inspect its selected project,
read-only profile and additional harness files. Confirm that personal/unrelated
MCP entries remain present. Explicitly apply, then run
`cairn team doctor --client --project-root PATH`. Explain the reported credential
expiry/roles and why no memory text is needed to check project access.

Move to another folder: the saved connection still names the explicit team
project. Try an unrelated project and a revoked credential; both must fail.
Compare a disconnect plan with `disconnect --apply --yes`: tokens/backups stay,
only owned unchanged entries disappear. Existing sessions require restart or
server-side revocation; removing local config is not offboarding.

The onboarding regression uses two workload identities and four generated
adapter configurations, actual MCP reads from different folders, a synthetic
review-policy fixture, interrupted activation/recovery and competing writers.
It does not claim two independent humans, a real user approval, every native
harness UI or an LLM quality advantage. No paid model is used. Keep the lesson
Brief until the release-verified learner lab is independently rehearsed.

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
- Independent production review and a deployment's approved real-data pilot are
  separate from the completed internal review and isolated native pilot.

## Privacy and trust boundary

Proposals and snapshots contain selected shared text and identities. Keep them
private and encrypted by the surrounding storage/backup system. Roles do not
make retrieved text executable authority. The OS owner administers membership
and can rewrite the local database; hash links are not independent signatures.
Team search is deterministic substring matching with no provider request.
Personal-memory embedding and reranking settings do not apply to team search.
This token-first JSON API plus local stdio bridge is not OAuth remote MCP HTTP.

## Recovery

The controls clean only their own temporary fixtures. For manual rehearsal,
stop the disposable service, verify the exact generated paths and remove only
that lab. Never run a purge against a real store for a recording. Logical key
deletion does not erase old backup copies or guarantee physical erasure.
Restoring a real service, enrolling users and publishing a release need separate
admission evidence; passing this rehearsal does not supply it.
