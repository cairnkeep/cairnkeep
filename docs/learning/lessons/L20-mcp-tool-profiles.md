# L20 - Least-authority MCP tool profiles

**Status:** Ready
**Tested with:** Cairnkeep 2.17.0 and Node.js 22 or newer
**Time:** 25 minutes

## Outcome

Classify every MCP tool as an observation or mutation, apply a read-only project
profile, replace it with an exact allowlist, and prove that invalid authority is
rejected before server startup.

## Exercise

Use a disposable directory so no real project policy changes:

```bash
lab=$(mktemp -d)
cairn mcp-tools list --json >"$lab/catalog.json"
cairn mcp-tools status --project "$lab" --json
cairn mcp-tools set read-only --project "$lab"
cairn mcp-tools status --project "$lab" --json >"$lab/read-only.json"
test "$(stat -c '%a' "$lab/.ai/mcp-tools.json" 2>/dev/null || stat -f '%Lp' "$lab/.ai/mcp-tools.json")" = 600
cairn mcp-tools set custom --tool memory_read --tool memory_search --project "$lab"
cairn mcp-tools status --project "$lab" --json >"$lab/custom.json"
```

Inspect the catalog. Every entry must contain a title and four Boolean hints.
The read-only profile must contain only tools whose `readOnlyHint` is true. The
custom profile contains exactly the two named tools in canonical discovery
order.

Confirm environment precedence without changing the project file:

```bash
CAIRN_MCP_TOOL_PROFILE=full cairn mcp-tools status --project "$lab" --json
```

The source is `environment`; the project remains custom when the override is
removed. A profile cannot enable a feature-gated tool, and a disabled capability
still removes its tool. Restart the memory server after profile changes.

## Common failures

- `custom` without `--tool` is invalid because an empty accidental server is
  more likely to be a configuration mistake than useful least authority.
- Unknown names and a group/world-readable project config fail closed.
- A running MCP session keeps its discovery snapshot until restarted.

## Privacy and trust boundary

Profiles do not read tool payloads or add telemetry. The digest identifies the
allowlist, not the user's identity or the independent capability state. Client
approval remains necessary for mutations even when a profile exposes them.

## Recovery and acceptance

```bash
cairn mcp-tools reset --project "$lab"
test ! -e "$lab/.ai/mcp-tools.json"
rm -rf "$lab"
```

- Unknown custom tool names fail `set`, server startup, and `cairn doctor`.
- Profile and capability digests are independent.
- Conservative clients may execute read-only observations; mutations still
  require their approval policy.
