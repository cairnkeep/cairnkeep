---
spike: 002
name: prime-authority-isolation
type: standard
validates: "Given a Cairnkeep custom profile and project header, when Prime discovers and calls tools, then only the allowlist is visible and project data stays isolated"
verdict: VALIDATED
related: [001]
tags: [security, profiles, isolation]
---

# Spike 002: Prime authority and project isolation

## What This Validates

Given a server-side Cairnkeep custom profile and explicit project routing, when
Prime discovers the catalog and attempts memory access, then it sees exactly the
allowlist and cannot read project-scoped data through a different project ID.

## Research

Prime 0.7.1's `McpIntegration.list_tools()` intentionally returns only `name`,
`description`, and `inputSchema`. Raw MCP discovery returns Cairnkeep's four
annotation hints, but Prime drops them before exposing the catalog to the model.
Therefore client-side classification is insufficient; Cairnkeep's profile must
be the authority boundary.

## How to Run

```bash
/home/stondo/.prime/agent/kernel-venv/bin/python \
  .planning/spikes/001-prime-http-mcp/probe.py \
  --output /tmp/cairn-prime-spike-result.json
python3 .planning/spikes/002-prime-authority-isolation/verify.py \
  /tmp/cairn-prime-spike-result.json
```

## What to Expect

The verifier prints `Spike 002 evidence: PASS`.

## Investigation Trail

1. The server was started with a custom profile containing only
   `memory_read`, `memory_write`, and `memory_search`.
2. Prime discovered exactly those tools in Cairnkeep's canonical order.
3. `context_explore` failed locally as an unavailable method after discovery.
4. Raw MCP inspection proved Cairnkeep transmitted complete annotations while
   Prime's catalog contained only three fields.
5. A value written under `prime-spike-a` was absent under `prime-spike-b`.
6. Missing and invalid bearer tokens both failed closed.

## Results

**VALIDATED within one trusted storage domain.** A Cairnkeep custom profile
reliably limits Prime's authority, and project routing keeps project databases
separate. `X-Cairn-Project` is routing metadata, not authorization: one bearer
token can choose another valid project ID. Mutually untrusted users still need
separate Cairnkeep server instances.
