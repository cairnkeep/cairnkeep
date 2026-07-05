# Phase 8: Operating-Layer Wiring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-05
**Phase:** 8-operating-layer-wiring
**Areas discussed:** Command architecture, Response surface, Repo targeting & name, Sync & CI parity

---

## Command architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Direct inline call | Command calls `context_explore` directly, no paired sub-agent (recall.md shape) | ✓ |
| Paired explorer sub-agent | Dispatch to a new context-explorer sub-agent via Task (wiki-query pattern) | |

**User's choice:** Direct inline call
**Notes:** Phase-7 tool is already thin and returns final citations; a sub-agent would only relay them and add an agent file to sync. OpenCode command therefore stays self-contained (no workflow/agent file).

---

## Response surface

| Option | Description | Selected |
|--------|-------------|----------|
| Citations only | Surface compact `path:line-range`; agent decides what to Read next | ✓ |
| Citations + 1-line synthesis | Add a short "what's here" note per citation | |
| Citations + auto-read ranges | Expand cited line ranges inline into the answer | |

**User's choice:** Citations only
**Notes:** Maximum token economy — the exact delta Phase 9 / CTX-07 A/B measures. Full Evidence still available in the tool's `structuredContent`; the command's response stays lean.

---

## Repo targeting & name

| Option | Description | Selected |
|--------|-------------|----------|
| Auto git-root + optional arg | Resolve via `git rev-parse --show-toplevel`, optional path override, pass explicitly | ✓ |
| Explicit path arg required | User supplies repo path every call | |
| Lean on env / cwd only | Rely on `CAIRN_EXPLORE_REPO_ROOT` / tool default | |

**User's choice:** Auto git-root + optional arg (name `/context-explore`)
**Notes:** MCP server cwd is `infraRoot`, so the command must pass `repo_root` explicitly (Phase 7 D-01). Tool still fails closed if unresolvable.

---

## Sync & CI parity

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated script + CI check | New `sync-opencode-explore-assets.sh`; wire `--check` into CI; Claude via `sync-claude-assets.sh` | ✓ |
| Dedicated script, no CI wiring | Ship the script but no CI `--check` gate | |
| Fold into an existing sync script | Add explore command to e.g. the memory script | |

**User's choice:** Dedicated script + CI check
**Notes:** Preserves one-script-per-feature convention and the drift guard every other feature already has.

---

## Claude's Discretion

- Frontmatter tool-name conventions (`mcp__cairn-memory__context_explore` for Claude vs `cairn-memory_context_explore: true` for OpenCode).
- How the command relays the tool's fail-closed error (Phase 7 D-04) — pass-through, not re-implemented.
- Exact `$ARGUMENTS`/flag parsing, the `ASSETS=(...)` contents, and the precise CI hook location for the new `--check`.

## Deferred Ideas

- Pre-task hook auto-invoke of exploration (CTX-F2) — out of scope; SC-3 mandates on-demand/agent-invoked, not automatic.
- Memory-aware citation annotation (CTX-F1); result caching (CTX-F3) — future differentiators.
- Token-savings A/B measurement (CTX-07) — Phase 9.
