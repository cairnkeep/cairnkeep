# Phase 4: OpenCode parity operating layer - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-03
**Phase:** 4-OpenCode parity operating layer
**Areas discussed:** Logic-sharing strategy, remember/recall layers, Capture trigger, Recall injection

> **Note:** The gray-area selection question timed out (user away from keyboard).
> Decisions were made on best judgment following the Claude reference implementation
> and the minimal-diff principle, and recorded as revisable defaults. No interactive
> per-area Q&A occurred.

---

## Logic-sharing strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Native TS in plugins | Port each Claude hook's thin glue natively into the TS plugins, calling the existing server `wakeup`/`extract` subcommands | ✓ |
| Shared neutral shell scripts | Extract harness-neutral `.sh` scripts (real INFRA_ROOT, no `~/.claude`) that both Claude hooks and OpenCode plugins call | |

**User's choice:** (default) Native TS in plugins.
**Notes:** The heavy logic already lives in the `cairn-memory` server (the real shared source of truth); the hooks are thin glue. Native TS removes the `~/.claude` dependency with the smallest diff and no new artifact. Revisit if the glue proves large.

---

## remember / recall layers

| Option | Description | Selected |
|--------|-------------|----------|
| Drop Claude file-memory | AgentFS-only structured write + flag doc layers; drop the Claude-runtime `~/.claude/projects/.../memory/` layer | ✓ |
| OpenCode-native file-memory | Add an OpenCode-specific file-memory store mirroring Claude's | |

**User's choice:** (default) Drop Claude file-memory.
**Notes:** AgentFS is the shared cross-harness durable store that makes the lifecycle round-trip; the Claude file-memory dir is a Claude-runtime artifact, not part of the shared parity contract.

---

## Capture trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Same staging contract | Write the identical `.planning/memory-staging/<stamp>.json`, same `extract` subcommand, same 5-session cap and env guards; OpenCode session-end event + message-acquisition are research items | ✓ |

**User's choice:** (default) Same staging contract; session-end event + transcript acquisition flagged for research.
**Notes:** Keeps `/memory-review` (already cross-harness) and wakeup surfacing working unchanged. OpenCode has no `transcript_path` equivalent — mechanism is a research item.

---

## Recall injection

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve high-signal rule | Basename/stem match (stem ≥ 4), inject only on specific AgentFS/wiki match, nothing on routine edits; exact `tool.execute.before` injection mechanism is a research item | ✓ |

**User's choice:** (default) Preserve high-signal/low-noise behavior; injection mechanism flagged for research.
**Notes:** Claude uses PreToolUse `additionalContext`; OpenCode's equivalent hook name + payload shape need confirmation.

## Claude's Discretion

- Internal TS structure/naming of the plugins, wording of injected context strings, and command markdown prose — constrained by matching Claude reference behavior and OpenCode house style.

## Deferred Ideas

None — discussion stayed within phase scope.
