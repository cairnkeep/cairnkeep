import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "../dist/trajectory-cli.js");
const fixture = join(here, "fixtures", "trajectory-opencode.json");
const scratch = mkdtempSync(join(tmpdir(), "cairn-trajectory-redaction-"));
const repo = join(scratch, "project");
const config = join(repo, ".ai", "trajectory-redaction.json");
const sentinels = [
    "sk-redact-opencode-123",
    "hidden-opencode-bearer",
    "opencode-password",
    "INTERNAL-OPENCODE-7788",
    "exact-env-secret-9911",
];

function run(args, options = {}) {
    const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: options.cwd ?? repo,
        encoding: "utf8",
        input: options.input,
        env: {
            ...process.env,
            CAIRN_TRAJECTORY_REDACTION_FILE: config,
            PRIVATE_TEST_TOKEN: "exact-env-secret-9911",
            ...options.env,
        },
    });
    return result;
}

try {
    mkdirSync(join(repo, ".agentfs"), { recursive: true });
    mkdirSync(join(repo, ".ai"), { recursive: true });
    writeFileSync(config, JSON.stringify({
        version: 1,
        patterns: [{ pattern: "INTERNAL-[A-Z]+-[0-9]+", flags: "g", replacement: "$&" }],
    }));
    const raw = JSON.parse(readFileSync(fixture, "utf8"));
    raw.messages[0].parts[0].text += " exact-env-secret-9911";
    raw.messages[1].parts[2].state.output += " https://alice:supersecret@example.test/path";
    raw.messages[2].parts[0].text += "\n-----BEGIN PRIVATE KEY-----\nSYNTHETICKEY\n-----END PRIVATE KEY-----";

    const captured = run(["capture-opencode", repo], { input: JSON.stringify(raw) });
    assert.equal(captured.status, 0, captured.stderr);
    const shown = run(["show", "opencode-session-001", "--json"]);
    assert.equal(shown.status, 0, shown.stderr);
    const listed = run(["list", "--json"]);
    assert.equal(listed.status, 0, listed.stderr);

    const dbBytes = readFileSync(join(repo, ".agentfs", "trajectory.db")).toString("utf8");
    const allOutput = `${captured.stdout}\n${captured.stderr}\n${shown.stdout}\n${shown.stderr}\n${listed.stdout}\n${listed.stderr}\n${dbBytes}`;
    for (const sentinel of sentinels) {
        assert.equal(allOutput.includes(sentinel), false, `secret leaked: ${sentinel}`);
    }
    assert.doesNotMatch(allOutput, /alice:supersecret/);
    assert.doesNotMatch(allOutput, /SYNTHETICKEY/);
    assert.match(shown.stdout, /\[REDACTED/);
    assert.match(shown.stdout, /\$&/, "custom replacements must be inserted literally");

    writeFileSync(config, JSON.stringify({ version: 1, patterns: [{ pattern: "[invalid" }] }));
    raw.session.id = "invalid-config-session";
    const invalid = run(["capture-opencode", repo], { input: JSON.stringify(raw) });
    assert.equal(invalid.status, 0, "capture must fail open for an invalid redaction config");
    const absent = run(["show", "invalid-config-session", "--json"]);
    assert.notEqual(absent.status, 0, "invalid config must prevent persistence");
    assert.doesNotMatch(`${invalid.stdout}${invalid.stderr}`, /sk-redact|hidden-opencode|opencode-password/);
    console.log("PASS: trajectory pre-write redaction and fail-closed config");
} finally {
    rmSync(scratch, { recursive: true, force: true });
}
