// Cross-platform token_miser fixture. Production accepts native executables
// and JavaScript helpers; the latter are launched through process.execPath so
// the same contract can be tested on POSIX and native Windows.
import { appendFileSync } from "node:fs";

const mode = process.env.FAKE_TOKENMISER_MODE ?? "cited";

if (mode === "exit1") {
    console.error("Error: simulated token_miser failure");
    process.exit(1);
}

if (mode === "garbage") {
    console.log("this is not evidence json");
    process.exit(0);
}

if (mode === "logging" && process.env.EXPLORE_HIT_LOG) {
    appendFileSync(process.env.EXPLORE_HIT_LOG, "invocation\n", "utf8");
}

const crossref = mode === "crossref";
const empty = mode === "empty";
const firstStem = crossref ? "widget" : "foo";
const secondStem = crossref ? "gadget" : "bar";

console.log(JSON.stringify({
    citations: empty ? [] : [
        { path: `src/${firstStem}.rs`, start_line: 10, end_line: 42 },
        { path: `src/${secondStem}.rs`, start_line: 5, end_line: 9 },
    ],
    expanded_snippets: empty ? [] : [
        {
            path: `src/${firstStem}.rs`,
            start_line: 10,
            end_line: 42,
            code: `fn ${firstStem}() {}`,
        },
    ],
    stats: {
        turns: empty ? 1 : 3,
        tool_calls: empty ? 0 : 4,
        hit_turn_cap: false,
        expanded_lines: empty ? 0 : 33,
        expanded_tokens: empty ? 0 : 120,
    },
}));
