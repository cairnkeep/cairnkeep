# L02 - Install the local workflow

**Status:** Ready
**Track:** Quickstart
**Time:** 25 minutes
**Tested with:** Cairnkeep 2.2.1 and Node.js 22 or newer

## Outcome

You can install the CLI, register the local memory server, install the operating
layer, and distinguish a complete installation from a partial one.

## Prerequisites

- Node.js 22 or newer and npm.
- Claude Code installed for the commands below. OpenCode users should follow
  the equivalent setup in [the operating guide](../../operating.md).
- Permission to install an npm package globally for your user.

## Mental model

A complete setup has three independent parts:

1. the `cairn` CLI and memory server;
2. the MCP registration used by the harness;
3. the operating layer containing commands, agents, hooks, and templates.

`cairn bootstrap` configures a project later; it does not perform the first two
machine-level steps.

## Exercise

1. Confirm the runtime:

   ```bash
   node --version
   npm --version
   ```

2. Install Cairnkeep:

   ```bash
   npm install --global @cairnkeep/cli@2.2.1
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
or enable an optional document-RAG integration.

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

Next: [L03 - Bootstrap the first project](L03-first-project.md).

## Video

Use [the L02 presenter script](../video-scripts/L02-installation.md).
