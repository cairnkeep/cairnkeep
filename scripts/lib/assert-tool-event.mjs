#!/usr/bin/env node
// scripts/lib/assert-tool-event.mjs
//
// Reads NDJSON (opencode `run --format json` style events) from stdin and
// exits 0 the moment a genuine tool_use event matches TOOL_EVENT_REGEX (and,
// if TOOL_EVENT_CANARY is set, whose part.state.output contains it); exits 1
// otherwise. A narrated-but-unexecuted mention of a tool name inside a
// "text" event's part.text never matches — only a real top-level
// type === "tool_use" event with part.state.status === "completed" does
// (D-08/D-09, 13-RESEARCH.md Pattern 2).
//
// TOOL_EVENT_REGEX and TOOL_EVENT_CANARY are read ONLY from process.env
// (never argv string-interpolation), so an adversarial canary value can't
// inject into the matcher — mirrors seed_canary()'s env-var-passing idiom
// in scripts/verify-opencode-live-parity.sh.

const toolEventRegexSource = process.env.TOOL_EVENT_REGEX;
if (!toolEventRegexSource) {
  process.stderr.write("assert-tool-event: TOOL_EVENT_REGEX env var is required\n");
  process.exit(1);
}
const toolEventRegex = new RegExp(toolEventRegexSource);
const canary = process.env.TOOL_EVENT_CANARY || "";

let data = "";
process.stdin.on("data", (c) => { data += c; });
process.stdin.on("end", () => {
  for (const line of data.split("\n")) {
    if (!line.trim()) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      // Not a JSON line (e.g. interleaved log noise) — skip, never abort
      // the scan on a malformed line (T-13-01).
      continue;
    }
    if (
      parsed.type === "tool_use" &&
      toolEventRegex.test(parsed.part?.tool || "") &&
      parsed.part?.state?.status === "completed"
    ) {
      if (canary && !String(parsed.part?.state?.output ?? "").includes(canary)) {
        continue;
      }
      process.exit(0);
    }
  }
  process.exit(1);
});
