# Phase 10: Routing Seam - Context

**Gathered:** 2026-07-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 10 delivers a **thin, documented delegate** from cairnkeep's core to
token-miser's routing/tiering surface, plus a **frozen seam-contract doc** so a
future private overlay can drive routing unchanged. The core **invokes** the
surface but **hosts no proxy, endpoint list, model list, or tier config** — it
mirrors the existing `context_explore` subprocess-delegate (Phase 7).

Covers **RT-01** (thin routing delegate) and **RT-02** (documented stable seam
contract). This is HOW to wire and freeze the seam — not whether to add new
routing capabilities (those belong to token-miser and the private overlay).

</domain>

<decisions>
## Implementation Decisions

### token-miser routing surface (what cairnkeep talks to)
- **D-01:** Design the seam against a **one-shot CLI subcommand**
  (`token_miser route`-style), spawned via the existing `runCommand`
  (`mcp-memory-server/src/index.ts:406`) exactly as `context_explore` spawns
  `token_miser explore`. Input in → routing decision/result JSON out → process
  exits.
- **D-02:** The **exact subcommand name and its input→output JSON shape are
  unconfirmed** — the researcher MUST verify them against token-miser's actual
  routing surface before planning locks the argv.
- **D-03:** **Fallback if token-miser routing is proxy-only** (no CLI
  subcommand): the seam becomes an **env-var endpoint *reference*** the overlay
  points at — still no proxy hosted in core, still config-external. Researcher
  picks CLI vs. reference based on what token-miser actually ships; CLI is the
  default assumption.

### Seam form (what "one thin delegate call" is)
- **D-04:** The seam is a **new thin MCP tool in `cairn-memory`**, mirroring
  `context_explore` (`index.ts:1001`) — same registration, same `runCommand`
  delegation, same fail-closed tiers. Chosen over an internal-only function
  because the MCP tool is the **overlay's driveable, independently-verifiable
  entry point** (proven via MCP round-trip, as CTX-04/05 were), which is exactly
  what lets us keep the seam dormant in cairnkeep's own operation without
  wiring live extraction.
- **D-05:** The tool is **inert unless `CAIRN_ROUTE_*` is configured** (mirrors
  how `context_explore` is inert without `CAIRN_EXPLORE_BINARY`) — adds no noise
  for users who don't opt in.

### What flows through the seam (live vs. dormant)
- **D-06:** **Dormant/env-gated seam + a real proof invocation.** Ship the
  delegate and exercise it **once with a real token-miser routing call in a
  verify script** (verify-by-execution — a genuine invocation, not a mock →
  satisfies Success Criterion #1). cairnkeep's own memory-extraction **stays on
  the existing `CAIRN_LLM_*` path** — the core stays provider-neutral with zero
  new runtime dependency by default.
- **D-07:** Cairnkeep does **NOT** route its own extraction LLM calls through
  token-miser in this phase. That "live wire" is captured as a deferred/optional
  follow-up (see Deferred Ideas) — the overlay or a later phase flips it on.

### Config contract & freeze mechanism
- **D-08:** Config keys mirror `CAIRN_EXPLORE_*` → **`CAIRN_ROUTE_*`**:
  env-only, **no committed defaults**, provider-neutral.
- **D-09:** **Fail-closed error tiers** identical to `context_explore`:
  precondition problems (missing binary/env) **throw**; runtime problems
  (non-zero exit, timeout, malformed JSON) **return `{ok:false, ...}`**.
- **D-10:** **Freeze = documented seam contract in `docs/operating.md` + a
  pinning test** on the emitted call shape (the exact `token_miser` argv and
  the `CAIRN_ROUTE_*` env-key set), so a future refactor cannot silently drift
  the seam. Docs-only would sit below this repo's verify-by-execution bar.

### Claude's Discretion
The user delegated every design decision above ("you decide what is best").
All decisions D-01…D-10 are Claude's calls, grounded in the LOCKED constraints
and the Phase 7 precedent. The user explicitly asked me to decide whether to
include a live extraction wire (rejected → D-07) and whether to drop the MCP
tool for an internal-only seam (rejected → D-04). The planner has latitude on
naming details and test structure, but MUST preserve: thin-delegate boundary,
env-only config, fail-closed tiers, and a real (non-mocked) proof invocation.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 10: Routing Seam" — goal + the 3 Success
  Criteria that gate this phase.
- `.planning/REQUIREMENTS.md` — **RT-01** (thin delegate, no proxy/endpoint/
  model/tier config in core) and **RT-02** (documented stable seam contract).
- `.planning/PROJECT.md` §Constraints/decisions — **DEC-no-private-references
  [LOCKED]**, and the v1.2 thin-delegate boundary in §"Out of Scope".

### The pattern to mirror (token_miser explore delegate)
- `mcp-memory-server/src/index.ts:1001` — `context_explore` MCP tool: the exact
  template for the new routing tool (registration, env preconditions,
  fail-closed tiers, JSON parsing).
- `mcp-memory-server/src/index.ts:406` — `runCommand` helper: reuse for spawning
  `token_miser` (note the optional `env` param used to inject `NO_COLOR=1`).

### Where the seam contract gets documented
- `docs/operating.md` §Configuration (line ~93) — the env-var table pattern
  that `CAIRN_ROUTE_*` extends; the seam-contract section (RT-02) is added here.
  Note: `context_explore`'s `CAIRN_EXPLORE_*` keys are **not yet** in this table
  — that doc gap is Phase 11's (SC-02) concern, not Phase 10's, but the routing
  section should be written self-consistently from the start.

### Verify-by-execution precedent (for the proof invocation, D-06)
- `scripts/verify-fastcontext-reliability.sh` and
  `scripts/verify-token-savings-ab.sh` — the re-runnable verify-script pattern
  the routing proof invocation should follow.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`context_explore` MCP tool** (`index.ts:1001`): copy its structure verbatim
  — precondition-throw / execution-`{ok:false}` split, `existsSync` binary
  guard, absolute-path resolution before the process boundary, `asToolText` +
  `structuredContent` return shape.
- **`runCommand`** (`index.ts:406`): spawns with `cwd: infraRoot`, timeout via
  `SIGTERM`, truncated stdout/stderr, optional `env` override. Reuse as-is.
- **Env-only config idiom** (`process.env.CAIRN_*` throughout `index.ts`): the
  established provider-neutral config surface — `CAIRN_ROUTE_*` slots in.

### Established Patterns
- **Thin subprocess delegate [LOCKED, v1.2]**: token-miser owns the logic;
  cairnkeep parses its JSON and holds no endpoint/model/tier config.
- **Fail-closed tiers (D-04, Phase 7)**: config/env problems throw; runtime
  problems return a structured `{ok:false}` payload with stderr/exitCode.
- **MCP round-trip verification (CTX-04/05)**: the tool is proven by an actual
  MCP call, not a unit mock — this is how Success Criterion #1 is met.

### Integration Points
- New tool registered alongside the other `server.tool(...)` calls in
  `mcp-memory-server/src/index.ts`.
- Seam-contract doc + `CAIRN_ROUTE_*` env table land in `docs/operating.md`.
- A new `scripts/verify-*.sh` (or extension) drives the real proof invocation.

</code_context>

<specifics>
## Specific Ideas

- The overlay drives routing **via the MCP tool + the documented `CAIRN_ROUTE_*`
  env contract alone** — Success Criterion #3 requires the seam-contract doc to
  be sufficient *without reading core source*. Write the doc to that bar.
- Keep the routing tool's naming/shape parallel to `context_explore` so the two
  delegates read as one consistent family (`CAIRN_EXPLORE_*` ‖ `CAIRN_ROUTE_*`).

</specifics>

<deferred>
## Deferred Ideas

- **Live extraction routing (opt-in):** route cairnkeep's own memory-extraction
  LLM calls (`CAIRN_LLM_*`, `index.ts:342`) through token-miser when a routing
  env var is set. Explicitly out of Phase 10 scope (D-07) — not required by
  RT-01/RT-02, and an invasive HTTP→subprocess refactor. The frozen seam is
  designed so the overlay or a later phase can flip this on unchanged.
- **Hosting the token-miser routing proxy / any endpoint/model/tier config:**
  already LOCKED out of the core (v1.2 thin-delegate boundary); carried by a
  future private-track milestone.

</deferred>

---

*Phase: 10-routing-seam*
*Context gathered: 2026-07-06*
