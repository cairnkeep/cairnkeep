# Cairnkeep quickstart

This is the shortest supported route from an empty directory or existing Git
repository to durable, local agent memory. The default transport is stdio and
the default store stays on this computer.

## Codex CLI

Install Cairnkeep, then let guided setup initialize an empty project and write
Codex's project-scoped MCP entry:

```bash
npm install --global @cairnkeep/cli
cairn setup /path/to/project --git init --harness codex --memory local --yes
cd /path/to/project
cairn doctor
./.ai/start-codex.sh
```

Use `--git existing` instead when the target is already a Git work tree. On
native Windows, launch with `.\.ai\start-codex.cmd`.

Before the first session, review `.codex/config.toml` and accept Codex's project
trust prompt. The generated entry runs `cairn memory-server` locally. Setup
does not edit the user-wide Codex configuration and does not enable networking,
telemetry, embeddings, session capture, or context packs.

If `.codex/config.toml` already exists and differs, setup reports it as
`skipped` and preserves it byte-for-byte. Merge this table into the existing
file, then run `cairn doctor`:

```toml
[mcp_servers.cairn-memory]
command = "cairn"
args = ["memory-server"]
```

## Claude Code

Claude Code has the full Cairnkeep operating layer, so it needs one explicit
machine-level sync in addition to project setup:

```bash
npm install --global @cairnkeep/cli
claude mcp add cairn-memory -s user -- cairn memory-server
cairn sync --apply
cairn setup /path/to/project --git init --harness claude --memory local --yes
cd /path/to/project
cairn doctor
./.ai/start-claude.sh
```

Setup reports machine-level commands but never executes them. This keeps
project scaffolding separate from harness-wide changes.

## First memory cycle

In a harness with Cairnkeep commands, remember one durable fact and recall it:

```text
> /remember Use transactional migrations for schema changes
> /recall transactional migrations
```

In Codex or another MCP client, ask the client to call `memory_write`, then
`memory_search`. Close the session, start a new one, and repeat the search. The
result should survive the restart.

## What setup owns

`cairn setup` creates only the selected harness assets plus the common `.ai`,
`.planning`, and `.agentfs` scaffold. It initializes Git only with explicit
`--git init`, preserves unrelated files, does not overwrite modified files it
does not own, and records managed digests in private `.ai/cairnkeep.json`.

Useful follow-ups:

```bash
cairn setup . --git existing --harness codex --memory local --yes  # reconcile
cairn doctor                                                       # diagnose
cairn uninstall --dry-run .                                       # preview removal
```

For all harnesses, remote HTTP, storage, profiles, context packs, overlays, and
recovery details, continue with [Operating Cairnkeep](operating.md) or the
[learning path](learning/README.md).

To add bounded Git state around future generated-launcher sessions, set
`CAIRN_WORK_EVIDENCE=1` in `.ai/.env`; inspect it with `cairn evidence list`.
It is local and off by default. Patch capture remains a separate double-consent
feature. See [Git-linked work evidence](work-evidence.md).
