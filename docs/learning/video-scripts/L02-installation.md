# L02 Video Script - Install the local workflow

**Target duration:** 12 minutes
**Companion lesson:** [L02](../lessons/L02-installation.md)

## Recording setup

- Use a clean user profile or disposable VM with Node.js 22 or newer.
- Install Claude Code but remove any existing `cairn-memory` registration.
- Ensure no private MCP servers, provider URLs, or environment variables appear.
- Prepare a snapshot before installation for a repeatable retake.

## 00:00 - Hook

**Say:** “The most common incomplete installation has a running memory server
but no Cairnkeep commands or hooks. We will install and verify all three parts
of the local workflow.”

**Show:** A three-part diagram: CLI, MCP registration, operating layer.

## 00:40 - Outcome

**Say:** “At the end, Claude Code can start the local `cairn-memory` server and
the managed command assets pass a non-writing drift check.”

## 01:10 - Runtime preflight

**Do:** Run `node --version` and `npm --version`.

**Say:** “Cairnkeep requires Node.js 22 or newer. I verify that before changing
the machine.”

## 02:00 - Install the CLI

**Do:** Run the pinned npm install and `cairn --version` from L02.

**Say:** “For a course recording I pin the version. Users can follow the current
release instructions when the lesson is updated.”

## 03:30 - Register MCP

**Say:** “The stable server name is `cairn-memory`. This command tells Claude
Code to launch a local stdio child process. It does not configure a remote URL.”

**Do:** Run the `claude mcp add` command, followed by `claude mcp get cairn-memory`.

**Point out:** The command is `cairn memory-server`.

## 05:15 - Install the operating layer

**Say:** “MCP tools alone do not install `/remember`, `/recall`, wiki commands,
review workflows, agents, or hooks. That is the job of `cairn sync`.”

**Do:** Run `cairn sync --apply`.

**Pause:** Allow the learner to see the asset summary.

## 07:00 - Verify without writing

**Do:** Run `cairn sync --check`.

**Say:** “This is the repeatable drift check. A healthy result means the
operating layer matches the installed distribution. MCP registration plus this
check distinguishes a complete setup from a partial one.”

## 08:30 - Common failure demonstration

**Say:** “If slash commands are missing, do not reinstall everything blindly.
First check the MCP registration, then check operating-layer drift, and restart
the harness after applying assets.”

**Show:** The two verification commands together.

## 09:40 - Boundary

**Say:** “This default server is local. We did not configure embeddings,
document RAG, or remote HTTP memory. Those choices have separate lessons
because they change data flow.”

## 10:30 - Recap

**Say:** “The machine setup has three pieces: CLI, MCP registration, and the
operating layer. In L03 we add the fourth piece, a bootstrapped project, and
prove memory survives a new session.”

## Editing notes

- Chapter markers: Preflight, CLI, MCP, Operating layer, Verify, Boundary.
- Do not show the general MCP list if it contains unrelated server names.
- Link L02, the operating guide, and L03.
