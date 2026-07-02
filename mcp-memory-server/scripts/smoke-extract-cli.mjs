// Smoke test for the extract CLI path. Verifies offline behavior without
// network access, and exercises the live extraction path only when the LLM
// extraction environment is configured.
//
// Run: node scripts/smoke-extract-cli.mjs   (after `npm run build`)
import { spawn } from "node:child_process";

let failures = 0;

function check(name, cond, details = "") {
    if (cond) {
        console.log(`ok: ${name}`);
    } else {
        console.error(`FAIL: ${name}${details ? ` (${details})` : ""}`);
        failures += 1;
    }
}

function runExtract({ input = "", args = [], env = process.env } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn("node", ["dist/index.js", "extract", ...args], {
            env,
            stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";

        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
        });

        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
        });

        child.on("error", reject);
        child.on("close", (exitCode) => {
            resolve({ exitCode, stdout, stderr });
        });

        child.stdin.end(input);
    });
}

async function pickLiveExtractionModel() {
    const apiKey = process.env.CAIRN_LLM_API_KEY;
    if (!apiKey) {
        return null;
    }

    const rawUrl = process.env.CAIRN_LLM_API_URL;
    if (!rawUrl) {
        return null;
    }
    const apiUrl = rawUrl.trim().replace(/\/+$/, "");
    const response = await fetch(`${apiUrl}/models`, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
        },
    });

    if (!response.ok) {
        throw new Error(`Model discovery failed with ${response.status}`);
    }

    const payload = await response.json();
    const modelIds = Array.isArray(payload.data)
        ? payload.data
            .map((item) => (item && typeof item.id === "string" ? item.id : null))
            .filter((id) => typeof id === "string")
        : [];

    const preferred = [
        process.env.CAIRN_LLM_EXTRACTION_MODEL,
        "gpt-4o",
        "gpt-4o-mini",
    ].filter(Boolean);

    for (const candidate of preferred) {
        if (modelIds.includes(candidate)) {
            return candidate;
        }
    }

    return modelIds.find((id) => !/embed/i.test(id)) ?? null;
}

// 1. Offline: empty stdin should fail before any network call.
const empty = await runExtract();
check(
    "extract CLI rejects empty stdin",
    empty.exitCode === 1 && empty.stderr.includes("No input provided on stdin."),
    `exit=${empty.exitCode} stderr=${JSON.stringify(empty.stderr.trim())}`,
);

// 2. Offline: non-empty stdin without API key should fail cleanly.
const envWithoutKey = { ...process.env };
delete envWithoutKey.CAIRN_LLM_API_KEY;
const noKey = await runExtract({
    input: "We decided retries must be centralized in the provider gateway.",
    env: envWithoutKey,
});
check(
    "extract CLI requires an LLM API key",
    noKey.exitCode === 1 && noKey.stderr.includes("CAIRN_LLM_API_KEY is not set."),
    `exit=${noKey.exitCode} stderr=${JSON.stringify(noKey.stderr.trim())}`,
);

// 3. Live extraction only when configured.
if (!process.env.CAIRN_LLM_API_KEY) {
    console.log("skip: live extraction (CAIRN_LLM_API_KEY not set)");
} else {
    const liveModel = await pickLiveExtractionModel();
    if (!liveModel) {
        console.log("skip: live extraction (no chat-capable model available from /models)");
    } else {
    const live = await runExtract({
        input: [
            "We implemented centralized retry handling in the provider gateway.",
            "Root cause was retry fanout creating duplicate token refresh calls.",
            "New invariant: all provider retries must pass through the gateway.",
        ].join(" "),
        args: [liveModel, "decision"],
    });

    check(
        "live extraction exits successfully",
        live.exitCode === 0,
        `exit=${live.exitCode} stderr=${JSON.stringify(live.stderr.trim())}`,
    );

    let parsed = null;
    try {
        parsed = JSON.parse(live.stdout);
    } catch (error) {
        check("live extraction returns valid JSON", false, String(error));
    }

    if (parsed) {
        check("live extraction returns model", typeof parsed.model === "string" && parsed.model.length > 0);
        check("live extraction returns count", Number.isInteger(parsed.count) && parsed.count >= 0);
        check("live extraction returns candidates array", Array.isArray(parsed.candidates));
        if (Array.isArray(parsed.candidates)) {
            check(
                "live extraction count matches candidates length",
                parsed.count === parsed.candidates.length,
            );
            for (const candidate of parsed.candidates) {
                check(
                    "live extraction candidate shape",
                    typeof candidate.key === "string" && candidate.key.length > 0
                        && typeof candidate.value === "string" && candidate.value.length > 0,
                    JSON.stringify(candidate),
                );
            }
        }
    }
    }
}

if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
}

console.log("\nAll extract CLI smoke checks passed");
