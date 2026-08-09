---
name: cairnkeep-memory
description: Read and write explicitly allowed Cairnkeep memory tools through an authenticated HTTP MCP endpoint. Discover tools before calling them.
---

# Cairnkeep memory

Use Cairnkeep as durable, cross-harness memory from Prime Agent's IPython
kernel. Cairnkeep remains an external service; Prime Agent still owns the agent
loop, session, compaction, goals, and refinement state.

## Setup

Configure `cairn-memory` under `mcpServers` in the project's private
`.prime/agent/settings.json`. Use `type: "http"`, the loopback or protected TLS
URL, `bearerTokenEnvVar: "CAIRN_MEMORY_HTTP_TOKEN"`, and an explicit
`X-Cairn-Project` header. Keep the token in the process environment, not JSON.

The Cairnkeep server must use a `read-only` or narrow `custom` MCP tool profile.
Prime Agent 0.7.1 exposes only tool name, description, and input schema to the
kernel, so Cairnkeep's server-side profile is the effective authority boundary.

## Usage

```python
import cairnkeep_memory

for tool in await cairnkeep_memory.list_tools():
    print(tool["name"], tool["description"])

results = await cairnkeep_memory.memory_search(
    scope="project",
    query="release checklist",
)
print(results)
```

Call `list_tools()` before use. Only call `memory_write` after the user has
explicitly enabled it in the Cairnkeep profile and requested a durable write.
Do not copy Cairnkeep context-pack skills into Prime's executable skill paths,
and do not synchronize Prime `/refine` state automatically.
