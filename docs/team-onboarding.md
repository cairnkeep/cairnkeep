# Team preview: a small, explicit handoff

For Cairnkeep 2.25.0 or newer. This is **not production admission**;
no real-data deployment is authorized by following this guide.

## Choose the right workflow

For your own context across sessions, folders and harnesses, keep ordinary
`cairn-memory`. You already have that continuity; you do not need a team store.
Use the team preview when another person should retrieve **selected, reviewed
project decisions**. Personal memory stays separate. An overlay upgrade does
not enroll anyone, start a team service or enable sharing.

| Person | Responsibility | Keep separate |
|---|---|---|
| Operator | Private service, memberships, credentials and recovery | Deployment consent |
| Reader / coding client | Own workload token and explicit project | Human-review token |
| Contributor | Select/redact and propose exact text with consent | Publication authority |
| Human reviewer | Inspect actual proposal, approve/reject its digest | Agent workspace |

## Operator handoff

For an explicitly approved **synthetic** rehearsal, follow the
[isolated pilot setup](team-pilot.md#1-prepare-a-private-lab), then start its
foreground loopback service. The tested recipe refuses an existing lab and
preserves personal MCP settings. Do not use production paths.

Give each participant a connection card: verified CLI version/path; loopback
or authenticated-tunnel URL; organization/project IDs; their individual private
workload-token file and expiry; disposable workspace; revocation contact.
For this lab the IDs are `trial-org` and `trial-project`.

Transfer tokens privately, never through chat, Git, arguments or recordings.
Keep the reviewer token outside agent workspaces. Same-OS-owner processes are
not mutually isolated; use separate accounts/machines when that is required.

## Reader quick-check

In a separate Bash terminal on Linux/macOS, set the operator's paths and URL:

```sh
TEAM_CAIRN=/absolute/path/to/verified-checkout/bin/cairn
TEAM_PILOT_DIR=/absolute/private/new-team-pilot
TEAM_PILOT_URL=http://127.0.0.1:17955
```

This block makes one read request. It does not create storage, issue credentials,
start a service or edit a harness. Expect `[]` before any human publication.
Stop on connection/authorization failure; never fall back to personal memory.

<!-- team-reader-check:start -->
```sh
set -e
: "${TEAM_CAIRN:?Set the verified CLI path}"
: "${TEAM_PILOT_DIR:?Set the private lab directory}"
: "${TEAM_PILOT_URL:?Set the loopback or authenticated-tunnel URL}"
team_pilot_reader() {
  env -i PATH="$PATH" CAIRN_TEAM=1 \
    CAIRN_TEAM_URL="$TEAM_PILOT_URL" CAIRN_TEAM_ORGANIZATION=trial-org \
    CAIRN_TEAM_TOKEN_FILE="$TEAM_PILOT_DIR/reader.token" \
    "$TEAM_CAIRN" team "$@" --project trial-project
}
team_pilot_reader list
```
<!-- team-reader-check:end -->

On native Windows, use equivalent explicit environment settings and
`cairn team list --project trial-project` from [the reference](team.md).

Add **only an additional**, disposable `cairn-team-memory` stdio entry:
the verified command, arguments `team mcp --project-root WORKSPACE`, and the
same four `CAIRN_TEAM*` settings above. For a reader, also set
`CAIRN_TEAM_MCP_TOOL_PROFILE=read-only`. Merge into the isolated harness profile;
never replace `cairn-memory` or its entire configuration. See
[connection semantics](team.md#harness-connection).
Each tool call names `trial-project`; cwd and display names grant no access.
The MCP profile restricts tools; server membership independently restricts data.

## Contributor and reviewer

Contributors get their **own** workload credential and explicit contributor
membership. Start with one synthetic decision; select/redact exact text and
confirm its value digest using the [proposal reference](team.md#harness-connection).
There is no automatic personal-memory import.

In the separate human terminal, inspect `proposal-show`, then approve/reject
the actual stored bytes with their proposal digest. Never hand a human token
to a model. Automated tests of human-class tokens are not human consent.
Restart a reader in another folder: the approved decision/provenance must match;
unrelated-project access and revoked credentials must fail. Follow the
[pilot checks and cleanup](team-pilot.md#4-exercise-the-actual-review-boundary).
Native trials require separately authorized providers; no model purchase or
subscription use is authorized by this guide.

## Deployment readiness

Before requesting a real-data pilot, record an owner and evidence for:

- **Purpose:** project IDs, participants, data classes, one continuity use case,
  explicit exclusions and a stop date.
- **Consent:** selected-data approval, independent production security review
  and deployment authorization. Mark absent decisions pending; tests supply none.
- **Access:** least-privilege roles, individual expiring tokens, separate human
  review, authenticated tunnel/TLS, private storage and trusted host ownership.
- **Operation:** named operator, revocation/offboarding contact, storage/audit
  capacity, encrypted backup retention and a rehearsed fresh-only restore.
  Restored credentials are revoked; reissue and activation remain explicit.
- **Acceptance/rollback:** continuity across clients/folders, denied/unapproved
  content hidden, immediate revocation and unchanged personal config hashes.
  Stop the separate service and remove only its additional client entry to
  withdraw access; preserve agreed private evidence.

Until these decisions are explicitly approved, stay in the disposable synthetic
lab. No automatic production transition follows the rehearsal.
