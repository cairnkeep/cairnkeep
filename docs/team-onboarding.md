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

<a id="guided-connection-next-release--matching-source-checkout"></a>

## Guided connection (2.26 or newer)

The original preview and reader card above work on 2.25.0. The guided commands
below require both the client **and team API** at 2.26.0 or newer. They do not
change ordinary `cairn setup`, personal memory or the preview's
production-admission boundary.

After the operator supplies a **workload reader** credential, opt in explicitly:

```sh
CAIRN_TEAM=1 cairn team connect --project-root /absolute/project
```

The wizard asks for URL, organization/project IDs, a private credential-file
path and harness checkboxes. Its default tool profile is read-only. It displays
the planned files and asks before applying. Cancellation returns to the shell.
For automation, supply every choice; without `--apply` this only plans:

```sh
CAIRN_TEAM=1 cairn team connect --project-root /absolute/project \
  --url http://127.0.0.1:17955 --organization trial-org --project trial-project \
  --token-file /absolute/private/reader.token --harness claude,opencode
# Repeat the same command with --apply --yes to connect.
CAIRN_TEAM=1 cairn team doctor --client --project-root /absolute/project
```

Never pass a token value. Keep the credential file outside this project's
source tree and owner-only (POSIX 0600; native Windows private ACL). URLs must
be loopback HTTP or HTTPS, without credentials, query, fragment or path prefix.
Use the operator's encrypted authenticated tunnel, not a public unauthenticated
listener. The command authenticates reader access before changing a harness.
It refuses human-class credentials: the operator must issue a workload token
for the agent, keeping human review credentials in the separate human terminal.

| Harness choice | Project-local file | Additional entry |
|----------------|--------------------|------------------|
| `claude` | `.mcp.json` | `mcpServers.cairn-team-memory` |
| `opencode` | `opencode.json` | `mcp.cairn-team-memory` |
| `qwen` | `.qwen/settings.json` | `mcpServers.cairn-team-memory` |
| `codex` | `.codex/config.toml` | marked `mcp_servers.cairn-team-memory` block |

No global harness file is written. Existing unrelated entries are preserved;
an existing team entry, duplicate JSON keys, JSONC or unsupported inline TOML
causes refusal rather than replacement. OpenCode `opencode.jsonc` is not edited.
Pi/OMP/Kimi use the manual bridge recipe; this wizard does not claim automated
configuration for them. Harness-native trust/enablement prompts still apply.
Adapter regression uses real SDK stdio calls, not live model/harness UI sessions.

The generated entry invokes the verified Node/CLI paths with a private
`--connection` file. It pins the server project even if the harness starts in
another folder; each tool call still names that ID. It does not grant server
membership. Contributors can explicitly select `--access full` to expose
proposal creation, still subject to existing profile/capability restrictions
and server authorization. Human review/admin tools never become available.
Changing connection settings requires disconnect/reconnect; credentials may be
rotated in place without a harness restart because the bridge rereads the file.

### Client diagnosis and recovery

Client doctor verifies the active managed entries and private credential file,
then makes one authenticated `connection-check` request. It reports the current
subject, credential ID/class/expiry, project and roles, **not** memory text,
proposals, token values or environment snapshots. The service appends its normal
value-free audit event. It opens no local administrator store and cannot issue
credentials, grant membership or repair permissions. Wrong org/project, missing
reader membership and expired/revoked credentials require the operator; failed
team access never falls back to personal memory. Check the tunnel/TLS and API
version on connection failure. Store doctor remains `team doctor --data DIR`.

```sh
CAIRN_TEAM=1 cairn team disconnect --project-root /absolute/project
# Inspect the no-write plan, then:
CAIRN_TEAM=1 cairn team disconnect --project-root /absolute/project --apply --yes
```

Disconnect removes only unchanged owned entries. It restores exact original
bytes when nothing else changed; otherwise it preserves unrelated edits and
refuses an altered team entry. It keeps the token and private backups. Restart
existing harness sessions; disconnect is **not revocation**. The operator must
revoke a credential/remove membership for immediate denial in running sessions.

Connection records and original configuration snapshots are private under
`~/.cairnkeep/team-clients/<canonical-project-path-sha256>/`. Backups may include
secrets already present in your original MCP config: never commit or publish
them; use separately encrypted backups as appropriate. No token content is
copied from its file. Disconnected records are retained in uniquely named
`.disconnected-*` siblings. Uninstall/purge refuses to delete this retained state.

A per-project exclusive `<project-path-hash>.operation.lock` beside the state
directory serializes Cairnkeep writers and stays held while state is archived,
including on native Windows. A failed
multi-file connect keeps its recovery record in `preparing`; the bridge refuses
startup until **all** entries are written and activation is committed. Run
disconnect to undo an interrupted operation after checking for configuration
drift. An interrupted disconnect is likewise resumable. Do not restore a whole
backup over newer unrelated edits. If the process crashed holding its lock,
first verify no connection/disconnection process is running, preserve the state
directory, then manually remove **only that project's** sibling `.operation.lock` and
retry disconnect. The tool never guesses that a live lock is stale.

Configuration directories must be owned/trusted and not writable by other users.
Each configuration is bounded to 1 MiB and the four-file recovery record to
16 MiB, including both original/new bytes and base64 overhead.
Links and unsafe files are rejected. Writers use bounded descriptor-first reads,
exclusive creation and atomic replacement with a final drift check. This is not
an OS compare-and-swap against a hostile process running as your own identity;
stop concurrent editor writes before applying. No root-directory or global
configuration target, automatic permission changes to existing directories,
automatic enrollment or background synchronization is introduced.

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
