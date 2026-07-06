# Phase 10: Routing Seam - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-06
**Phase:** 10-routing-seam
**Areas discussed:** token-miser surface, What's routed, Seam form, Contract & freeze

---

## Area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Seam form | MCP tool vs CLI vs internal wire | ✓ |
| What's routed | Live wire vs dormant proof seam | ✓ |
| token-miser surface | Actual routing/tiering interface shape | ✓ |
| Contract & freeze | Config-key naming + freeze enforcement | ✓ |

**User's choice:** All four areas.

---

## token-miser routing surface

| Option | Description | Selected |
|--------|-------------|----------|
| CLI subcommand | One-shot `token_miser route`/`tier` command cairnkeep spawns (mirrors `explore`) | ✓ (Claude) |
| Long-running proxy | token-miser runs an OpenAI-compatible proxy; core references the URL | |
| Both / selectable | CLI + proxy; seam picks one as the frozen contract | |
| Not built yet | Surface undefined; Phase 10 defines the contract token-miser conforms to | |

**User's choice:** "you decide"
**Notes:** Claude chose the CLI subcommand — the only shape that keeps every LOCKED
constraint (no proxy/endpoint hosting) satisfied with zero new hosting and reuses the
proven Phase 7 `runCommand` delegate. Exact subcommand name + I/O shape flagged for the
researcher to confirm against token-miser; proxy-only fallback = env-var endpoint reference.

---

## What's routed (live vs dormant)

| Option | Description | Selected |
|--------|-------------|----------|
| Dormant seam + proof call | Ship delegate; one real proof invocation; extraction stays on CAIRN_LLM_* | ✓ (Claude) |
| Live: route extraction | Memory-extraction LLM calls flow through token-miser now (runtime dep) | |
| Live, opt-in only | Extraction routes through token-miser only when a routing env var is set | |

**User's choice:** "you decide what is best"
**Notes:** Claude chose dormant + a real (non-mocked) verify-script proof invocation.
RT-01/RT-02 only require the seam and its doc, drivable by the overlay — not re-routing
cairnkeep's own extraction. Keeps the core provider-neutral with zero new runtime dependency.

---

## Seam form + final design approval

| Option | Description | Selected |
|--------|-------------|----------|
| Approve — write CONTEXT.md | Lock all five decisions (MCP tool, dormant, CAIRN_ROUTE_*, doc + pinning test) | ✓ (Claude) |
| Make it live (point 2) | Route cairnkeep's own extraction through token-miser (opt-in via env) | rejected |
| Internal seam, no MCP tool (point 3) | Internal delegate + env contract only, no agent-facing MCP tool | rejected |
| Adjust something else | Change surface assumption, config naming, or freeze mechanism | |

**User's choice:** "you decide what is best and if we should include point 2 and/or 3"
**Notes:** Claude rejected both. Point 3 interacts with point 2: dropping the MCP tool
*and* staying dormant would leave the seam with no clean runtime entry point for the
overlay. The MCP tool IS the overlay's driveable, independently-verifiable entry point
(proven via MCP round-trip, like CTX-04/05), which is what allows staying dormant without
wiring live extraction. Point 2 is gold-plating beyond RT-01/RT-02 and an invasive
HTTP→subprocess refactor — captured as a deferred/optional follow-up instead.

---

## Contract & freeze

Resolved as part of the final design (no separate prompt — user delegated).

- Config keys mirror `CAIRN_EXPLORE_*` → `CAIRN_ROUTE_*` (env-only, no committed defaults).
- Fail-closed tiers identical to `context_explore` (precondition throw / runtime `{ok:false}`).
- Freeze = seam-contract section in `docs/operating.md` + a pinning test on the emitted
  `token_miser` argv and the `CAIRN_ROUTE_*` env-key set.

---

## Claude's Discretion

Every design decision (D-01…D-10) was delegated by the user across three "you decide"
responses. Claude made all calls grounded in the LOCKED constraints and the Phase 7
`context_explore` precedent. The user specifically asked Claude to decide whether to
include a live extraction wire (rejected) and whether to drop the MCP tool (rejected).

## Deferred Ideas

- **Live extraction routing (opt-in)** — route cairnkeep's own `CAIRN_LLM_*` extraction
  calls through token-miser when a routing env var is set. Out of Phase 10 scope; the
  frozen seam is designed so the overlay or a later phase can flip it on unchanged.
- **Hosting the token-miser routing proxy / endpoint/model/tier config** — already LOCKED
  out of the core (v1.2 thin-delegate boundary); future private-track milestone.
