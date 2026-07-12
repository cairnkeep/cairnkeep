# Phase 13: Headless Harness Hardening - Pattern Map

**Mapped:** 2026-07-08
**Files analyzed:** 3 (1 script modified in-place across several functions, 2 docs)
**Analogs found:** 3 / 3 (all patterns exist inside the same file being modified, or a sibling verify-script)

## File Classification

No new files. All work modifies existing files. The "file" granularity here is
functions within one script plus doc sections.

| New/Modified Unit | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|---------------|
| `run_stage_remember_recall()` → converted to serve/`--attach` | test-harness stage function | request-response (CLI subprocess + NDJSON stdout) | `run_stage_capture()` (same file, lines 482-526) | exact — already does serve/`--attach` + bounded retry + poll |
| New NDJSON tool-event parser (Node helper) | utility (stdin JSON-line parser) | streaming (NDJSON) | `extract_session_id()` (same file, lines 532-551) | exact — identical idiom (line-split, try/catch JSON.parse, early exit) |
| New `--repeat N` soak loop + evidence table | test-harness orchestration (main dispatch) | batch (loop N iterations) | `main()`'s `--full` case (same file, lines 672-700) + `run_negative_controls()` (line 632-640) | role-match — same "loop stages, accumulate failures, single verdict" shape |
| New preflight probe (D-06) | test-harness staged probe | request-response (single cheap CLI call) | `scripts/verify-fastcontext-reliability.sh` `--self-test`/`--props-only` staged-probe pattern (`usage()` lines 23-45, `inspect_props()`/`assert_tool_call_turn()` ~lines 227-263) | role-match — cheap-gate-before-expensive-run precedent |
| Retry-count-per-iteration logging | cross-cutting (evidence/logging) | transform (annotate PASS/FAIL with retry count) | existing bounded-retry loops in `run_stage_capture()` (lines 496-508) and `run_stage_remember_recall()` (lines 599-606) | exact — same retry-loop shape, needs a counter variable added |
| `docs/operating.md` — trait-based model precondition (D-07) | docs | N/A | Existing `CAIRN_LLM_*` precondition language already in `docs/operating.md` (see `log_env_presence()` env vars, same file lines 288-292, for the exact var names to cross-reference) | role-match |
| `.planning/MILESTONES.md` / `.planning/REQUIREMENTS.md` closeout entries | docs/planning record | N/A | Phase 11's milestone-gate closeout entry (cited in CONTEXT.md D-04 as the precedent to mirror) | exact (precedent named explicitly by CONTEXT.md) |

## Pattern Assignments

### `run_stage_remember_recall()` conversion to serve/`--attach` (D-11)

**Analog:** `run_stage_capture()` and `start_capture_server()`/`stop_capture_server()`, `scripts/verify-opencode-live-parity.sh` lines 441-526.

**Server bring-up pattern** (lines 441-461):
```bash
start_capture_server() {
  CAPTURE_SERVE_LOG=$(mktemp)
  opencode serve --port 0 --hostname 127.0.0.1 >"$CAPTURE_SERVE_LOG" 2>&1 &
  CAPTURE_SERVE_PID=$!

  CAPTURE_SERVE_URL=""
  for _wait_sec in 1 2 3 4 5 6 7 8 9 10; do
    if grep -q "listening on" "$CAPTURE_SERVE_LOG" 2>/dev/null; then
      CAPTURE_SERVE_URL=$(grep -o 'http://[0-9.]*:[0-9]*' "$CAPTURE_SERVE_LOG" | head -1)
      break
    fi
    sleep 1
  done

  if [[ -z "$CAPTURE_SERVE_URL" ]]; then
    echo "[start_capture_server] FAIL: opencode serve did not report a listening URL within 10s" >&2
    cat "$CAPTURE_SERVE_LOG" >&2
    return 1
  fi
  echo "[start_capture_server] OK: $CAPTURE_SERVE_URL (pid=$CAPTURE_SERVE_PID)"
}

stop_capture_server() {
  if [[ -n "$CAPTURE_SERVE_PID" ]]; then
    kill "$CAPTURE_SERVE_PID" 2>/dev/null || true
    wait "$CAPTURE_SERVE_PID" 2>/dev/null || true
    CAPTURE_SERVE_PID=""
  fi
  CAPTURE_SERVE_URL=""
}
```
Reuse verbatim — this is D-11's stated conversion target, not a rewrite.
`start_capture_server`/`stop_capture_server` are already generic (not
capture-stage-specific in name or behavior); `run_stage_remember_recall`
should call them the same way `main()`'s `--full` case already does around
`run_stage_capture`.

**Bounded-retry + `--attach` client-call pattern** (lines 496-508, from `run_stage_capture`):
```bash
local attempts_list="1 2 3"
[[ "$mode" == "unseeded" ]] && attempts_list="1"

local canary found=0
for _attempt in $attempts_list; do
  canary="OCP-06-CAPTURE-${mode}-$(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
  (cd "$project_dir" && timeout 60 opencode run "..." --attach "$CAPTURE_SERVE_URL" --dir "$project_dir" --format json --dangerously-skip-permissions >/dev/null 2>&1) || true
  for _poll_sec in 1 2 3 4 5 6 7 8 9 10; do
    ...
  done
  [[ "$found" -eq 1 ]] && break
done
```
`run_stage_remember_recall`'s existing bounded-retry shape (lines 599-606,
already retrying the recall half) is structurally identical — the change is
(a) add `--attach "$CAPTURE_SERVE_URL"` to both the `/remember` and `/recall`
`opencode run` invocations (currently lines 583 and 601 call bare
`run_opencode`/inline `opencode run` without `--attach`), and (b) per D-13,
split the retry trigger from "no tool event" (current behavior, being
replaced) to "infra failure only" (timeout kill / empty output / connection
reset) — a genuinely-completed run with no tool_use event must fail the
iteration outright, not retry.

**Current pre-hardening code being replaced** (lines 576-626, full function) —
read this in full before editing; it already has session-ID threading via
`extract_session_id()` and the retry loop shape to preserve, just needs the
transport (`--attach`) and assertion (grep → NDJSON parse) swapped in place.

---

### NDJSON tool-event parser (D-08/D-09)

**Analog:** `extract_session_id()`, `scripts/verify-opencode-live-parity.sh` lines 532-551.

```javascript
extract_session_id() {
  node -e '
let data = "";
process.stdin.on("data", (c) => { data += c; });
process.stdin.on("end", () => {
  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.sessionID) {
        process.stdout.write(parsed.sessionID);
        process.exit(0);
      }
    } catch {
      // not a JSON line, skip
    }
  }
});
'
}
```

**New parser to add, matching this idiom exactly** (per RESEARCH.md Pattern 2,
live-pinned event shape — top-level `type === "tool_use"`, tool name at
`part.tool`, JSON-encoded result string at `part.state.output`, status at
`part.state.status`):

```javascript
// Pattern only — wire exact tool-name regex + canary substring per call site
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
        process.exit(0);
      }
    } catch { /* not a JSON line, skip */ }
  }
  process.exit(1);
});
```
For the recall half, swap the tool-name regex to
`/cairn-memory_memory_(search|read)/` and additionally require
`parsed.part.state.output.includes(canary)` (the D-09 canary-linkage
requirement — `part.state.output` is a JSON-encoded **string**, so a plain
substring match on it is sufficient without a second `JSON.parse`).

**Anti-pattern this replaces** (current code, lines 585, 602 — to be deleted):
```bash
if ! echo "$out_remember" | grep -qE "cairn-memory_memory_write|cairn-memory_memory_supersede"; then
...
if echo "$out_recall" | grep -qE "cairn-memory_memory_search|cairn-memory_memory_read" && echo "$out_recall" | grep -qF "$canary"; then
```
This is the exact narrated-vs-executed false-positive class D-08 exists to
close (a model narrating the string inside a `text` event would still match).

---

### `--repeat N` soak loop + evidence table (D-02/D-03/D-04)

**Analog:** `main()`'s `--full` case (lines 672-700) and `run_negative_controls()` (lines 632-640) — both already "run stages, accumulate a `failures` flag, print one aggregate verdict" shapes.

```bash
--full)
  capture_real_config_fingerprint
  setup_scratch
  seed_canary seeded
  ...
  local failures=0
  run_stage_wakeup "$SCRATCH_PROJECT" seeded || failures=1
  ...
  if [[ "$failures" -ne 0 ]]; then
    echo "[main:--full] ONE OR MORE STAGES FAILED" >&2
    return 1
  fi
  echo "[main:--full] ALL STAGES PASSED"
  ;;
```
New `--repeat N` case wraps this same per-run sequence (`capture_real_config_fingerprint`
→ `setup_scratch` → `seed_canary` → `install_assets` → `write_scratch_config`
→ `positive_load_check` → `start_capture_server` → `run_stage_remember_recall`
→ `stop_capture_server` → scratch cleanup) inside a `for i in $(seq 1 "$N")`
loop, recording a PASS/FAIL + retry-count row per iteration into an array/log
(new — no existing table-formatting code in this file to imitate; keep it as
plain `echo` lines matching the file's existing bracketed-tag log style,
e.g. `[repeat:3/5] PASS (retries=1)`), then a final aggregate line
`[repeat] 5/5 PASSED` or `[repeat] FAIL: N/5` and non-zero exit if any
iteration failed. `cleanup()` (lines 87-141, not fully read but referenced
throughout) already exists for per-run teardown/fingerprint-guard reuse per
iteration.

**Usage/help text pattern to extend** (lines 19-49, `usage()`):
```bash
usage() {
  cat <<'EOF'
Usage: verify-opencode-live-parity.sh --setup-only [seeded|unseeded]
       verify-opencode-live-parity.sh --stage wakeup
       verify-opencode-live-parity.sh --full
...
EOF
}
```
Add a `--repeat N` line to this same heredoc, following the existing
option-doc format (one-line usage synopsis + indented paragraph explaining
behavior), matching `verify-explore-maturation.sh`/`verify-routing-seam.sh`'s
staged-output help-text conventions per RESEARCH.md's Don't-Hand-Roll table.

---

### Preflight probe (D-06)

**Analog:** `scripts/verify-fastcontext-reliability.sh` staged-probe structure — `usage()` (lines 23-45) documents `--self-test` (offline canned-fixture) vs `--props-only` (live, cheap, single fetch) vs presumably a `--full` expensive multi-turn mode; `assert_tool_call_turn()` (~line 246) is the closest existing "did this turn produce a genuine tool call" assertion helper in the codebase, worth reading in full before writing the new probe's assertion logic since it may already encode the "narration vs real call" distinction this phase needs.

**Design per RESEARCH.md Architecture Patterns / Pattern 3:** one `opencode
run` turn forcing a single tool call (recommend a real `cairn-memory` tool
call per RESEARCH.md's Open Question 2 answer — reuses the same
`setup_scratch`/`install_assets`/`write_scratch_config` sequence that already
runs once, so no new setup path is needed), parsed with the same NDJSON
tool_use parser as above. Must also check `CAIRN_LLM_API_KEY`/
`CAIRN_LLM_API_URL`/`CAIRN_LLM_EXTRACTION_MODEL` are non-empty **before**
spending the probe's timeout budget (Pitfall 2 — empty config hangs forever
rather than failing fast) — `log_env_presence()` (lines 288-292) already
knows how to check these three vars, but only logs presence, doesn't gate on
it; the probe needs a fail-fast branch using the same three var names.

Fail message must name the trait per specifics: `"model is not
tool-call-reliable (no-thinking required) — see docs/operating.md"`.

---

## Shared Patterns

### Env-var presence logging (never log values)
**Source:** `log_env_presence()`, `scripts/verify-opencode-live-parity.sh` lines 288-292
```bash
log_env_presence() {
  echo "[env] CAIRN_LLM_API_KEY set: $([[ -n "${CAIRN_LLM_API_KEY:-}" ]] && echo yes || echo no)" >&2
  echo "[env] CAIRN_LLM_API_URL set: $([[ -n "${CAIRN_LLM_API_URL:-}" ]] && echo yes || echo no)" >&2
  echo "[env] CAIRN_LLM_EXTRACTION_MODEL set: $([[ -n "${CAIRN_LLM_EXTRACTION_MODEL:-}" ]] && echo yes || echo no)" >&2
}
```
**Apply to:** the preflight probe's fail-fast env check (D-06/Pitfall 2) and any new FAIL branch in the `--repeat` loop — call this existing function rather than re-deriving env-presence checks.

### Bracketed-tag logging convention
**Source:** every function in `scripts/verify-opencode-live-parity.sh`, e.g. `echo "[run_stage_wakeup:$mode] OK: ..."`, `echo "[start_capture_server] FAIL: ..."`
**Apply to:** all new log lines (preflight probe, `--repeat` per-iteration rows, aggregate verdict) — use `[repeat:i/N]`, `[preflight]` style tags consistent with the existing `[function_name:mode]` pattern.

### `run_opencode()` thin wrapper
**Source:** lines 302-307
```bash
run_opencode() {
  local project_dir="$1"; shift
  local timeout_secs="$1"; shift
  local prompt="$1"; shift
  (cd "$project_dir" && timeout "$timeout_secs" opencode run "$prompt" --dir "$project_dir" --format json --dangerously-skip-permissions "$@" 2>&1)
}
```
**Apply to:** the converted `run_stage_remember_recall`'s calls should still route through `run_opencode` where possible, passing `--attach "$CAPTURE_SERVE_URL"` as one of the trailing `"$@"` args (this wrapper already forwards extra args) rather than hand-rolling a new inline subshell like `run_stage_capture` currently does. Note: `run_stage_capture` bypasses `run_opencode` entirely with its own inline `(cd ... && timeout ...)` call (line 498) — the planner should decide whether to route through `run_opencode` (cleaner, D-11 precedent partially diverges here) or mirror `run_stage_capture`'s inline call exactly; either is defensible, `run_opencode`'s `"$@"` forwarding makes the former slightly less duplicative.

### CANARY_PREFIX / canary generation
**Source:** line 313 (`CANARY_PREFIX="OCP-06-CANARY"`) and `od -An -N6 -tx1 /dev/urandom | tr -d ' \n'` used throughout (e.g. line 497, 582, 617)
**Apply to:** no change needed — existing canary generation is reused as-is by the hardened stage; only the transport/assertion around it changes.

## No Analog Found

None. Every unit of work in this phase modifies functions that already exist
in `scripts/verify-opencode-live-parity.sh`, or has a directly-cited sibling
pattern in `scripts/verify-fastcontext-reliability.sh`. This matches
RESEARCH.md's own conclusion: "this is a composition task, not a
design-from-scratch task."

## Metadata

**Analog search scope:** `scripts/verify-opencode-live-parity.sh` (primary
subject, read in full across two passes), `scripts/verify-fastcontext-reliability.sh`
(preflight-probe precedent, function names grepped, `usage()` block read).
**Files scanned:** 2 shell scripts (711 + partial lines).
**Pattern extraction date:** 2026-07-08
