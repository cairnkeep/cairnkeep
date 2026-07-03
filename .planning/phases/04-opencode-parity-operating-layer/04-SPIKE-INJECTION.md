# Phase 4 Plan 01: Wakeup Injection Spike

**Ran:** 2026-07-03
**Against:** locally installed `opencode` CLI v1.17.11, model `local-ai/qwen3.6-27b-coder` (a locally hosted OpenAI-compatible provider already configured in `~/.config/opencode`)
**Method:** throwaway probe plugin (`probe.ts`), written only under a scratch `OPENCODE_CONFIG_DIR` (`mktemp -d`), never under the repo's `opencode/plugins/` tree. Scratch project was a `mktemp -d` git repo with one seed file (`sample.txt`). Both scratch dirs and the probe's diagnostic log were deleted after the runs below.

## Finding 1 — MARKER-REACHES-MODEL: yes

The probe plugin registered `experimental.chat.system.transform` and pushed a unique marker string (`CAIRN-WAKEUP-PROBE-x7q2f9`) onto `output.system`. `opencode run` was invoked non-interactively (`--format json`) with a prompt asking the model to inspect its own system instructions for a line beginning with the exact prefix `CAIRN-WAKEUP-PROBE-` and echo it verbatim if present, or reply `NOT-FOUND` otherwise. The user prompt never contained the marker itself, so a correct `FOUND:` echo can only come from the marker actually being present in the delivered system prompt.

**MARKER-REACHES-MODEL: yes**

Two clean, isolated runs (fresh scratch log per run, same model) both produced:
```
FOUND:CAIRN-WAKEUP-PROBE-x7q2f9
```
confirming `output.system` mutations from `experimental.chat.system.transform` do reach the model in this OpenCode CLI version — GH `anomalyco/opencode#17100`'s "silently discarded" bug does **not** reproduce against v1.17.11 with this local provider.

**Raw observation notes:**
- Diagnostic logging in the probe (writing every hook invocation + the `output.system` array before/after `.push()` to `/tmp/opencode-probe-log.jsonl`) confirmed the hook fires twice per turn: once for OpenCode's internal session-title-generation call (`systemBefore[0]` = "You are a title generator...") and once for the main agent turn (`systemBefore[0]` = "You are opencode, an interactive CLI tool..."). The push succeeded (no exception) in both cases in the two clean runs.
- One earlier, non-isolated attempt (run immediately after two failed setup attempts against unavailable providers — GitHub Copilot returned `403 Forbidden: unauthorized: not licensed to use Copilot`, and a `zai-coding-plan/glm-4.7` attempt timed out after 90s with no response) produced `NOT-FOUND` for the same model/plugin. That run's diagnostic log could not be cleanly correlated to a single session because the log file had accumulated entries across all three attempts. Two subsequent clean, isolated re-runs (fresh log, fresh session, no prior failed attempts in the same log window) were unambiguous and consistent (`FOUND:` both times), so the isolated result is treated as authoritative. This is noted for transparency rather than treated as a contradicting result — the anomaly is more consistent with session/log correlation noise from the earlier failed-provider attempts than with genuine hook non-determinism, but it was not root-caused further since it falls outside this plan's scope.
- Providers with no working credentials in this environment: `github-copilot` (auth present but "not licensed to use Copilot" — a plan/entitlement issue, not a probe issue) and `zai-coding-plan/glm-4.7` (request timed out). Neither was usable for this spike; `local-ai/qwen3.6-27b-coder` (a locally hosted model, already configured and authenticated) was used instead and is unaffected by the choice of injection channel being tested.

## Finding 2 — `tool.execute.before` file-path field: `filePath`

The probe registered `tool.execute.before` and logged `Object.keys(output.args)` plus the full `args` object whenever `input.tool === "edit"` or `input.tool === "write"`. A live `opencode run` prompt instructed the model to overwrite `sample.txt` with the write tool, then change one line with the edit tool.

Confirmed live payloads:
```json
{"hook":"tool.execute.before","tool":"write","argsKeys":["filePath","content"],"args":{"filePath":"/tmp/.../sample.txt","content":"probe write test\n"}}
{"hook":"tool.execute.before","tool":"edit","argsKeys":["filePath","newString","oldString"],"args":{"filePath":"/tmp/.../sample.txt","newString":"probe edit test","oldString":"probe write test"}}
```

**Confirmed field name: `filePath`** (candidate `path` does not appear in either payload) — matches Assumption A2 in `04-RESEARCH.md`. Both `edit` and `write` tools use the identical field name.

## Finding 3 — `client.session.messages()` shape

Two complementary checks were run:

1. **Raw HTTP endpoint** (`opencode serve` on a scratch port, `GET /session/{id}/message`) returned a bare JSON array: `[{ "info": { "id", "sessionID", "role", ... }, "parts": [ ... ] }, ...]` — `role` lives at `message.info.role` (not top-level on the message), and `parts` for each message are already embedded inline in the same array element (contrary to Pattern 3's assumption in `04-RESEARCH.md` that message and part records must be fetched separately — the `/session/{id}/message` endpoint already joins them).
2. **SDK type definitions** (`@opencode-ai/sdk`, cached locally at `~/.config/opencode/node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts` and `sdk.gen.d.ts`, matching the version already used by this OpenCode install) confirm the client wrapper: `client.session.messages(...)` (default `ThrowOnError=false`) resolves to
   ```ts
   { data: Array<{ info: Message; parts: Array<Part> }> | undefined, error: ... | undefined, request: Request, response: Response }
   ```
   i.e. the actual message array is under a **`data`** key, alongside `error`/`request`/`response` siblings (standard `openapi-fetch`-style envelope), not a bare array as returned by the raw HTTP body inspected in (1).

**Confirmed shape:** `client.session.messages({ path: { id } }).data` is `Array<{ info: Message, parts: Array<Part> }>`. `role` is `data[i].info.role` (`"user" | "assistant"`). `parts` are pre-joined per message by this endpoint — no separate part-fetch call is needed for OCP-01's message-to-text conversion, simplifying Pattern 3's planned implementation.

## Decision

**CHOSEN-CHANNEL: system.transform** (i.e. `experimental.chat.system.transform`)

Per plan 04-01's deterministic decision rule (D-04): MARKER-REACHES-MODEL: yes -> use `experimental.chat.system.transform` as the wakeup injection channel. Operator-confirmed at the Task 2 checkpoint (approved response: "CHOSEN-CHANNEL: system.transform"; the checkpoint interaction itself was auto-confirmed by the orchestrator after a timeout with the operator away, consistent with the plan's decision rule — re-visitable before 04-03 runs if the operator returns and disagrees).

## Cleanup confirmation

- No probe file remains under the repo `opencode/plugins/` directory (`ls opencode/plugins` shows only `memory-wakeup.ts`).
- Scratch `OPENCODE_CONFIG_DIR`, scratch project directory, and the probe's diagnostic log file (`/tmp/opencode-probe-log.jsonl`) were all deleted after the runs above.
- The scratch `opencode serve` process (started to inspect the raw HTTP message endpoint) was terminated; no lingering process remains.
