# Spike Manifest

## Idea

Test whether Prime Agent can use Cairnkeep as an optional durable memory and
context service through Prime's supported HTTP MCP integration seam, without
making either project own the other's runtime, session store, or refinement
lifecycle.

## Requirements

- Keep Prime Agent as the agent loop and Cairnkeep as an external memory service.
- Use authenticated loopback HTTP; do not expose the listener publicly.
- Enforce authority in Cairnkeep because Prime Agent 0.7.1 does not preserve MCP
  tool annotations in its Python integration catalog.
- Never promote Prime `/refine` state or executable skills into Cairnkeep
  automatically.
- Keep the integration optional, provider-neutral, and removable.

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|---|---|---|---|---|
| 001 | prime-http-mcp | standard | Given Prime's supported Python MCP integration, when it connects to authenticated Cairnkeep HTTP, then discovery and calls work with current stable dependencies | VALIDATED | prime-agent, mcp, http |
| 002 | prime-authority-isolation | standard | Given a Cairnkeep custom profile and project header, when Prime discovers and calls tools, then only the allowlist is visible and project data stays isolated | VALIDATED | security, profiles, isolation |
| 003 | prime-cross-session-memory | standard | Given a memory written through one Prime integration instance, when a fresh instance and an independent MCP client read it, then the same durable value is returned | VALIDATED | persistence, interoperability, memory |
