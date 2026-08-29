# Cairnkeep

[![CI](https://github.com/cairnkeep/cairnkeep/actions/workflows/ci.yml/badge.svg)](https://github.com/cairnkeep/cairnkeep/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@cairnkeep/cli)](https://www.npmjs.com/package/@cairnkeep/cli)
[![license](https://img.shields.io/npm/l/@cairnkeep/cli)](LICENSE)

> Durable, local-first memory and context for coding agents.

Cairnkeep helps coding agents carry project context across sessions and
harnesses. It stores decisions, constraints, patterns, and lessons in
project-scoped memory, then gives agents a bounded protocol for finding and
verifying that context without turning memory into an authority or an
autonomous agent runtime.

## Why Cairnkeep?

- **Continuity across sessions.** Recall project decisions and recurring
  failures instead of rediscovering them from scratch.
- **Harness independence.** Use the same memory through Claude Code, OpenCode,
  Codex CLI, Kimi Code, Qwen Code, Pi, or another MCP client.
- **Local by default.** The default stdio server stores data on your computer;
  remote access, embeddings, capture, and external context are explicit
  opt-ins.
- **Bounded agent guidance.** Managed `AGENTS.md` instructions and project
  playbooks tell compatible agents when to retrieve context and which checks
  apply, but never execute work or grant approval.
- **Least authority.** Complete MCP annotations, read-only/custom tool profiles,
  capability gates, and immutable context packs keep observation separate from
  action.

## Quick start

Cairnkeep requires Node.js 22 or newer. In an interactive terminal, guided
setup presents selectable Git and memory choices plus checkboxes for every
supported coding harness:

```bash
npm install --global @cairnkeep/cli
cairn setup /path/to/project
cd /path/to/project
cairn doctor
./.ai/start-codex.sh                 # Windows: .\.ai\start-codex.cmd
```

Select Codex CLI in the harness checklist for this route. Review
`.codex/config.toml` and accept Codex's project-trust prompt on first use.
Automation can supply every choice explicitly; the quickstart documents that
deterministic form.

See the [quickstart](docs/quickstart.md) for Claude Code, the first
remember/recall cycle, recovery, and setup ownership. See
[harness compatibility](docs/harness-compatibility.md) for the exact surface
supported by each client.

The core loop is intentionally small: store a concise, verified project fact,
close the session, and retrieve it when a later task needs it. Claude Code and
OpenCode expose `/remember` and `/recall`; any compatible MCP client can use
`memory_write` and `memory_search` directly.

## For coding agents

Setup installs a managed project instruction block with a deliberately small
protocol:

1. For a nontrivial task that may depend on prior project knowledge, make one
   task-derived, project-scoped `memory_search` the first tool or command.
2. Treat results as locators, not truth; verify the maintained repository
   sources they reference.
3. Continue with normal repository inspection if memory is unavailable or has
   no relevant result.
4. Never write, supersede, or approve durable memory unless the user or a
   reviewed workflow explicitly requests it.

Cairnkeep playbooks can recommend or require existing review, verification,
security, documentation, and learning steps. They do not run those steps,
activate skills, enable capabilities, or authorize destructive work.

Read [Cairnkeep for coding agents](docs/agents.md) for the full contract,
authority model, harness behavior, and graceful fallback.

## Trust boundary

Cairnkeep is not a hosted agent, telemetry service, or automatic remote
knowledge collector. Memory is durable context, not source-of-truth
documentation. Configured Claude Code and OpenCode hooks can derive local
memory candidates; durable promotion and every networked or sensitive capture
path remain separately controlled. Ordinary uninstall retains durable data
unless an explicit purge is requested.

Start with [Privacy and data flow](docs/privacy-and-data-flow.md) and
[Memory storage and deployment](docs/storage.md) before enabling remote HTTP,
embeddings, trajectories, artifacts, work evidence, or context packs.

## Documentation

The [documentation hub](docs/README.md) is the index for setup, agents,
operations, optional features, deployment, learning paths, and contributor
guides. In particular:

- [Quickstart](docs/quickstart.md)
- [For coding agents](docs/agents.md)
- [Context intelligence](docs/context-intelligence.md)
- [Operating guide](docs/operating.md)
- [Harness compatibility](docs/harness-compatibility.md)
- [Privacy and data flow](docs/privacy-and-data-flow.md)
- [Guided learning paths and video scripts](docs/learning/README.md)

The repository supports Linux, macOS, native Windows x64, WSL, Node.js 22/24/26,
and real Bash 3.2 within the boundaries documented in the compatibility guides.

## Contributing and support

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and pull-request
guidelines, [SUPPORT.md](SUPPORT.md) for help, and [SECURITY.md](SECURITY.md) for
private vulnerability reporting.

## License

Apache-2.0 © 2026 Stefano Tondo
