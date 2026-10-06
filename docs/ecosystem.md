# Companion tools and related projects

Cairnkeep's core memory server, project setup, wiki, and review assets run
without any of the tools below. Optional delegated exploration, routing, and
graph workflows have their own explicit companion requirements.

## Related project

- [token-miser](https://github.com/cairnkeep/token-miser) owns context
  exploration and request routing. Cairnkeep's optional `context_explore` and
  `route_check` MCP tools are thin, environment-gated delegates to it.

## Optional companion tools

| Tool | What it adds | Integration |
|---|---|---|
| [token-miser](https://github.com/cairnkeep/token-miser) | Model routing and compact codebase exploration | Configure `CAIRN_ROUTE_ENDPOINT` and/or `CAIRN_EXPLORE_BINARY` |
| [rtk](https://github.com/rtk-ai/rtk) | Token-reduced output for common Git, npm, and Cargo commands | Install as a shell-level proxy; Cairnkeep wiring is not required |

These integrations are accelerators, not part of Cairnkeep's trust boundary or
runtime dependency set. Review each project's installation and data-flow
documentation independently before enabling it.

## Context and agent-state projects

These projects overlap with one layer of Cairnkeep but do not supersede its
reviewed-memory and authority model.

| Project | Strongest capability | Relationship to Cairnkeep | Current decision |
|---|---|---|---|
| [OpenViking](https://github.com/volcengine/OpenViking) | Hierarchical external context retrieval | Complements project memory; Cairnkeep already offers an explicitly configured, read-only provider boundary | Keep optional and read-only; see [context intelligence](context-intelligence.md) |
| [MemFork](https://github.com/memforkdb/memfork) | Branch, merge, discard, time travel, and cross-agent handoff for mutable agent state | Adds cheap experimental state branches that Cairnkeep's review-gated durable memory intentionally does not model | Do not add as a dependency; consider an optional capability only for disposable agent state |
| [Context Language Models](https://github.com/facebookresearch/context-language-models) and [pi-clm](https://github.com/lolipopshock/pi-clm) | Model-managed projection of the current conversation | Operates inside a session; Cairnkeep preserves reviewed context across sessions and harnesses | Experimental Pi companion only; never a durable-memory replacement |
| [Ollaya](https://github.com/ollaya-dev/ollaya) | Fast local typed decision models | May rank ambiguous suggestions, but Cairnkeep permissions and promotion rules are deterministic policy | Advisory experiments only; never authorization or security enforcement |

The architectural split is deliberate:

- repository sources and reviewed documentation remain authoritative;
- Cairnkeep memory locates and carries reviewed project knowledge;
- context projection may reduce the current model request;
- branchable agent state may isolate speculative work;
- deterministic code, not a learned classifier, enforces permissions.

This also addresses the useful criticism that agents often need better access
to source context rather than an ever-growing opaque memory store. Cairnkeep
does not ask users to trust remembered prose over maintained sources: search
results are locators, provenance is explicit, and contradictions must be
resolved against the repository.

## Measured comparison

The pinned October 2026 comparison and exact reproduction commands are in
[ecosystem evaluation evidence](research/ecosystem-evidence-2026-10.md).
The runners are operator-invoked only. They are absent from CI, install no
runtime dependency, and use disposable stores and workspaces.
