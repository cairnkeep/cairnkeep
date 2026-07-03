# Phase 5: Live OpenCode parity verification - Research

**Researched:** 2026-07-03
**Domain:** OpenCode headless CLI execution + local stdio MCP registration, for a scratch-isolated live-execution verification harness
**Confidence:** MEDIUM-HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (Hybrid):** An automated harness is the backbone — extend the Phase-4 OCP-05 scratch-`HOME` acceptance script to exercise every stage (wakeup, recall-on-edit, capture, `remember`, `recall`) deterministically against a live model + registered MCP. Plus one genuine interactive OpenCode session to confirm the same workflow works in a real session. If the interactive session proves impractical at execution time, fall back to harness-only and record that gap explicitly in the UAT.
- **D-02 (Scratch-isolated, MCP registered inside it):** Run in a fresh scratch `HOME` + `OPENCODE_CONFIG_DIR`, with the OpenCode assets installed via the `sync-opencode-*-assets.sh` scripts and `cairn-memory` registered inside that scratch OpenCode config (pointing at the real `mcp-memory-server/dist/index.js`). No reachable `~/.claude`. The operator's real `~/.config/opencode` and `~/.claude` are never mutated; all scratch dirs are cleaned up.
- **D-03:** Because `cairn-memory` is currently not registered in the live `~/.config/opencode/` and no plugins are installed there, registration + install is part of the phase's setup step — done in the scratch env only. (Researcher: confirm the exact OpenCode MCP-registration mechanism and that `OPENCODE_CONFIG_DIR` fully isolates it — **resolved below**.)
- **D-04 (Local model + canary + negative control):** Drive extract/recall with a local model (qwen family, Phase-4 precedent). Seed a fresh canary token per round-trip proof; run a negative control (unseeded project → canary must NOT appear). Do not run against the repo's real `.agentfs`. Runtime endpoint fallback is allowed (Phase 4 fell back debian-4080 → local-ai; record which was used).
- **D-05 (Phase-5 UAT.md, raw evidence inline):** Capture the parity run as a standard `05-UAT.md`, one test per stage, closing the four owed 04-UAT test-2 items (OCP-01/02/03/04 live) plus the integrated wakeup→recall→capture and remember→recall round-trips. Embed raw evidence inline.

### Claude's Discretion

Exact harness script structure/naming, canary token strings, the specific stem/file used to trigger the OCP-02 recall match, per-stage assertion wording, and the interactive-session script — all left to the planner/executor, constrained by matching the Phase-4 harness patterns and the OpenCode plugin behavior under test.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope. (token-miser integration and the enterprise overlay remain future milestones; this phase only proves Phase-4 parity by execution.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OCP-06 | The full OpenCode memory lifecycle (wakeup → recall → capture) and the `remember`/`recall` commands round-trip against the registered `cairn-memory` MCP in a live OpenCode session | MCP registration config shape (confirmed live + cited), scratch-isolation mechanics (HOME vs `OPENCODE_CONFIG_DIR`, with a documented bug flagged), headless lifecycle-triggering via `opencode run` (session-start/tool-hook confirmed by Phase-4's own spike; session-end/`session.idle` cited but not yet run-time-verified — Wave-0 item), and five concrete "silently proves nothing" failure modes the harness must assert against |
</phase_requirements>

## Summary

Phase 4 already answered most of the hard OpenCode-plugin-API questions (lifecycle hook names, injection mechanisms, message shapes) via a live spike (`04-SPIKE-INJECTION.md`) and a passing scratch-`HOME` acceptance run (`04-06-SUMMARY.md`). Phase 5 does not need to re-derive that — it needs to (1) actually **register** `cairn-memory` as an MCP server for the first time (Phase 4 never did this — OCP-05's proof only exercised the wakeup plugin's direct server-subcommand shell-out, not a real MCP-tool call), and (2) drive the full five-stage lifecycle headlessly and/or interactively against that registration.

**MCP registration is well-grounded (HIGH confidence):** the operator's own live `~/.config/opencode/opencode.json` already registers a local stdio MCP server (`lean-ctx`) using exactly the schema this research needed to confirm — `"type": "local"`, a `"command"` array, `"enabled": true` — cross-checked against the official docs. The registered server name must be exactly `cairn-memory`, because `opencode/command/remember.md` and `recall.md` already hardcode tool names as `cairn-memory_memory_write`, `cairn-memory_memory_search`, etc. (confirmed by reading those files) — OpenCode's MCP tool-naming convention is `<server-name>_<tool-name>` (also independently confirmed in `04-RESEARCH.md` from live session data on this machine).

**Isolation is mostly solid but has one real gotcha (MEDIUM confidence):** a scratch `HOME` alone already redirects `~/.config/opencode` (global config), `~/.local/share/opencode/auth.json` (credentials), and any global-scope AgentFS data (`~/.cairnkeep` default) into scratch space — because all three paths are `$HOME`-relative. `OPENCODE_CONFIG_DIR` is *additive* on top of the global config, not a replacement for it, and there is an open, unresolved GitHub issue (`anomalyco/opencode#4399`) reporting that pointing `OPENCODE_CONFIG_DIR` at a non-default path silently fails to load its `opencode.json` unless paired with the separate `OPENCODE_CONFIG` env var. The safest, cheapest-to-verify approach is to **not** fight this: leave `OPENCODE_CONFIG_DIR` unset and simply point scratch `HOME` at an empty dir — the `sync-opencode-*-assets.sh` scripts already default their live-root to `$HOME/.config/opencode` when `OPENCODE_CONFIG_DIR` is unset, so scratch `HOME` alone reproduces D-02's isolation goal without touching the buggy env var at all. (If the planner wants to keep `OPENCODE_CONFIG_DIR` for parity with D-02's wording, set it to exactly `$SCRATCH_HOME/.config/opencode` — functionally identical, zero risk — never to a custom path.)

**Headless lifecycle triggering is proven for two of three stages, cited-not-verified for the third:** Phase 4's spike already confirmed live, with real `opencode run` invocations, that (a) `experimental.chat.system.transform` (wakeup/session-start) delivers content to the model, and (b) `tool.execute.before` fires for real `edit`/`write` tool calls issued by `opencode run` (recall-on-edit). What Phase 4 never exercised is whether `opencode run` reliably fires `session.idle` (the capture trigger) — official docs describe `run` as "exiting when idle," which strongly implies it does, but this is `[CITED]`, not `[VERIFIED]` in this repo. Compounding this, Phase 4 found (and fixed) a real bug where `experimental.chat.system.transform` fires **twice** per turn — once for OpenCode's internal title-generation sub-call, once for the real turn — sharing the same `sessionID`. `memory-capture.ts`'s dedupe (`processed.add(sessionID)`, marked *before* the extract call) is exposed to the exact same class of bug if `session.idle` also double-fires: a premature idle on the title-gen sub-call could mark the session "processed" before real messages exist, silently starving the true end-of-turn capture. This is the single highest-value thing for Phase 5's harness to empirically check early, mirroring Phase 4's own diagnostic-probe pattern.

**Primary recommendation:** Reuse the Phase-4 OCP-05 harness almost unchanged (scratch `HOME`, no `OPENCODE_CONFIG_DIR` override, plugins/commands installed via the existing sync scripts, `opencode run --format json --dir <scratch-project> --auto`), add one new setup step — write a scratch `opencode.json` registering `cairn-memory` as a local MCP server plus a `provider`/`model` block mirroring the operator's existing local-model config — and add a small Wave-0 diagnostic probe (a throwaway `session.idle` logger, deleted after use, exactly like `04-01`'s `probe.ts`) to settle whether `session.idle` double-fires before building the full capture assertion.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Harness orchestration (scratch setup, canary seeding, assertions) | Shell harness script (extends 04-UAT test-1 pattern) | — | Owns environment isolation and pass/fail evidence capture; no new plugin/command code |
| MCP registration | Scratch `opencode.json` (`mcp.cairn-memory`) | `mcp-memory-server/dist/index.js` (stdio server binary) | Config declares the server; the existing v1.0-validated binary is the actual logic, unchanged |
| Lifecycle triggering (wakeup/recall/capture) | OpenCode CLI (`opencode run`, headless) | OpenCode TUI (one interactive session, D-01 fallback bar) | Headless drives deterministic per-stage proof; interactive satisfies the literal "live session" wording |
| remember/recall round trip | OpenCode Command Layer (`opencode/command/{remember,recall}.md`) via MCP tool calls | `cairn-memory` MCP Server (AgentFS project scope) | Command orchestrates; server persists — unchanged from Phase 4 |
| Evidence capture | `05-UAT.md` (raw evidence inline) | — | Per D-05, no separate evidence artifact |

## Standard Stack

No new libraries are introduced by this phase — it is a verification harness over already-shipped Phase-4 code and the already-built `mcp-memory-server` binary.

### Core (existing, reused unchanged)

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| OpenCode CLI | 1.17.11 (local, `[VERIFIED: local environment]`) | Harness driver — `opencode run` headless mode | Same version Phase 4's spike validated against; re-verify hook behavior did not regress if this version has since changed |
| `mcp-memory-server/dist/index.js` | already built, v1.0-validated | The `cairn-memory` MCP server binary AND the CLI `wakeup`/`extract` subcommands the plugins shell out to | Single source of truth for both the plugin glue and the registered MCP — do not rebuild or fork |
| Node.js | v22.22.0 (local, `[VERIFIED: local environment]`) | Runtime for the server binary | Unchanged from Phase 4 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Scratch `HOME` alone for isolation | Scratch `HOME` + explicit `OPENCODE_CONFIG_DIR` pointed at a *custom* (non-`$HOME/.config/opencode`) path | The custom-path form hits an open, unresolved OpenCode bug (`#4399`) requiring a paired `OPENCODE_CONFIG` env var to actually load; not worth the risk when scratch `HOME` alone already achieves full isolation |
| `opencode run --session <id>` (captured from a prior JSON response) for the remember→recall round trip | `opencode run --continue` | `--continue` resumes "the most recently active session" — safe in a scratch env with exactly one session, but two open GitHub issues (`#11680`, `#3434`) report unreliability; capturing and passing the explicit session ID is more auditable and matches the raw-evidence-inline requirement (D-05) |

**Installation:** none — `opencode/plugins/*.ts` and `opencode/command/*.md` are already shipped by Phase 4; this phase only writes a scratch `opencode.json` (data, not code) and a harness shell script.

## Package Legitimacy Audit

**Not applicable.** This phase installs no new external packages — it exercises already-shipped, already-audited Phase-4 code (`@opencode-ai/plugin`/`@opencode-ai/sdk` legitimacy was already assessed in `04-RESEARCH.md`) against the already-built, v1.0-validated `mcp-memory-server` binary.

## Architecture Patterns

### System Architecture Diagram

```
Harness setup (once per full run)
  │
  ├─ mktemp -d  →  SCRATCH_HOME     (redirects ~/.config/opencode, ~/.local/share/opencode, ~/.cairnkeep)
  ├─ mktemp -d  →  SCRATCH_PROJECT  (fresh .agentfs/project.db seeded with a canary; NOT the repo's real .agentfs)
  │
  ├─ scripts/sync-opencode-plugin-assets.sh --apply --live-root "$SCRATCH_HOME/.config/opencode"
  ├─ scripts/sync-opencode-memory-assets.sh --apply --live-root "$SCRATCH_HOME/.config/opencode"
  │     (installs plugins/*.ts + command/{remember,recall}.md, @@INFRA_ROOT@@ rendered to real repo path)
  │
  └─ write "$SCRATCH_HOME/.config/opencode/opencode.json":
        mcp.cairn-memory      = { type: local, command: [node, <real repo>/mcp-memory-server/dist/index.js] }
        provider.<local-model> = mirrors the operator's own local-model provider block
        model                 = "<provider>/<model>"

Per-stage headless execution ── HOME=$SCRATCH_HOME  CAIRN_LLM_API_KEY=...  CAIRN_LLM_EXTRACTION_MODEL=...
  │  (env vars exported in the shell that launches `opencode run` — NOT just inside mcp.cairn-memory.environment;
  │   memory-capture.ts's `node <server> extract` subprocess call inherits OpenCode's own process env, not the
  │   MCP registration's per-server environment block)
  │
  ├─ opencode run "<prompt>" --dir "$SCRATCH_PROJECT" --format json --auto
  │     ├─ experimental.chat.system.transform  → wakeup (OCP-05) — assert seeded canary appears (FOUND/NOT-FOUND probe, Phase-4 pattern)
  │     ├─ tool.execute.before (edit/write)     → recall-on-edit (OCP-02) — assert thrown context contains the seeded fact for a matching-stem file; assert NO throw for a non-matching file (negative control)
  │     └─ session.idle (on run completion)     → capture (OCP-01) — assert a NEW .planning/memory-staging/*.json appears containing the seeded canary
  │
  ├─ opencode run "/remember <canary fact>" --dir "$SCRATCH_PROJECT" --format json --auto
  │     → parse session ID from JSON output
  ├─ opencode run "/recall <canary topic>" --dir "$SCRATCH_PROJECT" --format json --auto --session <captured-id>
  │     → assert the canary fact is returned (OCP-03/OCP-04 round trip)
  │
  └─ Negative control (unseeded scratch project, same env) → every assertion above must FAIL/NOT-FOUND

One genuine interactive session (D-01 fallback bar)
  └─ `opencode` (TUI) in $SCRATCH_PROJECT with HOME=$SCRATCH_HOME → operator/executor manually drives
     wakeup→edit→/remember→/recall in one continuous live conversation, sidestepping any --session/--continue
     CLI reliability risk entirely (the TUI keeps its own live session state)
```

### Recommended Harness Structure (extends `04-UAT.md` test 1)

```
scripts/ (or a phase-local scratch script, planner's discretion)
└── verify-opencode-live-parity.sh   # extends the Phase-4 OCP-05 acceptance script pattern
     ├── setup_scratch()             # mktemp -d HOME + project, seed .agentfs canary
     ├── install_assets()            # calls the two existing sync-opencode-*-assets.sh --apply
     ├── write_scratch_config()      # NEW — writes opencode.json (mcp.cairn-memory + provider + model)
     ├── run_stage_wakeup()          # opencode run FOUND/NOT-FOUND probe (Phase-4 pattern reused)
     ├── run_stage_recall_edit()     # opencode run + assert thrown context / no-throw negative control
     ├── run_stage_capture()         # opencode run + assert staged JSON contains canary
     ├── run_stage_remember_recall() # two opencode run calls, --session continuity
     ├── run_negative_controls()     # unseeded project, all of the above must fail
     └── cleanup()                   # rm -rf scratch dirs; confirm real ~/.claude, ~/.config/opencode untouched
```

### Pattern 1: MCP registration (local stdio server) — `[VERIFIED: local environment]` + `[CITED: opencode.ai/docs/mcp-servers/]`

**What:** OpenCode registers a local stdio MCP server in `opencode.json` under the `mcp` key, `"type": "local"`, with a `"command"` array (the full command + args to launch the server process) and an optional `"environment"` object for env vars scoped to that server's own subprocess.
**When to use:** The one-time scratch setup step (D-03).
**Example — confirmed live on this machine** (the operator's own real `~/.config/opencode/opencode.json` already registers `lean-ctx` this exact way):
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "cairn-memory": {
      "type": "local",
      "command": ["node", "/absolute/path/to/repo/mcp-memory-server/dist/index.js"],
      "enabled": true
    }
  }
}
```
**Confirmation the server name must be exactly `cairn-memory`:** `opencode/command/remember.md` and `opencode/command/recall.md` already hardcode `tools: { cairn-memory_memory_read: true, cairn-memory_memory_search: true, cairn-memory_memory_write: true, ... }` in their frontmatter — the MCP tool-naming convention is `<server-name>_<tool-name>` (single underscore), independently confirmed both by these command files and by `04-RESEARCH.md`'s live session-data inspection. A different registration name breaks the already-shipped commands.
**Caveat — env var placement:** `mcp.cairn-memory.environment` only reaches the MCP server subprocess itself (spawned when a `cairn-memory_memory_*` tool is actually invoked). The `memory-capture.ts` and `memory-wakeup.ts` plugins call `node <server> extract|wakeup` **directly via the `$` shell handle**, which inherits OpenCode's own process environment — so `CAIRN_LLM_API_KEY` / `CAIRN_LLM_EXTRACTION_MODEL` must be exported in the shell that launches `opencode run` itself, not (only) inside this `environment` block. Setting them in both places is harmless and recommended for clarity.

### Pattern 2: Full isolation via scratch `HOME` alone — `[CITED: opencode.ai/docs/config/]` + one open bug flagged

**What:** `~/.config/opencode` (global config + wherever `OPENCODE_CONFIG_DIR` defaults to), `~/.local/share/opencode/auth.json` (credentials), and AgentFS global scope (`~/.cairnkeep` default) are all `$HOME`-relative. Redirecting `HOME` to an empty scratch dir isolates all three simultaneously — exactly the mechanism Phase 4's OCP-05 acceptance run already used successfully (`04-06-SUMMARY.md`: "HOME pointed at an empty scratch home").
**When to use:** Every stage of this phase's harness (D-02).
**Caveat — do not fight `OPENCODE_CONFIG_DIR`:** docs state it is loaded *after* (i.e., merged on top of, not instead of) the global config, and a currently-open GitHub issue (`anomalyco/opencode#4399`) reports that pointing it at a non-default path silently fails to load its `opencode.json` unless a separate `OPENCODE_CONFIG` env var is also set. Since the `sync-opencode-*-assets.sh` scripts already default their live-root to `$HOME/.config/opencode` when `OPENCODE_CONFIG_DIR` is unset, the simplest safe choice is: **set only `HOME`**, leave `OPENCODE_CONFIG_DIR` unset (or, if D-02's literal wording is preferred, set it to exactly `$SCRATCH_HOME/.config/opencode` — the default path anyway, so functionally identical and bug-free).
**Verify cheaply at execution time:** after `write_scratch_config()`, run `opencode run "list your available tools" --dir "$SCRATCH_PROJECT" --format json` and grep the JSON output for `cairn-memory_` tool names — confirms both the registration loaded AND no real-`~/.config/opencode` tools leaked in.

### Pattern 3: Headless lifecycle triggering via `opencode run` — `[VERIFIED: this repo's 04-SPIKE-INJECTION.md]` for wakeup/recall, `[CITED]` for capture

**What:** `opencode run "<prompt>" --dir <path> --format json` is OpenCode's documented non-interactive execution mode — Phase 4's own spike already used it live to fire both `experimental.chat.system.transform` and `tool.execute.before`.
**When to use:** Every headless stage of this phase's harness.
**Example (Phase-4-proven invocation shape, this repo):**
```bash
# Source: 04-SPIKE-INJECTION.md (this repo) — confirmed live against opencode CLI v1.17.11
opencode run "Inspect your own system instructions for a line beginning with the exact prefix ..." \
  --dir "$SCRATCH_PROJECT" --format json
```
**New for this phase — `--auto` flag:** the operator's real config carries a permissive `permission` block (`exec`/`write`/`external_directory` all `"allow"`). A fresh scratch `opencode.json` with no `permission` block may prompt for edit/write approval, which in headless mode can hang or silently deny. Pass `--auto` (documented: "auto-approve non-denied permissions") on every `opencode run` invocation that needs a tool call to actually execute (recall-on-edit, remember, recall), or replicate a permissive `permission` block in the scratch config. **Symptom if missed:** `--format json` output ends with no `tool.execute` event despite the prompt clearly requesting an edit/write — indistinguishable at a glance from "the plugin didn't fire," so check this first if a stage silently produces no tool-call events.
**Open (cited, not yet run-verified in this repo): does `opencode run` reliably fire `session.idle` on completion?** CLI docs describe `run` as "exiting when idle" — strongly implies yes, but Phase 4 never exercised this hook. Verify cheaply in Wave 0 (see Common Pitfalls #1 below) before trusting the capture stage's pass/fail signal.

### Anti-Patterns to Avoid

- **Pointing `OPENCODE_CONFIG_DIR` at a custom, non-default path** without also setting `OPENCODE_CONFIG` — hits the open `#4399` bug; use the default-location trick above instead.
- **Relying on Phase 4's already-passed OCP-05 result without re-running the FOUND/NOT-FOUND canary check in this phase's own scratch env** — Phase 5 stands up a *new* scratch environment with a *new* MCP registration; re-confirm rather than assume carryover (D-04 already mandates fresh canaries per round-trip proof).
- **Treating "no staged JSON file appeared" as an unambiguous capture failure** without first confirming `session.idle` didn't double-fire on the title-gen sub-call (mirrors the exact system.transform dedupe bug Phase 4 found and fixed) — see Common Pitfalls #1.
- **Skipping `--auto` / a permissive `permission` block** — a headless run that silently hangs or auto-denies edit/write tool calls looks identical, from the harness's outside view, to "the recall plugin didn't fire."

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP server registration | A custom launcher script that starts `mcp-memory-server` and points OpenCode at a socket/port | The documented `mcp.<name> { type: "local", command: [...] }` stdio registration | Already the pattern the operator's own live config uses for `lean-ctx`; OpenCode manages the subprocess lifecycle itself |
| Session continuity for remember→recall | Custom session-ID persistence/tracking logic | `opencode run`'s own `--session <id>` (captured from the first call's `--format json` output) | Documented, first-party mechanism; avoids re-deriving OpenCode's internal session model |
| Verifying whether injected content reached the model | Parsing plugin-internal logs only | The FOUND/NOT-FOUND canary-recite probe pattern Phase 4 already validated (`04-SPIKE-INJECTION.md`) | Directly observes the model's actual context, not just that the plugin code ran without throwing |

**Key insight:** every mechanism this phase needs (MCP registration schema, headless execution, canary-probe verification) was either already proven live by Phase 4 or is directly confirmed by the operator's own working OpenCode config on this machine — there is no new plugin/command logic to write, only a scratch config + harness script.

## Common Pitfalls

### Pitfall 1: `session.idle` may double-fire on the title-generation sub-call, starving the real capture (highest-priority Wave-0 check)

**What goes wrong:** `memory-capture.ts` marks a session as `processed` (dedupe) *before* fetching messages and calling `extract` — a defensive measure against `session.idle` firing multiple times within one real working session. But Phase 4 already discovered, for the *sibling* hook `experimental.chat.system.transform`, that OpenCode fires it once for an internal title-generation sub-call and once for the real turn, **sharing the same `sessionID`**. If `session.idle` exhibits the same behavior, the title-gen sub-call's idle event would mark the session `processed` before any real user/assistant messages exist, and the true end-of-turn capture would be silently skipped by the dedupe check.
**Why it happens:** Undocumented OpenCode internal behavior (title generation is a real, separate agent-loop invocation that shares the parent session's ID); Phase 4 only characterized this for `system.transform`, not `session.idle`.
**How to avoid:** Before trusting the capture stage's assertions, run a throwaway diagnostic probe (mirroring `04-01`'s `probe.ts` — write only under a scratch config, delete after use): register `session.idle`, append `{sessionID, messageCountAtFireTime, time}` to a log file on every fire, run one `opencode run` prompt that should produce a real conversational turn, and inspect the log. If `session.idle` fires more than once per `sessionID` or fires before real messages exist, the capture plugin has the same bug class Phase 4 fixed in wakeup — flag it as a genuine Phase-4 defect requiring an in-scope fix (per this phase's context: "If verification uncovers a genuine defect, that is a fix within OCP-06 scope").
**Warning signs:** The capture stage of the harness consistently produces no staged file, even with `CAIRN_LLM_API_KEY`/`CAIRN_LLM_EXTRACTION_MODEL` correctly exported and a clearly durable-fact-worthy prompt.

### Pitfall 2: MCP registration silently fails to load (wrong path, crashing subprocess, or `OPENCODE_CONFIG_DIR` bug)

**What goes wrong:** `cairn-memory` appears correctly in `opencode.json`, but the harness never actually sees `cairn-memory_memory_*` tool calls — either because the `command` path is wrong, the server crashes on start, or (per Pattern 2's caveat) `OPENCODE_CONFIG_DIR` pointed at a non-default path never loaded at all.
**Why it happens:** `command` in the MCP registration must be an *absolute* path (the plugins already use `@@INFRA_ROOT@@`-rendered absolute paths for the same reason — relative paths break once OpenCode's own cwd differs from the repo root).
**How to avoid:** After writing the scratch config, run one throwaway `opencode run "list your available tools" --format json` and grep for `cairn-memory_` in the output before running any real stage — a fast, cheap positive-loading check (Pattern 2's "verify cheaply" step).
**Warning signs:** `/remember` or `/recall` commands appear to run (no error) but no `memory_write`/`memory_search` tool-call event shows up anywhere in the `--format json` stream.

### Pitfall 3: Env vars set in the wrong place look identical to "the feature is broken"

**What goes wrong:** `CAIRN_LLM_API_KEY` / `CAIRN_LLM_EXTRACTION_MODEL` are set only inside `mcp.cairn-memory.environment` (which only reaches the MCP server's own subprocess), not in the shell environment that launches `opencode run` — so `memory-capture.ts`'s direct `node <server> extract` shell-out (a separate subprocess spawn, not an MCP tool call) silently no-ops per its env guard (D-08/D-03 fail-open).
**Why it happens:** Two different invocation paths exist for the same server binary — MCP-tool-mediated (env from the `mcp.*.environment` block) and plugin-direct-shell-out (env inherited from OpenCode's own process) — and only the second one is used by `memory-capture.ts`/`memory-wakeup.ts`.
**How to avoid:** Export `CAIRN_LLM_API_KEY`, `CAIRN_LLM_API_URL`, `CAIRN_LLM_EXTRACTION_MODEL` in the harness script's own shell environment (the one that execs `opencode run`), not only inside the scratch `opencode.json`'s MCP `environment` block. Log the guard-relevant env vars' presence (not values) at harness start so a failed stage can be triaged against "env wasn't set" vs. "the plugin has a real bug."
**Warning signs:** Capture and wakeup stages behave inconsistently from remember/recall (which go through the MCP path and would see the registration's `environment` block).

### Pitfall 4: Headless permission prompts silently block or deny tool calls

**What goes wrong:** A fresh scratch `opencode.json` has no `permission` block (unlike the operator's real, permissive config); in headless `opencode run` mode, an edit/write tool call needing approval either hangs the process or is auto-denied, so `tool.execute.before` never fires for the harness to observe.
**Why it happens:** OpenCode's permission model defaults to prompting; `--auto` ("auto-approve non-denied permissions") or an explicit permissive `permission` block in the scratch config are the two documented ways around this in non-interactive mode.
**How to avoid:** Pass `--auto` on every `opencode run` invocation in the harness that expects a tool call to actually execute.
**Warning signs:** `--format json` output completes with no `tool.execute` events at all despite a prompt that unambiguously requests a file edit.

### Pitfall 5: `docs/operating.md` still describes the pre-Phase-4 OpenCode wakeup dependency on `~/.claude`

**What goes wrong:** `docs/operating.md` (lines 88-91) currently instructs: "Install the Claude assets first. The OpenCode memory-wakeup plugin reuses the rendered Claude hook at `~/.claude/hooks/memory-wakeup.sh`... otherwise the plugin fails open." This is stale — Phase 4's D-04 rewrote `memory-wakeup.ts` to be fully self-sufficient and no longer shells out to any Claude asset (confirmed by reading the current `opencode/plugins/memory-wakeup.ts` — no `~/.claude` reference anywhere in it).
**Why it happens:** The doc was not updated when Phase 4 shipped the native rewrite.
**How to avoid:** Not a Phase-5 blocker (the actual code doesn't depend on Claude assets — D-02's "no reachable `~/.claude`" isolation will pass regardless), but the stale doc could mislead an operator following it manually into believing the OpenCode path still requires Claude assets, which contradicts what Phase 5 is about to prove live. Flag this as a small in-scope fix candidate (documentation correction, not a new capability) for the planner to optionally include.
**Warning signs:** N/A for the harness itself; only relevant if a human reads the doc and gets confused.

## Code Examples

### Scratch `opencode.json` — full example (safe values only, no private hostnames)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "cairn-memory": {
      "type": "local",
      "command": ["node", "/absolute/path/to/repo/mcp-memory-server/dist/index.js"],
      "enabled": true
    }
  },
  "provider": {
    "local-ai": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Local AI",
      "options": { "apiKey": "local", "baseURL": "http://127.0.0.1:8001/v1" },
      "models": { "qwen3.6-27b-coder": { "name": "Qwen local model" } }
    }
  },
  "model": "local-ai/qwen3.6-27b-coder",
  "permission": {
    "exec": { "*": "allow" },
    "external_directory": { "**": "allow" },
    "read": { "**": "allow" },
    "write": { "**": "allow" }
  }
}
```
Source: local-MCP schema `[VERIFIED: local environment]` (this machine's real `~/.config/opencode/opencode.json`, `lean-ctx` entry) cross-checked against `[CITED: opencode.ai/docs/mcp-servers/]`; `provider`/`model`/`permission` shape mirrors this machine's real config verbatim (values shown are loopback/local-only, matching Phase 4's `04-UAT.md` precedent of using `127.0.0.1:8001` — no private hostnames per DEC-no-private-references).

### Harness invocation sequence (per stage)

```bash
# Source: pattern synthesized from 04-SPIKE-INJECTION.md's proven `opencode run` usage
# + opencode.ai/docs/cli/ (--dir, --format, --auto, --session flags)
export HOME="$SCRATCH_HOME"
export CAIRN_LLM_API_KEY="local"
export CAIRN_LLM_API_URL="http://127.0.0.1:8001/v1"
export CAIRN_LLM_EXTRACTION_MODEL="qwen3.6-27b-coder"

# Stage: wakeup (OCP-05) — reuses Phase-4's FOUND/NOT-FOUND canary probe verbatim
opencode run "Inspect your session-start context for a project-memory fact and echo it verbatim, or reply NOT-FOUND." \
  --dir "$SCRATCH_PROJECT" --format json --auto

# Stage: remember (OCP-03) — capture the session ID from JSON output for the recall stage
SESSION_ID=$(opencode run "/remember <fresh-canary-fact>" --dir "$SCRATCH_PROJECT" --format json --auto | jq -r '.sessionID // empty')

# Stage: recall (OCP-04) — reuse the captured session for a genuine same-session round trip
opencode run "/recall <canary-topic>" --dir "$SCRATCH_PROJECT" --format json --auto --session "$SESSION_ID"
```
(Exact JSON field name for the session ID in `--format json` output should be confirmed against a live run in Wave 0 — Phase 4's spike consumed the JSON stream for tool-call/system-prompt content but did not need to extract the session ID field itself.)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `cairn-memory` never registered as an MCP server for OpenCode (only shelled-out CLI subcommands) | Registered as a `type: "local"` stdio MCP server in a scratch `opencode.json` | This phase | First time OpenCode's own MCP-tool-call path (not just plugin shell-outs) is exercised for `cairn-memory` |
| Phase-4 acceptance harness only proved wakeup (OCP-05) | Extended to all five stages (wakeup, recall-on-edit, capture, remember, recall) | This phase | Closes the four owed 04-UAT test-2 items |

**Deprecated/outdated:** `docs/operating.md`'s OpenCode setup section still describes the pre-Phase-4 Claude-asset dependency for wakeup (see Pitfall 5) — worth a documentation fix, not a blocker.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `opencode run` fires `session.idle` on completion (the capture trigger) | Summary, Pattern 3 | If it does not fire reliably, OCP-01's headless proof is not achievable via `opencode run` alone and the capture stage must move to the interactive-session fallback (D-01) — verify in Wave 0 before committing the harness design |
| A2 | `session.idle` may double-fire on the title-generation sub-call, mirroring the confirmed `system.transform` behavior | Common Pitfalls #1 | If it does NOT double-fire, this pitfall is moot and the capture dedupe is fine as-is; if it DOES and is left unchecked, the harness could produce a false "capture is broken" result that is actually a Phase-4 dedupe bug — must be distinguished before concluding pass/fail |
| A3 | The exact JSON field name for the session ID in `opencode run --format json` output | Code Examples | If the field name differs from the assumed `sessionID`, the remember→recall headless round trip's `--session` continuity step needs a one-line fix; low risk, cheap to verify against one live run |
| A4 | A fresh scratch `opencode.json` with no `permission` block, run with `--auto`, behaves equivalently (for this harness's purposes) to the operator's real permissive config | Pattern 3, Common Pitfalls #4 | If `--auto` does not cover all needed tool categories (e.g., MCP tool calls specifically), the harness may need an explicit `permission` block instead — cheap to add defensively (already included in the Code Examples scratch config) |
| A5 | `OPENCODE_CONFIG_DIR` left unset (relying on scratch `HOME`'s default `$HOME/.config/opencode` resolution) fully satisfies D-02's isolation intent without hitting the `#4399` bug | Pattern 2 | If some other OpenCode code path bypasses the `$HOME`-relative default and needs `OPENCODE_CONFIG_DIR` explicitly, isolation could be incomplete; mitigated by setting `OPENCODE_CONFIG_DIR="$SCRATCH_HOME/.config/opencode"` explicitly (same value, zero extra risk) rather than leaving it fully unset, if the planner prefers defense-in-depth |

**If this table is empty:** N/A — see entries above.

## Open Questions

1. **Does `opencode run` reliably fire `session.idle` exactly once per real working session (not on the title-gen sub-call)?** — RESOLVED-AT-EXECUTION: 05-01 Wave-0 `session.idle` probe (Task 1); the capture-stage design in 05-02 Task 2 is gated on this finding.
   - What we know: CLI docs describe `run` as "exiting when idle," implying `session.idle` is the run command's own completion signal; Phase 4 confirmed `experimental.chat.system.transform` double-fires (title-gen + real turn) sharing `sessionID`, but never characterized `session.idle` specifically.
   - What's unclear: whether the same double-fire class applies to `session.idle`, and whether it fires before or after the real turn's messages are persisted.
   - Recommendation: Wave-0 diagnostic probe (mirrors `04-01`'s `probe.ts` exactly) — log every `session.idle` fire with message-count-at-fire-time, run one real `opencode run` prompt, inspect the log before trusting the capture stage's assertions.

2. **What is the exact field name/shape for extracting the session ID from `opencode run --format json` output, for the `--session <id>` continuity step?** — RESOLVED-AT-EXECUTION: 05-01 Wave-0 one-line JSON inspection; consumed by 05-02 Task 3's remember→recall `--session` continuity step.
   - What we know: `--format json` streams raw events (used successfully by Phase 4's spike to inspect `output.system` and `tool.execute.before` payloads); a session ID must be present somewhere in that stream since sessions are created per-run.
   - What's unclear: the exact top-level field name.
   - Recommendation: one throwaway `opencode run "hello" --format json | jq .` inspection during Wave 0 settles this in under a minute.

3. **Is the "one genuine interactive OpenCode session" (D-01's literal-live-session bar) best used for the full lifecycle, or specifically to de-risk the remember→recall multi-turn continuity that the headless `--session`/`--continue` flags have open reliability bugs against?** — RESOLVED-AT-EXECUTION: 05-03 interactive-session scope (the D-01 live-session bar recorded into 05-UAT.md).
   - What we know: `--continue`/`--session` have two open GitHub issues reporting inconsistent behavior; a real interactive TUI session has no such risk since it keeps its own live conversation state.
   - What's unclear: whether D-01 intends the interactive session as a full parallel proof or specifically as insurance against this one CLI weak point.
   - Recommendation: use it for the multi-turn remember→recall proof primarily (where the CLI's documented flag reliability is weakest), and let it double as informal confirmation of wakeup/recall-on-edit if convenient — matches D-01's stated rationale ("the roadmap says 'in a live OpenCode session' explicitly").

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| OpenCode CLI | Entire harness (headless + interactive) | ✓ | 1.17.11 | — |
| Node.js | `mcp-memory-server/dist/index.js` subcommands + MCP server | ✓ | v22.22.0 | — |
| `mcp-memory-server/dist/index.js` (built) | MCP registration target | ✓ (already built per Phase 1-4) | v1.0-validated | Rebuild via `cd mcp-memory-server && npm install && npm run build` if missing |
| Local OpenAI-compatible model endpoint | Drive extract/recall (D-04) | ✓ | `local-ai/qwen3.6-27b-coder` at `127.0.0.1:8001` confirmed reachable per Phase-4 precedent | Runtime endpoint fallback explicitly allowed by D-04 — try `debian-4080` next, record which was used |
| `jq` (or equivalent JSON field extraction) | Parsing `--format json` session IDs | not directly checked this session — verify at harness-write time | — | Any JSON parsing method (`node -e`, `python3 -c`) works equally; not a hard OpenCode dependency |

**Missing dependencies with no fallback:** none identified.
**Missing dependencies with fallback:** local model endpoint (fallback chain already established by D-04/Phase-4 precedent).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Bash harness script (extends the Phase-4 OCP-05 acceptance script pattern — no unit-test framework; this is a live-execution verification phase) |
| Config file | none — the harness IS the "test config" (scratch `opencode.json` written per-run) |
| Quick run command | A single-stage invocation, e.g. the wakeup FOUND/NOT-FOUND probe alone (fastest signal that MCP registration + isolation are sound) |
| Full suite command | The full harness script exercising all five stages + negative controls, then the one interactive session |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OCP-06 (wakeup) | Session-start context surfaces a seeded AgentFS canary with no reachable `~/.claude` | live/scripted | `opencode run` FOUND/NOT-FOUND probe (Phase-4 pattern reused verbatim) | ❌ Wave 0 — new harness stage |
| OCP-06 (capture) | Session-end stages a real candidates JSON containing the seeded canary | live/scripted, gated on Open Question 1 | `opencode run` + `ls`/`grep` on `.planning/memory-staging/*.json` | ❌ Wave 0 — new harness stage + diagnostic probe first |
| OCP-06 (recall-on-edit) | Editing a stem-matching file throws injected context containing the seeded fact; editing a non-matching file does not | live/scripted | `opencode run` + inspect `--format json` for a `tool.execute` error/result event | ❌ Wave 0 — new harness stage |
| OCP-06 (remember/recall) | `/remember` writes via a live MCP call; `/recall` (same or continued session) retrieves it | live/scripted, gated on Open Question 2 | Two `opencode run --format json` calls with `--session` continuity | ❌ Wave 0 — new harness stage |
| OCP-06 (negative controls) | Every stage above returns NOT-FOUND/no-effect against an unseeded scratch project | live/scripted | Same commands, unseeded project dir | ❌ Wave 0 — new harness stage |
| OCP-06 (interactive bar) | The full workflow works in one genuine interactive OpenCode session | manual/live (D-01 fallback-eligible) | Operator/executor drives `opencode` TUI manually in the scratch project | ❌ Wave 0 — the interactive script/checklist itself |

### Sampling Rate

- **Per task commit:** the single fastest stage (wakeup FOUND/NOT-FOUND probe) — confirms MCP registration + isolation didn't regress
- **Per wave merge:** the full scripted harness (all five stages + negative controls)
- **Phase gate:** full scripted harness green, plus the one interactive session, before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] Diagnostic probe: does `session.idle` double-fire on the title-gen sub-call the way `system.transform` does? (resolves Open Question 1 / Common Pitfalls #1 — highest priority, gates the capture stage's design)
- [ ] One-line inspection: exact session-ID field name in `opencode run --format json` output (resolves Open Question 2)
- [ ] Scratch `opencode.json` writer (MCP registration + provider/model + permission block) — new harness setup step, no precedent to copy verbatim (closest precedent: the operator's own real config, read this session)
- [ ] Negative-control scaffolding for all five stages (Phase 4 only built this for wakeup)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase does not touch auth; local model endpoint uses a placeholder `apiKey: "local"`, matching existing Phase-4 precedent for loopback-only local providers |
| V3 Session Management | no | OpenCode session IDs are harness-internal test plumbing, not a security boundary this phase modifies |
| V4 Access Control | no | No new access-control surface; scratch `permission: { "**": "allow" }` block is intentionally permissive and scoped to a throwaway scratch config, never the real one |
| V5 Input Validation | no | No new filesystem path-joining logic introduced by this phase (recall plugin's path-containment logic was already hardened in Phase 4/Phase 2 SEC-0001) |
| V6 Cryptography | no | No new cryptographic surface |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Canary token or scratch path leaking into a repo commit or the shipped harness script | Information Disclosure | DEC-no-private-references (LOCKED) — every canary/scratch value used in `05-UAT.md` must be a synthetic test string; scratch dirs are `mktemp -d`, never fixed/committed paths; cleanup step in every stage confirmed before the harness exits |
| Scratch `permission: "allow-all"` config accidentally written to the operator's REAL `~/.config/opencode/opencode.json` instead of the scratch one | Tampering | Harness must construct the scratch config path from `$SCRATCH_HOME` explicitly (never `$HOME` after the `export HOME=$SCRATCH_HOME` reassignment risks ambiguity if the script is interrupted mid-run) — mirror Phase 4's `04-06-SUMMARY.md` discipline of confirming `git status`/directory listing shows the real config untouched after every run |

## Sources

### Primary (HIGH confidence)

- Local filesystem: `~/.config/opencode/opencode.json` (this machine, `[VERIFIED: local environment]`) — ground truth for the live, working `mcp.<name> { type: "local", command: [...] }` schema and `provider`/`model`/`permission` shape
- `opencode.ai/docs/mcp-servers/` (fetched this session, `[CITED]`) — confirms `"type": "local"`, `"command"` array, `"environment"`, `"enabled"`, `"cwd"`, `"timeout"` keys for local MCP registration
- `opencode.ai/docs/cli/` (fetched this session, `[CITED]`) — `run` subcommand flags (`--dir`, `--format`, `--auto`, `--session`, `--continue`, `--model`), `OPENCODE_CONFIG_DIR`/`OPENCODE_CONFIG`/`OPENCODE_CONFIG_CONTENT` env vars, `~/.local/share/opencode/auth.json` credential location
- This repo: `.planning/phases/04-opencode-parity-operating-layer/04-SPIKE-INJECTION.md` — live, run-verified confirmation that `opencode run` fires `experimental.chat.system.transform` and `tool.execute.before`
- This repo: `.planning/phases/04-opencode-parity-operating-layer/04-06-SUMMARY.md` — the proven scratch-`HOME` OCP-05 acceptance harness this phase extends, plus the title-gen double-fire bug and its fix
- This repo: `opencode/command/remember.md`, `opencode/command/recall.md` — confirm the `cairn-memory_<tool>` naming convention and the exact required MCP server name
- This repo: `mcp-memory-server/src/index.ts` — confirms all `CAIRN_*` env var names and that AgentFS "project" scope resolves off `process.cwd()`, not an explicit directory argument

### Secondary (MEDIUM confidence)

- GitHub `anomalyco/opencode#4399` (WebSearch summary, `[CITED]`) — `OPENCODE_CONFIG_DIR` pointed at a non-default path may not load without a paired `OPENCODE_CONFIG`
- GitHub `anomalyco/opencode#11680`, `#3434` (WebSearch summary, `[CITED]`) — `--continue`/`--session` reliability issues
- CLI docs' "exiting when idle" phrasing for `opencode run` (WebFetch, `[CITED]`) — implies but does not explicitly confirm `session.idle` fires on run completion; treated as `[ASSUMED]` for planning purposes pending Wave-0 verification (A1)

### Tertiary (LOW confidence)

- None specifically flagged beyond what's already logged in the Assumptions Log.

## Metadata

**Confidence breakdown:**
- MCP registration config shape: HIGH — directly confirmed against this machine's own live, working OpenCode config, cross-checked with official docs
- Isolation mechanics (scratch HOME vs OPENCODE_CONFIG_DIR): MEDIUM-HIGH — mechanism is well-understood and grounded in docs + a proven Phase-4 precedent, but the `#4399` bug avoidance strategy (rely on scratch-HOME default resolution) has not itself been run-verified in this research pass
- Headless lifecycle triggering: MEDIUM — two of three stages (wakeup, recall-on-edit) are directly run-verified by Phase 4's own spike; the third (capture/`session.idle`) is cited-not-verified and flagged as the top Wave-0 priority
- Failure-mode / "silently proves nothing" catalogue: HIGH — five concrete, source-grounded failure modes identified, each with a specific harness assertion to guard against it

**Research date:** 2026-07-03
**Valid until:** 7 days (fast-moving: depends on the same actively-developed OpenCode CLI/plugin surface Phase 4 flagged as fast-moving; re-verify hook/CLI behavior if planning is delayed)
