# MCP tool annotations and least-authority profiles

Cairnkeep publishes a complete annotation contract for every MCP tool. Each
tool has a stable title and explicit `readOnlyHint`, `destructiveHint`,
`idempotentHint`, and `openWorldHint` values. Local observations are closed
world. Tools that query configured services or delegated processes are open
world. Any mutation that may replace or remove state is destructive; immutable
artifact creation is additive.

Use the profile CLI to reduce the tools visible to an MCP client:

```bash
cairn mcp-tools list
cairn mcp-tools status --json
cairn mcp-tools set read-only
cairn mcp-tools set custom --tool memory_read --tool memory_search
cairn mcp-tools reset
```

Project configuration is strict versioned JSON in `.ai/mcp-tools.json`, created
only by `set` and written with mode `0600`. Do not hand-edit it. A process may
override the project with `CAIRN_MCP_TOOL_PROFILE=full|read-only|custom`; custom
process profiles also require a comma-separated `CAIRN_MCP_ALLOWED_TOOLS`.
Precedence is process environment, project configuration, then `full`.

`read-only` is derived from the central annotation catalog. `custom` is an
exact allowlist. Unknown names fail server startup and `cairn doctor`. Profiles
only remove authority: they cannot activate typed nodes, artifacts, context
packs, HTTP exposure, or a disabled capability. Effective discovery is:

```text
available feature gates ∩ capability contract ∩ MCP tool profile
```

`status` includes a canonical profile digest. Evaluation reports record that
same digest in their evidence provenance without changing the independent
capability-configuration digest. Restart the memory server after changing an
MCP profile.

The default `full` profile preserves the same tool names, schemas, responses,
feature gates, and ordering as an unconfigured server. The annotations help
conservative clients distinguish observations from actions; they do not grant
permission or replace the client's approval policy.
