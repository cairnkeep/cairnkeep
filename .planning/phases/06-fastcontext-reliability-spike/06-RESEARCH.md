# Phase 6: FastContext Reliability Spike - Research

**Researched:** 2026-07-04
**Domain:** llama.cpp `llama-server` tool-calling HTTP mechanics for a locally-served FastContext-1.0-4B GGUF
**Confidence:** HIGH on the llama.cpp API mechanics and the FastContext tool schema (source-verified this session); MEDIUM on the reliability *outcome* itself (that is what the probe exists to establish empirically — no research can substitute for running it)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Probe harness form**
- **D-01:** Ship a committed, re-runnable probe script (bash + `curl`, mirroring the known-good `scripts/verify-opencode-live-parity.sh` pattern — staged, isolated, generous timeouts). Rationale: Phase 6 gates Phases 7-9, and the pinned quant/build/template combo will change over time — a re-runnable probe lets the verdict be re-established cheaply whenever the deployed server changes.
- **D-02:** The script is config-by-env / loopback-only in committed form — endpoint URL via env var (e.g. `FASTCONTEXT_PROBE_URL`), default loopback. No host/IP/vendor default committed (DEC-no-private-references [LOCKED]). The operator supplies the real endpoint from the ambient shell / gitignored `.ai/.env`.

**Probe surface**
- **D-03:** Primary probe = the raw `llama-server` `/v1/chat/completions` endpoint driven directly with FastContext's own Read/Glob/Grep tool schemas. This isolates the variable under test (model + chat-template + `--jinja` + quant) from token-miser's Rust execution loop. The go/no-go verdict is based on this raw-endpoint probe.
- **D-04:** Secondary / optional corroboration: if the `token_miser explore` binary is available, drive it once end-to-end against a real repo to confirm the integration path also yields citations — corroboration only, not the verdict basis.

**Go/no-go threshold**
- **D-05:** Two gates, both mandatory for "go":
  1. `GET /props` → `chat_template_tool_use` is present on the deployed `llama-server` build — confirming a native tool-call template is active, not the narration-prone generic fallback.
  2. Every turn across a small matrix (≥5 distinct exploration prompts × ≥3 turns each, ≥15 turns total) returns `finish_reason=tool_calls` with a well-formed tool call (not just the field present, and not narration). Any narration-instead-of-toolcall turn = no-go / hard blocker.
- **D-06:** The strict 100%-at-the-raw-API-level bar is deliberate — OCP-04 memory shows a tool-reliable model hit `finish_reason=tool_calls` 100% at curl level (~2s), while the unreliable coder narrated. For a 4B quant, anything short of near-100% at the raw endpoint is a red flag worth blocking on.

**Deployment prerequisite**
- **D-07:** Standing up the FastContext server is a runtime prerequisite the operator provides, not phase-deliverable code. The mitkox FastContext GGUF does not appear to be deployed yet on this project's infra — the spike's first real step is likely *bring the server up* before probing. **Confirmed this session:** `llama-server` and `token_miser` are both absent from `PATH` on this machine as of 2026-07-04 (see Environment Availability below) — D-07's assumption is current.
- **D-08:** The phase artifact MUST pin and record the exact combination probed — mitkox repo + specific quant + llama.cpp build + `--jinja` + chat-template file — so the verdict is meaningful and reproducible. If the server cannot be stood up at all, that is itself a documented no-go blocker, never a silent skip.

### Claude's Discretion
- Exact probe prompt wording, script filename, and evidence-log format are left to the planner/executor. Recommendation: target cairnkeep's own repo as the probe corpus (real repo, and the same repo Phase 9's A/B will measure) rather than synthetic prompts.
- Whether the go/no-go verdict lives in a `06-SPIKE.md`, `06-FINDINGS.md`, or the standard phase UAT/SUMMARY artifacts — planner's call; the roadmap only requires it "exists in the phase artifacts."

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. Adjacent work is already scheduled elsewhere: `context_explore` tool + config (Phase 7), operating-layer commands (Phase 8), token-savings A/B (Phase 9), and token-miser's HTTP routing proxy (TMISER-R1, future milestone).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CTX-06 | FastContext tool-call reliability is probed and documented against the actually-deployed GGUF quant + `llama-server --jinja` combination (confirming real `tool_calls`, not narration) before any operating-layer wiring is built on top of it | This document resolves the exact `/props` field semantics, the exact request/response wire shape, the exact FastContext tool schemas to drive the probe with, and the exact validated `llama-server` invocation — everything the planner needs to write concrete probe-script tasks and a verdict-recording task. See "Real Research Gap: Resolved Findings" below. |
</phase_requirements>

## Summary

The prior-art research in this repo (SUMMARY.md, PITFALLS.md, STACK.md, ARCHITECTURE.md) already fully diagnosed the *shape* of this phase: build a raw-endpoint probe, not wire anything, gate on tool-call reliability before Phase 7 exists. That research flagged one open question as genuinely unconfirmed — whether llama.cpp's `/props` endpoint exposes a `chat_template_tool_use` field for a native (non-generic) Qwen3 tool-call template, and what the exact request/response wire shape looks like. This session resolved that gap by reading llama.cpp's actual current source (`tools/server/server-context.cpp`, `tools/server/server-task.cpp`) via GitHub code search, and by fetching the actual GGUF metadata of the pinned model (`mitkox/FastContext-1.0-4B-RL-Q8_0-GGUF`) directly from the Hugging Face Hub API — not summaries of either.

**The headline finding, and the single most important thing for the planner to internalize:** `chat_template_tool_use` will almost certainly be **ABSENT** from `/props` for this exact pinned FastContext GGUF, because its embedded chat template is a single unified ChatML template with an inline `{%- if tools %}` conditional (the Hermes-2-Pro-style `<tool_call>` XML convention), not a separately-named `tool_use` template variant. D-05's gate #1, read completely literally ("`chat_template_tool_use` is present"), is therefore likely to mechanically evaluate to **false** for the actual model this phase will probe — even if the model reliably emits real tool calls in practice. This is not a research dead-end; it is the single most actionable thing this research surfaces, because it means the probe script must record the *raw* `/props` response verbatim (not just assert on the field's presence) and the planner must decide, in the plan itself, how gate #1 is scored when the field is absent by architectural convention rather than by template misconfiguration. See "Open Questions" below — this needs an explicit decision in the plan, not a re-litigation of D-05 itself.

The empirical gate (D-05's gate #2 — every turn returns `finish_reason=tool_calls`) is unaffected by this nuance and remains exactly as specified. The exact wire-level request/response shape, the exact FastContext tool schemas to drive the probe with (reused verbatim from the sibling `token-miser` project's real, already-shipped implementation — not invented), and the exact validated `llama-server` invocation are all resolved below with source citations.

**Primary recommendation:** Write the probe script to (1) start from the exact `llama-server` invocation already validated in `token-miser/docs/architecture/FASTCONTEXT-EXPLORE.md`, (2) dump the full raw `/props` JSON to the evidence log regardless of whether `chat_template_tool_use` is present, (3) drive `/v1/chat/completions` using the real `read`/`glob`/`grep` tool schemas copied verbatim from `token-miser/src/explore/client.rs`, and (4) score gate #2 by checking `choices[0].finish_reason == "tool_calls"` AND `choices[0].message.tool_calls` is a non-empty, well-formed array — not by string-matching `content` text.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Probe script execution (bash + curl) | Local dev/ops tooling (not a service tier) | — | A committed shell script run by the operator; no runtime application tier owns it |
| FastContext model inference | External model-serving tier (`llama-server`, operator-run) | — | Referenced only via env-configured URL; cairnkeep code never talks to it directly in this phase |
| Tool-call execution (read/glob/grep) | N/A this phase | Future: `token-miser` Rust sandbox (Phase 7+) | Phase 6's raw-endpoint probe does NOT execute the model's tool calls against a real filesystem — it only records whether the model *emitted* well-formed `tool_calls`. Execution is out of scope until Phase 7 wires `context_explore` |
| Evidence/verdict recording | Local dev/ops tooling (committed Markdown + probe-script stdout log) | — | No database, no API — a phase artifact (`.md`) is the record |

**Why this matters for the plan:** because the primary probe (D-03) never executes the model's tool calls, the probe script does NOT need token-miser's sandbox/containment logic at all — it can safely reply to every tool call with a small, static, hardcoded "tool result" string (e.g. a fixed line-numbered snippet) regardless of what the model actually requested, since the goal is only to observe whether `finish_reason=tool_calls` fires on each turn of a short multi-turn conversation, not whether the returned evidence is correct. This significantly simplifies the probe script versus a full agentic loop — see Architecture Patterns below.

## Real Research Gap: Resolved Findings

### 1. `GET /props` → `chat_template_tool_use`: exact field semantics (VERIFIED via source)

Read directly from the current `ggml-org/llama.cpp` master branch via `gh` code search + raw content fetch (2026-07-04):

```cpp
// tools/server/server-context.cpp
std::string tmpl_default = common_chat_templates_source(meta->chat_params.tmpls.get(), "");
std::string tmpl_tools   = common_chat_templates_source(meta->chat_params.tmpls.get(), "tool_use");
...
if (params.use_jinja) {
    if (!tmpl_tools.empty()) {
        props["chat_template_tool_use"] = tmpl_tools;
    }
}
```
`[VERIFIED: github.com/ggml-org/llama.cpp/blob/master/tools/server/server-context.cpp]`

**What this means, precisely:**
- The field is named exactly `chat_template_tool_use` (matches STACK.md's flagged name — confirmed, not renamed).
- It is present in the `/props` JSON **only if `--jinja` is passed** (`params.use_jinja`) **and** the model's chat-template metadata defines a **separately-named `"tool_use"` template variant** (the HF convention where `tokenizer_config.json`'s `chat_template` field is a list of `{name, template}` objects, one of which is literally named `"tool_use"`, distinct from the `""`/default template).
- If the model's own chat template metadata does **not** define a separate `tool_use`-named variant (a single unified template that internally branches on `{%- if tools %}`, which is exactly how Qwen-family ChatML templates work — see finding #4 below), `tmpl_tools` is empty and **the key does not appear in the response at all** (not `null`, not `""` — absent).
- The current server README's own documented `/props` example (`tools/server/README.md`) does not show this field in its sample JSON dump, and its prose bullet list omits it — the field is real (confirmed in source) but under-documented in the current README; only `docs/function-calling.md` mentions it, as the verification method. `[VERIFIED: github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md]`

**Actionable for the probe:** the probe script must not treat "key absent" as an ambiguous failure to retry — it is a deterministic, expected outcome for a Qwen3-family model and must be recorded as a plain fact in the evidence log (`chat_template_tool_use: <absent | "<template string>">`), with the planner deciding in the plan how this feeds the D-05 gate-#1 scoring (see Open Questions).

### 2. `POST /v1/chat/completions` wire shape with `--jinja` + `tools` (VERIFIED via source, with a documented doc/code discrepancy)

**Request shape** (OpenAI-compatible; confirmed against both `docs/function-calling.md` and token-miser's own working client):

```bash
curl -s "${FASTCONTEXT_PROBE_URL:-http://127.0.0.1:8081/v1}/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fastcontext-4b-rl",
    "temperature": 0.0,
    "stream": false,
    "tool_choice": "auto",
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "read",
          "description": "Read a file'"'"'s contents with line numbers. Use offset/limit to read a span.",
          "parameters": {
            "type": "object",
            "properties": {
              "path":   {"type": "string", "description": "Path relative to the repo root."},
              "offset": {"type": "integer", "description": "1-based first line to read."},
              "limit":  {"type": "integer", "description": "Number of lines to read."}
            },
            "required": ["path"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "glob",
          "description": "List files matching a glob pattern (gitignore-aware).",
          "parameters": {
            "type": "object",
            "properties": {
              "pattern": {"type": "string"},
              "base":    {"type": "string", "description": "Optional subdirectory to search under."}
            },
            "required": ["pattern"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "grep",
          "description": "Regex search across the repo (gitignore-aware). Returns path:line:content.",
          "parameters": {
            "type": "object",
            "properties": {
              "regex": {"type": "string"},
              "path":  {"type": "string", "description": "Optional single file to search."},
              "glob":  {"type": "string", "description": "Optional glob to limit which files are searched."}
            },
            "required": ["regex"]
          }
        }
      }
    ],
    "messages": [
      {"role": "system", "content": "You are a repository exploration agent. Locate the code relevant to the user'"'"'s task using the read, glob, and grep tools. Do not attempt to solve the task."},
      {"role": "user", "content": "Where is scope path containment implemented in this repo?"}
    ]
  }'
```
`[VERIFIED: github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md; tool schema shape cross-checked against token-miser's own working client below]`

**Success response shape (tool call fires — the "go" signal):**

```json
{
  "choices": [
    {
      "finish_reason": "tool_calls",
      "index": 0,
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_...",
            "type": "function",
            "function": { "name": "grep", "arguments": "{\"regex\":\"resolveScopePath\"}" }
          }
        ]
      }
    }
  ]
}
```

**Narration failure shape (the "no-go" signal — no `tool_calls` array, or an empty one):**

```json
{
  "choices": [
    {
      "finish_reason": "stop",
      "message": { "role": "assistant", "content": "I'll grep for resolveScopePath in the codebase..." }
    }
  ]
}
```

**Important discrepancy found and documented (must not be silently "fixed" in the probe — record both):** current llama.cpp master (`tools/server/server-task.cpp`) computes:
```cpp
finish_reason = msg.tool_calls.empty() ? "stop" : "tool_calls";
```
`[VERIFIED: github.com/ggml-org/llama.cpp/blob/master/tools/server/server-task.cpp]` — the authoritative value for a successful tool call is **`"tool_calls"`**, exactly matching D-05's wording. However, the *committed example* in `docs/function-calling.md` shows `"finish_reason": "tool"` (singular, no `_calls`) — a **stale/inconsistent doc example**, not a different runtime behavior; do not let the probe script accept `"tool"` as a pass condition, and flag this drift explicitly in the probe's comments so a future maintainer doesn't "fix" the check to match the doc instead of the source. `[CITED: docs/function-calling.md example on lines ~398-405, cross-checked against source — doc appears stale relative to current master]`

**`--jinja` requirement — build-version caveat:** token-miser's own bring-up notes state flatly `"--jinja is mandatory — without the model's chat template, tool_calls are not parsed and the loop never runs"` `[VERIFIED: ~/PARA/Projects/token-miser/docs/architecture/FASTCONTEXT-EXPLORE.md]`. The current llama.cpp master's own `--jinja` flag help text now reads `"default: enabled"` `[VERIFIED: github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md]` — meaning newer builds may have flipped the CLI default from disabled to enabled at some point after the STACK.md research and after token-miser's own bring-up notes were written. **The probe script must pass `--jinja` explicitly regardless of the build's current default** (cheap, harmless if already-default, and removes one variable from the reproducibility story D-08 requires), and must record the exact `build_info` string from `/props` in its evidence log so the pinned combination is traceable if the default ever changes again.

**Parser-architecture caveat (new finding, build-version-dependent):** llama.cpp has migrated its chat-format detection away from a fixed enum of named formats (Hermes-2-Pro, Qwen, etc. — the framing STACK.md's research used) toward an "auto-parser"/PEG-based system (`common/chat-auto-parser-generator.cpp`, `COMMON_CHAT_FORMAT_PEG_NATIVE`, `COMMON_CHAT_FORMAT_PEG_GEMMA4`, `COMMON_CHAT_FORMAT_CONTENT_ONLY`) `[VERIFIED: github.com/ggml-org/llama.cpp — common/ directory listing via git tree API]`. This means STACK.md's "Qwen3 has no documented native handler, expect Generic fallback" framing is **likely stale for current builds** — the auto-parser may synthesize a working native-equivalent parser for any template containing the `<tool_call>` XML convention, Qwen3 included, without needing to be individually named. This cannot be fully resolved without running the actual deployed build's `/props` and a live probe — which is exactly what this phase does. Do not assume either the old "Generic fallback, expect overhead" framing or the new "auto-parser handles everything" framing; record `chat_template_caps` (also present in `/props`, per `common/jinja/caps.h`) alongside `chat_template_tool_use` in the evidence log, since it may carry additional signal on which parsing path the server picked.

### 3. FastContext's own Read/Glob/Grep tool schemas (VERIFIED — primary local source, not invented)

STACK.md/ARCHITECTURE.md already established that the FastContext contract is exactly three read-only tools with a `<final_answer>` stop condition. This session located and read the **exact, already-shipped, tested** tool-schema JSON and system prompt token-miser drives FastContext with — the probe should copy this verbatim rather than re-deriving an approximate schema:

```rust
// ~/PARA/Projects/token-miser/src/explore/client.rs (fn tool_schemas(), lines 84-134)
// — read/glob/grep, OpenAI function-calling shape, exactly as shown in
//   the curl example in finding #2 above.
```
`[VERIFIED: ~/PARA/Projects/token-miser/src/explore/client.rs — read directly this session, primary local source, already `cargo test`+`clippy`-verified]`

The accompanying system prompt (also copied verbatim into the curl example above) requires the model to reply with a single `<final_answer>` block listing `relative/path:START-END` citations and nothing else, and explicitly instructs the model *not* to solve the task — only locate it. `[VERIFIED: same source, lines 65-81]`

**Why this matters for the probe:** if the probe script invents its own tool schema (different parameter names, different descriptions) instead of reusing this exact one, a "no-go" result could actually be an artifact of schema mismatch (Pitfall 5 from PITFALLS.md) rather than genuine model unreliability — since FastContext was fine-tuned against this specific schema shape. Reusing the real schema verbatim removes that confound.

### 4. mitkox FastContext quant + validated `llama-server` invocation (VERIFIED — primary local source + live HF Hub API)

**Validated recipe already used by the sibling project** (the exact combination D-08 asks the phase to pin and record):

```bash
llama-server -m fastcontext-1.0-4b-rl-q8_0.gguf --alias fastcontext-4b-rl \
  -ngl 99 -c 24576 --jinja --host 0.0.0.0 --port 8081 \
  --flash-attn on --cache-type-k q4_0 --cache-type-v q4_0
```
`[VERIFIED: ~/PARA/Projects/token-miser/docs/architecture/FASTCONTEXT-EXPLORE.md — "Validated recipe (llama.cpp server, NVIDIA GPU via a container)"]`

This is the RL Q8_0 quant (4.3 GB), fetched via:
```bash
curl -L -o fastcontext-1.0-4b-rl-q8_0.gguf \
  https://huggingface.co/mitkox/FastContext-1.0-4B-RL-Q8_0-GGUF/resolve/main/fastcontext-1.0-4b-rl-q8_0.gguf
```

**Live-verified GGUF metadata (fetched this session directly from the Hugging Face Hub API, not a cached model card):**
```
architecture: qwen3
context_length: 262144
chat_template: <single unified ChatML template with an {%- if tools %} block
                emitting <tools>...</tools> and instructing the model to reply
                with <tool_call>{"name":...,"arguments":...}</tool_call> —
                the Hermes-2-Pro XML convention>
```
`[VERIFIED: huggingface.co/api/models/mitkox/FastContext-1.0-4B-RL-Q8_0-GGUF — fetched live via curl this session]`

This directly confirms finding #1's prediction: because this GGUF's chat template is a single template (no separately-named `"tool_use"` variant in its `tokenizer_config.json`-derived metadata), `chat_template_tool_use` will be absent from `/props` for this exact operator-recommended quant. This is now an empirically-grounded prediction (checked against the real, currently-hosted model file this phase will probe), not a generic inference about "Qwen models in general."

**Operator note (D-07):** neither `llama-server` nor `token_miser` is present on `PATH` on this machine as of 2026-07-04 (confirmed via `command -v` this session — see Environment Availability). Per D-07/D-08, standing up the server is the operator's first real step in this phase, and an inability to stand it up at all is itself a documented no-go, never a silent skip.

**SFT vs RL model-variant note (carried from STACK.md, still valid):** the RL checkpoint is token-miser's own deployment target and the one with a live validated recipe above; STACK.md flags RL as more prone to the Docker-mount-path (`/repo-name/...`) hallucination without a `resolve_path()`-style normalization shim. Since D-03/D-04 confine this phase's raw-endpoint probe to *never executing* the model's tool calls against a real filesystem (see Architectural Responsibility Map above), this path-hallucination quirk does not affect Phase 6's own verdict — it only matters once Phase 7 wires the real sandbox. Record whatever paths the model actually emits in the probe's evidence log regardless (useful early signal for Phase 7 planning), but do not gate Phase 6's go/no-go on it.

## Standard Stack

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| `bash` | 5.3.9 (confirmed installed) | Probe script shell | Matches `scripts/verify-opencode-live-parity.sh` precedent exactly (D-01) |
| `curl` | 8.18.0 (confirmed installed) | Drives `/props` and `/v1/chat/completions` | Matches D-03's "raw endpoint" requirement; no HTTP client dependency needed |
| `jq` | 1.8.1 (confirmed installed) | Parses/asserts on JSON responses (`finish_reason`, `tool_calls`, `chat_template_tool_use`) | Already implicitly relied on by the harness precedent's JSON-shaped `opencode run --format json` outputs; no new dependency |
| `llama-server` | Not on PATH — operator-provided (D-07) | Serves the FastContext GGUF as an OpenAI-compatible endpoint | External runtime prerequisite; version/build pinned via the probe recording `/props`'s `build_info` field |

**No new npm/pip/cargo packages are installed by this phase.** The probe is a standalone bash script; `curl`/`jq`/`bash` are already present in the target environment. Package Legitimacy Audit is therefore not applicable — see that section below for the explicit "none" disposition.

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `token_miser` (external Rust binary) | Optional secondary corroboration (D-04) | Only if already available on the operator's machine; not a hard dependency of the go/no-go verdict |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `curl` + `jq` bash probe | A small Node/TS or Python probe script | Bash+curl mirrors the existing harness precedent exactly (D-01) and needs zero new dependencies or build step; a TS/Python probe would add an unnecessary second implementation of a one-off spike script |
| Static hardcoded tool-result stub (probe doesn't execute real files) | Full token-miser-style sandboxed execution inside the probe | D-03 explicitly isolates the model/template/quant variable from execution concerns; a stubbed tool-result keeps the probe's only job "does the model call tools reliably," not "does the sandbox work" (that's Phase 7's job) |

**Installation:** No installation step for this phase's own deliverable (a bash script). Operator-side model serving is documented above as a runtime prerequisite, not an `npm install`/`pip install` step.

## Package Legitimacy Audit

**Not applicable this phase.** Phase 6 installs no new npm/pip/cargo packages — its only deliverable is a committed bash script using tools already present in the target environment (`bash`, `curl`, `jq`). The external runtime prerequisite (`llama-server`, from the `llama.cpp` project) is an operator-managed binary, not a project dependency resolved through a package manager, and is out of this audit's scope by the same logic that excludes OS-level tools like `git` or `ssh`.

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
Operator (D-07: brings the server up first)
   │
   │  llama-server -m fastcontext-1.0-4b-rl-q8_0.gguf --jinja -ngl 99 -c 24576
   │  --flash-attn on --cache-type-k/v q4_0 --host 0.0.0.0 --port 8081
   ▼
┌────────────────────────────────────────────────────────────────┐
│ llama-server (external, operator-run, OpenAI-compatible)        │
│  GET  /props                 → chat_template / chat_template_   │
│                                  tool_use / chat_template_caps / │
│                                  build_info                      │
│  POST /v1/chat/completions   → tools[] in, tool_calls[] or       │
│                                  narration content out            │
└───────────────────────┬──────────────────────────────────────────┘
                         │  FASTCONTEXT_PROBE_URL (env, loopback default — D-02)
                         ▼
┌────────────────────────────────────────────────────────────────┐
│ Committed probe script (bash + curl + jq — D-01)                  │
│  Stage 1: GET /props            → record chat_template_tool_use, │
│                                    chat_template_caps, build_info │
│                                    verbatim (present-or-absent,   │
│                                    not pass/fail alone)           │
│  Stage 2: for each of ≥5 prompts × ≥3 turns (≥15 total — D-05):   │
│    POST /v1/chat/completions with the read/glob/grep tool         │
│    schemas (verbatim from token-miser/src/explore/client.rs)      │
│    → assert finish_reason == "tool_calls" AND                     │
│         message.tool_calls is a non-empty, well-formed array      │
│    → append a STATIC stubbed tool-result message (no real fs      │
│      access — Phase 6 does not execute tool calls) and continue   │
│      the turn loop                                                 │
│  Stage 3 (optional, D-04): if `token_miser` is on PATH, run        │
│    `token_miser explore --query ... --repo-root .` once against   │
│    cairnkeep's own repo as corroboration only                     │
└───────────────────────┬──────────────────────────────────────────┘
                         │  evidence log (raw JSON + pass/fail per turn)
                         ▼
              Documented go/no-go verdict (06-SPIKE.md or similar,
              planner's choice per CONTEXT.md Claude's Discretion)
                         │
                         ▼
        Gates Phase 7 (context_explore tool) — "go" required to proceed
```

### Recommended Project Structure
```
scripts/
└── verify-fastcontext-reliability.sh   # NEW — the D-01 probe script,
                                          #   mirrors verify-opencode-live-parity.sh's
                                          #   shape (usage/help, setup, staged
                                          #   functions, evidence logging, single
                                          #   exit-code pass/fail)
.planning/phases/06-fastcontext-reliability-spike/
└── 06-SPIKE.md (or 06-FINDINGS.md)     # NEW — the documented go/no-go verdict +
                                          #   pinned combination (D-08) + raw
                                          #   evidence excerpts
```

### Pattern 1: Stubbed tool-result loop (no real filesystem execution)

**What:** Because D-03 isolates the model-reliability variable from token-miser's execution concerns, the probe's tool-call loop does not need to actually read/glob/grep the real filesystem. When the model emits a `tool_calls` array, the probe appends a `role:"tool"` message with a small, fixed, plausible-looking string (e.g. a hardcoded 3-line snippet) as the result, regardless of what the model asked for, and continues to the next turn.
**When to use:** Any reliability probe whose only question is "does the model reliably emit well-formed tool calls," not "does the tool execution produce correct results."
**Trade-offs:** + massively simpler probe script (no sandboxing, no path containment, no real repo dependency for the tool-execution side); + removes an entire class of probe-script bugs (Pitfall 2's path-containment class) from this phase's scope entirely, since the probe never touches a real filesystem on the model's behalf. − the probe cannot detect FastContext's documented Docker-mount-path hallucination quirk from PITFALLS.md/STACK.md (since it never inspects whether the *paths* the model requests are sane) — this is fine for Phase 6's narrow verdict, but the planner should note it as a Phase 7 concern in the plan's forward-looking notes, not something Phase 6 needs to also verify.
**Example:**
```bash
# Pseudocode for the stubbed tool-result payload appended after each
# assistant turn's tool_calls[] is observed:
tool_result_message() {
  local tool_call_id="$1"
  jq -n --arg id "$tool_call_id" '{
    role: "tool",
    tool_call_id: $id,
    content: "1: fn placeholder() {}\n2:     // stubbed tool result for reliability probing\n3: }"
  }'
}
```

### Pattern 2: Env-driven, loopback-default endpoint config (mirrors `verify-opencode-live-parity.sh`)

**What:** `FASTCONTEXT_PROBE_URL` (or similarly-named env var) resolved from the ambient shell, defaulting to a loopback address only, never a committed real host/IP — exactly D-02 and the existing harness precedent (`CAIRN_LLM_API_URL` sourced from `.ai/.env`).
**When to use:** Every committed script in this repo that talks to a real inference endpoint.
**Example:**
```bash
FASTCONTEXT_PROBE_URL="${FASTCONTEXT_PROBE_URL:-http://127.0.0.1:8081/v1}"
echo "[setup] FASTCONTEXT_PROBE_URL set via env: $([[ -n "${FASTCONTEXT_PROBE_URL:-}" ]] && echo yes || echo no)"
```

### Anti-Patterns to Avoid
- **Scoring gate #1 as a hard boolean without recording the raw `/props` payload:** given finding #1 above, `chat_template_tool_use` being absent is an expected, architecturally-explainable outcome for this exact model — a probe script that only prints `PASS`/`FAIL` for gate #1 without also dumping the full `/props` JSON (including `chat_template_caps` and `build_info`) will produce a verdict document nobody can debug six months from now when the deployed build changes.
- **String-matching narration text instead of checking the JSON structure:** exactly the "false-positive substring match" lesson already logged in this project's own MILESTONES.md Known Gaps — verify `finish_reason == "tool_calls"` AND a non-empty `message.tool_calls` array via `jq`, never a text search for words like "grep" or "I'll read" in `content`.
- **Accepting the stale doc example's `"finish_reason":"tool"` as a pass condition:** per finding #2, the authoritative source-verified value is `"tool_calls"`; if a future llama.cpp build ever actually emits `"tool"` in practice (not just in a stale doc example), that is itself a build-version finding worth recording, not silently normalizing away.

## Common Pitfalls

### Pitfall 1: Treating "field absent" as a probe bug and debugging the script instead of recording the finding
**What goes wrong:** An executor sees `chat_template_tool_use` missing from `/props`, assumes the probe script has a bug (wrong endpoint, wrong `--jinja` flag, wrong build), and burns time "fixing" a script that isn't broken.
**Why it happens:** D-05's wording ("chat_template_tool_use is present") reads like a simple existence check that "should" pass for any correctly-configured tool-calling server; this research shows that's not true for this exact model's chat-template convention.
**How to avoid:** The probe script's evidence log must state explicitly, in plain language, why the field's absence is expected for a Qwen3-family single-unified-template model (cite this research doc), so absence is never mistaken for misconfiguration.
**Warning signs:** Repeated re-runs of the probe with different `--jinja`/`--chat-template-file` flags chasing a field that structurally cannot appear for this GGUF's template shape.

### Pitfall 2: Re-chasing OCP-04's proven dead ends
**What goes wrong:** Someone tries a thinking-strip proxy or `enable_thinking` toggle to "fix" a narration problem observed during this probe.
**Why it happens:** Those techniques worked (partially) for the *previous* model/harness combination (qwen3.5/qwen3.6-27b under `opencode run`'s multi-turn flow).
**How to avoid:** Per project memory (`qwen-coder-opencode-toolcall-limits`), those findings are scoped to the `opencode run` headless multi-turn slash-command flow, which Phase 6 does not touch at all (D-03: raw curl endpoint only). If FastContext-4B narrates at the raw curl level, the fix path is a different model/quant/template, not a proxy or thinking toggle — record it as a no-go per D-06 and stop there; do not re-run the OCP-04 investigation for a different model.
**Warning signs:** Any probe-script iteration that starts adding thinking-mode flags, chat-template-kwargs, or a stripping proxy in response to an observed narration failure.

### Pitfall 3: Scoring gate #2 on the first turn only
**What goes wrong:** A probe that only checks the *first* assistant turn of a conversation for `finish_reason=tool_calls` and declares success, missing later-turn narration (the historically-observed failure mode: "thinking ON fires write but not read," i.e. reliability differs by turn position/turn type).
**Why it happens:** It's tempting to treat "one successful call" as proof, especially once a live endpoint is finally reachable after standing up the server (D-07's overhead).
**How to avoid:** D-05 explicitly requires ≥3 turns per prompt × ≥5 prompts (≥15 turns total), with every single turn required to pass — implement the probe as a genuine multi-turn loop (assistant tool call → stubbed tool result → next assistant turn) per prompt, not 15 independent single-turn calls.
**Warning signs:** A probe script whose loop always sends a fresh `messages` array of length 2 (system+user) instead of accumulating the conversation across turns.

### Pitfall 4: Conflating this phase's "no execution" scope with skipping the Docker-path-hallucination recording
**What goes wrong:** Since Pattern 1 above says the probe doesn't need to execute tool calls against a real filesystem, someone concludes the probe shouldn't bother logging what paths/patterns the model actually requested either — losing an easy, nearly-free early signal for Phase 7 planning.
**Why it happens:** "We don't execute it" gets over-generalized to "we don't need to look at it."
**How to avoid:** Log every tool-call's raw `arguments` JSON in the evidence file even though the probe replies with a stubbed result — this costs nothing and gives Phase 7 planning a head start on whether the Docker-mount-path (`/repo-name/...`) quirk documented in PITFALLS.md/STACK.md actually manifests against a real cairnkeep-shaped prompt.
**Warning signs:** An evidence log that records only pass/fail per turn with no raw tool-call arguments.

## Code Examples

### Full `/props` inspection stage
```bash
# Source: docs/function-calling.md verification method + server-context.cpp field name,
# both verified directly against ggml-org/llama.cpp master this session.
inspect_props() {
  local url="$1"
  local props
  props=$(curl -sf "${url}/props" || curl -sf "${url%/v1}/props")
  echo "$props" | jq '{chat_template_tool_use, chat_template_caps, build_info}'
  if echo "$props" | jq -e 'has("chat_template_tool_use")' >/dev/null; then
    echo "[gate-1] chat_template_tool_use PRESENT"
  else
    echo "[gate-1] chat_template_tool_use ABSENT (expected for a single-unified-template Qwen3-family GGUF — see 06-RESEARCH.md finding #1; record verbatim, do not treat as a script bug)"
  fi
}
```

### Per-turn tool-call assertion
```bash
# Source: tools/server/server-task.cpp (finish_reason computation), verified this session.
assert_tool_call_turn() {
  local response_json="$1"
  local finish_reason
  finish_reason=$(echo "$response_json" | jq -r '.choices[0].finish_reason')
  local n_calls
  n_calls=$(echo "$response_json" | jq '.choices[0].message.tool_calls | length // 0')

  if [[ "$finish_reason" == "tool_calls" && "$n_calls" -gt 0 ]]; then
    echo "[turn] PASS: finish_reason=tool_calls, $n_calls well-formed call(s)"
    return 0
  fi
  echo "[turn] FAIL: finish_reason=$finish_reason, tool_calls_count=$n_calls (narration or malformed — hard blocker per D-05/D-06)" >&2
  return 1
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| llama.cpp named tool-call format enum (Hermes-2-Pro, Qwen, Generic fallback) | Auto-parser / PEG-based format detection (`COMMON_CHAT_FORMAT_PEG_NATIVE` etc.) | Unconfirmed exact date this session; confirmed present in current master via source directory listing | STACK.md's "expect Generic fallback for unlisted Qwen3" framing may be stale for whatever build is actually deployed — the probe's `/props`/`build_info` recording is now the only reliable way to know which parsing path is active, not a static doc lookup |
| `--jinja` required explicitly or server 500s on `tools`-bearing requests | `--jinja, --no-jinja` documented as `default: enabled` in current master's server README | Unconfirmed exact date; token-miser's own bring-up notes (this session's primary source) still say "mandatory," implying their pinned build predates this default flip | Pass `--jinja` explicitly regardless — costs nothing, removes ambiguity, and is what D-08 wants recorded as part of the pinned combination anyway |

**Deprecated/outdated:**
- STACK.md's blanket claim "llama.cpp does not document a native Qwen3 tool-call template" should be treated as build-version-dependent, not a permanent fact — record `build_info` in the probe's evidence log so this claim can be re-checked whenever the deployed build changes.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The mitkox `FastContext-1.0-4B-RL-Q8_0-GGUF`'s live-fetched `gguf.chat_template` metadata (single unified ChatML template, no separately-named `tool_use` variant) is representative of whatever exact file the operator ends up serving — the operator could choose the SFT variant, a different quant, or a different mirror | Finding #4 / Headline finding | If the operator serves a different file whose metadata *does* define a separate `tool_use` template variant, `chat_template_tool_use` could actually be present, and the "expected absence" framing in this doc would need correction in the plan/probe comments. Low risk (all mirrors of this model family share the same base architecture and are Qwen3-derived), but the probe script should record the raw metadata itself rather than assuming this doc's prediction always holds. |
| A2 | The current llama.cpp master branch (fetched live this session) reflects the exact build the operator will actually run — build drift between "master today" and "whatever binary the operator installs" is unverified | Findings #1, #2 | If the operator runs an older or newer build, the exact `finish_reason` value, `/props` field set, or parser architecture could differ from what's documented here. Mitigated by the probe script recording `build_info` from `/props` on every run — this is exactly why D-08 requires pinning the exact combination probed, not trusting this research's snapshot indefinitely. |
| A3 | llama.cpp's auto-parser/PEG system (observed via source directory listing only, not read in full) actually produces a working native-equivalent parser for the Hermes-2-Pro-style `<tool_call>` XML convention this GGUF's template uses, rather than falling back to a slower/less-reliable generic path | State of the Art table | If the auto-parser does NOT handle this template well, tool-calling could be less reliable than a "properly native-supported" format — this is exactly the kind of thing the empirical gate #2 probe (D-05/D-06) is designed to catch regardless of this assumption's truth, so it does not block the phase, but it does affect how surprised the planner should be by a marginal (not clean 100%) result. |

**If this table is empty:** N/A — see entries above.

## Open Questions

1. **How should the probe/verdict score D-05 gate #1 when `chat_template_tool_use` is absent by architectural convention rather than misconfiguration?**
   - What we know: the field's absence for this exact pinned model is now empirically predicted (finding #4) and mechanically explained (finding #1) — it is not evidence of a broken or misconfigured server.
   - What's unclear: D-05 as literally worded requires the field to be "present" for a "go." The user's own D-06 rationale is about the *empirical* reliability bar (gate #2), and gate #1 was written as a proxy for "a native, non-generic template is active" — but this research shows field-presence is a weaker/different signal than that intent for a Qwen3-family model.
   - Recommendation: the planner should make an explicit, written decision in the PLAN.md about how gate #1 is scored (e.g., "gate #1 passes if either `chat_template_tool_use` is present, OR the raw `chat_template` itself contains a `{%- if tools %}`/`<tool_call>` block AND gate #2's empirical bar is met at 100%") rather than silently reinterpreting D-05. This is a locked user decision from CONTEXT.md — the planner should surface this specific nuance for explicit confirmation (via `checkpoint:human-verify` or equivalent) rather than quietly redefining it, since it changes what "go" means.

2. **Does the actually-deployed build's `llama-server` parser recognize this GGUF's `<tool_call>` XML template as a fast/native path, or fall back to a slower generic/auto-parser path?**
   - What we know: the template itself uses the well-established Hermes-2-Pro-style `<tool_call>` XML convention that llama.cpp has historically special-cased; the current codebase has moved to a more general auto-parser architecture whose exact behavior for this specific template is unconfirmed without running it.
   - What's unclear: whether this affects tool-calling *reliability* (the thing D-05/D-06 actually gate on) or only *token efficiency* (a Phase 9 A/B concern, out of this phase's scope).
   - Recommendation: not blocking for Phase 6 — the empirical per-turn probe (gate #2) is the correct instrument regardless of which parsing path is active; just ensure `chat_template_caps` is recorded in the evidence log alongside `chat_template_tool_use` in case it carries a useful signal for this question later.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `bash` | Probe script | ✓ | 5.3.9(1)-release | — |
| `curl` | Probe script (`/props`, `/v1/chat/completions`) | ✓ | 8.18.0 | — |
| `jq` | Probe script (JSON assertions) | ✓ | 1.8.1 | — |
| `llama-server` | Serving the FastContext GGUF (operator prerequisite, D-07) | ✗ (not on PATH, checked 2026-07-04) | — | None — per D-07/D-08, an un-standable server is a documented no-go, not a silent skip. The plan must include an explicit "stand up the server" step/checkpoint before probing can begin. |
| `token_miser` | Optional secondary corroboration (D-04) | ✗ (not on PATH, checked 2026-07-04) | — | Skip stage 3 (D-04 is optional/corroboration-only) and note its absence in the verdict document; does not affect the go/no-go verdict, which is anchored to the raw endpoint (D-03) |

**Missing dependencies with no fallback:**
- `llama-server` — this phase's probing cannot start until the operator brings up the FastContext-serving endpoint. This is expected per D-07 and must be an explicit early task/checkpoint in the plan, not an assumed precondition.

**Missing dependencies with fallback:**
- `token_miser` — optional corroboration only (D-04); its absence should be recorded, not treated as a blocker.

## Validation Architecture

> `workflow.nyquist_validation` is absent from `.planning/config.json` — treated as enabled per the default rule.

This phase's "test framework" is the probe script itself (bash + `curl` + `jq` assertions), not a language-level unit-test runner — there is no `pytest`/`jest`/`vitest` involved, matching the existing precedent set by `scripts/verify-opencode-live-parity.sh` (also a self-contained, exit-code-driven bash harness with no external test framework).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None (bash assertion script, mirrors `verify-opencode-live-parity.sh`) |
| Config file | none — the script itself is the executable spec |
| Quick run command | `scripts/verify-fastcontext-reliability.sh --props-only` (proposed fast path: gate #1 only, no live model round-trips) |
| Full suite command | `scripts/verify-fastcontext-reliability.sh --full` (proposed: full ≥5-prompt × ≥3-turn matrix, gate #1 + gate #2, exits non-zero on any failed turn) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CTX-06 | `/props` records `chat_template_tool_use`/`chat_template_caps`/`build_info` verbatim | smoke (live, requires operator-run server) | `scripts/verify-fastcontext-reliability.sh --props-only` | ❌ Wave 0 — script does not exist yet |
| CTX-06 | Every turn across ≥5 prompts × ≥3 turns (≥15 total) returns `finish_reason=tool_calls` with a well-formed call | smoke (live, requires operator-run server) | `scripts/verify-fastcontext-reliability.sh --full` | ❌ Wave 0 — script does not exist yet |
| CTX-06 | A documented go/no-go verdict exists as a phase artifact | manual-only (documentation, not automatable) | N/A — human/agent writes `06-SPIKE.md` (or equivalent) from the probe's evidence log | ❌ Wave 0 — artifact does not exist yet |

### Sampling Rate
- **Per task commit:** `scripts/verify-fastcontext-reliability.sh --props-only` (fast — no multi-turn model round-trips, just confirms the endpoint is reachable and dumps `/props`)
- **Per wave merge:** `scripts/verify-fastcontext-reliability.sh --full` (full ≥15-turn matrix — the actual go/no-go evidence)
- **Phase gate:** Full suite green (or a documented, deliberate "no-go" verdict — this phase's success criterion is "a documented verdict exists," not "the verdict is always go") before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `scripts/verify-fastcontext-reliability.sh` — does not exist yet; this phase's primary deliverable (D-01)
- [ ] `.planning/phases/06-fastcontext-reliability-spike/06-SPIKE.md` (or equivalent) — the verdict document; does not exist yet
- [ ] No framework install needed — `bash`/`curl`/`jq` already present in the target environment (confirmed this session)

## Security Domain

> `security_enforcement` is absent from `.planning/config.json` — treated as enabled per the default rule.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | The probe talks only to a loopback-default, operator-configured local inference endpoint; no user-facing auth surface is introduced |
| V3 Session Management | No | Stateless per-run bash script; no sessions |
| V4 Access Control | No | No new access-controlled surface introduced |
| V5 Input Validation | Yes (minimal) | The only "input" is the `FASTCONTEXT_PROBE_URL` env var and the fixed set of probe prompts, both operator/repo-controlled, not user-facing; validate the URL is well-formed before use (`curl`'s own error handling suffices — no custom parser needed) |
| V6 Cryptography | No | No secrets/crypto introduced by this phase; if the operator's endpoint requires a bearer token, source it from the ambient shell / gitignored `.ai/.env` exactly as the existing harness precedent does — never hardcode |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Committing a real host/IP/vendor endpoint default in the probe script | Information Disclosure | D-02 (env-only config, loopback default) — already locked; verify with a pre-commit grep for literal non-loopback IPs/hostnames, matching this project's existing DEC-commit-scanning discipline |
| Treating a narrated (non-tool-call) response's `content` text as trustworthy "evidence" | Spoofing (of a successful result) | Always gate on the JSON structure (`finish_reason`/`tool_calls` array), never on substring-matching `content` — Anti-Pattern 2 above, and the same "verify genuine `type:tool` events" lesson already logged in this project's MILESTONES.md Known Gaps |

## Sources

### Primary (HIGH confidence)
- `github.com/ggml-org/llama.cpp` — `tools/server/server-context.cpp` (exact `chat_template_tool_use` assignment logic), `tools/server/server-task.cpp` (exact `finish_reason` computation), `tools/server/README.md` (`/props` documented fields, `--jinja` flag help text), `docs/function-calling.md` (curl example, verification method) — all fetched via `gh api`/`gh search code` directly against the current master branch this session
- `huggingface.co/api/models/mitkox/FastContext-1.0-4B-RL-Q8_0-GGUF` — live GGUF metadata fetch (architecture, context_length, full `chat_template` Jinja source) via the Hugging Face Hub API this session
- `~/PARA/Projects/token-miser/src/explore/client.rs` — exact, already-shipped, tested Read/Glob/Grep tool schemas and system prompt (read directly this session)
- `~/PARA/Projects/token-miser/docs/architecture/FASTCONTEXT-EXPLORE.md` — validated `llama-server` invocation recipe, bring-up notes on `--jinja` necessity and context-size tuning (read directly this session)
- `~/PARA/Projects/token-miser/config.example.toml` — `[fastcontext]`/`[explore]` config shape confirming the model alias/endpoint convention (read directly this session)
- `scripts/verify-opencode-live-parity.sh` (this repo) — the committed harness pattern Phase 6's probe should mirror (read directly this session)
- `.planning/research/{SUMMARY,PITFALLS,STACK,ARCHITECTURE}.md` (this repo) — the prior-art research this document builds on and does not duplicate
- Project memory `local-inference-infra`, `qwen-coder-opencode-toolcall-limits` — OCP-04 history and the proven dead ends not to re-chase

### Secondary (MEDIUM confidence)
- General WebSearch summaries of llama.cpp's function-calling docs and server README (used to locate the primary sources above, superseded by the direct source reads wherever they disagreed)

### Tertiary (LOW confidence, superseded)
- None retained — every WebSearch-sourced claim in this document was subsequently cross-checked against the primary GitHub source or the live HF Hub API before being included.

## Metadata

**Confidence breakdown:**
- `/props` and `/v1/chat/completions` wire mechanics: HIGH — read directly from current llama.cpp master source this session, not summarized from docs alone
- FastContext tool schema: HIGH — read directly from the sibling project's real, tested, already-shipped implementation
- Predicted `chat_template_tool_use` absence for the pinned GGUF: HIGH — confirmed via live Hugging Face Hub API metadata fetch of the exact recommended quant, not inferred from "Qwen models generally"
- Whether the deployed model will actually pass the empirical gate #2 bar: MEDIUM/unknowable by research — this is precisely what the probe exists to determine; no research substitutes for running it

**Research date:** 2026-07-04
**Valid until:** Re-verify the llama.cpp-specific findings (parser architecture, `--jinja` default, `/props` field set) if more than ~14 days pass before the plan executes, or immediately if the operator serves a different quant/mirror than `mitkox/FastContext-1.0-4B-RL-Q8_0-GGUF` — this is a fast-moving upstream project (auto-parser refactor observed mid-development) and llama.cpp build drift directly affects this phase's findings.
