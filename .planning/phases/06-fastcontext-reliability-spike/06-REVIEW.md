---
phase: 06-fastcontext-reliability-spike
reviewed: 2026-07-04T00:00:00Z
depth: standard
files_reviewed: 1
files_reviewed_list:
  - scripts/verify-fastcontext-reliability.sh
findings:
  critical: 1
  warning: 2
  info: 2
  total: 5
status: resolved
resolved: 2026-07-04
resolution_commit: 9df61a7
resolution_note: CR-01, WR-01, WR-02 fixed and reconfirmed by a live 15/15 GO re-run; IN-01/IN-02 left as accepted info-level notes.
---

# Phase 6: Code Review Report

**Reviewed:** 2026-07-04
**Depth:** standard
**Files Reviewed:** 1
**Status:** resolved (fixes in `9df61a7`; live re-run reconfirmed GO 15/15)

> **Resolution (2026-07-04, commit `9df61a7`):** CR-01 fixed — the replay now
> normalizes every tool_call id and sends one `role:"tool"` reply per call, so
> parallel/id-less calls no longer desync the transcript; a new offline
> `[self-test:parallel]` guards it. WR-01 fixed — a malformed 2xx body is now
> recorded as a per-turn FAIL instead of aborting the probe under `set -e`.
> WR-02 fixed — token_miser corroboration output is kept out of the evidence log
> (redacted status line only). IN-01/IN-02 accepted as info-level, not changed.
> The corrected probe was re-run live against the deployed GGUF: **15/15 turns
> PASS, VERDICT GO, `--full` exit 0** — the verdict is unchanged.

## Summary

Reviewed `scripts/verify-fastcontext-reliability.sh`, a bash+curl+jq probe that
drives a local llama-server `/v1/chat/completions` endpoint and computes a
GO/NO-GO tool-call-reliability verdict.

Positives verified: request bodies are built with `jq -n` (no shell/`eval`
injection), the probe URL is validated against `^https?://` before use and is
never echoed/logged, the evidence-log path defaults to a `*.log` file that
`.gitignore` genuinely excludes (`git check-ignore` confirms), and the verdict
scoring (`GO` iff every matrix turn passed and `MATRIX_TOTAL>0`) is correct with
sound offline self-tests.

However, the multi-turn conversation-replay logic contains a correctness defect
that can corrupt the very metric the script exists to produce, plus two
robustness/leak-invariant gaps. Findings below.

## Critical Issues

### CR-01: Tool-result reply only handles the first tool_call and requires `.id`, desyncing the multi-turn conversation

**File:** `scripts/verify-fastcontext-reliability.sh:332-336`
**Issue:**
After each turn the script appends the assistant message (which may contain
*multiple* `tool_calls`) but replies with at most **one** stubbed tool result:

```bash
tool_call_id=$(echo "$response" | jq -r '.choices[0].message.tool_calls[0].id // empty')
if [[ -n "$tool_call_id" ]]; then
  tool_msg=$(tool_result_message "$tool_call_id")
  messages=$(echo "$messages" | jq --argjson t "$tool_msg" '. + [$t]')
fi
```

Two ways this desyncs the OpenAI-protocol conversation that is then re-sent on
the next turn:

1. **Parallel tool calls.** Exploration agents (and Qwen3-family tool models in
   particular) frequently emit 2+ tool calls in one assistant turn. The next
   request then carries an assistant message with N `tool_calls` but only 1
   `role:"tool"` reply. Most llama.cpp jinja tool templates treat this as a
   malformed transcript, biasing turns 2..N toward narration/`finish_reason:stop`
   — i.e. a **false FAIL / false NO-GO**.
2. **Missing/empty id.** When `tool_calls[0].id` is absent (some llama.cpp
   builds omit or vary this field), the `// empty` branch silently appends *no*
   tool result at all, leaving the prior assistant `tool_calls` turn unanswered
   and again desyncing every subsequent turn.

Because the script's sole output is a trustworthy per-turn tool-call verdict,
this can systematically convert genuine tool-call successes into downstream
failures and flip GO to NO-GO. That is incorrect behavior in the primary code
path, not a style issue.

**Fix:** Emit exactly one `role:"tool"` reply per tool_call in the assistant
message, keyed by each call's id (falling back to a synthesized id when the
server omits it), and only continue the loop when at least one tool_call was
present:

```bash
# collect every tool_call id (synthesize when absent) and append one reply each
mapfile -t call_ids < <(echo "$response" | jq -r \
  '.choices[0].message.tool_calls // [] | to_entries[]
   | (.value.id // "call_\(.key)")')
if [[ "${#call_ids[@]}" -gt 0 ]]; then
  for cid in "${call_ids[@]}"; do
    tool_msg=$(tool_result_message "$cid")
    messages=$(echo "$messages" | jq --argjson t "$tool_msg" '. + [$t]')
  done
fi
```

Note: if ids are synthesized, the assistant message re-sent in `messages` must
carry the *same* synthesized ids, so backfill them onto `assistant_msg` before
appending it at line 329-330 rather than sending server-omitted ids.

## Warnings

### WR-01: Malformed 2xx response aborts the entire probe mid-matrix under `set -euo pipefail`

**File:** `scripts/verify-fastcontext-reliability.sh:250-251, 310-313, 315, 323`
**Issue:**
`response` comes from `curl -sf` (2xx only), but a truncated or non-JSON 2xx body
is still possible. The parse then happens in plain command substitutions and a
bare pipeline:

```bash
finish_reason=$(echo "$response_json" | jq -r '...')          # line 250
n_calls=$(echo "$response_json" | jq '... | length? // 0')    # line 251/315
echo "$response" | jq -c '...arguments // empty' 2>/dev/null | while ...  # line 310
```

I confirmed that under `set -euo pipefail` a jq **parse** error (not suppressible
by `?`) makes both a plain assignment and a bare pipeline exit non-zero and abort
the script:

```
$ bash -c 'set -euo pipefail; n=$(echo "not json" | jq ".x|length?//0"); echo survived'
jq: parse error: Invalid numeric literal at line 1, column 4   # -> exit 5, "survived" never prints
```

So a single malformed body kills the whole run — `run_turn_matrix` never
finishes, `finalize_evidence_log` never runs, and the operator gets an opaque
non-zero exit instead of the intended per-turn `FAIL` record. This defeats the
D-07/D-08 "never a silent skip / always record" intent.

**Fix:** Treat a jq/parse failure on a response as a recorded FAIL rather than a
fatal abort, e.g. guard the parse:

```bash
if ! finish_reason=$(printf '%s' "$response" | jq -re '.choices[0].finish_reason // "missing"' 2>/dev/null); then
  result="FAIL"; finish_reason="unparseable"; n_calls=0
  MATRIX_RESULTS+=("$prompt_idx|$turn_idx|FAIL|unparseable|0")
  append_evidence "[matrix] prompt=$prompt_idx turn=$turn_idx result=FAIL reason=unparseable-response"
  continue
fi
```

and apply the same guard to the `tool-call-args` logging pipeline (or drop its
reliance on the bare-pipeline exit status).

### WR-02: `run_token_miser_corroboration` writes unscrubbed subprocess output, breaking the "URL/secret never written" invariant

**File:** `scripts/verify-fastcontext-reliability.sh:362-374`
**Issue:**
The script repeatedly asserts (header comment, `log_endpoint_presence`,
`finalize_evidence_log` line 406) that the endpoint URL and any credential are
never written to the evidence log. But stage 3 appends `token_miser explore`'s
raw stdout/stderr verbatim:

```bash
out=$(cd "$ROOT_DIR" && timeout 60 token_miser explore --repo-root . 2>&1) || true
append_evidence "[stage-3] token_miser corroboration output:"
append_evidence "$out"
```

`token_miser` reads endpoint/credential config from the ambient env / `.ai/.env`
and may echo an endpoint URL, alias, or diagnostic banner into that captured
output — which then lands unfiltered in the log the script elsewhere promises is
scrub-clean. The `*.log` gitignore mitigates *committing* it, but the invariant
the script advertises is still violated on disk.

**Fix:** Either redact known-sensitive tokens from `$out` before appending, or
record only a bounded, structured summary (e.g. exit status + first N lines with
URL-shaped substrings masked) rather than raw `2>&1` output; and soften the
"never contains ... URL" scrub-check line so it does not overstate the guarantee.

## Info

### IN-01: Evidence-log scrub safety depends entirely on the `.log` file extension

**File:** `scripts/verify-fastcontext-reliability.sh:63-65, 74`
**Issue:** `FASTCONTEXT_EVIDENCE_LOG` is operator-overridable and the "excluded
from commits" guarantee rests solely on `.gitignore`'s `*.log` rule. An override
to any non-`.log` path (e.g. `06-EVIDENCE.txt`) would make the raw model outputs,
`build_info`, and `chat_template` commitable.
**Fix:** Validate the override ends in `.log` (or lives under an ignored dir), or
document the extension requirement in the `--help` Environment section.

### IN-02: Duplicated `mkdir -p "$(dirname ...)"` log-dir bootstrap

**File:** `scripts/verify-fastcontext-reliability.sh:186, 209`
**Issue:** The parent-dir creation is repeated in `append_evidence` and
`record_props_evidence`. Minor duplication.
**Fix:** Factor a single `ensure_log_dir <path>` helper, or rely on
`append_evidence` consistently.

---

_Reviewed: 2026-07-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
