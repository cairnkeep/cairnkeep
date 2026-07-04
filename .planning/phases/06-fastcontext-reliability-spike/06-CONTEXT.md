# Phase 6: FastContext Reliability Spike - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove — **before** any code in Phases 7-9 depends on it — that the *actually-deployed*
FastContext GGUF quant + `llama-server --jinja` combination reliably emits real
`tool_calls` (not narration), and record a documented **go/no-go verdict** that gates
the rest of v1.2.

This phase is a **spike/verification**, not a build. It produces a probe + evidence + a
verdict. It does **not** build the `context_explore` tool (Phase 7), any operating-layer
command (Phase 8), or the token-savings A/B (Phase 9). It de-risks the exact failure class
this project already paid for once (OCP-04: a local model narrating tool calls as text
instead of invoking them).

</domain>

<decisions>
## Implementation Decisions

> **Note:** The user was away when these gray areas were presented. All four decisions
> below are Claude's grounded defaults, chosen from the loaded research + the OCP-04
> history in project memory. They are safe to edit before planning.

### Probe harness form
- **D-01:** Ship a **committed, re-runnable probe script** (bash + `curl`, mirroring the
  known-good `scripts/verify-opencode-live-parity.sh` pattern — staged, isolated, generous
  timeouts). Rationale: Phase 6 gates Phases 7-9, and the pinned quant/build/template combo
  will change over time — a re-runnable probe lets the verdict be re-established cheaply
  whenever the deployed server changes, exactly as OCP-04 wished it had. A one-off ad-hoc
  investigation would have to be re-derived from scratch next time.
- **D-02:** The script is **config-by-env / loopback-only** in committed form — endpoint URL
  via env var (e.g. `FASTCONTEXT_PROBE_URL`), default loopback. **No host/IP/vendor default
  committed** (DEC-no-private-references [LOCKED]). The operator supplies the real endpoint
  from the ambient shell / gitignored `.ai/.env`, same as the Phase 4/5 harness precedent.

### Probe surface
- **D-03:** **Primary probe = the raw `llama-server` `/v1/chat/completions` endpoint** driven
  directly with FastContext's own Read/Glob/Grep tool schemas. This is what the success
  criteria literally require ("against the actually-deployed … endpoint") and it **isolates
  the variable under test** — the model + chat-template + `--jinja` + quant combo — from
  token-miser's Rust execution loop. The go/no-go verdict is based on this raw-endpoint probe.
- **D-04:** **Secondary / optional corroboration:** if the `token_miser explore` binary is
  available, drive it once end-to-end against a real repo to confirm the integration path also
  yields citations — but this is *corroboration only*, not the verdict basis. Keep the verdict
  anchored to the raw endpoint so a token-miser-side issue can't mask a model-side one (and
  vice-versa). *(ponytail: raw endpoint is the minimal sufficient probe; don't make the
  binary a hard dependency of the verdict.)*

### Go/no-go threshold
- **D-05:** **Two gates, both mandatory for "go":**
  1. **`GET /props` → `chat_template_tool_use` is present** on the deployed `llama-server`
     build — confirming a *native* tool-call template is active, not the narration-prone
     generic fallback (success criterion 2; STACK.md flags this as unconfirmed for the
     researched llama.cpp build).
  2. **Every turn** across a small matrix (**≥5 distinct exploration prompts × ≥3 turns each,
     ≥15 turns total**) returns `finish_reason=tool_calls` **with a well-formed tool call**
     (not just the field present, and not narration). **Any** narration-instead-of-toolcall
     turn = **no-go / hard blocker**.
- **D-06:** The strict 100%-at-the-raw-API-level bar is deliberate and grounded: OCP-04
  memory shows a tool-reliable model hit `finish_reason=tool_calls` **100% at curl level**
  (~2s), while the unreliable coder narrated. For a 4B quant, anything short of near-100% at
  the raw endpoint is a red flag worth blocking on. The bar is cheap to check here and
  expensive to discover after Phase 7-8 are built on top.

### Deployment prerequisite
- **D-07:** Standing up the FastContext server is treated as a **runtime prerequisite the
  operator provides**, not phase-deliverable code. Per project memory, the infra currently
  runs qwen-coder (`:8001`) and an inactive qwen3.5-27b — **the mitkox FastContext GGUF does
  not appear to be deployed yet**, so the spike's first real step is likely *bring the server
  up* before probing.
- **D-08:** The phase artifact **MUST pin and record the exact combination probed** — mitkox
  repo + specific quant (the research names `mitkox/FastContext-1.0-4B-{SFT,RL}-*-GGUF`;
  operator picks; probe records whatever `/props` reports) + llama.cpp build + `--jinja` +
  chat-template file — so the verdict is meaningful and reproducible. If the server **cannot**
  be stood up at all, that is itself a **documented no-go blocker**, never a silent skip.

### Claude's Discretion
- Exact probe prompt wording, script filename, and evidence-log format are left to the
  planner/executor. Recommendation: target **cairnkeep's own repo** as the probe corpus
  (real repo, and the same repo Phase 9's A/B will measure) rather than synthetic prompts.
- Whether the go/no-go verdict lives in a `06-SPIKE.md`, `06-FINDINGS.md`, or the standard
  phase `UAT/SUMMARY` artifacts — planner's call; the roadmap only requires it "exists in the
  phase artifacts."

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` § "Phase 6: FastContext Reliability Spike" — goal, depends-on,
  and the three success criteria (probe records `finish_reason` every turn; `/props` →
  `chat_template_tool_use` check; documented go/no-go verdict).
- `.planning/REQUIREMENTS.md` — **CTX-06** (the requirement this phase discharges) and its
  traceability row.

### Prior-art research (already in-repo, read before planning)
- `.planning/research/SUMMARY.md` § "Implications for Roadmap → Phase 1: FastContext
  reliability spike" and the Pitfall-1 discussion — the rationale, the `/props` verification
  note, and the "probe the raw endpoint before wiring" directive.
- `.planning/research/PITFALLS.md` — Pitfall 1 (tool-call reliability degradation), the
  highest-value pitfall this phase exists to neutralize.
- `.planning/research/STACK.md` — llama.cpp `--jinja` requirement and the *unconfirmed*
  Qwen3 native-tool-call-template status (the `/props` check target).
- `.planning/research/ARCHITECTURE.md` — ground-truth on token-miser's `explore` subcommand
  and the FastContext-emits-only / token-miser-executes split (informs D-03/D-04).

### Harness precedent (pattern to mirror)
- `scripts/verify-opencode-live-parity.sh` — the committed, staged, isolated live-probe
  harness pattern the Phase 6 probe script should follow (D-01/D-02).

### External runtime prerequisites (referenced, never vendored)
- Sibling project `~/PARA/Projects/token-miser` (`docs/OVERVIEW.md`, `src/explore/*.rs`) —
  the `token_miser explore` binary + FastContext loop. Referenced by path only; **not**
  vendored into this repo, and its endpoint/model config stays entirely in token-miser's own
  TOML (never in cairnkeep — DEC-no-private-references).
- `mitkox/FastContext-1.0-4B-{SFT,RL}-*-GGUF` Hugging Face model cards — quant details +
  llama.cpp invocation (external; the operator's deployment source).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/verify-opencode-live-parity.sh`: the template for a committed, env-driven,
  staged probe script — reuse its structure (loopback-safe, sourced `.ai/.env`, per-stage
  isolation with generous timeouts).
- Project memory (`local-inference-infra`, `qwen-coder-opencode-toolcall-limits`): the
  deployed-endpoint facts and the OCP-04 tool-call-reliability history — required reading so
  the probe doesn't re-chase proven dead ends (thinking-strip proxy, enable_thinking toggles).

### Established Patterns
- Provider-neutral / loopback-only committed artifacts (Phase 1-5 discipline): no private
  host/IP in anything committed; real endpoints come from gitignored `.ai/.env` at runtime.
- Verify-by-execution bar: a claim isn't "proven" until it runs live and the evidence is
  recorded — this phase's whole point is to hold FastContext to that bar before Phase 7.

### Integration Points
- **None built this phase.** The spike deliberately stops at the raw model endpoint (and,
  optionally, the `token_miser explore` binary). The `cairn-memory` `context_explore` tool,
  its `runCommand` subprocess call, and the operating-layer commands are all Phase 7-8 work
  that this phase's verdict *gates*.

</code_context>

<specifics>
## Specific Ideas

- **Isolate the variable:** verdict anchored to the raw `llama-server` endpoint so a
  model/template/quant problem can't be masked (or manufactured) by token-miser's Rust loop.
- **Don't re-chase OCP-04 dead ends:** thinking-strip proxy hangs opencode; `enable_thinking`
  toggles trade one tool call for another. Those findings are about the *opencode multi-turn
  flow*, which this phase does not touch — the raw-endpoint / curl path was the surface that
  already proved 100% reliable for a good model.
- **Fail loud on "server won't deploy":** an un-standable FastContext server is a documented
  no-go, not a silent skip — the whole point is to never make a silent assumption either way.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. Adjacent work is already scheduled elsewhere:
`context_explore` tool + config (Phase 7), operating-layer commands (Phase 8), token-savings
A/B (Phase 9), and token-miser's HTTP routing proxy (TMISER-R1, future milestone).

</deferred>

---

*Phase: 6-FastContext Reliability Spike*
*Context gathered: 2026-07-04*
