---
spike: 001
name: prime-http-mcp
type: standard
validates: "Given Prime's supported Python MCP integration, when it connects to authenticated Cairnkeep HTTP, then discovery and calls work with current stable dependencies"
verdict: VALIDATED
related: []
tags: [prime-agent, mcp, http]
---

# Spike 001: Prime HTTP MCP

## What This Validates

Given Prime Agent's supported Python MCP integration, when its exact installed
runtime connects to an authenticated Cairnkeep loopback listener, then it can
discover and call the configured memory tools.

## Research

| Approach | Tool/library | Pros | Cons | Status |
|---|---|---|---|---|
| Prime Python skill over HTTP MCP | `rlm.McpIntegration` | Official extension seam; no Cairnkeep runtime dependency; static bearer tokens and headers supported | HTTP only; each call opens a new MCP session | Chosen and validated |
| Prime project `stdio` entry | Prime `mcpServers` | Would avoid a listener | Prime 0.7.1 does not wire stdio entries into its kernel | Rejected |
| Cairnkeep-native Prime agent loop | Custom integration | Could control every lifecycle event | Duplicates Prime's runtime and violates Cairnkeep's harness-neutral boundary | Rejected |

Primary references:

- [Prime Agent MCP integrations](https://github.com/PrimeIntellect-ai/prime-agent/blob/main/packages/coding-agent/docs/mcp-integrations.md)
- [Prime Agent architecture](https://github.com/PrimeIntellect-ai/prime-agent/blob/main/packages/coding-agent/docs/architecture.md)
- Cairnkeep `docs/storage.md` and `docs/harness-compatibility.md`

Chosen versions were Prime Agent 0.7.1 (release tarball SHA-256
`d68612c83239caafab72cc76c55ac572bfd07a059ea8fbd2a3ddbe1f2b55dcdb`),
Prime's Python 3.11 kernel, Python MCP 2.0.0, and Cairnkeep 2.10.0.

## How to Run

```bash
npm run build:server
/home/stondo/.prime/agent/kernel-venv/bin/python \
  .planning/spikes/001-prime-http-mcp/probe.py \
  --output /tmp/cairn-prime-spike-result.json
```

The probe starts an authenticated Cairnkeep server on a random loopback port,
uses only disposable storage, and removes the store on exit.

## What to Expect

The JSON report has `error_count: 0` and includes `prime-discovery`,
`prime-write`, `fresh-prime-read`, and `server-restart-read` events.

## Observability

Every assertion records an ISO-timestamped category in the exported JSON. The
summary contains duration, event count, and error count. No bearer token, memory
payload, database path, or prompt is written to the report.

## Investigation Trail

1. The official Prime installer was pinned to 0.7.1 and its published SHA-256
   was verified before user-local npm installation.
2. The first independent-client attempt used Python MCP 1.x's `headers=` form.
   MCP 2.0.0 rejects that argument; Prime's `McpIntegration` had already
   succeeded because it adapts to the new `http_client=` signature.
3. The independent client was changed to the MCP 2.0.0 path and the complete
   probe passed in under one second.
4. A second Cairnkeep process reopened the same disposable store and returned
   the previously written value, proving persistence beyond one HTTP session or
   server process.
5. A five-run soak passed 5/5 with 12 evidence events and zero errors per run;
   durations were 481-487 ms on the test host.

## Results

**VALIDATED.** Prime's official `McpIntegration` works with Cairnkeep's
authenticated streamable HTTP endpoint. The adapter is a small Python skill;
Cairnkeep does not need a Prime-specific runtime, daemon, or agent loop.

The operational cost is one local HTTP listener and a fresh MCP session per
call. That is acceptable for durable memory operations, but it is not a good
transport for high-frequency token-stream interception.
