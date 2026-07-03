# Phase 5: Live OpenCode parity verification - Context

**Gathered:** 2026-07-03
**Status:** Ready for planning

> ⚠ **Decisions below were made on best judgment while the user was away** (gray-area
> selection timed out after being re-asked). They follow the Phase-4 verification
> precedent and the ponytail/minimal-diff principle, and are chosen to satisfy every
> Phase-5 success criterion with the least new machinery. Every decision is revisable —
> re-run `/gsd-discuss-phase 5` to confirm or change any of them before planning locks
> them in.

<domain>
## Phase Boundary

**This is a verification phase — no new capabilities.** Prove, by live execution, that
the OpenCode operating layer shipped in Phase 4 round-trips end-to-end against the
registered `cairn-memory` MCP — the same "verify by execution" bar v1.0 used for the
Claude path. One requirement: **OCP-06**.

What must be proven live (from ROADMAP.md Phase 5 success criteria):
1. In a live OpenCode session, the **wakeup → recall → capture** lifecycle runs against
   the registered `cairn-memory` MCP and each stage produces its expected effect.
2. **`remember` → `recall` round-trips** a finding within the live session — written on
   one turn, read back across layers on a later turn.
3. A **fresh install of only the OpenCode assets** (no Claude assets on disk) reproduces
   the full working workflow — drop-in parity confirmed.
4. The parity run is **captured as execution evidence**, matching how v1.0 verified the
   Claude path.

**Owed from Phase 4** (04-UAT test 2, skipped-by-design): the live round-trip of OCP-01
capture, OCP-02 recall-on-edit, OCP-03 `remember`, OCP-04 `recall`. OCP-05 (wakeup
surfaces AgentFS memory with no reachable `~/.claude`) was already re-proven live in
Phase 4 — Phase 5 re-confirms it as part of the integrated lifecycle, not as fresh work.

**Not in scope:** no changes to the plugins/commands themselves beyond what verification
exposes as broken, no `cairn-memory` server-contract changes (v1.0-validated), no third
harness, no new memory/wiki/security capabilities. If verification uncovers a genuine
defect, that is a fix within OCP-06 scope — not a feature.

</domain>

<decisions>
## Implementation Decisions

### Verification execution model
- **D-01 (Hybrid):** An **automated harness** is the backbone — extend the Phase-4
  OCP-05 scratch-`HOME` acceptance script to exercise every stage (wakeup, recall-on-edit,
  capture, `remember`, `recall`) deterministically against a live model + registered MCP.
  Plus **one genuine interactive OpenCode session** to confirm the same workflow works in
  a real session (the roadmap says "in a live OpenCode session" explicitly — a pure mock
  would not honor that wording). Rationale: the harness gives repeatable, provable
  execution evidence; the interactive confirm satisfies the literal "live session" bar.
  If the interactive session proves impractical at execution time, fall back to
  harness-only and record that gap explicitly in the UAT — do not silently drop it.

### Test environment / install surface
- **D-02 (Scratch-isolated, MCP registered inside it):** Run in a fresh scratch `HOME` +
  `OPENCODE_CONFIG_DIR`, with the OpenCode assets installed via the `sync-opencode-*-assets.sh`
  scripts and **`cairn-memory` registered inside that scratch OpenCode config** (pointing at
  the real `mcp-memory-server/dist/index.js`). No reachable `~/.claude`. This one env
  satisfies BOTH criterion 3 (fresh install, no Claude assets) AND criteria 1/2 (round-trip
  against a *genuinely registered* MCP) — the lazy consolidation. The operator's real
  `~/.config/opencode` and `~/.claude` are **never mutated**; all scratch dirs are cleaned up.
- **D-03:** Because `cairn-memory` is currently **not** registered in the live
  `~/.config/opencode/` and no plugins are installed there, registration + install is part
  of the phase's setup step — done in the scratch env, not the real config. (Researcher:
  confirm the exact OpenCode MCP-registration mechanism — `opencode.json`/config key shape
  for a stdio MCP server, and that `OPENCODE_CONFIG_DIR` fully isolates it.)

### Model + data for the round-trip
- **D-04 (Local model + canary + negative control):** Drive extract/recall with a local
  model (qwen family, Phase-4 precedent). Seed a **fresh canary token** into a scratch
  AgentFS project for each round-trip proof, and run a **negative control** (unseeded
  project → canary must NOT appear) so a surfaced canary can only have come from injected
  memory — not training or guessing. Do not run against the repo's real `.agentfs` (avoids
  polluting real memory with test facts). Runtime endpoint fallback is allowed: if the
  default model endpoint is down, use whatever comparable local endpoint is reachable and
  record which was used (Phase 4 fell back debian-4080 → local-ai).

### Evidence artifact
- **D-05 (Phase-5 UAT.md, raw evidence inline):** Capture the parity run as a standard GSD
  `05-UAT.md` with one test per stage (expected / result / evidence), directly closing the
  four owed 04-UAT test-2 items (OCP-01/02/03/04 live) plus the integrated
  wakeup→recall→capture and `remember`→`recall` round-trips. Embed **raw evidence inline** —
  canary IDs, command outputs, model responses, the negative-control result — so the
  execution record stands on its own, matching v1.0's "verified by execution" bar. The
  standard `05-VERIFICATION.md` (goal-backward check) is produced by the verify workflow as
  usual; no separate standalone evidence file is needed.

### Claude's Discretion
- Exact harness script structure/naming, canary token strings, the specific stem/file used
  to trigger the OCP-02 recall match, per-stage assertion wording, and the interactive-session
  script — all left to the planner/executor, constrained by matching the Phase-4 harness
  patterns and the OpenCode plugin behavior under test.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### What is being verified — the Phase-4 assets under test
- `opencode/plugins/memory-wakeup.ts` — wakeup (OCP-05); surfaces AgentFS memory + wiki index + HARD contradictions via `experimental.chat.system.transform`.
- `opencode/plugins/memory-capture.ts` — session-end extract → `.planning/memory-staging/` (OCP-01).
- `opencode/plugins/memory-recall.ts` — pre-edit file-specific injection (OCP-02).
- `opencode/command/remember.md` — durable-write command (OCP-03).
- `opencode/command/recall.md` — cross-layer read command (OCP-04).
- `scripts/sync-opencode-plugin-assets.sh` — installs the three plugins (`@@INFRA_ROOT@@` rendering).
- `scripts/sync-opencode-memory-assets.sh` — installs the commands.
- `mcp-memory-server/dist/index.js` — the registered MCP server binary; `wakeup` / `extract <model>` subcommands are the shared logic.

### The verification precedent to extend
- `.planning/phases/04-opencode-parity-operating-layer/04-UAT.md` — test 1 is the OCP-05 scratch-`HOME` canary + negative-control harness to extend; **test 2 lists the exact OCP-01/02/03/04 live round-trip items owed to this phase**.
- `.planning/phases/04-opencode-parity-operating-layer/04-VERIFICATION.md` — Phase-4 goal-backward verification shape.
- `.planning/phases/04-opencode-parity-operating-layer/04-CONTEXT.md` — the parity decisions (D-01..D-12) the verification checks were correctly realized; especially D-04 (wakeup four surfaces), D-08 (staging contract + env guards), D-10 (high-signal recall rule).

### Requirements & constraints
- `.planning/ROADMAP.md` §"Phase 5" — goal + the four success criteria above (OCP-06).
- `.planning/REQUIREMENTS.md` — OCP-06 wording; v1.1 coverage map.
- `.planning/PROJECT.md` decisions block — DEC-no-private-references (LOCKED): no test canary, scratch path, or endpoint may leak a private host/repo into the repo or commits.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- The Phase-4 OCP-05 acceptance harness (recorded in `04-UAT.md` test 1) — the scratch-`HOME`
  + fresh-canary + negative-control pattern; extend it to all five stages rather than writing
  a new harness from scratch.
- `scripts/sync-opencode-plugin-assets.sh` / `sync-opencode-memory-assets.sh` — idempotent
  installers (`--apply`/`--check`); the fresh-install step uses these unchanged.
- `mcp-memory-server/dist/index.js` — already built and present; `wakeup` / `extract` are the
  subcommands the plugins call and the harness can invoke directly to seed/inspect.
- `.planning/memory-staging/` staging contract + `/memory-review` accept gate — capture's
  output target; the harness asserts against the same file shape.

### Established Patterns
- Scratch `HOME` + `OPENCODE_CONFIG_DIR`, no reachable `~/.claude`, cleanup after — the
  Phase-4 isolation pattern that proves the no-Claude-assets bar.
- Canary token + negative control — proves a surfaced value came from injected memory, not
  the model's prior knowledge.
- Fail-open plugins — verification must also confirm the *fail-open* path (missing binary /
  missing `.agentfs` → no wedge), not only the happy path.

### Integration Points
- OpenCode MCP registration (stdio `cairn-memory` in the scratch `OPENCODE_CONFIG_DIR`) — the
  primary setup surface; exact config key shape is the main research item.
- OpenCode session lifecycle events the plugins hook (session-start transform, session-end,
  tool.execute.before) — the harness must trigger these the way a real session would.

</code_context>

<specifics>
## Specific Ideas

- **One scratch env, both bars:** registering `cairn-memory` *inside* the scratch
  `OPENCODE_CONFIG_DIR` means the same isolated environment proves "fresh install / no Claude
  assets" (criterion 3) AND "round-trip against the registered MCP" (criteria 1/2) — avoid
  standing up two environments.
- **Close the owed items explicitly:** the `05-UAT.md` must name OCP-01/02/03/04 as the
  Phase-4-deferred round-trip being discharged here, so the audit trail from 04-UAT test 2 is
  closed, not orphaned.
- **Never touch real memory/config:** no test facts into the repo `.agentfs`, no writes to the
  operator's real `~/.config/opencode` or `~/.claude`; canaries and scratch dirs are ephemeral
  and cleaned up (Phase-4 discipline).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (token-miser integration and the enterprise
overlay remain future milestones; this phase only proves Phase-4 parity by execution.)

</deferred>

---

*Phase: 5-Live OpenCode parity verification*
*Context gathered: 2026-07-03*
