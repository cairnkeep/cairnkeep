# Phase 4: OpenCode parity operating layer - Research

**Researched:** 2026-07-03
**Domain:** OpenCode plugin API (lifecycle hooks, command frontmatter) for porting the Claude memory operating layer
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** The heavy logic already lives in the `cairn-memory` MCP server — it exposes `wakeup` and `extract` subcommands (`node mcp-memory-server/dist/index.js wakeup|extract <model>`). That server binary IS the shared source of truth both harnesses already call. The Claude `.sh` hooks are thin glue around it.
- **D-02:** Port the thin glue **natively into TypeScript** inside each OpenCode plugin (call the server subcommands + read/write the same `.planning/` files). Do **not** introduce a new harness-neutral shell-script layer, and do **not** shell out to any `~/.claude` path. Rationale: the shared logic is the server, not the glue; a native TS port removes the Claude dependency with the smallest diff and no new artifact.
- **D-03:** Every plugin is **fail-open**: a missing server binary, missing `.agentfs`/`.planning`, or a failed subcommand must never wedge an OpenCode session.
- **D-04:** Reimplement `memory-wakeup.ts` to surface, natively, the same four things `memory-wakeup.sh` does: (1) AgentFS project memory via `node <server> wakeup`, (2) the wiki index `.planning/wiki/index.md`, (3) open **HARD** contradictions from `.planning/wiki/CONTRADICTIONS.md`, (4) a staged-candidates count from `.planning/memory-staging/`. Guard: no-op unless `.agentfs/project.db` or `.planning/wiki/index.md` exists. Keep the once-per-session dedupe and `experimental.chat.system.transform` injection already in the plugin.
- **D-05:** The server's `INFRA_ROOT` (path to `mcp-memory-server/dist/index.js`) is resolved for OpenCode independently of `~/.claude` — the install/sync step is responsible for making the plugin point at the real server path. (Researcher: confirm how the current plugin/install resolves INFRA_ROOT for OpenCode without the Claude token substitution.)
- **D-06:** **Drop the Claude-only file-memory layer.** AgentFS (via `mcp__cairn-memory__memory_write`) is the shared, cross-harness durable store. OpenCode `remember` = dedupe (`memory_search`) → write/supersede AgentFS (project scope) → *flag only* the doc layers (wiki via `/wiki-ingest`, AnythingLLM via `domain_knowledge_sync`), never auto-run them. OpenCode `recall` = read AgentFS + wiki index + optional `domain_knowledge_query`.
- **D-07:** Preserve the Claude command semantics verbatim where they are layer-agnostic: empty-argument guard, dedupe-before-write, absolute-date conversion, no em/double-hyphen dashes, doc-layer flag-don't-run. Only the frontmatter and the file-memory step change for OpenCode.
- **D-08:** The capture plugin writes to the **identical** staging contract the Claude hook uses: one `.planning/memory-staging/<UTCstamp>.json` file per session-end, the same `node <server> extract <EXTRACT_MODEL>` candidate JSON, the same 5-session retention cap, and the same env guards (`CAIRN_LLM_API_KEY`, `CAIRN_LLM_EXTRACTION_MODEL` both required, else no-op).
- **D-09:** The OpenCode lifecycle event that stands in for Claude's SessionEnd, and the mechanism for obtaining the session transcript/messages to feed `extract`, are **research items** (resolved below).
- **D-10:** Preserve the **high-signal / low-noise** rule: derive the target file's basename + stem (skip stems < 4 chars), match against the AgentFS wakeup index (grep by stem) and wiki source pages, and inject context **only** when there is a specific match — inject nothing on routine edits. Fail-open on any error.
- **D-11:** The concrete injection mechanism for OCP-02 is a **research item** (resolved below).
- **D-12:** Add `plugins/memory-capture.ts` and `plugins/memory-recall.ts` to the `ASSETS` array in `scripts/sync-opencode-plugin-assets.sh`; add `command/remember.md` and `command/recall.md` to the `ASSETS` array in `scripts/sync-opencode-memory-assets.sh`. No new sync script.

### Claude's Discretion

Exact TS structure/naming inside the plugins, the wording of the injected context strings, and the command markdown prose — all left to the executor, constrained by matching the Claude reference behavior and OpenCode's existing `memory-wakeup.ts` / `command/*.md` house style.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope. (Live end-to-end round-trip proof is Phase 5 / OCP-06, already roadmapped; token-miser and the enterprise overlay remain future milestones.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OCP-01 | On session end, OpenCode extracts memory candidates to the shared staging area | `session.idle`/`session.deleted` event analysis, `client.session.messages()` message/part shape (verified locally), staging JSON contract confirmed byte-identical to `mcp-memory-server extract` output |
| OCP-02 | Before an OpenCode edit/write, file-specific memory is injected into context | `tool.execute.before` payload shape + the throw-to-surface-context mechanism (only confirmed injection channel); subagent-bypass caveat |
| OCP-03 | `remember` in OpenCode persists a durable finding across memory layers | Command frontmatter pattern (`opencode/command/memory-sync.md` house style), MCP tool naming convention, D-06 layer scope |
| OCP-04 | `recall` in OpenCode retrieves known info across memory layers | Same frontmatter pattern; `memory_search`/`memory_read`/`domain_knowledge_query` reuse verbatim from Claude's `recall.md` |
| OCP-05 | OpenCode `memory-wakeup` surfaces session-start context without Claude assets | **CRITICAL FINDING:** `experimental.chat.system.transform` mutations are confirmed silently discarded by the OpenCode runtime (GH issue, closed not-planned) — the existing plugin's injection mechanism may not actually reach the model today; see Pitfall 1 |
</phase_requirements>

## Summary

This phase ports five Claude-hook behaviors to OpenCode's plugin model. The mechanical parts are straightforward and well-grounded: D-01–D-08 are settled, the `cairn-memory` server subcommands (`wakeup`, `extract <model>`) are unchanged shared logic, and the staging JSON contract, AgentFS scopes, and MCP tool names (`memory_read`, `memory_write`, `memory_search`, `memory_supersede`, `memory_history`, `memory_list`, `memory_delete`, `domain_knowledge_query`) are all directly confirmed from `mcp-memory-server/src/index.ts` and the Claude reference commands.

The hard part — and the reason this phase needed research before planning — is that **none of OpenCode's three relevant lifecycle hooks map cleanly onto what Claude's hooks do**, and one of them (the hook the existing wakeup plugin already depends on) is documented as **currently broken at the runtime level**:

1. **No `session.end` event exists.** The closest substitutes are `session.idle` (fires whenever the agent stops responding — likely multiple times per working session, and for subagent subsessions too) and `session.deleted` (fires on explicit deletion, not guaranteed on normal exit). Neither is a clean 1:1 match for Claude's single SessionEnd. Event handlers are also fire-and-forget (the returned promise is dropped by the runtime), which is a real risk for the async `extract` call this phase depends on.
2. **`tool.execute.before` cannot transparently inject context the way Claude's `additionalContext` does.** The only confirmed way to surface arbitrary text to the model from this hook is to `throw new Error(text)`, which **blocks** the tool call (the model sees the error as the tool result and must retry the edit). This is a materially different UX than Claude's non-blocking pre-edit injection, and it does not fire for subagent-issued edits (documented OpenCode bug).
3. **`experimental.chat.system.transform` — the hook `memory-wakeup.ts` already uses — has an open, closed-as-not-planned GitHub issue stating the runtime silently discards all mutations to `output.system` before the prompt reaches the LLM.** Two independent probe plugins and 37 passing unit tests confirmed the plugin-side mutation succeeds in-process but never reaches the model. If this is still true against the OpenCode version this project targets, OCP-05's wakeup surfacing plugin — even reimplemented perfectly per D-04 — will silently fail to inject anything, and the phase's acceptance test ("delete `~/.claude`, wakeup must still surface memory") will fail for a reason unrelated to the port itself.

**Primary recommendation:** Plan a Wave 0 "verify hook capability" spike — a minimal probe plugin exercised live against the OpenCode version installed in this environment (`opencode` CLI v1.17.11 confirmed present) — that checks whether `experimental.chat.system.transform` output actually reaches the model's context, before writing the full D-04 reimplementation. If the bug reproduces, fall back to the community-confirmed working channel: have the wakeup plugin write to an `AGENTS.md`/`CONTEXT.md`-style instruction file that OpenCode's built-in instruction-file discovery loads at system-prompt time (verified separate code path, not subject to the same bug). This fallback should be scoped and gated as a `checkpoint:human-verify` decision point, since it changes the injection mechanism the existing plugin already ships with.

## Architectural Responsibility Map

This phase has no browser/frontend tiers; the relevant "tiers" are harness-internal layers.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OCP-01 capture trigger + message retrieval | OpenCode Plugin Runtime (event hook) | cairn-memory MCP Server (`extract` subcommand) | Plugin owns the trigger + message-to-text conversion; server owns the LLM extraction call and candidate shape |
| OCP-02 recall trigger + match | OpenCode Plugin Runtime (`tool.execute.before`) | cairn-memory MCP Server (`wakeup` index) + Filesystem (`.planning/wiki/sources`) | Plugin owns the trigger + stem match; server/files own the searchable content |
| OCP-03 remember command | OpenCode Command Layer (markdown) | cairn-memory MCP Server (`memory_write`/`memory_supersede`) | Command orchestrates the dedupe-then-write flow; server persists |
| OCP-04 recall command | OpenCode Command Layer (markdown) | cairn-memory MCP Server (`memory_search`/`memory_read`) + Filesystem (wiki index) | Same split as remember |
| OCP-05 wakeup | OpenCode Plugin Runtime (`experimental.chat.system.transform`) | **OpenCode Core Runtime (Go binary — system-prompt assembly)** | Plugin builds the content; the Go core decides whether it reaches the LLM — **confirmed broken passthrough today**, see Summary |
| Install wiring | `scripts/sync-opencode-*-assets.sh` (shell) | Filesystem (`~/.config/opencode/`) | Idempotent copy + (new) INFRA_ROOT rendering, mirroring `sync-claude-assets.sh`'s `@@INFRA_ROOT@@` substitution |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@opencode-ai/plugin` | 1.17.13 (npm, `[VERIFIED: npm registry]` version; package legitimacy flagged SUS by the automated scanner — see audit below) | `Plugin` type import for OpenCode plugin files | The only documented way to type an OpenCode plugin; already used by `opencode/plugins/memory-wakeup.ts` `[VERIFIED: local codebase]` |
| Node.js | v22.22.0 (local, `[VERIFIED: local environment]`) | Runtime for `mcp-memory-server/dist/index.js` subcommands | Already the runtime for the shared server; no change needed |
| OpenCode CLI | 1.17.11 (local, `[VERIFIED: local environment]`) | Harness under test | Installed on this dev machine; usable for the Wave-0 spike |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@opencode-ai/sdk` | 1.17.13 (npm, `[ASSUMED]` — discovered via search, not yet imported anywhere in this repo) | Typed `Session`/`Message`/`Part` types if the plugin needs them for the message→text conversion | Only if D-09's implementation wants compile-time types for `client.session.messages()` results; otherwise the plugin can treat the SDK response as untyped JSON, matching the existing house style (`memory-wakeup.ts` has no local `@opencode-ai/sdk` dependency either) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `client.session.messages()` SDK call for OCP-01 | Reading `~/.local/share/opencode/storage/{message,part}/*.json` directly from the plugin | Filesystem read is a storage-layer implementation detail (confirmed to exist on this machine, but undocumented and unversioned); the SDK/client call is the documented, stable surface — **use the SDK, do not read storage files directly** |
| Throwing inside `tool.execute.before` for OCP-02 | Writing to an instruction file for `tool.execute.after` mutation | Instruction-file rewrite is asynchronous (next turn only) and not scoped to "this specific edit, before it proceeds" — throwing is the only mechanism that satisfies "before the edit proceeds" literally, at the cost of blocking the first attempt |

**Installation:** No new package installs are strictly required — `opencode/plugins/*.ts` and `opencode/command/*.md` are loose files with no local `package.json`, matching the existing `memory-wakeup.ts` pattern (OpenCode's own Bun-based loader resolves `@opencode-ai/plugin` at runtime; there is no local devDependency today). If the executor wants IDE type-checking during development, adding a scratch `devDependency` is optional and not part of the shipped asset tree.

**Version verification:** `npm view @opencode-ai/plugin version` → `1.17.13`; `npm view @opencode-ai/sdk version` → `1.17.13`; both confirmed to exist on the npm registry at time of research and roughly track the locally installed OpenCode CLI version (1.17.11), which corroborates legitimacy despite the automated scanner's "too-new" signal (see Package Legitimacy Audit).

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@opencode-ai/plugin` | npm | scanner reports "too-new" (publish-date heuristic; ~13.5M weekly downloads contradicts a hallucinated/new package) | 13,523,387/wk | none listed in npm metadata | `[SUS]` (tool verdict) | **Keep** — flagged per protocol, but this is very likely a scanner false positive: the package is confirmed by official OpenCode docs (`opencode.ai/docs/plugins/`) and is already the live dependency of this repo's working `memory-wakeup.ts`. Planner should still add a `checkpoint:human-verify` before any place this becomes an explicit installed dependency (e.g., if a `package.json` is introduced under `opencode/`). |
| `@opencode-ai/sdk` | npm | same heuristic | 14,181,910/wk | none listed | `[SUS]` (tool verdict) | **Keep**, same reasoning — only relevant if the executor chooses to import typed SDK client helpers for `client.session.messages()`; not required. |

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** `@opencode-ai/plugin`, `@opencode-ai/sdk` — both are almost certainly legitimate (huge download counts, official docs confirm the import path, already in production use in this repo) but the scanner's "too-new"/"no-repository" heuristics fired on npm metadata gaps. Planner must still gate any *new* explicit install (not the existing type-only import) behind `checkpoint:human-verify` per protocol.

## Architecture Patterns

### System Architecture Diagram

```
OpenCode session lifecycle
  │
  ├─ session start ──► [memory-wakeup.ts]
  │                      │  reads: .agentfs/project.db (via `node <server> wakeup`)
  │                      │         .planning/wiki/index.md
  │                      │         .planning/wiki/CONTRADICTIONS.md (open HARD only)
  │                      │         .planning/memory-staging/ (count only)
  │                      ▼
  │                 experimental.chat.system.transform
  │                      │
  │                      ▼
  │            [OpenCode Core Runtime — system prompt assembly]
  │                      │  ⚠ confirmed bug: output.system mutations may be
  │                      │    discarded here before reaching the LLM (verify first)
  │                      ▼
  │                    LLM sees session-start context (if bug does not reproduce)
  │
  ├─ edit/write tool call ──► [memory-recall.ts]
  │                             │  tool.execute.before(input, output)
  │                             │  input.tool === "edit" | "write"
  │                             │  output.args.filePath → basename/stem
  │                             │  stem match: `node <server> wakeup` index (grep)
  │                             │              .planning/wiki/sources/*.md (grep)
  │                             ▼
  │                        match found? ──yes──► throw Error(context text)
  │                             │                    │
  │                             no                    ▼
  │                             │              tool call blocked; model sees
  │                             ▼              context as tool-result text,
  │                        tool proceeds       retries edit informed
  │                        unmodified
  │
  └─ session end (no dedicated event) ──► [memory-capture.ts]
                                            │  event hook: session.idle (best-fit)
                                            │  guard: parentID absent (top-level only)
                                            │  client.session.messages({path:{id}})
                                            │       → {data: messages}
                                            │  for each message: fetch parts,
                                            │  join type:"text" parts in order,
                                            │  skip tool/reasoning/file parts
                                            ▼
                                    node <server> extract <EXTRACT_MODEL> (stdin=text)
                                            ▼
                                    .planning/memory-staging/<UTCstamp>.json
                                    (same shape as Claude's memory-capture.sh output;
                                     5-file retention cap; env-guarded no-op)
```

### Recommended Project Structure

```
opencode/
├── plugins/
│   ├── memory-wakeup.ts      # rewritten per D-04 — native, no ~/.claude shell-out
│   ├── memory-capture.ts     # new — OCP-01
│   └── memory-recall.ts      # new — OCP-02
├── command/
│   ├── remember.md           # new — OCP-03, house style of memory-sync.md
│   ├── recall.md             # new — OCP-04
│   └── memory-sync.md        # existing reference, unchanged
scripts/
├── sync-opencode-plugin-assets.sh   # extend ASSETS[]; add INFRA_ROOT rendering (new)
└── sync-opencode-memory-assets.sh   # extend ASSETS[] with remember.md/recall.md
```

### Pattern 1: Fail-open plugin guard (existing house style)

**What:** Every hook body wraps its work in `try { ... } catch { /* no-op */ }`, and bails early if required files/env are absent.
**When to use:** Every new plugin hook in this phase (matches D-03).
**Example:**
```typescript
// Source: opencode/plugins/memory-wakeup.ts (this repo, existing pattern)
"experimental.chat.system.transform": async (input, output) => {
  try {
    const sid = input?.sessionID ?? ""
    if (sid && surfaced.has(sid)) return
    if (!fs.existsSync(HOOK)) return
    // ... do work ...
  } catch {
    // Fail open — never block a session because context surfacing failed.
  }
},
```

### Pattern 2: Throw-to-surface-context (new — the only confirmed OCP-02 mechanism)

**What:** `tool.execute.before` cannot append freeform text to a passing tool call. The documented, working way to get text in front of the model at that exact point is to throw an `Error` whose message the model reads as the tool's failure result.
**When to use:** OCP-02 recall injection, when a specific memory/wiki match is found for the file about to be edited.
**Example:**
```typescript
// Source: OpenCode plugin docs (opencode.ai/docs/plugins/) — canonical block pattern
"tool.execute.before": async (input, output) => {
  if (input.tool === "edit" || input.tool === "write") {
    const filePath = output.args.filePath as string | undefined
    // ... derive stem, match against wakeup index / wiki sources ...
    if (matchFound) {
      throw new Error(
        `Memory recall (auto-injected for this file edit):\n\n${contextText}`
      )
    }
  }
},
```
**Caveat:** this blocks the first attempt at every matched edit — guard against repeat-throwing on the *same* file within the *same* session (mirrors the once-per-session dedupe pattern in `memory-wakeup.ts`) so the model is not stuck retrying the same file forever if it re-attempts the identical edit. Does **not** fire for tool calls issued by subagents spawned via the `task` tool (documented OpenCode limitation).

### Pattern 3: Session-message → plain text (new — adapts, does not reuse, `transcript-to-text.mjs`)

**What:** OpenCode's message shape is `{data: messages}` where each message (`role: "user"|"assistant"`) has associated `part` records fetched separately, each tagged with a discriminated `type` (`text`, `tool`, `reasoning`, `file`). This differs structurally from Claude's JSONL transcript (`{message: {role, content}}` per line), so `scripts/transcript-to-text.mjs` cannot be called as-is — its *behavior* (skip tool/reasoning noise, join user/assistant text in order) should be reimplemented against the parts shape.
**When to use:** OCP-01 capture, to build the text blob piped into `node <server> extract <model>`.
**Example (shape confirmed via direct local inspection):**
```json
// ~/.local/share/opencode/storage/message/<sessionID>/<messageID>.json
{ "id": "msg_...", "sessionID": "ses_...", "role": "assistant", "time": {...} }

// ~/.local/share/opencode/storage/part/<messageID>/<partID>.json (type: "text")
{ "id": "prt_...", "sessionID": "ses_...", "messageID": "msg_...", "type": "text", "text": "..." }

// type: "tool" (skip these when building extraction text, same as transcript-to-text.mjs)
{ "type": "tool", "tool": "write", "state": { "input": { "filePath": "...", "content": "..." } } }
```
Retrieve via the SDK, not by reading these files directly (the storage layout is undocumented and could change): `const { data } = await client.session.messages({ path: { id: sessionID } })`.

### Anti-Patterns to Avoid

- **Reading `~/.local/share/opencode/storage/**` directly from a plugin:** works today (confirmed on this machine) but is an undocumented internal layout, not a stable API. Use the SDK client passed into the plugin instead.
- **Relying on `experimental.chat.system.transform` without first verifying it actually reaches the model in the target OpenCode version:** the existing `memory-wakeup.ts` already depends on this hook and may already be silently non-functional. Do not assume D-04's reimplementation "just works" because the pattern matches the existing file.
- **Assuming `session.idle` == Claude's `SessionEnd`:** `session.idle` fires whenever the agent goes idle (potentially many times per working session and for subagent subsessions with a `parentID`). A capture plugin naively triggering on every `session.idle` will over-stage candidates and blow past the 5-session retention cap's intent. Filter to top-level sessions and consider debouncing.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Memory extraction (LLM call, candidate shape) | A second extraction pipeline inside the OpenCode plugin | `node <server> extract <model>` (same subprocess call the Claude hook already makes) | D-01 — the server is the single source of truth; duplicating this logic in TS would fork the candidate schema across harnesses |
| AgentFS read/write/dedupe | Direct SQLite/AgentFS file access from a plugin or command | The `cairn-memory` MCP tools (`memory_write`, `memory_search`, `memory_supersede`, `memory_read`) | Same lock/scope-guard concerns the server already handles (see Phase 2 SEC-0001 learnings on scope path containment) |
| Session message retrieval | Parsing `~/.local/share/opencode/storage/*` JSON directly in shipped code | `client.session.messages({ path: { id } })` via the SDK client passed to the plugin | Storage layout is an implementation detail; the client API is documented and stable |

**Key insight:** every piece of "smart" logic in this phase (extraction, embedding search, dedupe) already lives in `mcp-memory-server`. The only new code this phase should contain is thin: event wiring, message-to-text conversion, and stem-based file matching — all glue, no new logic layers.

## Common Pitfalls

### Pitfall 1: `experimental.chat.system.transform` mutations may not reach the LLM (blocks OCP-05)

**What goes wrong:** The wakeup plugin builds correct context, pushes it to `output.system`, and the hook fires without error — but the system prompt actually sent to the model is unchanged.
**Why it happens:** An open OpenCode GitHub issue (`anomalyco/opencode#17100`, closed as "not planned") documents the runtime silently discarding `output.system` mutations before the prompt reaches the LLM. Verified by the reporter with two independent probe plugins and 37 passing unit tests that confirmed the plugin-side object mutation succeeds, but the delivered prompt does not change.
**How to avoid:** Before implementing the full D-04 reimplementation, run a minimal probe plugin against the actual installed OpenCode version and confirm (or refute) that pushed `output.system` content is visible to the model in a live turn. If the bug reproduces, fall back to writing an `AGENTS.md`/`CONTEXT.md`-style instruction file that OpenCode's built-in instruction-file discovery loads at system-prompt assembly time — a separate, apparently-unaffected code path.
**Warning signs:** The plugin logs show it ran and pushed content (e.g., via `client.app.log()`), but the model's responses show no awareness of the injected memory/wiki/contradiction content.

### Pitfall 2: `session.idle` is not a clean session-end signal

**What goes wrong:** A capture plugin bound to `session.idle` fires every time the agent finishes a turn (not just once at true session close), and fires for subagent subsessions (which carry a `parentID`) as well as the top-level session.
**Why it happens:** OpenCode has no `session.end`/`session.close` event; `session.idle` and `session.deleted` are the closest documented substitutes, and neither matches Claude's single-fire SessionEnd semantics.
**How to avoid:** Filter to sessions with no `parentID` (top-level only), and design the extraction trigger to not re-run on every idle within the same session (e.g., only extract once per session using a message-count or last-processed-message-id watermark, not "every idle event").
**Warning signs:** `.planning/memory-staging/` fills up faster than expected, or contains near-duplicate extractions from what was really one working session.

### Pitfall 3: Fire-and-forget event handlers can truncate async extraction work

**What goes wrong:** The `extract` call requires a network round-trip to the configured LLM; if the plugin's `event` handler promise is dropped by the runtime (documented open issue requesting an awaited `event.sync` hook, not yet implemented) before that work finishes, the staging file may never get written.
**Why it happens:** OpenCode's plugin `event` hook is fire-and-forget by design — the runtime does not await the handler's returned promise.
**How to avoid:** Keep the extraction call as fast as reasonably possible, and treat missing staged output as an acceptable (fail-open) outcome rather than something to retry-loop on. Do not assume the async work reliably completes before process exit; if this proves unacceptable in practice, flag it as an open question for Phase 5's live verification.
**Warning signs:** Sessions end but no staging file appears despite `CAIRN_LLM_API_KEY`/`CAIRN_LLM_EXTRACTION_MODEL` both being set.

### Pitfall 4: `tool.execute.before` does not intercept subagent tool calls

**What goes wrong:** If any part of this codebase's workflow delegates edits to a subagent (via the `task` tool), OCP-02's recall injection silently never fires for those edits.
**Why it happens:** Documented OpenCode limitation/bug (`anomalyco/opencode#5894`) — plugin hooks work for the primary agent but are bypassed for subagent-issued tool calls.
**How to avoid:** Document this as a known scope limitation for OCP-02 rather than trying to work around it in this phase (out of scope per REQUIREMENTS.md — "no new operating-layer surface").
**Warning signs:** N/A for direct verification in this phase; relevant if Phase 5 live-testing exercises subagent-driven edits.

### Pitfall 5: INFRA_ROOT is not currently rendered for OpenCode plugin assets

**What goes wrong:** `scripts/sync-opencode-plugin-assets.sh` today does a byte-for-byte `install`/`cmp` of `opencode/plugins/*.ts` with no `@@INFRA_ROOT@@` substitution step (unlike `sync-claude-assets.sh`, which `sed`s the token before installing Claude hooks). If the new native TS plugins need an absolute path to `mcp-memory-server/dist/index.js`, this substitution step does not exist yet for OpenCode.
**Why it happens:** The only OpenCode plugin asset so far (`memory-wakeup.ts`) never needed a server path — it shelled out to the Claude hook instead. This phase is the first to need it.
**How to avoid:** Extend `sync-opencode-plugin-assets.sh` to render `@@INFRA_ROOT@@` → the resolved repo root (`ROOT_DIR`, same value `sync-claude-assets.sh` already computes via `cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd`) before installing, mirroring the existing Claude hook-rendering step. This is a plan-worthy change to the sync script, not just an `ASSETS[]` addition.
**Warning signs:** The reimplemented plugins hardcode a path or rely on `process.cwd()` in a way that breaks when OpenCode's working directory differs from the target project root.

## Code Examples

### Server subcommand invocation (Claude reference, direct port target)
```bash
# Source: claude/hooks/memory-capture.sh (this repo)
candidates_json="$(printf '%s' "$text" | node "$SERVER_ENTRY" extract "$EXTRACT_MODEL" 2>/dev/null || true)"
```
```typescript
// Native TS equivalent using the $ shell handle already used by memory-wakeup.ts
const res = await $`node ${SERVER_ENTRY} extract ${EXTRACT_MODEL}`.quiet().nothrow().stdin(text)
const candidatesJson = String(res.stdout ?? "").trim()
```
(Exact `$` stdin-piping API should be confirmed against the installed `@opencode-ai/plugin`/Bun shell version during implementation — the existing plugin only demonstrates argument-based invocation, not stdin piping.)

### Staging file contract (verbatim shape, confirmed in `mcp-memory-server/src/index.ts` and `claude/commands/memory-review.md`)
```json
{ "model": "...", "count": 2, "candidates": [
  { "key": "...", "value": "...", "category": "...", "importance": 3, "rationale": "..." }
] }
```

### MCP tool naming convention (verified locally)
```json
// Source: ~/.local/share/opencode/storage/part/.../*.json (this machine, live session data)
{ "type": "tool", "tool": "lean-ctx_ctx_shell", "state": { "input": { "command": "..." } } }
```
Confirms MCP tools surface to OpenCode as `<mcp-server-name>_<tool-name>` (single underscore), not Claude's `mcp__server__tool`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `memory-wakeup.ts` shells out to `~/.claude/hooks/memory-wakeup.sh` | Native TS reimplementation calling `node <server> wakeup` directly (D-04) | This phase | Removes the last Claude-asset dependency from the OpenCode path |
| Claude file-memory layer (`~/.claude/projects/.../memory/`) referenced from `remember.md` | Dropped for OpenCode; AgentFS is the sole durable structured store (D-06) | This phase | Simplifies the write path; wiki/AnythingLLM remain flag-only |

**Deprecated/outdated:** none — this is new capability, not a migration of already-shipped OpenCode behavior (aside from the wakeup plugin's Claude shell-out, which D-04 explicitly retires).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@opencode-ai/sdk`'s `client.session.messages({ path: { id } })` returns `{ data: messages }` with the exact shape described (role on the message, text in separate `part` records) | Standard Stack, Pattern 3 | If the actual SDK response shape differs, the message→text conversion in the capture plugin needs rework; local storage inspection increases confidence but the SDK's client-facing shape was not directly exercised (only the on-disk storage format was) |
| A2 | `tool.execute.before`'s `output.args.filePath` is the correct field for both `edit` and `write` tools | Pattern 2 | Confirmed via one real `write` tool's persisted state (`input.filePath`) — if the live hook payload field name differs from the persisted-state field name, the recall plugin's file-path extraction breaks silently (fail-open masks this, so verify explicitly in Wave 0) |
| A3 | Throwing inside `tool.execute.before` reliably causes the model to see the message and retry the edit (rather than abandoning it) | Pattern 2, Pitfall 4's sibling risk | If the model does not reliably retry after a thrown-with-context error, OCP-02's "inject before the edit proceeds" success criterion may not be satisfiable via this mechanism at all, and would need a design escalation back to discuss-phase |
| A4 | `experimental.chat.system.transform`'s "mutations discarded" bug (GH #17100) still reproduces against the OpenCode version this project targets | Summary, Pitfall 1 | This is the single highest-impact assumption in this research — everything about D-04/OCP-05 planning depends on whether this is still true. Recommend verifying empirically in Wave 0 rather than trusting the issue's "closed as not planned" status as permanent |
| A5 | `@opencode-ai/plugin` / `@opencode-ai/sdk` npm packages are legitimate despite the automated legitimacy scanner's `[SUS]` verdict | Package Legitimacy Audit | Very low risk (huge download counts, official docs confirm the import, already in production use in this repo) but flagged per protocol; if wrong, the entire plugin type-import pattern would need re-sourcing |

**If this table is empty:** N/A — see entries above.

## Open Questions

1. **Does `experimental.chat.system.transform` actually deliver injected content to the model in the OpenCode version this project targets?**
   - What we know: GitHub issue #17100 (closed as not planned) documents this as broken; the existing `memory-wakeup.ts` already depends on this exact hook.
   - What's unclear: whether this project's currently-supported OpenCode version is affected, and whether any undocumented fix landed since the issue was closed.
   - Recommendation: Wave 0 spike — a minimal probe plugin, run live against the installed `opencode` CLI (confirmed present on this machine, v1.17.11), that pushes a unique marker string and checks whether the model can see/repeat it. Gate D-04's implementation approach (system-prompt hook vs. instruction-file fallback) on this result.

2. **What message-count/watermark strategy correctly maps `session.idle` to "one capture per real working session"?**
   - What we know: `session.idle` fires whenever the agent stops responding, potentially many times per session, and for subagent subsessions (`parentID` present).
   - What's unclear: the exact recommended debounce/watermark pattern; no first-party guidance found for "treat this like Claude's one-shot SessionEnd."
   - Recommendation: filter to `parentID`-absent sessions; consider capturing only once per session by tracking the last-processed message ID/count in a small local marker (mirroring the once-per-session `Set` dedupe already used for wakeup), and treat any extraction as best-effort/fail-open rather than exactly-once-guaranteed.

3. **Does throwing inside `tool.execute.before` reliably cause the model to retry the blocked edit with the injected context in view, rather than giving up or looping?**
   - What we know: throwing is the documented way to surface text to the model at that point; no first-party guidance on model retry behavior after such a throw.
   - What's unclear: empirical retry behavior across different models/providers.
   - Recommendation: treat as a Wave 0/Nyquist validation item — exercise a real edit against a file with a seeded memory match and observe whether the agent proceeds sensibly after the thrown message.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | `mcp-memory-server/dist/index.js` subcommands | ✓ | v22.22.0 | — |
| OpenCode CLI | Live verification of plugin hooks (Wave 0 spike) | ✓ | 1.17.11 | — |
| `@opencode-ai/plugin` (npm, type-only import) | Plugin `Plugin` type | ✓ (registry) | 1.17.13 | Resolved at runtime by OpenCode's own Bun loader; no local install needed to ship |
| `@opencode-ai/sdk` (npm, optional) | Typed `client.session.messages()` if desired | ✓ (registry) | 1.17.13 | Untyped/`any` usage is acceptable — matches existing house style |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none — all required tooling is present in this environment.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `mcp-memory-server`'s existing offline smoke-test scripts (`npm run test:smoke` — Node, no test framework/runner beyond plain scripts) |
| Config file | none — see Wave 0 |
| Quick run command | `cd mcp-memory-server && npm run check:extract` (exercises `extract` subcommand offline) |
| Full suite command | `cd mcp-memory-server && npm test` |

There is no existing automated test harness for the OpenCode plugin/command assets themselves (they are exercised by live-session manual verification today, per Phase 3's `docs/operating.md`). This phase's Nyquist validation therefore leans on **live-execution checks** rather than unit tests, consistent with how `memory-wakeup.ts` was verified in Phase 3.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OCP-01 | Session end stages a candidates JSON file | manual/live | Start an OpenCode session, make a durable-fact-worthy statement, end the session, `ls .planning/memory-staging/*.json` | ❌ Wave 0 (no automated harness yet) |
| OCP-02 | Editing a file with a known memory/wiki match surfaces that context before the edit completes | manual/live + Wave-0 spike (Open Question 3) | Seed an AgentFS fact referencing a specific file, ask the agent to edit that file, observe the thrown-context/retry behavior | ❌ Wave 0 |
| OCP-03 | `remember` writes to AgentFS project scope | manual/live | `/remember <fact>` in an OpenCode session, then `memory_read` to confirm the write | ❌ Wave 0 |
| OCP-04 | `recall` retrieves the fact written above | manual/live | `/recall <topic>` in an OpenCode session, confirm the fact surfaces | ❌ Wave 0 |
| OCP-05 | Wakeup surfaces AgentFS + wiki + HARD contradictions with **no `~/.claude` present** | manual/live — **the hard acceptance bar** | Delete/rename `~/.claude`, start a fresh OpenCode session in a project with `.agentfs/project.db` and `.planning/wiki/index.md`, confirm the model's opening turn reflects the injected context | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `cd mcp-memory-server && npm run check:extract` (fast, offline, confirms the shared subcommand contract is untouched by this phase's TS glue)
- **Per wave merge:** live OpenCode session walkthrough of the specific OCP-0X behavior that wave implemented
- **Phase gate:** the `~/.claude`-deleted wakeup acceptance test (OCP-05) plus one full remember→recall round trip, before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] A minimal probe plugin to empirically test whether `experimental.chat.system.transform` output reaches the model (resolves Open Question 1 / Pitfall 1) — this should run **before** committing to D-04's implementation approach.
- [ ] A small live-session checklist/script for exercising OCP-01–05 manually (no existing automated harness for OpenCode plugin/command behavior — Phase 5 (OCP-06) is where the full live round-trip gets formally proven, but this phase still needs *some* Wave-level manual verification per task).
- [ ] Decision on the `sync-opencode-plugin-assets.sh` INFRA_ROOT-rendering change (Pitfall 5) before the capture/recall plugins are written, since they need a real server path to call subcommands.

## Security Domain

> `security_enforcement` config key not found in `.planning/config.json` (no config file exists in this repo) — treating as enabled per default.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase does not touch auth |
| V3 Session Management | no | OpenCode session IDs are harness-internal, not a security session boundary this phase modifies |
| V4 Access Control | no | No new access-control surface |
| V5 Input Validation | yes | File-path stem matching (D-10) must not be usable for path traversal into content outside `.planning/wiki/sources` — reuse the existing scope-path containment pattern already hardened in Phase 2 (SEC-0001: `relative()`-based containment, not `resolve()===join()`) if the new plugins do any filesystem path joining beyond what's already server-side |
| V6 Cryptography | no | No new cryptographic surface |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Untrusted file-path input driving a filesystem read (recall plugin reading wiki source files by matched stem) | Tampering / Information Disclosure | Confine reads to `.planning/wiki/sources/` using the same `relative()`-based containment approach the memory server already uses post-SEC-0001 (this repo, `mcp-memory-server` scope-path fix) — do not construct paths by naive string concatenation |
| Thrown error text (OCP-02) echoing arbitrary matched content back into the model's context | Information Disclosure (low severity — the content is the project's own memory/wiki, not secrets) | No additional mitigation needed beyond what already gates AgentFS/wiki content today; this phase does not introduce a new data source, only a new delivery channel |

## Sources

### Primary (curated docs, `[CITED]`)
- `opencode.ai/docs/plugins/` — Plugin type import, `$` shell handle, full hook-name list including `session.idle`, `session.deleted`, `tool.execute.before/after`, `experimental.chat.system.transform`, `experimental.session.compacting`
- `opencode.ai/docs/mcp-servers/`, `opencode.ai/docs/tools/` — MCP tool wildcard naming convention (`servername_*`), coarse tool-permission model
- `opencode.ai/docs/commands/` — documented command frontmatter fields (`description`, `agent`, `model`, `subtask`) — notably does **not** document a `tools:` field for commands, unlike this repo's existing `memory-sync.md`
- GitHub `anomalyco/opencode#17100` (fetched directly) — `experimental.chat.system.transform` mutation-discard bug, closed as not planned
- Local filesystem inspection of `~/.local/share/opencode/storage/{session,message,part}/*.json` on this machine — `[VERIFIED: local environment]` ground truth for message/part shape and MCP tool naming (`lean-ctx_ctx_shell`)
- `mcp-memory-server/src/index.ts` (this repo) — `wakeup`/`extract` CLI subcommand behavior, registered MCP tool names, env var contract
- `claude/hooks/memory-{wakeup,capture,recall}.sh`, `claude/commands/{remember,recall,memory-review}.md`, `opencode/plugins/memory-wakeup.ts`, `opencode/command/memory-sync.md`, `scripts/sync-{claude,opencode-plugin,opencode-memory}-assets.sh`, `scripts/transcript-to-text.mjs` (this repo) — all read directly

### Secondary (WebSearch/WebFetch summaries cross-checked against official docs, `[CITED]`/MEDIUM)
- Community porting guides (dev.to, GitHub gists) confirming `tool.execute.before` ≈ Claude's `PreToolUse`, throw-to-block pattern, and the subagent-bypass limitation (`anomalyco/opencode#5894`)
- GitHub issue summaries (`#17637`, `#16879`) on missing user-message context and fire-and-forget event handlers

### Tertiary (LOW confidence, flagged for validation)
- Any specific claim about exact runtime version numbers where OpenCode's system.transform bug was introduced/fixed — not independently confirmed beyond "closed as not planned, no fix noted"

## Metadata

**Confidence breakdown:**
- Standard stack (server subcommands, MCP tool names, staging contract): HIGH — directly read from this repo's own source
- Architecture / lifecycle hook mapping: MEDIUM — grounded in official docs plus a directly-fetched GitHub issue and local storage inspection, but the two highest-stakes claims (system.transform bug reproduction, throw-then-retry model behavior) are unverified against a live session in this research pass
- Pitfalls: MEDIUM-HIGH — five concrete, source-grounded pitfalls identified; the two most severe (Pitfall 1, Pitfall 2) are exactly the reason a Wave 0 spike is recommended before full implementation

**Research date:** 2026-07-03
**Valid until:** 7 days (fast-moving: OpenCode is an actively developed harness with recent open issues on the exact hooks this phase depends on; re-verify hook behavior if planning is delayed)
