# An isolated team-continuity pilot

This guide is for the opt-in Cairnkeep 2.25.0 team preview. It is **not production admission**.
Obtain explicit pilot approval first. Keep automated rehearsal, human review,
native-harness observations and release authorization as separate evidence.
Use the exact matching source checkout for the source controls below, not an
unverified global command or a production overlay. The released CLI includes
the optional team commands, but installation does not authorize this pilot.

The pilot runs beside existing personal memory: a new private store, expiring
credentials, a separate loopback port and additional isolated client profiles.
It never imports a personal store or replaces an existing MCP registration.
Use synthetic project decisions, not employer, personal or customer data.

## 1. Prepare a private lab

Build the matching checkout. The following setup uses Bash on Linux/macOS; on
native Windows use the equivalent explicit CLI commands from [Team continuity](team.md).
Choose an absolute, **nonexistent** lab directory outside source checkouts,
personal memory, backup stores and other private stores. Do not reuse an old lab.

```sh
TEAM_CAIRN=/absolute/path/to/feature-checkout/bin/cairn
TEAM_PILOT_DIR=/absolute/private/new-team-pilot
```

Run this setup block in that shell. The operator chooses these two paths; the
block refuses an existing lab directory. Credential values are never printed.

<!-- team-pilot-setup:start -->
```sh
set -e
: "${TEAM_CAIRN:?Set the absolute feature-checkout command}"
: "${TEAM_PILOT_DIR:?Set a new absolute private lab directory}"
case "$TEAM_CAIRN:$TEAM_PILOT_DIR" in /*:/*) ;; *) exit 1 ;; esac
mkdir -m 0700 "$TEAM_PILOT_DIR"
mkdir -m 0700 "$TEAM_PILOT_DIR/author-workspace" "$TEAM_PILOT_DIR/reader-workspace"
TEAM_PILOT_EXPIRY=$(node -p 'new Date(Date.now() + 2 * 3600000).toISOString()')
team_pilot_admin() {
  (cd "$TEAM_PILOT_DIR" && env -i PATH="$PATH" CAIRN_TEAM=1 \
    "$TEAM_CAIRN" team "$@" --data "$TEAM_PILOT_DIR/store")
}
team_pilot_admin init --organization trial-org
team_pilot_admin project create trial-project
team_pilot_admin project create unrelated-project
team_pilot_admin member set author --project trial-project --roles reader,contributor
team_pilot_admin member set reader --project trial-project --roles reader
team_pilot_admin member set reviewer --project trial-project --roles reader,reviewer,auditor
team_pilot_admin credential issue author --class workload --expires-at "$TEAM_PILOT_EXPIRY" --output "$TEAM_PILOT_DIR/author.token"
team_pilot_admin credential issue reader --class workload --expires-at "$TEAM_PILOT_EXPIRY" --output "$TEAM_PILOT_DIR/reader.token"
team_pilot_admin credential issue reviewer --class human --expires-at "$TEAM_PILOT_EXPIRY" --output "$TEAM_PILOT_DIR/reviewer.token"
team_pilot_admin doctor
```
<!-- team-pilot-setup:end -->

If setup fails, stop and inspect only that generated lab; do not rerun against a
partially initialized directory. Keep the reviewer token outside both agent
workspaces. File-only credentials are private, but processes under the same OS
owner are not mutually isolated: use separate accounts or machines if that is
part of the pilot's threat model. Do not claim role tests prove OS isolation.

## 2. Start only the disposable service

In a dedicated terminal, choose a separate unused port and run the exact feature
command from the lab directory. Do not kill another listener to claim its port.

```sh
cd "$TEAM_PILOT_DIR"
env -i PATH="$PATH" CAIRN_TEAM=1 CAIRN_TEAM_HTTP=1 \
  "$TEAM_CAIRN" team serve --data "$TEAM_PILOT_DIR/store" --port 17955
```

Keep it in the foreground and use Ctrl+C for shutdown. It binds loopback only.
A second machine needs an authenticated SSH tunnel, not a public API listener.
Keep the production service, personal stores and existing MCP definitions intact.

## 3. Use two additional client profiles

Configure only a new `cairn-team-memory` stdio server in disposable profiles for
the chosen harnesses. Do not edit their user-wide settings, trust lists or tokens.
Use the feature command with arguments `team mcp --project-root WORKSPACE` and
an explicit private workspace path for each client. Both clients receive:

- `CAIRN_TEAM=1`, `CAIRN_TEAM_ORGANIZATION=trial-org`;
- `CAIRN_TEAM_URL=http://127.0.0.1:17955` (or the explicit loopback tunnel);
- `CAIRN_TEAM_TOKEN_FILE` pointing to **only** their own workload credential.

Each tool call must explicitly name project `trial-project`; the working folder
and client name do not select or grant project access.

The author uses `author.token`; the other client uses `reader.token` and
`CAIRN_TEAM_MCP_TOOL_PROFILE=read-only`. Never give either model `reviewer.token`,
an administrative command, production credentials or an inherited cloud-provider
key for this lab. Use a provider explicitly authorized for the pilot. Starting
a server or downloading a model is not implicit subscription authorization.

## 4. Exercise the actual review boundary

Have the author propose one exact synthetic project decision, with explicit
mutation consent. Record the immutable proposal ID, digest, selected bytes and
provenance privately. The reader must not see it before publication.

In the operator-only terminal, use `proposal-show` with the human reviewer
credential to inspect the **actual stored proposal**, not an agent's paraphrase.
Only after the reviewer explicitly approves those bytes, call `review` with
the exact proposal digest as described in [the reference](team.md#harness-connection).
Do not put a human token into an agent profile or script automatic human review.
Checking a hash does not establish human consent or verify a person's identity.

Restart the reader harness in a different empty working folder, retaining the
explicit authorized team project. Verify it reads identical approved text and
provenance. Capture actual tool-use evidence, not a model's claim of recall.
Exercise an unrelated-project denial, a read-only proposal denial, membership
removal on a connected client, and restore into a fresh store with old tokens
refused. Do not change production roles or activate the restored lab implicitly.

## 5. Record, stop and decide

Keep a private, payload-free summary of source revision, client versions,
projects/roles, consent method and outcomes. Label unattended SDK controls as
automated rehearsal; do not turn their pass result into a human-pilot claim.
Record missing steps and failures, including model/tool-use failures.

Stop the foreground lab server. Verify its listener and clients have exited.
Revoke lab credentials if retaining the store; retain or remove only the exact
generated lab after preserving agreed evidence. Never purge a real memory base.
Confirm production configuration hashes are unchanged. No team setting is
enabled globally, so stopping the lab requires no production rollback.

Independent security review, platform checks, pilot approval/results and release
authorization remain distinct gates. Completing this guide does not itself
authorize a merge, release, production enrollment or fleet deployment.
