---
spike: 003
name: prime-cross-session-memory
type: standard
validates: "Given a memory written through one Prime integration instance, when a fresh instance and an independent MCP client read it, then the same durable value is returned"
verdict: VALIDATED
related: [001, 002]
tags: [persistence, interoperability, memory]
---

# Spike 003: Prime cross-session memory

## What This Validates

Given a durable memory written through one Prime integration object, when a
fresh Prime object, an independent Python MCP client, and a restarted Cairnkeep
server read the same key, then all retrieve the original value.

## How to Run

```bash
/home/stondo/.prime/agent/kernel-venv/bin/python \
  .planning/spikes/001-prime-http-mcp/probe.py \
  --output /tmp/cairn-prime-spike-result.json
python3 .planning/spikes/003-prime-cross-session-memory/verify.py \
  /tmp/cairn-prime-spike-result.json
```

## What to Expect

The verifier prints `Spike 003 evidence: PASS`.

## Investigation Trail

1. Prime wrote `patterns/prime-agent-canary` through `McpIntegration`.
2. A newly constructed integration object read the same value, forcing a new
   discovery state and HTTP MCP session.
3. A raw MCP `ClientSession` read the same value, showing that the state is
   Cairnkeep memory rather than Prime-private state.
4. Cairnkeep was terminated and restarted against the same temporary store; a
   new Prime integration read the value again.

## Results

**VALIDATED.** Cairnkeep supplies real cross-session and cross-client durable
memory to Prime. This is the integration's strongest value: the same memory can
be reused by Prime and other MCP harnesses without synchronizing Prime's own
session files, compaction state, goals, or `/refine` history.
