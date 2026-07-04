# Phase 6 — FastContext Reliability Spike: Go/No-Go Verdict

**Requirement:** CTX-06
**Verdict recorded:** 2026-07-04
**Probe:** `scripts/verify-fastcontext-reliability.sh` (bash + curl + jq), run live against the operator's deployed endpoint via `FASTCONTEXT_PROBE_URL` (loopback-only, never committed — D-02).
**Raw evidence:** `06-EVIDENCE.log` (gitignored via the existing `*.log` rule; scrub-check confirmed no endpoint URL or API key was written).
**Probe hardening (2026-07-04, commit `9df61a7`):** after the initial GO, code review (`06-REVIEW.md`) found CR-01 — the replay answered only `tool_calls[0]` per turn, which could desync a re-run on parallel tool calls and bias toward a *false NO-GO*. It was fixed (reply to every tool_call, id-normalized; plus WR-01/WR-02) and the corrected probe was **re-run live against the same deployed GGUF: 15/15 PASS, GO, `--full` exit 0**. The verdict below is unchanged and now rests on a parallel-call-safe instrument.

---

## VERDICT: GO

**"Reliably invokes tools — safe to build Phase 7 on."**

The actually-deployed FastContext GGUF quant + `llama-server --jinja` combination emits real, well-formed `tool_calls` on **every** turn of the repeated-trial matrix (15/15, zero narration). This is the clean opposite of the OCP-04 narration failure class. The GO opens Phases 7–9 (`context_explore` tool, operating-layer wiring, A/B token-savings) to build on FastContext without re-discovering a tool-calling reliability gap in wired code.

This verdict is anchored to the empirical per-turn gate #2, scored by the refined-D-05 rubric below. The operator confirmed at the plan's `checkpoint:human-verify` that the recorded rubric matches their in-session "Evidence, not hard gate" decision.

---

## Scoring rubric — refined D-05 ("Evidence, not hard gate")

Read literally, D-05 gate #1 ("`chat_template_tool_use` is present") would force a NO-GO for this pinned FastContext GGUF even when it invokes tools reliably every turn, because the field is ABSENT **by architecture** — the model ships a single unified Qwen3-family ChatML template with an inline `{%- if tools %}` / `<tool_call>` XML block, not a separately-named `tool_use` template variant (06-RESEARCH.md finding #1/#4, source-verified against the live Hugging Face Hub metadata for this exact quant).

The operator resolved this in-session, and this verdict applies it:

- The probe records `/props` verbatim (satisfies ROADMAP SC#2).
- The VERDICT is anchored to **gate #2** — ≥5 prompts × ≥3 turns (≥15 turns total), every one `finish_reason == "tool_calls"` with a well-formed, non-empty `tool_calls` array.
- `chat_template_tool_use` **absence is a recorded caveat, NOT an automatic blocker.** Absence alone does not force a NO-GO; presence alone does not force a GO.

The operator confirmed this rubric at the checkpoint before the verdict was finalized. The verdict must never be reinterpreted toward a GO on narrated (content-only) turns, nor toward a NO-GO purely on gate-1 field absence.

---

## D-08 pinned combination (reproducibility)

The exact combination probed, so the verdict is meaningful and re-establishable when the deployed combo changes:

| Dimension | Value (from `/props`) |
|-----------|-----------------------|
| Model weights | FastContext-1.0-4b-rl, q8_0 quant (`fastcontext-1.0-4b-rl-q8_0.gguf`) — the mitkox FastContext-1.0-4B-RL GGUF |
| Server alias | `fastcontext-1.0-4b` |
| llama.cpp build | `build_info b8856-9da7b42f4` (mainline `llama-server`) |
| Context window | `n_ctx 24576` |
| Chat template | PRESENT — single unified Qwen3-family tool-calling template using `<tools></tools>` XML tags (Hermes-2-Pro-style `<tool_call>` convention) |
| `--jinja` | ON (passed explicitly regardless of build default, per 06-RESEARCH.md State of the Art) |
| Launch recipe | `--alias fastcontext-1.0-4b -ngl 99 -c 24576 --jinja --flash-attn on --cache-type-k q4_0 --cache-type-v q4_0`, bound loopback (06-RESEARCH.md finding #4) |
| Endpoint | Loopback base URL supplied via `FASTCONTEXT_PROBE_URL` (redacted; never committed — D-02, DEC-no-private-references) |

**GPU note:** the run used an RTX-class GPU, but the GPU is **NOT the variable under test**. The spike isolates the model weights + chat-template + `--jinja` + quant — all identical to the deployment target. The same GGUF quant + template + `--jinja` were exercised, so the verdict transfers to the deployment.

---

## Gate #1 evidence — `/props` (recorded, not a blocker)

- `build_info`: `b8856-9da7b42f4`
- alias: `fastcontext-1.0-4b`; quant: `q8_0`; `n_ctx`: `24576`
- `chat_template`: **PRESENT** (single unified Qwen3-family tool-calling template, `<tools></tools>` XML tags)
- `chat_template_tool_use`: **ABSENT** — expected for a single-unified-template Qwen3-family GGUF (06-RESEARCH.md finding #1). This is architectural, not a misconfiguration: the model's embedded template branches internally on `{%- if tools %}` rather than exposing a separately-named `tool_use` variant. Per the refined-D-05 rubric, absence alone does **not** force a NO-GO.
- Gate #1 exit code: **0**.

---

## Gate #2 evidence — the anchor (per-turn tool-call matrix)

| Metric | Result |
|--------|--------|
| Matrix | ≥5 prompts × ≥3 turns (≥15 turns total) |
| Turns passing (`finish_reason == "tool_calls"`, well-formed non-empty `tool_calls`) | **15 / 15** |
| Narration / pseudo-tool-call turns | **0 / 15** |
| Malformed / empty `tool_calls` turns | 0 / 15 |
| `--full` exit code | **0** (GO) |

Every turn emitted a real `tool_calls` array. No turn narrated a pseudo-tool-call; there are no raw-argument failures to report. Gate #2 is met at the strict 100% bar D-06 requires for a 4B quant at the raw endpoint.

---

## Forward note for Phase 7

- **Tool-call path/pattern signal:** the probe replies to every tool call with a static stubbed `role:"tool"` result (Pattern 1 — no real filesystem execution, D-03), so Phase 6 does not gate on path sanity. The Docker-mount-path (`/repo-name/...`) hallucination quirk documented in 06-RESEARCH.md / PITFALLS is a **Phase 7 concern** (once the real `context_explore` sandbox is wired), recorded here, not gated on now. Phase 7 planning should add a `resolve_path()`-style normalization shim when wiring real tool execution against the RL checkpoint.
- **D-04 token_miser corroboration:** **skipped — binary absent from PATH.** Corroboration is optional (D-04); the verdict is anchored to the raw endpoint (D-03) and is unaffected by the skip. If `token_miser` becomes available, a single end-to-end `explore` run against a real repo can corroborate the integration path later — corroboration only, never the verdict basis.

---

## Re-runnability

To re-establish this verdict when the deployed combination changes (new quant, new llama.cpp build, template change, or `--jinja` default flip), re-run the committed probe against the operator's endpoint (D-01):

```
export FASTCONTEXT_PROBE_URL=<loopback base URL, e.g. http://127.0.0.1:8081/v1>   # never committed
scripts/verify-fastcontext-reliability.sh --props-only   # gate #1: dump /props
scripts/verify-fastcontext-reliability.sh --full         # gate #2: ≥15-turn matrix, exit 0 = GO
```

The probe records `build_info` and the raw `/props` on every run, so any drift from the D-08 pinned combination above is immediately traceable.

---

## ROADMAP success criteria — satisfied

- **SC#1** — a repeated-trial probe recorded the observed `finish_reason` on every turn (15/15). ✓
- **SC#2** — the probe checked `GET /props` → `chat_template_tool_use` against the deployed build (recorded ABSENT, with the architectural explanation). ✓
- **SC#3** — a documented go/no-go verdict exists in the phase artifacts (this file): **GO**, never a silent assumption. ✓

---

*Phase: 06-fastcontext-reliability-spike — CTX-06*
*Verdict: GO (gate #2: 15/15, exit 0). Scrubbed of any private endpoint/secret; raw evidence in the gitignored 06-EVIDENCE.log.*
