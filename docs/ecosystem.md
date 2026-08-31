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
