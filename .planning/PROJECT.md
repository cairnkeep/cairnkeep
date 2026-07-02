# Cairnkeep — project

## What
A durable, harness-agnostic memory + context layer for coding agents (Claude
Code, OpenCode, …): a memory MCP server (`cairn-memory`), a CLI that bootstraps a
project's launchers and derived-knowledge layer, and a set of commands, agents,
and hooks for memory, wiki, security, and review workflows.

## Goals
- Provider-neutral core: no vendor names, no hardcoded endpoints. All LLM and
  git-provider configuration is external and swappable.
- Feature parity with the originating private workflow, so it can be adopted as a
  drop-in replacement.
- Clean open-source hygiene: Apache-2.0, CI, no secrets, no attribution noise.

## Constraints (hard rules)
- The public repo never references any specific employer, vendor, internal
  host/IP, or private repo name — in code, comments, commit messages, or docs.
- No AI/assistant authorship references anywhere (commits, comments, docs).
- Every commit is scanned (contents + message) before it is created.

## Layout
- `mcp-memory-server/` — the `cairn-memory` MCP server
- `bin/cairn`, `scripts/` — CLI, bootstrap, and utilities
- `templates/` — project scaffolding + derived-knowledge templates
- `claude/`, `opencode/` — commands, agents, hooks, and plugins (the operating layer)
