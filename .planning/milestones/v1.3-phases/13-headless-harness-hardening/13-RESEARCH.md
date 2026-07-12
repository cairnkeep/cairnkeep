# Phase 13: Headless Harness Hardening - Research

**Researched:** 2026-07-08
**Domain:** Bash test-harness hardening for a CLI (`opencode run`/`opencode serve`) NDJSON event stream; process-lifecycle race workarounds; soak-testing methodology
**Confidence:** HIGH (the D-10 critical mandate — the NDJSON event schema — was pinned via a live capture against the actually-installed opencode CLI in this research session, not inferred from docs alone)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01: The bar is 5/5 consecutive round-trip passes** with zero manual
  operator intervention. A failed iteration resets the count. Rejected: M-of-N
  (tolerating flaky runs doesn't close a reliability gap) and 3/3 (thin margin
  over v1.1's "proven once").
- **D-02: A `--repeat N` soak mode is added to
  `scripts/verify-opencode-live-parity.sh`** (e.g. `--repeat 5`) that loops
  the round-trip stage N times and emits a per-iteration PASS/FAIL table plus
  an aggregate verdict — one command, one recorded output. Rejected: separate
  wrapper script, manual re-runs.
- **D-03: Fresh scratch environment per iteration.** Each of the 5 runs does
  full scratch-HOME setup, fresh canary, fresh `opencode serve`, and teardown
  — 5 independent cold reproductions, no state bleed between runs.
- **D-04: Evidence = per-run + aggregate.** The `--repeat` output (per-run
  table + verdict) is recorded in the phase UAT/VERIFICATION doc;
  MILESTONES.md's v1.1 Known Gaps entry and REQUIREMENTS.md traceability are
  updated to point at it (Success Criterion #3), the way Phase 11 recorded
  its milestone gate.
- **D-05: OCP-07 is conditioned on a tool-call-reliable model.** "Reliable
  headless reproduction" means reliable **given a no-thinking,
  tool-call-reliable local model** (the class that proved the round-trip in
  v1.1). Retry exists to absorb opencode run-completion flakiness — it does
  NOT attempt to out-retry a thinking model that narrates instead of calling
  tools; v1.1 root-caused that as external to cairnkeep.
- **D-06: A mechanical preflight probe gates the soak.** Before the 5-run
  soak, a cheap probe asserts the configured model emits a genuine tool call,
  failing fast with a clear "model not tool-call-reliable" message instead of
  burning 5 scratch setups. Mirrors the Phase 6 spike-before-wiring lesson.
  Probe placement/shape = planner discretion.
- **D-07: Docs state the precondition trait-based, with the proven example.**
  The requirement is documented as "a no-thinking, tool-call-reliable local
  model", citing qwen3.5-27b as the publicly-known model that passed (a public
  model name does not breach DEC-no-private-references). Model selection stays
  operator-env-driven — no committed defaults, no known-good allowlist in the
  harness.
- **D-08: The round-trip stages upgrade to genuine tool-event assertions.**
  `run_stage_remember_recall` (seeded + unseeded negative control) stops
  trusting substring greps and instead parses the `--format json` NDJSON
  stream for real tool-execution events — discharging the MILESTONES.md
  carried-forward follow-up (narrated-but-unexecuted tool syntax
  false-positives) where it matters. Other stages keep their existing
  assertions (v1.1 accepted their evidence; no requirement demands widening
  the diff).
- **D-09: Assertion strictness = tool event + canary linkage.** PASS requires
  a genuine `memory_write`/`memory_supersede` tool event on `/remember` AND a
  `memory_search`/`memory_read` tool event on `/recall` whose result payload
  contains the canary — tying the tool call to the actual data round-trip.
- **D-10: The researcher pins the real NDJSON event schema first.** The exact
  event shape from `opencode run --format json` (field names, tool-result
  payload location) is unconfirmed — the researcher MUST capture a live
  stream from the installed opencode version and pin the shape before
  planning locks the parser (Phase 10 D-02 precedent).
- **D-11: Only `run_stage_remember_recall` converts to serve/`--attach`.**
  The capture stage already runs on that pattern; wakeup and recall-on-edit
  keep plain `opencode run` — their evidence was accepted in v1.1 and they
  are not part of the gap.
- **D-12: The soak covers the round-trip stage 5/5; `--full` runs once.** The
  `--repeat` loop soaks the hardened remember→recall stage (fresh scratch each
  iteration, D-03); the full suite (wakeup, recall-on-edit, capture, negative
  controls) runs once as a regression check that the harness changes broke
  nothing.
- **D-13: Retries absorb infra failures only.** Bounded retry (~3 attempts,
  planner discretion) applies only to identifiable run-completion/transport
  flakiness (the undici↔server race, timeouts, opencode exiting before the
  turn completes). A run that completes cleanly but fails its
  tool-event/canary assertion FAILS the iteration outright — no retry.
  Retry counts are logged in the per-run evidence so 5/5 stays honest
  (Success Criterion #2: retries absorb the flakiness; they never mask a
  broken round-trip).

### Claude's Discretion

- Preflight probe placement and mechanism (inside the harness vs. reusing the
  Phase 6 probe style), exact retry bound and infra-failure classification,
  NDJSON parser implementation (jq/node/etc.), `--repeat` flag ergonomics,
  and evidence-table format — preserve the invariants above (5/5 bar, fresh
  scratch per iteration, infra-only retry, event+canary assertions).
- If new env keys are introduced (none are expected), they must land in the
  docs in the same phase — `scripts/verify-docs-parity.sh` gates this.

### Deferred Ideas (OUT OF SCOPE)

- **Interactive TUI confirm of the round-trip** — carried v1.1 gap, remains
  out of scope (needs a TTY operator; REQUIREMENTS.md Out of Scope).
- **Tool-event assertion upgrade for wakeup/recall-on-edit/capture stages**
  — D-08 scopes the upgrade to the round-trip stages; converting the rest is
  a possible future consistency pass if their evidence is ever questioned.
- **Converting wakeup/recall-on-edit to serve/`--attach`** — rejected for
  this phase (D-11); revisit only if those stages exhibit the same
  run-completion flakiness in practice.
- **Soaking the whole `--full` suite N×** — rejected (D-12) as runtime-heavy
  with no requirement behind it; the single regression pass covers it.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OCP-07 | The headless harness reliably reproduces the OpenCode `/remember`→`/recall` round-trip (serve/`--attach` + retry), closing the v1.1 OCP-06 override gap. Headless reproducibility only — interactive-TUI confirm is out of scope. | Pinned NDJSON event schema (below) unblocks the D-08/D-09 parser design; the `start_capture_server`/`stop_capture_server` pattern already in the harness is the exact D-11 conversion target; the GitHub upstream issue confirming the run-completion race (Common Pitfalls) justifies and scopes D-13's infra-only retry; the live "empty-model-config hangs forever" finding directly informs D-06's preflight probe design. |

</phase_requirements>

## Summary

This phase hardens an existing, already-working bash harness
(`scripts/verify-opencode-live-parity.sh`) rather than building anything new.
The three deliverables are: (1) a `--repeat N` soak mode around the existing
`run_stage_remember_recall`, converted to the serve/`--attach` transport the
capture stage already proved; (2) a real NDJSON-event parser replacing the
current substring-grep assertions in that one stage; (3) a preflight probe
that fails fast when the configured model isn't tool-call-reliable, before
burning five scratch-environment setups.

The critical unknown going into this phase — the exact shape of
`opencode run --format json`'s NDJSON stream — is now resolved. This research
session captured live output directly from the installed opencode CLI
(`opencode-ai@1.17.15`, current npm-distributed version) driving the actual
`cairn-memory` MCP server from this repo, both via plain `opencode run` and
via `opencode serve` + `--attach`. The two transports produce byte-identical
event envelopes, confirming D-11's conversion is transport-only and doesn't
change downstream parsing. A genuine tool-execution event has top-level
`type: "tool_use"` (not `"tool"` — that string appears one level down, at
`part.type`), the tool name is at `part.tool` as an exact string
(`cairn-memory_memory_write`, `cairn-memory_memory_search`, etc., matching
the harness's existing grep patterns character-for-character), and the
tool-result payload is a **JSON-encoded string** at `part.state.output`
(not a nested JSON object — it must be string-matched or `JSON.parse`d a
second time to inspect structured fields).

Independently, a public GitHub issue against opencode
(anomalyco/opencode#26855) documents the exact upstream race this phase's
retry logic must absorb: the CLI's JSON-output loop can observe
`session.status=idle` and exit before flushing the final `step_finish` event
— reproduced by the opencode maintainers as model-independent (using a
hosted GPT model, not a local one), which independently corroborates
MILESTONES.md's "model-independent... undici↔server" root-cause language.
Critically, this race affects `step_finish`, which D-08/D-09's assertions do
not depend on — the design of checking for a `tool_use` event with a
matching `part.tool` and canary-bearing `part.state.output` is naturally
robust to this specific known bug, though the planner should still treat "no
JSON output at all" / a `timeout`-triggered kill as the infra-retry case
(D-13), and "well-formed output with no tool_use event at all" as the
narration-failure case (no retry, per D-13).

**Primary recommendation:** Build the D-08/D-09 parser as a small Node
one-liner (mirroring `extract_session_id()`'s existing style already in the
script) that scans NDJSON lines for `type=="tool_use"` AND
`part.tool` matching a regex AND `part.state.output` containing the canary
substring — no new dependency, reuses the harness's existing idiom, and
sidesteps `jq`'s awkwardness with a stream of independent JSON objects (one
per line) mixed with the script's other `2>&1`-captured stderr/log noise.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `--repeat N` soak loop / per-iteration scratch setup-teardown | Test Harness (bash script) | — | Pure orchestration; no product code changes (D-02/D-03) |
| Preflight tool-call-reliability probe | Test Harness (bash script) | External CLI (`opencode run`) | Mirrors the Phase 6 probe pattern; a cheap gate before the expensive soak (D-06) |
| serve/`--attach` transport for the round-trip stage | External CLI (`opencode serve`/`run --attach`) | Test Harness | The workaround lives entirely in how the harness invokes the CLI; no plugin/server code changes (D-11) |
| NDJSON tool-event parsing | Test Harness (bash+node helper) | — | Client-side parsing of the CLI's own stdout stream; the event schema is opencode's, the parser is the harness's (D-08/D-09) |
| `cairn-memory_memory_write`/`_search` tool execution | MCP Server (`mcp-memory-server`) | OpenCode plugin/agent runtime | Unchanged in this phase — the harness only observes these events, never triggers new tool-call code paths |
| Model tool-calling behavior | External LLM provider (operator-configured) | — | Explicitly out of cairnkeep's control (D-05); the harness can only probe and retry around it, never fix it |
| Gap-closure record | Docs/Planning (`MILESTONES.md`, `REQUIREMENTS.md`) | — | Pure documentation update, no code (Success Criterion #3 / D-04) |
| Model precondition documentation | Docs (`docs/operating.md`) | — | Trait-based precondition text, gated by `verify-docs-parity.sh` (D-07) |

## Standard Stack

No new external packages are introduced by this phase — it is a bash-script
hardening task using tools already present in the harness and the repo's
toolchain.

### Core (already in use, no version change)
| Tool | Version (verified this session) | Purpose | Why Standard |
|------|-----|---------|--------------|
| `opencode` CLI (`opencode-ai` npm package) | 1.17.15 [VERIFIED: live `npx opencode-ai --version` in this session] | The harness's subject under test | Already the project's chosen headless CLI (v1.1) |
| `node` | v20.19.2 [VERIFIED: live `node --version`] | NDJSON parsing helper (mirrors `extract_session_id()`) | Already used in the harness for `extract_session_id()` and `seed_canary()`; no new runtime dependency |
| `jq` | 1.7 [VERIFIED: live `jq --version`] | Available as an alternative/supplement for ad-hoc NDJSON inspection during development | Available on the box; not required if the Node-based parser pattern is followed for consistency with `extract_session_id()` |
| `bash` builtins (`timeout`, `mktemp`, loops) | n/a | `--repeat` loop, per-iteration scratch dirs, retry bound | Matches the existing script's idiom exactly |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Node-based line-by-line JSON parser (like `extract_session_id`) | `jq -c 'select(.type=="tool_use")'` piped over the captured output | `jq` is terser but the harness's stdout capture already mixes JSON lines with non-JSON stderr text in some code paths (`2>&1`); the existing Node parser pattern already handles "skip non-JSON lines" gracefully via try/catch, `jq` would need `-R`/manual filtering to do the same robustly |
| Bash-only `grep -c '"type":"tool_use"'` continuation of the current style | A real per-line JSON parse | Rejected by D-08 explicitly — string-matching `"type":"tool_use"` without parsing the JSON object risks a narrated/quoted occurrence of that literal text inside a `text` event's `part.text` field producing a false positive, the exact class of bug D-08 exists to close |

**Installation:** None required — `opencode`, `node`, `jq`, and `bash` are
already present in the harness's execution environment (confirmed live in
this research session).

## Package Legitimacy Audit

Not applicable — this phase installs no new external packages. The only
CLI dependency (`opencode-ai`) is the same one already installed and
exercised by the existing v1.1 harness (`scripts/verify-opencode-live-parity.sh`);
this phase does not add, upgrade, or pin a new version of it.

## Architecture Patterns

### System Architecture Diagram

```
operator invokes: scripts/verify-opencode-live-parity.sh --repeat 5
        │
        ▼
┌─────────────────────────────┐
│ Preflight probe (D-06)      │  cheap: 1 scratch env, 1 opencode run,
│ "does the model make a      │  assert a genuine tool_use event fires
│  genuine tool call?"        │  (mirrors Phase 6 --self-test/--props-only
└──────────┬───────────────────  staged-probe style)
           │ FAIL → exit non-zero, "model not tool-call-reliable" (no soak burned)
           │ PASS
           ▼
┌─────────────────────────────────────────────────────────┐
│ --repeat loop, N=5 (D-02), each iteration independent (D-03) │
│                                                           │
│   ┌─────────────────────────────────────────────────┐   │
│   │ 1. setup_scratch()      — fresh HOME/config       │   │
│   │ 2. seed_canary(seeded)  — fresh random canary      │   │
│   │ 3. install_assets() + write_scratch_config()       │   │
│   │ 4. start_capture_server()  — opencode serve --port 0│   │
│   │    (D-11: round-trip stage now uses this, matching │   │
│   │     the capture stage's existing pattern)          │   │
│   │ 5. run_opencode(... --attach $URL, "/remember ...")│   │
│   │    ├─ retry loop (≤3, D-13) on INFRA failure only: │   │
│   │    │   timeout-kill / no JSON output / connection  │   │
│   │    │   reset — NOT on "ran fine, no tool event"    │   │
│   │    └─ parse NDJSON → assert tool_use event where   │   │
│   │       part.tool ∈ {memory_write, memory_supersede} │   │
│   │       (D-08/D-09)                                  │   │
│   │ 6. extract_session_id() from that JSON (existing)  │   │
│   │ 7. run_opencode(... --attach $URL --session $ID,   │   │
│   │    "recall ...")                                   │   │
│   │    ├─ same retry/assertion split as step 5         │   │
│   │    └─ assert tool_use event where part.tool ∈       │   │
│   │       {memory_search, memory_read} AND              │   │
│   │       part.state.output contains the canary         │   │
│   │ 8. stop_capture_server(), cleanup scratch dirs       │   │
│   │ 9. record PASS/FAIL + retry count for this iteration│   │
│   └─────────────────────────────────────────────────┘   │
│                                                           │
└──────────────────────────┬────────────────────────────────┘
                            ▼
              per-iteration table + aggregate verdict (D-04)
                            │
                            ▼
          UAT/VERIFICATION doc records the run;
          MILESTONES.md Known Gaps + REQUIREMENTS.md traceability
          updated to point at it (Success Criterion #3)
```

### Recommended Project Structure

No new files — all changes land inside the existing script and doc set:
```
scripts/
└── verify-opencode-live-parity.sh   # --repeat flag, preflight probe,
                                      # run_stage_remember_recall converted
                                      # to --attach + NDJSON parser
docs/
└── operating.md                     # D-07 trait-based model precondition
.planning/
├── MILESTONES.md                    # D-04 Known Gaps closeout entry
└── REQUIREMENTS.md                  # OCP-07 traceability status update
```

### Pattern 1: serve + `--attach` (already proven in this exact script)
**What:** Start `opencode serve --port 0 --hostname 127.0.0.1` as a
background process, poll its log for `listening on`, extract the URL by
regex, then drive every subsequent turn with `opencode run "..." --attach
$URL`. The client (`run --attach`) can exit without killing the server, so
async plugin work (extraction, in this phase's case the MCP tool call
completing its response) isn't truncated by the client's own process-exit
race.
**When to use:** Any stage where the harness previously used bare
`opencode run` and observed truncated/incomplete async behavior. D-11 scopes
this specifically to `run_stage_remember_recall`.
**Example (existing code in this repo, reused not rewritten):**
```bash
# Source: scripts/verify-opencode-live-parity.sh (start_capture_server/stop_capture_server)
start_capture_server() {
  CAPTURE_SERVE_LOG=$(mktemp)
  opencode serve --port 0 --hostname 127.0.0.1 >"$CAPTURE_SERVE_LOG" 2>&1 &
  CAPTURE_SERVE_PID=$!
  for _wait_sec in 1 2 3 4 5 6 7 8 9 10; do
    if grep -q "listening on" "$CAPTURE_SERVE_LOG" 2>/dev/null; then
      CAPTURE_SERVE_URL=$(grep -o 'http://[0-9.]*:[0-9]*' "$CAPTURE_SERVE_LOG" | head -1)
      break
    fi
    sleep 1
  done
}
```
Confirmed live this session: `--port 0` on the installed 1.17.15 CLI
actually bound to the fixed default port 4096 in this sandbox rather than a
random free port — the existing `grep -o 'http://[0-9.]*:[0-9]*'` extraction
is robust to this either way since it reads the port back out of the log
line rather than assuming `0`'s literal value.

### Pattern 2: Genuine tool-event NDJSON parsing (new this phase)
**What:** Parse `--format json` NDJSON output line-by-line, keep only lines
that parse as JSON, and match on `parsed.type === "tool_use" &&
/cairn-memory_memory_(write|supersede)/.test(parsed.part.tool)` (and the
`_search|_read` + canary-in-`part.state.output` variant for recall).
**When to use:** `run_stage_remember_recall`'s seeded PASS/FAIL assertion
(D-08/D-09).
**Example — verbatim live capture from this research session** (installed
`opencode-ai@1.17.15`, real `cairn-memory` MCP server from this repo, no
edits):
```json
// Source: live capture, this research session, `opencode run "remember that the test canary value is XYZ123" --format json --auto`
{"type":"tool_use","timestamp":1783468394936,"sessionID":"ses_0c1000285ffeB3LgTc2lL6lpX7","part":{"type":"tool","tool":"cairn-memory_memory_write","callID":"call_00_HwYj7yo6GPefkOwdragE3435","state":{"status":"completed","input":{"scope":"work","key":"test-canary","value":"The test canary value is XYZ123."},"output":"{\n  \"ok\": true,\n  \"scope\": \"work\",\n  \"key\": \"test-canary\",\n  \"collisions\": []\n}","metadata":{"truncated":false},"title":"","time":{"start":1783468394919,"end":1783468394935}},"id":"prt_f3f000825001ZCly3HCQBHAmWC","sessionID":"ses_0c1000285ffeB3LgTc2lL6lpX7","messageID":"msg_f3efffdec001R3DoelYr4jBzyz"}}
```
```json
// Source: live capture, same session, `opencode run "search your memory for the test canary value..." --format json --auto`
{"type":"tool_use","timestamp":1783468410962,"sessionID":"ses_0c0ffc42fffean1LIPrMRiv0Gj","part":{"type":"tool","tool":"cairn-memory_memory_search","callID":"call_00_ojFUlRfeg7RdkhxkZudF4674","state":{"status":"completed","input":{"scope":"work","query":"test canary value"},"output":"{\n  \"mode\": \"substring\",\n  \"count\": 1,\n  \"results\": [\n    {\n      \"scope\": \"work\",\n      \"key\": \"test-canary\",\n      \"value\": \"The test canary value is XYZ123.\",\n      \"score\": 1\n    }\n  ]\n}","metadata":{"truncated":false},"title":"","time":{"start":1783468410951,"end":1783468410961}},"id":"prt_f3f004761001QGw1GlWtp0nfgx","sessionID":"ses_0c0ffc42fffean1LIPrMRiv0Gj","messageID":"msg_f3f003c45001tYJ94eWqStsR7W"}}
```
Suggested parser shape (mirrors the existing `extract_session_id()` idiom
verbatim):
```javascript
// Pattern only — planner/implementer wires exact tool-name regex, canary var
let data = "";
process.stdin.on("data", (c) => { data += c; });
process.stdin.on("end", () => {
  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "tool_use"
          && /cairn-memory_memory_(write|supersede)/.test(parsed.part?.tool || "")
          && parsed.part?.state?.status === "completed") {
        process.exit(0); // found a genuine write/supersede tool event
      }
    } catch { /* not a JSON line (e.g. interleaved timestamp= log noise), skip */ }
  }
  process.exit(1);
});
```

### Pattern 3: Staged preflight probe (Phase 6 precedent, applied here)
**What:** A cheap, single-shot check that fails loud and specific before the
expensive multi-run soak begins.
**When to use:** D-06's mandate — verify the configured model is
tool-call-reliable before running 5 full scratch cycles.
**Example (existing style to mirror, not code to copy verbatim):**
```bash
# Source: scripts/verify-fastcontext-reliability.sh usage() text (Phase 6 precedent)
# --self-test  : offline, no live endpoint, canned-fixture backstop
# --props-only : live, cheap, single fetch
# --full       : live, expensive, multi-turn matrix, computes go/no-go verdict
```
Applied to this phase: a single `opencode run` turn designed to force exactly
one tool call (e.g. "read this file" against a throwaway scratch file, or a
`/remember` against a disposable canary), parsed with the same NDJSON
tool_use check as Pattern 2. FAIL message must name the trait explicitly
(D-06/specifics): `"model is not tool-call-reliable (no-thinking required) — see docs/operating.md"`.

### Anti-Patterns to Avoid
- **Substring-grepping the raw NDJSON text for `"tool_use"` or a tool name
  without parsing each line as JSON:** this is exactly the false-positive
  class D-08 exists to close — a model narrating "I will call
  cairn-memory_memory_write now" inside a `type:"text"` event's `part.text`
  field will match a naive grep but is not a real tool call.
- **Treating a `timeout`-triggered kill or empty NDJSON output the same as
  "ran fine but chose not to call the tool":** the former is the exact
  upstream race documented in anomalyco/opencode#26855 (retry per D-13); the
  latter is a narration failure (no retry per D-13). Conflating them either
  masks real flakiness data or wastes retries on a model that will never
  succeed.
- **Assuming `--dangerously-skip-permissions` is guaranteed to remain a
  recognized flag across opencode versions:** confirmed live this session
  that opencode 1.17.15's `--help` output no longer lists it (only `--auto`
  is documented) — see Common Pitfalls.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| NDJSON parsing | A bash/grep-based JSON field extractor | The existing `extract_session_id()` Node idiom, extended | Already in the file, already proven to skip non-JSON noise lines safely; no reason to invent a second parsing style in the same script |
| Server bring-up polling | A fixed `sleep N` before assuming the server is ready | The existing `start_capture_server()` retry-poll-for-"listening on" loop | Already handles the port-0/hostname/URL-poll bring-up correctly; reuse verbatim per D-11 |
| Soak/retry reporting format | A bespoke ad-hoc log format | Match the existing verify-script family's staged, PASS/FAIL, non-zero-on-failure conventions (`verify-explore-maturation.sh`, `verify-routing-seam.sh`, `verify-fastcontext-reliability.sh`) | Consistency with the whole `scripts/verify-*.sh` family that already exists in this repo; an operator reading harness output expects this shape |

**Key insight:** Everything this phase needs already has a proven pattern
somewhere in this repo's `scripts/` directory (serve/attach, staged
probes, retry loops, NDJSON field extraction). This is a composition task,
not a design-from-scratch task — the risk is drift from those existing
idioms, not absence of a pattern to follow.

## Common Pitfalls

### Pitfall 1: `--dangerously-skip-permissions` may not be a recognized flag on newer opencode
**What goes wrong:** The current harness hardcodes `--dangerously-skip-permissions`
on every `opencode run` invocation (comment in the script cites "the
installed CLI, v1.17.11"). Live-tested this session against
`opencode-ai@1.17.15`'s `run --help`: that flag is **not** in the documented
option list (only `--auto` is, plus a permissive `permission` block in
`opencode.json`).
**Why it happens:** The CLI's flag surface changed between the version the
v1.1 harness was tuned against (1.17.11) and the current npm-distributed
version (1.17.15).
**How to avoid:** Confirmed live this session that passing the
now-undocumented `--dangerously-skip-permissions` flag to 1.17.15 does
**not** error — the CLI silently accepts/ignores it and the run still
succeeds (the scratch `opencode.json`'s permissive `permission` block is
doing the real work here, exactly as the existing code comment already
suspected: "belt-and-suspenders against Pitfall 4, not the sole guard").
No code change is strictly required, but the planner should not assume this
flag will remain silently-ignored forever across future opencode releases;
consider a comment noting the permission block, not the flag, is load-bearing.
**Warning signs:** If a future opencode version starts hard-erroring on
unknown flags (yargs' `strict()` mode), every `run_opencode()` call in this
script would break at once — a single shared helper (already the case) means
a single fix point.

### Pitfall 2: An unconfigured/empty local-model provider block hangs forever, it does not fail fast
**What goes wrong:** Live-tested this session: registering an
`opencode.json` provider block with empty `apiKey`, `baseURL`, and model
name (the exact shape `write_scratch_config()` produces when
`CAIRN_LLM_API_KEY`/`CAIRN_LLM_API_URL`/`CAIRN_LLM_EXTRACTION_MODEL` are all
unset) caused `opencode run` to hang with **zero** stdout output — not even
the first `step_start` event — until the wrapping `timeout` killed it.
**Why it happens:** The AI SDK provider layer appears to block indefinitely
trying to resolve/connect to an empty `baseURL` rather than surfacing a fast
connection-refused/config error.
**How to avoid:** The D-06 preflight probe must not rely solely on "did a
tool_use event appear" to produce its diagnosis — it should also explicitly
check `CAIRN_LLM_API_KEY`/`CAIRN_LLM_API_URL`/`CAIRN_LLM_EXTRACTION_MODEL`
are all non-empty (the harness's own `log_env_presence()` helper already
does exactly this check, just not as a fail-fast gate) before spending the
probe's `timeout` budget on a call that cannot possibly succeed.
**Warning signs:** A preflight probe or soak iteration that always exhausts
its full timeout with no output at all (as opposed to failing quickly with a
narrated-but-no-tool-call response) is a strong signal of a missing/empty
`CAIRN_LLM_*` var, not a "model not tool-call-reliable" verdict — these two
failure modes need distinct messages so an operator doesn't waste time
tuning a model that was never actually reached.

### Pitfall 3: opencode's own bundled default model can mask a missing/misconfigured local-model setup
**What goes wrong:** Live-tested this session: with **no** `opencode.json`
provider/model configuration at all, `opencode run` still succeeded, using a
model identified in its own logs as `providerID=opencode modelID=big-pickle`
— an opencode-bundled, zero-cost default. If a scratch config's provider
block is malformed in a way that opencode falls back rather than errors
(a narrower case than Pitfall 2's empty-string hang, not fully characterized
this session), a preflight probe could get a false PASS against opencode's
own default model instead of the operator's intended local model.
**Why it happens:** opencode ships a default provider so `opencode run`
"just works" out of the box; this is good UX for opencode's own onboarding
but is exactly the kind of implicit fallback a reliability harness must not
silently accept as evidence.
**How to avoid:** The preflight probe (D-06) and/or the round-trip stages
should log the tool_use event's associated model/provider where available
(`step_start`/`step_finish` NDJSON lines do not appear to carry
providerID/modelID directly on the wire — that's currently only visible in
the CLI's stderr/log output via `--print-logs`, confirmed live this
session), or at minimum should hard-fail via Pitfall 2's env-var check
before ever reaching a fallback path.
**Warning signs:** A soak that passes 5/5 in an environment where
`CAIRN_LLM_EXTRACTION_MODEL` was accidentally left unset would be a false
positive of exactly the kind D-05 exists to prevent (the reliability bar is
about the operator's tool-call-reliable local model, not opencode's own
bundled default).

### Pitfall 4: The documented upstream `run --format json` completion race can truncate output before `step_finish`, but not necessarily before `tool_use`
**What goes wrong:** anomalyco/opencode issue #26855 [CITED:
github.com/anomalyco/opencode/issues/26855] documents a race where the
`run --format json` stdout loop observes `session.status=idle` and exits
before flushing the final `step_finish` event — reproduced by opencode's own
maintainers using a hosted model (gpt-5.4-mini), confirming this is
model-independent, matching MILESTONES.md's existing "opencode
run-completion flakiness... model-independent" root-cause language for
OCP-06.
**Why it happens:** A stdout-flush-vs-process-exit ordering race in the
CLI's own run loop (documented upstream, unresolved as of this research
session).
**How to avoid:** Because D-08/D-09's assertion only requires a `tool_use`
event (which is emitted and flushed *before* the step completes, not at
step-finish time), this specific race should not, by itself, cause a false
FAIL on a genuinely-successful tool call — the assertion doesn't wait on
`step_finish`. The retry logic (D-13) still needs to handle the harder
failure mode: a `timeout`-triggered kill (Pitfall 2's shape) or a connection
reset from the `--attach` transport with **zero** JSON lines emitted at all
— that is the case the harness cannot parse its way around and must retry.
**Warning signs:** Distinguish, in logs: (a) NDJSON with a valid `tool_use`
line present, no `step_finish` — treat as PASS, this is the known
cosmetic race; (b) empty/truncated output with no `tool_use` line and a
non-zero `timeout` exit — treat as an infra retry candidate; (c)
well-formed complete output with no `tool_use` line at all (the model
narrated instead) — treat as a hard FAIL, no retry (D-13).

### Pitfall 5: `--repeat`'s "fresh scratch every iteration" (D-03) makes each soak run materially slower — budget for it
**What goes wrong:** Every iteration re-runs `setup_scratch`,
`seed_canary`, `install_assets`, `write_scratch_config`,
`positive_load_check`, `start_capture_server`, the remember+recall turns
(each with up to 3 retries per D-13/existing recall retry), and
`stop_capture_server`/cleanup. At roughly 60-90s of `timeout` budget per
`opencode run` call and up to 2 calls per iteration (remember + recall) plus
setup overhead, 5 iterations is a multi-minute soak, not a quick smoke test.
**Why it happens:** D-03 is a deliberate reliability requirement (no state
bleed between runs), not an accident, but it has a real wall-clock cost the
planner should size verification/CI expectations around.
**How to avoid:** Keep `--repeat 5` as a separate, explicitly slower mode
from `--stage wakeup`'s existing "fastest per-commit signal" positioning
(already in the script's own `usage()` text) — do not fold the soak into
every commit's fast-path check.
**Warning signs:** If `--repeat` is wired into a fast pre-commit hook rather
than an explicit operator-invoked/CI-gated soak, expect complaints about
slow commits; the existing `--stage`/`--full`/new `--repeat` three-tier
speed structure should be preserved and documented.

## Code Examples

### Full live-captured baseline turn (no tool call, plain text response)
```json
// Source: live capture, this research session, opencode-ai@1.17.15, `opencode run "say hi" --format json`
{"type":"step_start","timestamp":1783468325985,"sessionID":"ses_0c10112b3ffeqGHfvufjDYYsbE","part":{"id":"prt_f3efefc5f001amjPl803WUQ98J","messageID":"msg_f3efeedda001IPXglMxWK14AB8","sessionID":"ses_0c10112b3ffeqGHfvufjDYYsbE","type":"step-start"}}
{"type":"text","timestamp":1783468326682,"sessionID":"ses_0c10112b3ffeqGHfvufjDYYsbE","part":{"id":"prt_f3efefee1001Mv8cDiyqXqOBvd","messageID":"msg_f3efeedda001IPXglMxWK14AB8","sessionID":"ses_0c10112b3ffeqGHfvufjDYYsbE","type":"text","text":"hi","time":{"start":1783468326625,"end":1783468326672}}}
{"type":"step_finish","timestamp":1783468326682,"sessionID":"ses_0c10112b3ffeqGHfvufjDYYsbE","part":{"id":"prt_f3efeff1300174bTuiJMFYqJlV","reason":"stop","messageID":"msg_f3efeedda001IPXglMxWK14AB8","sessionID":"ses_0c10112b3ffeqGHfvufjDYYsbE","type":"step-finish","tokens":{"total":8772,"input":8755,"output":2,"reasoning":15,"cache":{"write":0,"read":0}},"cost":0}}
```
Note `step_finish.part.reason` is `"stop"` for a final turn vs `"tool-calls"`
(seen in the tool-call examples above) when the model is continuing after a
tool result — useful as a secondary signal if the parser ever needs to
detect "turn had at least one tool call" without scanning every line.

### Confirmed identical envelope shape via `--attach` (D-11's target transport)
```json
// Source: live capture, this research session, opencode-ai@1.17.15
// `opencode serve --port 0 --hostname 127.0.0.1` then
// `opencode run "read the file test.txt" --attach http://127.0.0.1:4096 --dir ... --format json --auto`
{"type":"tool_use","timestamp":1783468443062,"sessionID":"ses_0c0ff4cdcffeF5jHiaLZZpyM0o","part":{"type":"tool","tool":"read","callID":"call_00_mLSr2WiQpeR1K5DZHO5Z8387","state":{"status":"completed","input":{"filePath":"/tmp/oc-test/test.txt"},"output":"<path>/tmp/oc-test/test.txt</path>\n<type>file</type>\n<content>\n1: hello world\n\n(End of file - total 1 lines)\n</content>","metadata":{"preview":"hello world","truncated":false,"loaded":[],"display":{"type":"file","path":"/tmp/oc-test/test.txt","text":"hello world","lineStart":1,"lineEnd":1,"totalLines":1,"truncated":false}},"title":"tmp/oc-test/test.txt","time":{"start":1783468443055,"end":1783468443061}},"id":"prt_f3f00c5250017d9J6Tk7miqyT8","sessionID":"ses_0c0ff4cdcffeF5jHiaLZZpyM0o","messageID":"msg_f3f00b39a0011SVLrdcINFJ2k7"}}
```
Field-for-field identical structure to the plain-`run` capture above
(`type`, `part.type`, `part.tool`, `part.state.{status,input,output}`) —
confirms D-11's transport swap requires no parser changes beyond what D-08
already needs.

## State of the Art

| Old Approach (v1.1 / Phase 5) | Current State (this research session) | When Changed | Impact |
|--------------------------------|------------------------------------------|---------------|--------|
| `--dangerously-skip-permissions` was the confirmed-live flag on opencode v1.17.11 | opencode 1.17.15's `run --help` no longer documents this flag; `--auto` is the documented equivalent | Between v1.17.11 (Phase 5) and v1.17.15 (this session) | Confirmed non-breaking (flag is silently accepted), but planner should not add new reliance on undocumented flag behavior; the `opencode.json` permission block is the actually load-bearing mechanism |
| Substring grep for `cairn-memory_memory_write` etc. in raw stdout | Confirmed exact string still appears verbatim as `part.tool`'s value in a genuine `tool_use` event | N/A — this confirms the *tool name strings* the existing grep patterns already use are correct; only the *matching method* changes (parse JSON, don't grep raw text) per D-08 | Low-risk migration: the target strings don't change, only how they're located |
| MILESTONES.md's carried-forward follow-up: "genuine `\"type\":\"tool\"` event" | Precisely: `part.type == "tool"` is a *nested* field; the *top-level* envelope field the harness must actually filter on is `type == "tool_use"` | Discovered this session via live capture | The planner's parser spec must use `type === "tool_use"` at the top level — matching only on the nested `part.type === "tool"` without checking the top-level `type` would also match non-tool_use envelope shapes if opencode's schema evolves; belt-and-suspenders is to check both |

**Deprecated/outdated:**
- MILESTONES.md's shorthand `"type":"tool"` phrasing for the follow-up item
  should be understood as referring to `part.type`, not the top-level event
  `type` (which is `tool_use`) — worth a precise footnote when D-04 updates
  that document's Known Gaps section, so a future reader isn't misled by the
  shorthand.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | opencode's NDJSON envelope schema (`step_start`/`tool_use`/`text`/`step_finish`/`error` as the complete top-level type set) is stable across the versions an operator might run this harness against, not just the exact 1.17.15 build captured this session | Architecture Patterns / Code Examples | If opencode changes field names or the envelope shape in a future release, the D-08/D-09 parser would silently stop matching (fail-closed is the safer failure mode here, but still a maintenance risk); mitigated by the fact this schema also matches an independent third-party public cheatsheet (takopi.dev), not just this session's single capture |
| A2 | opencode's `error` event type (documented by the third-party takopi.dev cheatsheet, not directly observed live this session since no error was triggered) has a similarly-shaped envelope (`type`, `timestamp`, `sessionID`, `part`) | Code Examples / State of the Art | If the planner wants the harness to also classify explicit `error` events as a distinct infra-failure signal (beyond D-13's "timeout kill" and "empty output" cases), the exact `error` event field names should be captured live before relying on them — not attempted this session since no natural error condition arose |
| A3 | The "opencode's own bundled default model (`big-pickle`) can mask a misconfigured local-model setup" risk (Pitfall 3) is a real, exploitable gap in the current harness's preflight design, not just a theoretical concern | Common Pitfalls #3 | If wrong (e.g., a malformed `opencode.json` provider block always hard-errors rather than falling back), the extra env-var-presence guard suggested in Pitfall 2/3 is defense-in-depth rather than a strictly necessary fix — low cost either way, so worth including regardless |

**If this table is empty:** N/A — see entries above; none are load-bearing
enough to block planning, but the planner/discuss-phase should be aware A1
and A3 are inferences from a single research session's live captures, not
multi-version regression testing.

## Open Questions

1. **Does the retry bound (D-13, "~3 attempts, planner discretion") need to differ between the `/remember` half and the `/recall` half of the round-trip?**
   - What we know: the existing (pre-hardening) code already retries the
     `/recall` half up to 3 times but not the `/remember` half (v1.1 found
     `/remember` "reliably drove a real... tool call in every instance
     observed" while `/recall` did not, per the script's own comments).
   - What's unclear: whether D-13's *infra*-only retry (as opposed to the
     existing narration-failure-tolerant retry being replaced) should keep
     this asymmetry, or apply the same bound to both halves now that the
     retry's purpose has changed (transport flakiness, not model narration
     variance).
   - Recommendation: keep retry bounds symmetric across both halves by
     default (simpler to reason about and log) unless live soak evidence
     during execution shows one half needs a different bound — this is
     explicitly Claude's Discretion per CONTEXT.md.

2. **Should the preflight probe (D-06) exercise the exact `cairn-memory` MCP tools, or a generic tool (like the built-in `read`)?**
   - What we know: both produce a live, verifiable `tool_use` event with an
     identical envelope shape (confirmed this session); a generic `read`
     probe is cheaper (no MCP server registration/`seed_canary` needed) and
     tests the same underlying "does this model make genuine tool calls"
     property D-05 cares about.
   - What's unclear: whether probing the built-in `read` tool alone risks
     missing an MCP-registration-specific failure mode (e.g., the model
     calling built-in tools fine but narrating MCP-server tools specifically)
     that a `cairn-memory`-specific probe would catch.
   - Recommendation: probe against the real `cairn-memory` MCP tool (mirrors
     what the soak itself will do), since the marginal setup cost is small
     (the harness's `setup_scratch`/`install_assets`/`write_scratch_config`
     sequence already exists and runs once for the probe, before the 5x
     soak) and it directly tests the property the soak depends on.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `opencode` CLI | The entire harness | ✓ (via `npx opencode-ai`; not on bare `$PATH` in this sandbox) | 1.17.15 [VERIFIED: live] | Operator's real environment likely has it on `$PATH` directly (the script assumes bare `opencode`); no harness change needed, this is a sandbox-specific PATH gap, not a phase concern |
| `node` | NDJSON parsing (`extract_session_id`, new tool-event parser) | ✓ | v20.19.2 [VERIFIED: live] | — |
| `jq` | Optional ad-hoc inspection during implementation | ✓ | 1.7 [VERIFIED: live] | — |
| `CAIRN_LLM_API_KEY`/`CAIRN_LLM_API_URL`/`CAIRN_LLM_EXTRACTION_MODEL` (operator's tool-call-reliable local model) | The actual 5/5 soak (D-01/D-05) | ✗ in this research sandbox (confirmed via `env \| grep CAIRN_LLM`, empty) | — | None — this is squarely operator-environment-provided per D-07 ("model selection stays operator-env-driven"); the planner should assume the *execution* phase runs in an environment where these ARE set, and should NOT attempt to hardcode or default them |
| Network access to a real LLM provider | The actual soak / preflight probe | Partial in this sandbox (opencode's own bundled `opencode/big-pickle` default model was reachable and functional; a real `CAIRN_LLM_API_URL` endpoint was not configured/tested) | — | See Pitfall 3 — do not mistake reachability of opencode's bundled default for reachability of the operator's intended local model |

**Missing dependencies with no fallback:**
- A live, tool-call-reliable local model reachable via `CAIRN_LLM_*` is
  required for the actual 5/5 soak execution (D-01) and cannot be
  substituted — this is inherent to the requirement (OCP-07 is about
  reliability *given* such a model, D-05) and is expected to be present in
  the execution environment, not this research sandbox.

**Missing dependencies with fallback:**
- `opencode` not on bare `$PATH` in this research sandbox — resolved via
  `npx opencode-ai` for research purposes; the operator's execution
  environment is expected to have it directly on `$PATH` (matching the
  script's existing `opencode run`/`opencode serve` invocations, unchanged).

## Validation Architecture

`workflow.nyquist_validation` is absent from `.planning/config.json` (treated
as enabled). This phase's "test framework" is the harness script itself —
there is no separate unit-test suite; `scripts/verify-opencode-live-parity.sh`
functions AS the phase's own executable specification and pass/fail oracle
(matching how Phase 5/6/10/11/12 all validated their harness-shaped
requirements in this repo).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Bash integration harness (`scripts/verify-opencode-live-parity.sh`), no unit-test framework involved |
| Config file | none — the script is self-contained, env-var-driven (`CAIRN_LLM_*`) |
| Quick run command | `scripts/verify-opencode-live-parity.sh --setup-only` (fast smoke, existing) or the new preflight probe alone |
| Full suite command | `scripts/verify-opencode-live-parity.sh --repeat 5` (new, the D-02 soak) and `scripts/verify-opencode-live-parity.sh --full` (existing, run once per D-12) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OCP-07 (Success Criterion #1) | 5/5 consecutive round-trip passes, fresh scratch each time | integration (live, requires real model) | `scripts/verify-opencode-live-parity.sh --repeat 5` | ❌ Wave 0 — `--repeat` flag does not exist yet |
| OCP-07 (Success Criterion #2) | Retry absorbs infra flakiness without masking real failures | integration (same run, inspected via per-iteration retry-count logging) | same command, evidence table's retry column | ❌ Wave 0 — retry-count logging not yet distinguished from the existing recall-retry loop |
| OCP-07 (Success Criterion #3) | Gap recorded resolved in MILESTONES.md/REQUIREMENTS.md | doc/manual | N/A — reviewed, not executed | ❌ Wave 0 — the doc edits themselves are the deliverable |

### Sampling Rate
- **Per task commit:** `scripts/verify-opencode-live-parity.sh --stage wakeup` (existing fast smoke, unaffected by this phase) to confirm no regression while iterating on the parser/probe/`--repeat` changes.
- **Per wave merge:** `scripts/verify-opencode-live-parity.sh --full` once (D-12) to confirm the harness's other stages weren't broken by the round-trip-stage conversion.
- **Phase gate:** `scripts/verify-opencode-live-parity.sh --repeat 5` green (5/5, D-01) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `--repeat N` flag + per-iteration scratch loop + PASS/FAIL table + aggregate verdict — does not exist yet (D-02).
- [ ] Preflight probe function + fail-fast message — does not exist yet (D-06).
- [ ] NDJSON tool-event parser (Node helper, mirrors `extract_session_id()`) — does not exist yet (D-08/D-09).
- [ ] `run_stage_remember_recall` converted to use `start_capture_server`/`stop_capture_server`/`--attach` instead of bare `run_opencode` (D-11) — currently bare.
- [ ] Retry-count-per-iteration logging distinct from the existing bounded recall retry — does not exist yet (D-13 evidence requirement).

## Security Domain

`security_enforcement` is absent from `.planning/config.json` (treated as
enabled). This phase touches a test harness with no new network-facing
surface, no new user input parsing beyond what already exists, and no new
secrets handling beyond the existing `CAIRN_LLM_*` env-var pattern.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Harness has no auth surface of its own; `opencode serve` binds to `127.0.0.1` only (loopback), matching the existing capture-stage pattern |
| V3 Session Management | No | `sessionID`/`--session` continuation is opencode's own concept, already handled by existing `extract_session_id()`; no new session logic introduced |
| V4 Access Control | No | No new access-control surface |
| V5 Input Validation | Marginal | The NDJSON parser (D-08/D-09) must tolerate malformed/non-JSON lines without crashing (already the pattern in `extract_session_id()`'s try/catch) — this is the one place new "parsing untrusted-ish CLI output" logic is added |
| V6 Cryptography | No | No new cryptography; `CAIRN_LLM_API_KEY` continues to flow through the existing env-var-only pattern (never hardcoded, never logged — `log_env_presence()` already enforces presence-only logging) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A malformed/adversarial NDJSON line crashing the parser and masking a real PASS/FAIL signal | Denial of Service (of the harness's own signal, not a real security boundary) | try/catch per line (existing `extract_session_id()` pattern), never let one bad line abort the whole parse |
| `opencode serve` binding to a non-loopback interface by accident | Information Disclosure (unsecured server warning was observed live this session: "OPENCODE_SERVER_PASSWORD is not set; server is unsecured") | Keep `--hostname 127.0.0.1` exactly as the existing `start_capture_server()` already does; do not widen the bind address when extending to the round-trip stage |
| Secrets (`CAIRN_LLM_API_KEY`) leaking into evidence logs/PASS-FAIL tables | Information Disclosure | Continue the existing `log_env_presence()` pattern (presence-only, never value) for any new logging this phase adds |

## Sources

### Primary (HIGH confidence — live-verified this session)
- Live capture: `npx opencode-ai run "..." --format json [--auto]` against a
  real `cairn-memory` MCP server from this repo, both plain and via
  `opencode serve --attach` — the exact NDJSON envelope shapes reproduced
  verbatim in Code Examples above. [VERIFIED: live capture, opencode-ai 1.17.15, this session]
- `scripts/verify-opencode-live-parity.sh` (this repo) — read in full;
  every function referenced in Architecture Patterns/Don't Hand-Roll is from
  this file.
- `.planning/MILESTONES.md` §v1.1 Known Gaps — root-cause language for
  OCP-06, cross-checked against the live capture and the GitHub issue below.
- `scripts/verify-fastcontext-reliability.sh` — staged-probe precedent (Phase 6).

### Secondary (MEDIUM confidence)
- [CITED: github.com/anomalyco/opencode/issues/26855] — upstream-documented
  `run --format json` completion race (stdout loop exits on
  `session.status=idle` before flushing final `step_finish`), reproduced by
  opencode maintainers with a hosted (non-local) model, corroborating
  MILESTONES.md's "model-independent" root-cause claim.
- [CITED: takopi.dev/reference/runners/opencode/stream-json-cheatsheet] —
  third-party NDJSON event-type cheatsheet; cross-checked against this
  session's own live capture and found consistent (same 5 event types, same
  `part.tool`/`part.state.output` field locations).

### Tertiary (LOW confidence)
- [ASSUMED] github.com/anomalyco/opencode/issues/29997 ("`run --format json`
  never emits the user prompt message") — surfaced in the same search but
  not fetched/read in depth this session; noted only as a possibly-related
  but unconfirmed adjacent issue, not relied upon for any claim above.

## Metadata

**Confidence breakdown:**
- NDJSON event schema (D-10's critical mandate): HIGH — live-captured
  directly against the installed CLI and the real `cairn-memory` MCP server
  in this repo, then cross-checked against an independent third-party
  cheatsheet with matching results.
- Run-completion race root cause: MEDIUM-HIGH — corroborated by an upstream
  GitHub issue with a maintainer-acknowledged reproduction, independent of
  this repo's own prior findings.
- Preflight-probe/empty-config-hang pitfalls (Pitfalls 2/3): MEDIUM — directly
  observed live this session, but only in this sandbox's specific
  environment; not cross-checked against the operator's real execution
  environment.
- Architecture/patterns/Don't-Hand-Roll: HIGH — entirely sourced from reading
  the actual existing script this phase modifies, not external inference.

**Research date:** 2026-07-08
**Valid until:** 30 days, OR immediately upon any operator-side `opencode`
CLI version upgrade (the NDJSON schema and flag surface are both CLI-version-
dependent, per State of the Art's v1.17.11→v1.17.15 flag drift finding) —
whichever comes first.
