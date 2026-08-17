# L02 - Install the local workflow

**Status:** Ready
**Track:** Quickstart
**Time:** 25 minutes
**Tested with:** Cairnkeep 2.15.0 and Node.js 22 or newer

## Outcome

You can install the CLI, register the local memory server, install the operating
layer, and distinguish a complete installation from a partial one.

## Prerequisites

- Node.js 22 or newer and npm.
- Claude Code installed for the full operating-layer commands below. Codex CLI
  users can take the project-scoped path in L03. OpenCode, Kimi Code, and Qwen Code users
  should follow the equivalent setup in
  [the operating guide](../../operating.md).
- Permission to install an npm package globally for your user.

## Mental model

A complete setup has three independent parts:

1. the `cairn` CLI and memory server;
2. the MCP registration used by the harness;
3. the operating layer containing commands, agents, hooks, and templates.

`cairn setup` configures a project later; it does not perform the first two
machine-level steps. `cairn bootstrap` remains the compatibility primitive for
scripts and overlays that already own their setup policy.

Codex is the simpler memory-only exception: L03 writes its project-scoped MCP
entry and launcher, so it needs no user-wide MCP registration or machine-level
sync. Codex project trust remains an explicit operator decision.

## Exercise

1. Confirm the runtime:

   ```bash
   node --version
   npm --version
   ```

2. Install Cairnkeep:

   ```bash
   npm install --global @cairnkeep/cli@2.14.0
   cairn --version
   ```

3. Register the local stdio server under the stable name `cairn-memory`:

   ```bash
   claude mcp add cairn-memory -s user -- cairn memory-server
   ```

4. Install the operating layer:

   ```bash
   cairn sync --apply
   ```

5. Check for drift without modifying anything:

   ```bash
   cairn sync --check
   ```

6. Optionally enable completion in the current Bash shell:

   ```bash
   source <(cairn completion bash)
   ```

   Use `cairn completion zsh` or `cairn completion fish` for those shells.
   Completion is a convenience and is not another runtime component.

   On native Windows PowerShell, use:

   ```powershell
   Invoke-Expression (& cairn completion powershell | Out-String)
   ```

   Project setup emits `.cmd` launchers on Windows; use
   `.\.ai\start-claude.cmd` instead of the Unix `.sh` launcher.

## Verify

Run both checks:

```bash
claude mcp get cairn-memory
cairn sync --check
```

The MCP entry must invoke `cairn memory-server`, and the sync check must report
no operating-layer drift. Having only one of these results is a partial
installation.

## Common failures

| Symptom | Cause | Recovery |
|---|---|---|
| `cairn` is not found | npm global bin directory is absent from `PATH` | Run `npm prefix -g`, locate its bin directory, and update `PATH` |
| MCP exists but slash commands do not | Operating layer was not applied | Run `cairn sync --apply`, then restart the harness |
| MCP starts but stores somewhere unexpected | A memory environment override is active | Inspect the effective environment and read L07 before continuing |
| Existing managed files differ | Local customization conflicts with sync | Run `cairn sync --check`, review the diff, and back up before applying |

## Privacy and trust boundary

This registration starts `cairn memory-server` locally as a stdio child. It
does not discover a server, send memory to a remote host, configure embeddings,
enable session capture, or enable an optional document-RAG integration. Pi uses
the separate, explicit `cairn sync-pi --apply` command to install Cairnkeep's
maintained local stdio memory extension, trajectory extension, and graph prompt.
Project setup records the Pi selection but never changes machine-level Pi assets.

Kimi Code can use the same memory server through its generated
`.ai/start-kimi.sh` launcher, but its HTTP MCP configuration requires a literal
URL rather than `${CAIRN_MEMORY_REMOTE_URL}`. Keep the resolved URL in a private
`.kimi-code/mcp.json` and keep the bearer token in the environment. See
[Harness compatibility](../../harness-compatibility.md#kimi-code).
Its optional `cairn sync-kimi` Skill adds only the local `/graphify` delegate;
it does not change memory transport or send graph data to a new destination.

Qwen Code can use the generated `.ai/start-qwen.sh` launcher. Its project
`.qwen/settings.json` supports environment references for both the remote URL
and authorization header, so the file can contain names such as
`${CAIRN_MEMORY_REMOTE_URL}` and `${CAIRN_MEMORY_HTTP_TOKEN}` instead of secret
values. Keep this project settings file untracked and approve the generated MCP
entry with `qwen mcp approve cairn-memory`. See
[Harness compatibility](../../harness-compatibility.md#qwen-code).

## Clean up if you stop the evaluation

Continue directly to L03 if you are completing the quickstart. If you stop here,
remove the MCP registration and review the non-writing uninstall plan:

```bash
claude mcp remove -s user cairn-memory
cairn uninstall --dry-run
```

Do not delete memory stores as part of a course cleanup.

## Recap

- CLI installation, MCP registration, and operating-layer sync are distinct.
- `sync --check` is the non-writing drift check.
- Default stdio memory is local.

Next: [L03 - Set up the first project](L03-first-project.md).
