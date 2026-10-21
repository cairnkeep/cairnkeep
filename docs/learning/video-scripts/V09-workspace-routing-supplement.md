# V09 supplement — The right documents for the right repository

Technical recording brief; no completed video or full Ready L09 lab is claimed.
Use invented repository names and a loopback mock, never private mappings,
provider keys, real documents or production synchronization.

## Real terminal demonstration

Leave a readable pause after each command:

```sh
npm --prefix mcp-memory-server run build
npm --prefix mcp-memory-server run check:anythingllm-workspace
npm --prefix mcp-memory-server run check:remote-context
```

Show two synthetic checkouts sharing one global configuration, then highlight
the distinct workspace reported by each real stdio MCP query. Zoom into a
subdirectory call and an explicit override. Explain that an empty answer from
the wrong corpus is not evidence that the requested information does not exist.

The mock synchronization prints arguments only; it uploads nothing. Contrast
destination selection with write consent and show replacement being refused
without confirmation. For HTTP, show the conflicting server-directory mapping
fixture and the client header still winning. Do not run a live provider or
silently activate RAG merely to record this supplement.

## Boundaries and recovery

Explain the lookup order: explicit mapping file, legacy mapping beside the
selected sync script, then XDG. Missing or invalid mappings keep the legacy
configured default; inspect the returned workspace. Ambiguous deepest entries
require an explicit workspace or a corrected mapping. Mapping files are bounded
and unsafe file types are rejected. Directory matching is routing, not an ACL
or publisher-authenticity guarantee. Keep the full L09 lesson marked Brief until
its separate live synthetic-corpus lab has been verified.
