# Cairnkeep

## What This Is

A durable, harness-agnostic memory + context layer for coding agents (Claude Code, OpenCode, ...): the `cairn-memory` MCP server (Node.js/TypeScript), a CLI (`cairn`) that bootstraps a project's launchers and derived-knowledge layer, and an operating layer of commands, agents, and hooks for memory, wiki, security, and review workflows.

## Core Value

Drop-in parity: a fresh `cairn bootstrap` plus the carved commands, agents, and hooks reproduce the originating private workflow end-to-end, verified against the `cairn-memory` MCP server.

## Current Milestone: v1.3 Routing Seam & Context Maturation

**Goal:** Wire cairnkeep to token-miser's routing/tiering surface as a thin, self-consistent public delegate, mature `context_explore` (memory-aware, auto-invoked, cached), and make the OpenCode remember→recall round-trip reliably reproducible headless — without breaching the thin-delegate or no-private-references boundaries.

**Target features:**
- Thin routing wire to token-miser's routing/tiering surface (no proxy, endpoint, or model config in the core); freezes the seam the private enterprise overlay will later drive
- Self-consistency: token-miser positioned as a public cairnkeep-org sibling project, docs updated to match, and the no-private-references guard re-run as a milestone gate
- Memory-aware exploration — cross-reference `context_explore` citations against `memory_search` / wiki-query
- Pre-task hook auto-invoke of exploration
- Result caching keyed on (query, repo HEAD/dirty-state)
- Hardened headless harness so `/remember`→`/recall` reproduces reliably (serve/`--attach` + retry)

## Current State

**Shipped:** v1.1 OpenCode parity (2026-07-04, tag `v1.1`) — the OpenCode operating layer reached the Claude Code baseline: native memory-capture (session-end) and memory-recall (pre-edit) plugins, `remember`/`recall` commands, and a self-sufficient session-start wakeup that no longer depends on Claude-rendered assets. Closed as an **override closeout** — the `/remember`→`/recall` round-trip is proven achievable (demonstrated once live with a tool-call-reliable local model) but not reliably reproducible headless, and the interactive TUI confirm was not run (headless operator, no TTY). Details + follow-ups in MILESTONES.md → Known Gaps.

**Shipped:** v1.2 Context Exploration (token-miser + FastContext) — complete 2026-07-06. All four phases landed: FastContext reliability spike (Phase 6, live 15/15 `tool_calls`, GO), the `context_explore` MCP tool (Phase 7, CTX-01/02/03), Claude Code + OpenCode operating-layer wiring (Phase 8, CTX-04/05), and the live A/B token-savings verification (Phase 9, CTX-07). CTX-07 was closed against cairnkeep's **own measured number** via `scripts/verify-token-savings-ab.sh`: a live, independently-verified tight-query A/B anchor at ~99.9% byte-savings (D-03 **PASS**), with the small model's unreliability on broad/loosely-worded queries documented transparently (09-AB.md — hallucinated/wander citations disclosed, never counted as the headline). Full requirement traceability in REQUIREMENTS.md.

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
- ✓ **CTX-06** — FastContext tool-calling reliability probed against the actually-deployed GGUF quant + `llama-server --jinja` before any wiring — v1.2 Phase 6 (live 15/15 `finish_reason=tool_calls`, GO; re-runnable probe `scripts/verify-fastcontext-reliability.sh`, hardened for parallel tool calls)
- ✓ **CTX-01 / CTX-02 / CTX-03** — `context_explore` MCP tool in `cairn-memory`: a thin subprocess-delegating tool that parses token-miser's Evidence JSON with fail-closed error handling and provider-neutral env-only config — v1.2 Phase 7
- ✓ **CTX-04 / CTX-05** — Operating-layer wiring: Claude Code + OpenCode `/context-explore` commands invoke the tool, installed via the asset-sync script — v1.2 Phase 8 (live MCP round-trip verified)
- ✓ **CTX-07** — Token-savings value proposition proven by a live measured before/after A/B on cairnkeep's own harness (`scripts/verify-token-savings-ab.sh`): verified tight-query anchor ~99.9% byte-savings (D-03 PASS); the broad-query set's small-model unreliability documented transparently in 09-AB.md, not counted as the headline — v1.2 Phase 9
- ✓ **RT-01 / RT-02** — Thin `route_check` delegate to token-miser's routing/tiering surface (no proxy/endpoint/model config in the core), proven against the real binary via `scripts/verify-routing-seam.sh` and frozen as a seam contract in `docs/operating.md` — v1.3 Phase 10 (UAT: live `/health` proof + cold-read doc-sufficiency both passed)

### Active

<!-- v1.3 scope — REQ-IDs assigned in REQUIREMENTS.md -->
- [ ] token-miser established as a public cairnkeep-org sibling; docs self-consistent; no-private-references guard re-verified
- [ ] Memory-aware exploration (`context_explore` citations cross-referenced against `memory_search` / wiki-query)
- [ ] Pre-task hook auto-invoke of exploration
- [ ] `context_explore` result caching keyed on (query, repo HEAD/dirty-state)
- [ ] Headless harness hardened for a reliable `/remember`→`/recall` round-trip

### Out of Scope

- Enterprise overlay contents (organization-specific launchers and config) — lives only on the private remote, never in this repo (per DEC-no-private-references)
- Hosting a routing/tiering proxy or any endpoint/model config inside the core — token-miser owns routing; cairnkeep stays a thin delegate that only invokes it (per the LOCKED v1.2 thin-delegate boundary)
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
| `context_explore` is a thin subprocess delegate to `token_miser explore`, not a reimplementation of FastContext's loop/sandbox/serving | token-miser already owns and tests these in Rust; cairnkeep stays provider-neutral and holds no endpoint/model config | ✓ Good (Phase 7, CTX-01/03) |
| FastContext reliability spike made a standalone hard gate before any wiring | Same failure class as OCP-04 — building atop an unverified local model's tool-calling is the expensive way to find a narration failure | ✓ Good (Phase 6 — live 15/15 `tool_calls`, GO) |
| CTX-07 reported as cairnkeep's own live measured number, broad-query model unreliability disclosed rather than hidden | The verify-by-execution bar demands a real number; honest disclosure beats a flattering headline | ✓ Good (Phase 9 — tight-query ~99.9% byte-savings, D-03 PASS) |

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
*Last updated: 2026-07-06 after Phase 10 — Routing Seam shipped (RT-01/RT-02 validated: thin `route_check` delegate proven against the real token-miser binary + seam contract frozen in operating docs). Milestone v1.3 continues with self-consistent public positioning, matured context_explore, and a hardened OpenCode round-trip harness.*
