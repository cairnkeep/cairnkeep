# Cairnkeep documentation

This is the versioned documentation index for Cairnkeep. Start with the path
that matches what you are trying to do; detailed configuration belongs in the
linked guides rather than the project landing page.

## Start here

| Goal | Guide |
|---|---|
| Install Cairnkeep and configure a first project | [Quickstart](quickstart.md) |
| Understand how coding agents should use Cairnkeep | [Cairnkeep for coding agents](agents.md) |
| Compare Claude Code, OpenCode, Codex, Kimi, Qwen, Pi, and generic MCP support | [Harness compatibility](harness-compatibility.md) |
| Follow the complete operator reference | [Operating Cairnkeep](operating.md) |
| Learn Cairnkeep progressively or produce the video series | [Learning paths and video scripts](learning/README.md) |

## Agents and harnesses

- [Cairnkeep for coding agents](agents.md) explains retrieval-first behavior,
  memory authority, playbooks, approvals, and graceful fallback.
- [Harness compatibility](harness-compatibility.md) records the exact commands,
  hooks, plugins, launchers, skills, and MCP surfaces available in each client.
- [MCP tool annotations and least-authority profiles](mcp-tool-profiles.md)
  explains observation/action metadata and project tool allowlists.
- [Immutable context packs](context-packs.md) covers approved external documents
  and skills that remain read-only context rather than executable harness assets.
- [Validated skill improvement](skill-improvement.md) describes the reviewed,
  measured, reversible path for changing a live skill.

## Context intelligence

- [Context intelligence](context-intelligence.md) connects progressive context-pack
  retrieval, the frozen benchmark, usage receipts, review-gated proposals, and
  the optional read-only OpenViking provider.
- [Immutable context packs](context-packs.md), [domain knowledge](domain-knowledge.md),
  and [work evidence](work-evidence.md) document each boundary in depth.

## Operations, storage, and privacy

- [Operating Cairnkeep](operating.md) is the full CLI and configuration
  reference.
- [Memory storage and deployment](storage.md) documents local and remote stores,
  retention, backup, migration, and uninstall behavior.
- [Privacy and data flow](privacy-and-data-flow.md) maps what each opt-in feature
  reads, stores, and may send over the network.
- [Git-linked work evidence](work-evidence.md) covers bounded local session-to-Git
  provenance without prompt or reasoning capture.
- [Optional document knowledge](domain-knowledge.md) covers the separately
  configured document-RAG integration.

## Deployment and platforms

- [Containers](containers.md) covers rootless Podman, OCI images, authenticated
  HTTP, and persistent storage.
- [Native Windows](native-windows.md) covers x64 setup, launchers, ACLs,
  scheduling, process cleanup, and recovery.
- [Git providers](git-providers.md) describes provider-neutral Git-linked
  workflows.

## Exchange and ecosystem

- [Open Knowledge Format exchange](open-knowledge-format.md) covers importing
  and exporting portable knowledge bundles.
- [Companion tools and related projects](ecosystem.md) lists optional tools that
  complement Cairnkeep without becoming runtime dependencies.

## Overlays and teams

- [Building an overlay](building-an-overlay.md) explains how to add private
  provider or organization policy without forking the core.
- [Managed overlay distributions](overlay-distributions.md) covers wrapper CLIs,
  policy locks, private registries, and rollback.
- [Team-mode design](design/team-mode.md) records the current team workflow
  boundary and deferred multi-user concerns.
- [Meta-agent design](design/meta-agent.md) records the bounded workflow design
  behind Cairnkeep playbooks.

## Contributing and releases

- [Contributing](../CONTRIBUTING.md)
- [Release process](releasing.md)
- [Support](../SUPPORT.md)
- [Security policy](../SECURITY.md)

These files ship with the repository and npm package, so documentation stays
reviewable and version-aligned with the code. A website or GitHub Wiki may
mirror them later, but should not become a second source of truth.
