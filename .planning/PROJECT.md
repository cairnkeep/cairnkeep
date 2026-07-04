# Cairnkeep

## What This Is

A durable, harness-agnostic memory + context layer for coding agents (Claude Code, OpenCode, ...): the `cairn-memory` MCP server (Node.js/TypeScript), a CLI (`cairn`) that bootstraps a project's launchers and derived-knowledge layer, and an operating layer of commands, agents, and hooks for memory, wiki, security, and review workflows.

## Core Value

Drop-in parity: a fresh `cairn bootstrap` plus the carved commands, agents, and hooks reproduce the originating private workflow end-to-end, verified against the `cairn-memory` MCP server.

## Current Milestone: v1.2 Context Exploration (token-miser + FastContext)

**Goal:** Give cairnkeep a token-efficient repo-exploration capability — FastContext as a provider-neutral context-explore backend, routed through token-miser — wired into both the `cairn-memory` MCP and the Claude Code + OpenCode operating layers.

**Target features:**
- `context_explore` capability in the `cairn-memory` MCP (offloads READ/GLOB/GREP to a FastContext endpoint; returns compact file paths + line ranges)
- token-miser routing layer that dispatches exploration/model calls to FastContext and other backends, provider-neutral config
- Operating-layer wiring: commands/agents/hooks in `claude/` + `opencode/` that route exploration through the new capability
- Provider-neutral endpoint config (OpenAI-compatible; defaults to the mitkox FastContext GGUF on local infra, operator-swappable) — no vendor hardcoding

**Key context:** FastContext is Microsoft's repo-exploration subagent (4B–30B; MIT-licensed; cuts main-agent tokens ~60%, +5.5% SWE-bench); mitkox ships GGUF quants for llama.cpp. token-miser was already deferred as "the routing + context-explore sibling" — this milestone lands it. Must honor DEC-no-private-references, the provider-neutral core, and the verify-by-execution bar against the registered `cairn-memory` MCP.

## Current State

**Shipped:** v1.1 OpenCode parity (2026-07-04, tag `v1.1`) — the OpenCode operating layer reached the Claude Code baseline: native memory-capture (session-end) and memory-recall (pre-edit) plugins, `remember`/`recall` commands, and a self-sufficient session-start wakeup that no longer depends on Claude-rendered assets. Closed as an **override closeout** — the `/remember`→`/recall` round-trip is proven achievable (demonstrated once live with a tool-call-reliable local model) but not reliably reproducible headless, and the interactive TUI confirm was not run (headless operator, no TTY). Details + follow-ups in MILESTONES.md → Known Gaps.

**Next milestone:** v1.2 Context Exploration (token-miser + FastContext) — scoping in progress (requirements → roadmap).

## Requirements

### Validated

- ✓ **REQ-provider-neutral-core** — git host selected by one provider config key; collaboration commands resolve every git-host operation through a per-provider operation→tool map; no hardcoded vendor endpoints anywhere in the core — v1.0
- ✓ **REQ-memory-mcp-server** — `cairn-memory` registers and responds as an MCP server (10 tools on stdio + opt-in token-gated HTTP); remember/recall work end-to-end — v1.0
- ✓ **REQ-operating-layer** — commands, agents, and hooks for memory, wiki, security, and review workflows work end-to-end against `cairn-memory`; memory hooks (wakeup/capture/review) round-trip — v1.0 (Claude Code verified path; OpenCode wakeup ordering documented)
- ✓ **REQ-cli-bootstrap** — a fresh `cairn bootstrap` yields a working same-as-before workflow — v1.0
- ✓ **REQ-feature-parity** — operating guide in the OSS docs, fresh bootstrap works same-as-before, baseline tagged `v1.0.0` — v1.0
- ✓ **REQ-oss-hygiene** — Apache-2.0 license, CI, no secrets, no attribution noise — v1.0
- ✓ **OCP-01** — OpenCode extracts memory candidates to staging when a session ends (memory-capture parity) — v1.1 (proven live, capture 4/4)
- ✓ **OCP-02** — OpenCode injects file-specific memory before an edit (memory-recall parity) — v1.1 (mechanism proven with structural injected-error evidence; live tool-invocation intermittent — model-reliability, not a defect)
- ✓ **OCP-03** — User can run `remember` in OpenCode to persist a durable finding — v1.1 (live `memory_write` proven)
- ✓ **OCP-04** — User can run `recall` in OpenCode to retrieve memory across layers — v1.1 (proven achievable — demonstrated once live with a no-thinking, tool-call-reliable local model; reliable headless reproduction is an open gap, see MILESTONES.md)
- ✓ **OCP-05** — OpenCode memory-wakeup surfaces session-start context without requiring Claude assets installed — v1.1 (proven live in scratch-HOME)
- ✓ **OCP-06** — The full memory lifecycle + commands round-trip in a live OpenCode session (parity verified) — v1.1 (override closeout — full round-trip demonstrated once live; reliable headless reproduction + interactive TUI confirm are open gaps)

### Active

_(none — next milestone not yet scoped)_

### Out of Scope

- Enterprise overlay contents (organization-specific launchers and config) — lives only on the private remote, never in this repo (per DEC-no-private-references)
- token-miser integration — the routing + context-explore sibling; optional companion deferred to a future milestone
- Vendor-specific hardcoding (LLM or git host) — the core stays provider-neutral; all such configuration is external and swappable

## Context

- Layout: `mcp-memory-server/` (the `cairn-memory` MCP server), `bin/cairn` + `scripts/` (CLI, bootstrap, utilities), `templates/` (project scaffolding + derived-knowledge templates), `claude/` + `opencode/` (commands, agents, hooks, and plugins — the operating layer)
- Target runtime: Node.js/TypeScript for the MCP server; the operating layer targets the Claude Code and OpenCode harnesses
- Milestone "OSS core → parity" **shipped 2026-07-03** (all 3 phases, 6/6 requirements validated; baseline tag `v1.0.0`)
- Milestone "OpenCode parity" **shipped 2026-07-04** (phases 4-5, 6/6 requirements; baseline tag `v1.1`; override closeout). OpenCode now has native memory-capture/recall plugins, `remember`/`recall` commands, and self-sufficient wakeup — installed via `sync-opencode-*-assets.sh`. Next milestone not yet scoped.
- CI (build + smoke-test of the memory server) exists and passes on push/PR; smoke suite covers scope-guard, http-guard, extract-cli, search-e2e, embeddings
- Known deferred (v1.1 override gap): reliable headless reproduction of the OpenCode `/remember`→`/recall` round-trip is blocked by opencode run-completion flakiness + local thinking-model tool-call variance (external, not a code defect); the interactive TUI confirm awaits a TTY operator. Enterprise overlay and token-miser integration carried to future milestones.

## Constraints (hard rules)

<decisions>

**DEC-no-private-references [LOCKED]**
The public repo never references any specific employer, vendor, internal host/IP, or private repo name — in code, comments, commit messages, or docs.
Corollary: the enterprise overlay wrapping the core with organization-specific launchers and config lives only on the private remote, never in this repo.

**DEC-no-ai-authorship [LOCKED]**
No AI/assistant authorship references anywhere — commits, comments, or docs.

**DEC-commit-scanning [LOCKED]**
Every commit is scanned (contents + message) before it is created.

</decisions>

Additional constraints:

- **Tech stack**: Node.js/TypeScript for `cairn-memory` — matches the MCP ecosystem and the existing CI
- **Compatibility**: Provider-neutral core — all LLM and git-provider configuration is external and swappable; git host selected by one config setting
- **Licensing**: Apache-2.0 — clean open-source hygiene target

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Git host resolved via one provider config key + per-provider operation→tool map | Collaboration commands must work against any git host, never assuming one | ✓ Good (Phase 1) |
| Enterprise overlay kept private-only | Enforces DEC-no-private-references; keeps the OSS core neutral | — Pending (future milestone) |
| Three hard rules locked (see decisions block above) | Public-repo hygiene is non-negotiable | ✓ Good |
| `memory_read` validation moved into the handler | ZodEffects `.refine()` as an MCP inputSchema publishes an empty tool schema | ✓ Good (Phase 2) |
| Semantic-search embedding model required, else substring fallback | Removed a hardcoded vendor model default to keep the core provider-neutral | ✓ Good (Phase 2) |
| OpenCode memory-wakeup made self-sufficient (v1.1) | Reusing Claude's rendered hook made OpenCode parity require Claude installed first; true parity means OpenCode stands alone | ✓ Good (Phase 4, OCP-05 — native rewrite, no `~/.claude` shell-out) |
| Scope path containment via `relative()`, `"all"` rejected on write paths | `resolve===join` misses `../` traversal; `"all"` is a read-only fan-out scope | ✓ Good (Phase 2, SEC-0001) |
| Opt-in HTTP transport fails closed (bearer auth + per-origin CORS + Host validation) | The `MCP_HTTP_PORT` mode must not be exploitable by default | ✓ Good (Phase 2) |
| OpenCode memory lifecycle built on native plugins, not Claude's shell hooks | OpenCode has a plugin/event model (`session.idle`, `tool.execute.before`); reusing shell hooks would not be idiomatic parity | ✓ Good (Phase 4, OCP-01/02) |
| Live parity verified by a scratch-isolated harness with fingerprint guards + negative controls | Same verify-by-execution bar v1.0 used; scratch HOME prevents polluting the real `~/.config/opencode` / `~/.claude` | ✓ Good (Phase 5) |
| OCP-04 recall read-back blocker was the local model's tool-calling, not cairnkeep code | Thinking-config + strip-proxy were proven dead ends; a no-thinking, tool-call-reliable model (qwen3.5-27b) cleared it in one live round-trip | ⚠️ Revisit (reliable headless reproduction still open — v1.1 known gap) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-04 — started milestone v1.2 Context Exploration (token-miser + FastContext)*
